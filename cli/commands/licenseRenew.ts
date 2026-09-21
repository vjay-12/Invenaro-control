import { z } from "zod";
import os from "node:os";
import { renewLicense } from "../../src/services/adminActions.js";

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
  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    const updated = await renewLicense({
      licenseId,
      expiresAt: expires,
      actor,
    });

    console.log(
      `✅ License ${licenseId} renewed until: ${updated.expiresAt.toISOString().slice(0, 10)}`
    );
  } catch (error) {
    console.error("❌ Failed to renew license:", error);
    process.exit(1);
  }
}
