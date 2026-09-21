import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

export async function licenseReinstateCommand(id: string) {
  if (!id) {
    console.error("❌ License ID is required: license:reinstate <id>");
    process.exit(1);
  }

  try {
    const existing = await prisma.license.findUnique({
      where: { id },
    });

    if (!existing) {
      console.error(`❌ License not found with ID: ${id}`);
      process.exit(1);
    }

    const updated = await prisma.license.update({
      where: { id },
      data: { status: "active" },
    });

    await recordAuditLog({
      action: "license:reinstate",
      entityType: "License",
      entityId: id,
      before: { status: existing.status },
      after: { status: updated.status },
    });

    console.log(`▶️ License ${id} has been reinstated to ACTIVE.`);
  } catch (error) {
    console.error("❌ Failed to reinstate license:", error);
    process.exit(1);
  }
}
