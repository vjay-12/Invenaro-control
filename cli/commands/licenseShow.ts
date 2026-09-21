import { prisma } from "../../src/db.js";
import { computeLicenseStatus } from "../../src/services/statusLogic.js";
import { computeEffectiveModules } from "../../src/services/planDefaults.js";
import { LicensePlanType } from "../../src/contract/license-token.js";

export async function licenseShowCommand(identifier: string) {
  if (!identifier) {
    console.error("❌ License ID or Key Prefix is required: license:show <licenseId|keyPrefix>");
    process.exit(1);
  }

  const trimmed = identifier.trim();

  try {
    const license = await prisma.license.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { keyPrefix: trimmed },
          { keyPrefix: trimmed.slice(0, 8) },
        ],
      },
      include: {
        customer: true,
        modules: true,
      },
    });

    if (!license) {
      console.error(`❌ License not found matching: "${trimmed}"`);
      process.exit(1);
    }

    const status = computeLicenseStatus({
      customerStatus: license.customer.status,
      licenseStatus: license.status,
      expiresAt: license.expiresAt,
      graceDays: license.graceDays,
    });

    const effectiveModules = computeEffectiveModules(
      license.plan as LicensePlanType,
      license.modules
    );

    console.log("================================================================================");
    console.log(`📄 LICENSE DETAILS: ${license.id}`);
    console.log("================================================================================");
    console.log(`   Customer:        ${license.customer.companyName} (${license.customerId})`);
    console.log(`   Customer Status: ${license.customer.status}`);
    console.log(`   Key Prefix:      ${license.keyPrefix} (full key is hashed)`);
    console.log(`   Plan:            ${license.plan}`);
    console.log(`   License Status:  ${license.status} (Effective status: ${status.toUpperCase()})`);
    console.log(`   Expires At:      ${license.expiresAt.toISOString().slice(0, 10)}`);
    console.log(`   Grace Days:      ${license.graceDays} days`);
    console.log(`   Created At:      ${license.createdAt.toISOString()}`);

    console.log("\n   Effective Modules:");
    for (const [moduleName, enabled] of Object.entries(effectiveModules)) {
      const isOverridden = license.modules.some((m) => m.module === moduleName);
      const mark = enabled ? "✔ ENABLED" : "✖ DISABLED";
      const overrideNote = isOverridden ? " (custom override)" : "";
      console.log(`     - ${moduleName.padEnd(26)} : ${mark}${overrideNote}`);
    }
    console.log("================================================================================");
  } catch (error) {
    console.error("❌ Failed to show license:", error);
    process.exit(1);
  }
}
