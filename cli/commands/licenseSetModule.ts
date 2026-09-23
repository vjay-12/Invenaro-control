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
  _id: string,
  _module: string,
  _state: string
) {
  console.error(
    "❌ Module overrides are disabled. Module entitlements are strictly plan-based.\n" +
    "   Use 'license:change-plan <id> <basic|business|enterprise>' to adjust authorized modules."
  );
  process.exit(1);
}
