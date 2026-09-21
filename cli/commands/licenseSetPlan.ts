import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";
import { LicensePlan } from "@prisma/client";

const SetPlanSchema = z.object({
  id: z.string().min(1, "License ID is required"),
  plan: z.enum(["basic", "business", "enterprise"], {
    errorMap: () => ({ message: "Plan must be 'basic', 'business', or 'enterprise'" }),
  }),
});

export async function licenseSetPlanCommand(id: string, plan: string) {
  const parsed = SetPlanSchema.safeParse({ id, plan });
  if (!parsed.success) {
    console.error("❌ Invalid arguments:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { id: licenseId, plan: newPlan } = parsed.data;

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
      data: { plan: newPlan as LicensePlan },
    });

    await recordAuditLog({
      action: "license:set-plan",
      entityType: "License",
      entityId: licenseId,
      before: { plan: existing.plan },
      after: { plan: updated.plan },
    });

    console.log(`✅ License ${licenseId} plan updated: ${existing.plan} -> ${updated.plan}`);
  } catch (error) {
    console.error("❌ Failed to update license plan:", error);
    process.exit(1);
  }
}
