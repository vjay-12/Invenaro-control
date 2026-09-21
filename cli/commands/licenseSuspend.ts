import os from "node:os";
import { suspendLicense } from "../../src/services/adminActions.js";

export async function licenseSuspendCommand(id: string) {
  if (!id) {
    console.error("❌ License ID is required: license:suspend <id>");
    process.exit(1);
  }

  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    await suspendLicense({
      licenseId: id,
      actor,
    });

    console.log(`⏸️ License ${id} has been suspended.`);
  } catch (error) {
    console.error("❌ Failed to suspend license:", error);
    process.exit(1);
  }
}
