import { z } from "zod";
import os from "node:os";
import { changePlanAndIssueNewLicense } from "../../src/services/adminActions.js";

const SetPlanSchema = z.object({
  id: z.string().min(1, "Identifier (License ID or Customer ID) is required"),
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

  const { id: identifier, plan: newPlan } = parsed.data;
  const actor = `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;

  try {
    const result = await changePlanAndIssueNewLicense({
      licenseId: identifier,
      plan: newPlan,
      actor,
    });

    console.log(`\n✅ Plan changed successfully and new license issued!`);
    console.log(`--------------------------------------------------`);
    console.log(`Customer:        ${result.customer.companyName} (${result.customer.id})`);
    if (result.oldLicense) {
      console.log(`Previous License: ${result.oldLicense.id} [SUSPENDED] (Plan: ${result.oldLicense.plan})`);
    }
    console.log(`New License:     ${result.newLicense.id} [ACTIVE] (Plan: ${result.newLicense.plan})`);
    console.log(`Key Prefix:      ${result.newLicense.keyPrefix}...`);
    console.log(`Expires At:      ${result.newLicense.expiresAt.toISOString().slice(0, 10)}`);
    console.log(`--------------------------------------------------`);
    console.log(`\n⚠️  NEW LICENSE KEY (DISPLAYED ONCE):`);
    console.log(`--------------------------------------------------`);
    console.log(result.plainLicenseKey);
    console.log(`--------------------------------------------------`);
    console.log(`Securely deliver this license key to the customer.`);
    console.log(`The previous license has been suspended.\n`);
  } catch (error) {
    console.error("❌ Failed to change plan:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
