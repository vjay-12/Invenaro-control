import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

const LicenseRenewSchema = z.object({
  id: z.string().min(1, "License ID is required"),
  expires: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expires must be in YYYY-MM-DD format")
    .transform((str) => new Date(`${str}T23:59:59.999Z`)),
});

export async function licenseRenewCommand(id: string, options: { expires?: string }) {
  const parsed = LicenseRenewSchema.safeParse({ id, expires: options.expires });
  if (!parsed.success) {
    console.error("❌ Invalid arguments:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { id: licenseId, expires } = parsed.data;

  try {
    const existing = await prisma.license.findUnique({
      where: { id: licenseId },
    });

    if (!existing) {
      console.error(`❌ License not found with ID: ${licenseId}`);
      process.exit(1);
    }

    const updated = await prisma.license.update({
      where: { id: licenseId },
      data: { expiresAt: expires },
    });

    await recordAuditLog({
      action: "license:renew",
      entityType: "License",
      entityId: licenseId,
      before: { expiresAt: existing.expiresAt },
      after: { expiresAt: updated.expiresAt },
    });

    console.log(
      `✅ License ${licenseId} renewed until: ${updated.expiresAt.toISOString().slice(0, 10)}`
    );
  } catch (error) {
    console.error("❌ Failed to renew license:", error);
    process.exit(1);
  }
}
