import os from "node:os";
import { reinstateLicense } from "../../src/services/adminActions.js";

export async function licenseReinstateCommand(id: string) {
  if (!id) {
    console.error("❌ License ID is required: license:reinstate <id>");
    process.exit(1);
  }

  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    await reinstateLicense({
      licenseId: id,
      actor,
    });

    console.log(`▶️ License ${id} has been reinstated to ACTIVE.`);
  } catch (error) {
    console.error("❌ Failed to reinstate license:", error);
    process.exit(1);
  }
}
