import { z } from "zod";
import { prisma } from "../db.js";
import {
  generateLicenseKey,
  hashLicenseKey,
  extractKeyPrefix,
} from "./keyService.js";
import {
  sendAdminEmail,
  buildCustomerCreatedEmail,
  buildPlanChangedEmail,
  buildModulesChangedEmail,
  buildLicenseRenewedEmail,
  buildLicenseSuspendedEmail,
  buildLicenseReinstatedEmail,
  buildLicenseKeyReissuedEmail,
} from "./email.js";
import { LicensePlan } from "@prisma/client";
import { MODULE_NAMES, ModuleName } from "../contract/license-token.js";
import { normalizeDomain, parseAllowedDomains } from "./domainUtils.js";

export const CreateCustomerWithLicenseSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  domain: z.string().trim().min(1, "Primary domain is required"),
  adminEmail: z
    .string({ required_error: "Admin email is required" })
    .trim()
    .min(1, "Admin email is required")
    .email("Valid admin email is required")
    .transform((val) => val.toLowerCase()),
  plan: z.enum(["basic", "business", "enterprise"]),
  expiresAt: z.date(),
  graceDays: z.number().int().nonnegative().default(14),
  notes: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  contactPhone: z.string().trim().optional(),
  actor: z.string().min(1),
});

export async function createCustomerWithLicense(
  rawInput: z.input<typeof CreateCustomerWithLicenseSchema>
) {
  const input = CreateCustomerWithLicenseSchema.parse(rawInput);

  const plainKey = generateLicenseKey();
  const keyHash = hashLicenseKey(plainKey);
  const keyPrefix = extractKeyPrefix(plainKey);

  const result = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        companyName: input.companyName,
        status: "active",
        notes: input.notes || null,
        contactName: input.contactName || null,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
      },
    });

    const cleanDomain = normalizeDomain(input.domain) || input.domain;
    const allowed = parseAllowedDomains([], input.domain);

    const deployment = await tx.deployment.create({
      data: {
        customerId: customer.id,
        domain: cleanDomain,
        allowedDomains: allowed,
      },
    });

    const license = await tx.license.create({
      data: {
        customerId: customer.id,
        keyHash,
        keyPrefix,
        plan: input.plan as LicensePlan,
        expiresAt: input.expiresAt,
        graceDays: input.graceDays,
        status: "active",
        adminEmail: input.adminEmail,
      },
    });

    await tx.auditLog.create({
      data: {
        actor: input.actor,
        action: "customer:create",
        entityType: "Customer",
        entityId: customer.id,
        after: {
          companyName: customer.companyName,
          domain: deployment.domain,
          plan: license.plan,
          licenseId: license.id,
          keyPrefix: license.keyPrefix,
          adminEmail: license.adminEmail,
          expiresAt: license.expiresAt.toISOString(),
          graceDays: license.graceDays,
        },
      },
    });

    return { customer, deployment, license };
  });

  // Asynchronously send notification email (failure does not roll back)
  const emailPayload = buildCustomerCreatedEmail({
    customerId: result.customer.id,
    companyName: result.customer.companyName,
    domain: result.deployment.domain,
    plan: result.license.plan,
    actor: input.actor,
    adminEmail: input.adminEmail,
  });
  await sendAdminEmail({
    event: "customer_created",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "Customer",
    entityId: result.customer.id,
  });

  return {
    customer: result.customer,
    deployment: result.deployment,
    license: result.license,
    plainLicenseKey: plainKey,
  };
}

export interface ChangePlanInput {
  customerId?: string;
  licenseId?: string;
  plan: "basic" | "business" | "enterprise";
  actor: string;
}

