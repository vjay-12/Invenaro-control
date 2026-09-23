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

export interface ModuleInfo {
  key: ModuleName;
  name: string;
  description: string;
}

export const MODULE_METADATA: Record<ModuleName, ModuleInfo> = {
  multi_godown: {
    key: "multi_godown",
    name: "Multi-Godown",
    description: "Multiple warehouses and godowns management",
  },
  transfers: {
    key: "transfers",
    name: "Stock Transfers",
    description: "Inter-godown stock movement and goods tracking",
  },
  invoices_returns: {
    key: "invoices_returns",
    name: "Invoices & Returns",
    description: "Sales/purchase invoices, credit notes, and returns",
  },
  payments_dues: {
    key: "payments_dues",
    name: "Payments & Dues",
    description: "Payment receipts, accounts payable, and receivable tracking",
  },
  stock_control: {
    key: "stock_control",
    name: "Stock Control",
    description: "Low-stock thresholds, reorder alerts, and valuation",
  },
  gst: {
    key: "gst",
    name: "GST Compliance",
    description: "GST calculation, HSN/SAC codes, and tax filing reports",
  },
  ledger_ui: {
    key: "ledger_ui",
    name: "Party Ledgers",
    description: "Interactive party ledgers and account statements",
  },
  reports_advanced: {
    key: "reports_advanced",
    name: "Advanced Reports",
    description: "Advanced inventory, sales analytics, and business reporting",
  },
  import_export: {
    key: "import_export",
    name: "Import / Export",
    description: "Bulk CSV/Excel data import and export tools",
  },
  batch_expiry: {
    key: "batch_expiry",
    name: "Batch & Expiry",
    description: "Batch tracking, lot numbers, manufacturing and expiry dates",
  },
  barcode: {
    key: "barcode",
    name: "Barcode Scanning",
    description: "Barcode scanning and label generation",
  },
  ai_data_assistant: {
    key: "ai_data_assistant",
    name: "AI Data Assistant",
    description: "Conversational query assistant for business data",
  },
  ai_knowledge_assistant: {
    key: "ai_knowledge_assistant",
    name: "AI Knowledge Assistant",
    description: "Documentation and AI SOP workflow guidance",
  },
};

/**
 * Computes effective modules for a license based strictly on its plan tier.
 * Per-customer overrides are disabled in favor of plan-based licensing.
 */
export function computeEffectiveModules(
  plan: LicensePlanType,
  _overrides?: Array<{ module: string; enabled: boolean }>
): ModulesRecord {
  return getPlanDefaultModules(plan);
}
