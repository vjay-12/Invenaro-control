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

export const CreateCustomerWithLicenseSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  domain: z.string().trim().min(1, "Primary domain is required"),
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
  rawInput: z.infer<typeof CreateCustomerWithLicenseSchema>
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

    const deployment = await tx.deployment.create({
      data: {
        customerId: customer.id,
        domain: input.domain,
        allowedDomains: [input.domain],
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

export async function changePlan(params: {
  licenseId: string;
  plan: "basic" | "business" | "enterprise";
  actor: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    const oldPlan = license.plan;
    const updated = await tx.license.update({
      where: { id: params.licenseId },
      data: { plan: params.plan as LicensePlan },
      include: { customer: true },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:set-plan",
        entityType: "License",
        entityId: params.licenseId,
        before: { plan: oldPlan },
        after: { plan: params.plan },
      },
    });

    return { updated, oldPlan };
  });

  const emailPayload = buildPlanChangedEmail({
    customerId: result.updated.customerId,
    companyName: result.updated.customer.companyName,
    licenseId: result.updated.id,
    oldPlan: result.oldPlan,
    newPlan: result.updated.plan,
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "plan_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.updated.id,
  });

  return result.updated;
}

export async function setModule(params: {
  licenseId: string;
  module: string;
  enabled: boolean;
  actor: string;
}) {
  if (!MODULE_NAMES.includes(params.module as ModuleName)) {
    throw new Error(`Invalid module name: ${params.module}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const license = await tx.license.findUniqueOrThrow({
      where: { id: params.licenseId },
      include: { customer: true },
    });

    const moduleRecord = await tx.licenseModule.upsert({
      where: {
        licenseId_module: {
          licenseId: params.licenseId,
          module: params.module,
        },
      },
      create: {
        licenseId: params.licenseId,
        module: params.module,
        enabled: params.enabled,
      },
      update: {
        enabled: params.enabled,
      },
    });

    await tx.auditLog.create({
      data: {
        actor: params.actor,
        action: "license:set-module",
        entityType: "LicenseModule",
        entityId: moduleRecord.id,
        after: {
          licenseId: params.licenseId,
          module: params.module,
          enabled: params.enabled,
        },
      },
    });

    return { license, moduleRecord };
  });

  const emailPayload = buildModulesChangedEmail({
    companyName: result.license.customer.companyName,
    licenseId: result.license.id,
    module: params.module,
    enabled: params.enabled,
    actor: params.actor,
  });
  await sendAdminEmail({
    event: "modules_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "License",
    entityId: result.license.id,
  });

  return result.moduleRecord;
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
