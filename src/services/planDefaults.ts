import {
  MODULE_NAMES,
  ModuleName,
  ModulesRecord,
  LicensePlanType,
} from "../contract/license-token.js";

const BUSINESS_DEFAULT_MODULES: ReadonlySet<ModuleName> = new Set<ModuleName>([
  "multi_godown",
  "transfers",
  "invoices_returns",
  "payments_dues",
  "stock_control",
  "gst",
  "ledger_ui",
  "reports_advanced",
  "import_export",
]);

/**
 * Returns default module permissions for a given plan tier.
 */
export function getPlanDefaultModules(plan: LicensePlanType): ModulesRecord {
  const result = {} as ModulesRecord;

  for (const mod of MODULE_NAMES) {
    if (plan === "enterprise") {
      result[mod] = true;
    } else if (plan === "business") {
      result[mod] = BUSINESS_DEFAULT_MODULES.has(mod);
    } else {
      // basic: all false
      result[mod] = false;
    }
  }

  return result;
}

/**
 * Computes effective modules for a license by combining plan defaults
 * with per-license overrides stored in LicenseModule table.
 */
export function computeEffectiveModules(
  plan: LicensePlanType,
  overrides?: Array<{ module: string; enabled: boolean }>
): ModulesRecord {
  const defaults = getPlanDefaultModules(plan);

  if (!overrides || overrides.length === 0) {
    return defaults;
  }

  const effective = { ...defaults };
  for (const override of overrides) {
    if (MODULE_NAMES.includes(override.module as ModuleName)) {
      effective[override.module as ModuleName] = override.enabled;
    }
  }

  return effective;
}
