import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

export async function licenseSuspendCommand(id: string) {
  if (!id) {
    console.error("❌ License ID is required: license:suspend <id>");
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
      data: { status: "suspended" },
    });

    await recordAuditLog({
      action: "license:suspend",
      entityType: "License",
      entityId: id,
      before: { status: existing.status },
      after: { status: updated.status },
    });

    console.log(`⏸️ License ${id} has been suspended.`);
  } catch (error) {
    console.error("❌ Failed to suspend license:", error);
    process.exit(1);
  }
}
