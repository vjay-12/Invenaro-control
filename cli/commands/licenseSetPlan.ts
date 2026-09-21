import { z } from "zod";
import os from "node:os";
import { changePlan } from "../../src/services/adminActions.js";

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
  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    const updated = await changePlan({
      licenseId,
      plan: newPlan,
      actor,
    });

    console.log(`✅ License ${licenseId} plan updated to: ${updated.plan}`);
  } catch (error) {
    console.error("❌ Failed to update license plan:", error);
    process.exit(1);
  }
}
