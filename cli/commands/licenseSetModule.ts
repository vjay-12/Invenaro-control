import { z } from "zod";
import os from "node:os";
import { MODULE_NAMES } from "../../src/contract/license-token.js";
import { setModule } from "../../src/services/adminActions.js";

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
  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    await setModule({
      licenseId,
      module: moduleName,
      enabled,
      actor,
    });

    console.log(
      `✅ License ${licenseId} module override set: ${moduleName} -> ${enabled ? "ON" : "OFF"}`
    );
  } catch (error) {
    console.error("❌ Failed to set module override:", error);
    process.exit(1);
  }
}