export async function changePlanAndIssueNewLicense(params: ChangePlanInput) {
  if (!params.customerId && !params.licenseId) {
    throw new Error("Either customerId or licenseId must be provided.");
  }

  // 1. Locate customer
  let customerId = params.customerId;
  if (!customerId && params.licenseId) {
    const lic = await prisma.license.findUnique({
      where: { id: params.licenseId },
      select: { customerId: true },
    });
    if (lic) {
      customerId = lic.customerId;
    } else {
      const cust = await prisma.customer.findUnique({
        where: { id: params.licenseId },
        select: { id: true },
      });
      if (cust) {
        customerId = cust.id;
      } else {
        throw new Error(`Neither License nor Customer with ID '${params.licenseId}' found.`);
      }
    }
  }

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: {
      licenses: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  // Check currently active licenses for this customer
  const currentActive = customer.licenses.filter((l) => l.status === "active");
  const primaryLicense = currentActive[0] || customer.licenses[0];

  if (primaryLicense && primaryLicense.plan === params.plan && primaryLicense.status === "active") {
    throw new Error(`Customer '${customer.companyName}' is already on the '${params.plan}' plan.`);
  }

  // Generate completely new license key
  const plainLicenseKey = generateLicenseKey();
  const keyHash = hashLicenseKey(plainLicenseKey);
  const keyPrefix = extractKeyPrefix(plainLicenseKey);

  // Inherit expiration, grace period, and admin email from primary license
  const expiresAt = primaryLicense ? primaryLicense.expiresAt : new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const graceDays = primaryLicense ? primaryLicense.graceDays : 14;
  const adminEmail = primaryLicense?.adminEmail || customer.contactEmail || null;
  const oldPlan = primaryLicense?.plan || "basic";

  const result = await prisma.$transaction(async (tx) => {
    // 2. Atomically suspend all currently active licenses for this customer ONLY
    if (currentActive.length > 0) {
      await tx.license.updateMany({
        where: {
          customerId: customer.id,
          status: "active",
        },
        data: {
          status: "suspended",
        },
      });

      // Record audit logs for suspending previous active license(s)
      for (const oldLic of currentActive) {
        await tx.auditLog.create({
          data: {
            actor: params.actor,
            action: "license:suspend",
            entityType: "License",
            entityId: oldLic.id,
            before: { status: "active", plan: oldLic.plan },
            after: {
              status: "suspended",
              reason: `Plan changed to ${params.plan}. Superseded by new license.`,
            },
          },
        });
      }
    }

    // 3. Create the brand-new license with the selected plan and status: active
    const newLicense = await tx.license.create({
      data: {
        customerId: customer.id,
        keyHash,
        keyPrefix,
        plan: params.plan as LicensePlan,
        expiresAt,
        graceDays,
        status: "active",
        adminEmail,
      },
      include: { customer: true },
    });

    // 4. Audit logs for plan change and new license issuance
    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:plan-change",
        entityType: "License",
        entityId: newLicense.id,
        before: primaryLicense
          ? {
              licenseId: primaryLicense.id,
              plan: oldPlan,
              keyPrefix: primaryLicense.keyPrefix,
              status: primaryLicense.status,
            }
          : undefined,
        after: {
          licenseId: newLicense.id,
          plan: params.plan,
          keyPrefix: newLicense.keyPrefix,
          status: "active",
          ...(primaryLicense ? { supersedesLicenseId: primaryLicense.id } : {}),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "customer:change-plan",
        entityType: "Customer",
        entityId: customer.id,
        before: { plan: oldPlan, licenseId: primaryLicense?.id },
        after: {
          plan: params.plan,
          licenseId: newLicense.id,
          keyPrefix: newLicense.keyPrefix,
        },
      },
    });

    return {
      customer,
      oldLicense: primaryLicense,
      newLicense,
      plainLicenseKey,
    };
  });

  // 5. Asynchronously send notification email (outside transaction)
  const emailPayload = buildPlanChangedEmail({
    customerId: result.customer.id,
    companyName: result.customer.companyName,
    oldLicenseId: result.oldLicense?.id,
    newLicenseId: result.newLicense.id,
    oldKeyPrefix: result.oldLicense?.keyPrefix,
    newKeyPrefix: result.newLicense.keyPrefix,
    oldPlan,
    newPlan: params.plan,
    actor: params.actor,
  });

  await sendAdminEmail({
    event: "plan_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.newLicense.id,
  });

  return result;
}

// Deprecated in-place wrapper that now safely delegates to changePlanAndIssueNewLicense
export async function changePlan(params: {
  licenseId?: string;
  customerId?: string;
  plan: "basic" | "business" | "enterprise";
  actor: string;
}) {
  return changePlanAndIssueNewLicense(params);
}

export async function setModule(_params: {
  licenseId: string;
  module: string;
  enabled: boolean;
  actor: string;
}) {
  throw new Error(
    "Individual module overrides are disabled. Module configuration is completely plan-based."
  );
}

export async function renewLicense(params: {
  licenseId: string;
  expiresAt: Date;
  actor: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    const beforeExpiry = license.expiresAt.toISOString();
    const updated = await tx.license.update({
      where: { id: params.licenseId },
      data: { expiresAt: params.expiresAt },
      include: { customer: true },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:renew",
        entityType: "License",
        entityId: params.licenseId,
        before: { expiresAt: beforeExpiry },
        after: { expiresAt: params.expiresAt.toISOString() },
      },
    });

    return updated;
  });

  const emailPayload = buildLicenseRenewedEmail({
    companyName: result.customer.companyName,
    licenseId: result.id,
    newExpiry: params.expiresAt.toISOString().slice(0, 10),
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "license_renewed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.id,
  });

  return result;
}

export async function suspendLicense(params: {
  licenseId: string;
  actor: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    const updated = await tx.license.update({
      where: { id: params.licenseId },
      data: { status: "suspended" },
      include: { customer: true },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:suspend",
        entityType: "License",
        entityId: params.licenseId,
        before: { status: license.status },
        after: { status: "suspended" },
      },
    });

    return updated;
  });

  const emailPayload = buildLicenseSuspendedEmail({
    companyName: result.customer.companyName,
    licenseId: result.id,
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "license_suspended",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.id,
  });

  return result;
}

