import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";
import { MODULE_NAMES } from "../../src/contract/license-token.js";

const SetModuleSchema = z.object({
  id: z.string().min(1, "License ID is required"),
  module: z.enum(MODULE_NAMES, {
    errorMap: () => ({
      message: `Invalid module. Allowed: ${MODULE_NAMES.join(", ")}`,
    }),
  }),
  state: z.enum(["on", "off"], {
    errorMap: () => ({ message: "State must be 'on' or 'off'" }),
  }),
});

export async function licenseSetModuleCommand(
  id: string,
  module: string,
  state: string
) {
  const parsed = SetModuleSchema.safeParse({ id, module, state });
  if (!parsed.success) {
    console.error("❌ Invalid arguments:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { id: licenseId, module: moduleName, state: moduleState } = parsed.data;
  const enabled = moduleState === "on";

  try {
    const license = await prisma.license.findUnique({
      where: { id: licenseId },
    });

    if (!license) {
      console.error(`❌ License not found with ID: ${licenseId}`);
      process.exit(1);
    }

    const previous = await prisma.licenseModule.findUnique({
      where: {
        licenseId_module: {
          licenseId,
          module: moduleName,
        },
      },
    });

    const updated = await prisma.licenseModule.upsert({
      where: {
        licenseId_module: {
          licenseId,
          module: moduleName,
        },
      },
      update: { enabled },
      create: {
        licenseId,
        module: moduleName,
        enabled,
      },
    });

    await recordAuditLog({
      action: "license:set-module",
      entityType: "LicenseModule",
      entityId: `${licenseId}:${moduleName}`,
      before: previous ? { module: previous.module, enabled: previous.enabled } : null,
      after: { module: updated.module, enabled: updated.enabled },
    });

    console.log(
      `✅ License ${licenseId} module override set: ${moduleName} -> ${enabled ? "ON" : "OFF"}`
    );
  } catch (error) {
    console.error("❌ Failed to set module override:", error);
    process.exit(1);
  }
}
