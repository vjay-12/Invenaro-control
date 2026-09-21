import { z } from "zod";
import { prisma } from "../../src/db.js";
import {
  generateLicenseKey,
  hashLicenseKey,
  extractKeyPrefix,
} from "../../src/services/keyService.js";
import { recordAuditLog } from "../../src/services/audit.js";
import { LicensePlan } from "@prisma/client";

const LicenseCreateSchema = z.object({
  customer: z.string().min(1, "Customer ID is required"),
  plan: z.enum(["basic", "business", "enterprise"], {
    errorMap: () => ({ message: "Plan must be 'basic', 'business', or 'enterprise'" }),
  }),
  expires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expires must be in YYYY-MM-DD format")
    .transform((str) => new Date(`${str}T23:59:59.999Z`)),
  grace: z.coerce.number().int().nonnegative().default(14),
});

export async function licenseCreateCommand(options: {
  customer?: string;
  plan?: string;
  expires?: string;
  grace?: string | number;
}) {
  const parsed = LicenseCreateSchema.safeParse(options);
  if (!parsed.success) {
    console.error("❌ Invalid options:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { customer: customerId, plan, expires, grace } = parsed.data;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      console.error(`❌ Customer not found with ID: ${customerId}`);
      process.exit(1);
    }

    const plainKey = generateLicenseKey();
    const keyHash = hashLicenseKey(plainKey);
    const keyPrefix = extractKeyPrefix(plainKey);

    const license = await prisma.license.create({
      data: {
        customerId,
        keyHash,
        keyPrefix,
        plan: plan as LicensePlan,
        expiresAt: expires,
        graceDays: grace,
      },
    });

    await recordAuditLog({
      action: "license:create",
      entityType: "License",
      entityId: license.id,
      after: {
        id: license.id,
        customerId,
        keyPrefix,
        plan: license.plan,
        expiresAt: license.expiresAt,
        graceDays: license.graceDays,
      },
    });

    console.log("✅ License created successfully!\n");
    console.log("================================================================================");
    console.log("🔑 LICENSE KEY (PRINTED ONCE - STORE SECURELY):");
    console.log(`   ${plainKey}`);
    console.log("================================================================================");
    console.log("⚠️  This key is hashed and cannot be recovered if lost.\n");
    console.log(`   License ID:   ${license.id}`);
    console.log(`   Customer ID:  ${license.customerId} (${customer.companyName})`);
    console.log(`   Key Prefix:   ${license.keyPrefix}`);
    console.log(`   Plan:         ${license.plan}`);
    console.log(`   Expires At:   ${license.expiresAt.toISOString().slice(0, 10)}`);
    console.log(`   Grace Days:   ${license.graceDays} days`);
  } catch (error) {
    console.error("❌ Failed to create license:", error);
    process.exit(1);
  }
}