export async function reinstateLicense(params: {
  licenseId: string;
  actor: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    // Ensure only one active license exists for this customer at a time
    await tx.license.updateMany({
      where: {
        customerId: license.customerId,
        status: "active",
        NOT: { id: license.id },
      },
      data: { status: "suspended" },
    });

    const updated = await tx.license.update({
      where: { id: params.licenseId },
      data: { status: "active" },
      include: { customer: true },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:reinstate",
        entityType: "License",
        entityId: params.licenseId,
        before: { status: license.status },
        after: { status: "active" },
      },
    });

    return updated;
  });

  const emailPayload = buildLicenseReinstatedEmail({
    companyName: result.customer.companyName,
    licenseId: result.id,
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "license_reinstated",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.id,
  });

  return result;
}

export async function reissueLicenseKey(params: {
  licenseId: string;
  actor: string;
}) {
  const newPlainKey = generateLicenseKey();
  const newKeyHash = hashLicenseKey(newPlainKey);
  const newKeyPrefix = extractKeyPrefix(newPlainKey);

  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    const oldKeyPrefix = license.keyPrefix;

    const updated = await tx.license.update({
      where: { id: params.licenseId },
      data: {
        keyHash: newKeyHash,
        keyPrefix: newKeyPrefix,
      },
      include: { customer: true },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:reissue-key",
        entityType: "License",
        entityId: params.licenseId,
        before: { keyPrefix: oldKeyPrefix },
        after: { keyPrefix: newKeyPrefix },
      },
    });

    return updated;
  });

  const emailPayload = buildLicenseKeyReissuedEmail({
    companyName: result.customer.companyName,
    licenseId: result.id,
    newKeyPrefix,
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "license_key_reissued",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.id,
  });

  return {
    license: result,
    newPlainLicenseKey: newPlainKey,
  };
}

export async function updateCustomerContact(params: {
  customerId: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  actor: string;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.customer.findUniqueOrThrow({
      where: { id: params.customerId },
    });

    const updated = await tx.customer.update({
      where: { id: params.customerId },
      data: {
        contactName: params.contactName !== undefined ? params.contactName : current.contactName,
        contactEmail: params.contactEmail !== undefined ? params.contactEmail : current.contactEmail,
        contactPhone: params.contactPhone !== undefined ? params.contactPhone : current.contactPhone,
        notes: params.notes !== undefined ? params.notes : current.notes,
      },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "customer:update-contact",
        entityType: "Customer",
        entityId: params.customerId,
        before: {
          contactName: current.contactName,
          contactEmail: current.contactEmail,
          contactPhone: current.contactPhone,
          notes: current.notes,
        },
        after: {
          contactName: updated.contactName,
          contactEmail: updated.contactEmail,
          contactPhone: updated.contactPhone,
          notes: updated.notes,
        },
      },
    });

    return updated;
  });
}

export interface UpdateCustomerDomainInput {
  customerId: string;
  deploymentId?: string | null;
  domain: string;
  allowedDomains?: string[] | string | null;
  actor: string;
}

export async function updateCustomerDomain(params: UpdateCustomerDomainInput) {
  const trimmed = params.domain.trim();
  if (!trimmed) {
    throw new Error("Primary domain is required and cannot be empty.");
  }

  const primaryDomain = normalizeDomain(trimmed) || trimmed;
  const allowedDomains = parseAllowedDomains(params.allowedDomains, trimmed);

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: params.customerId },
      include: {
        deployments: { orderBy: { createdAt: "asc" } },
      },
    });

    let targetDeployment = params.deploymentId
      ? customer.deployments.find((d) => d.id === params.deploymentId)
      : customer.deployments[0];

    let updatedDeployment;
    let beforeState: {
      deploymentId?: string;
      domain?: string;
      allowedDomains?: string[];
    } = {};

    if (targetDeployment) {
      beforeState = {
        deploymentId: targetDeployment.id,
        domain: targetDeployment.domain,
        allowedDomains: targetDeployment.allowedDomains,
      };

      updatedDeployment = await tx.deployment.update({
        where: { id: targetDeployment.id },
        data: {
          domain: primaryDomain,
          allowedDomains,
        },
      });
    } else {
      updatedDeployment = await tx.deployment.create({
        data: {
          customerId: customer.id,
          domain: primaryDomain,
          allowedDomains,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "deployment:update-domain",
        entityType: "Customer",
        entityId: customer.id,
        before: beforeState,
        after: {
          deploymentId: updatedDeployment.id,
          domain: updatedDeployment.domain,
          allowedDomains: updatedDeployment.allowedDomains,
        },
      },
    });

    return updatedDeployment;
  });
}
