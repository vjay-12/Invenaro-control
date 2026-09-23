import { describe, it, expect } from "vitest";
import {
  getPlanDefaultModules,
  computeEffectiveModules,
  MODULE_METADATA,
} from "../src/services/planDefaults.js";
import { MODULE_NAMES } from "../src/contract/license-token.js";
import { setModule } from "../src/services/adminActions.js";
import {
  renderCustomerNewPage,
  renderCustomerDetailPage,
} from "../src/admin/views/pages.js";

describe("Plan-Based License & Module Configuration", () => {
  describe("Module definitions & Plan defaults", () => {
    it("defines 13 valid modules in MODULE_NAMES and metadata", () => {
      expect(MODULE_NAMES).toHaveLength(13);
      for (const mod of MODULE_NAMES) {
        expect(MODULE_METADATA[mod]).toBeDefined();
        expect(MODULE_METADATA[mod].name).toBeTruthy();
        expect(MODULE_METADATA[mod].description).toBeTruthy();
      }
    });

    it("basic plan authorizes 0 tiered add-on modules (core app only)", () => {
      const basicModules = getPlanDefaultModules("basic");
      for (const mod of MODULE_NAMES) {
        expect(basicModules[mod]).toBe(false);
      }
    });

    it("business plan authorizes exactly 9 core modules", () => {
      const bizModules = getPlanDefaultModules("business");
      const enabledList = MODULE_NAMES.filter((m) => bizModules[m]);
      expect(enabledList).toHaveLength(9);
      expect(enabledList).toEqual([
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

      // Advanced modules must be false
      expect(bizModules.batch_expiry).toBe(false);
      expect(bizModules.barcode).toBe(false);
      expect(bizModules.ai_data_assistant).toBe(false);
      expect(bizModules.ai_knowledge_assistant).toBe(false);
    });

    it("enterprise plan authorizes all 13 modules", () => {
      const entModules = getPlanDefaultModules("enterprise");
      for (const mod of MODULE_NAMES) {
        expect(entModules[mod]).toBe(true);
      }
    });

    it("computeEffectiveModules strictly returns plan defaults regardless of overrides", () => {
      const effectiveBiz = computeEffectiveModules("business", [
        { module: "batch_expiry", enabled: true },
        { module: "gst", enabled: false },
      ]);
      expect(effectiveBiz.batch_expiry).toBe(false);
      expect(effectiveBiz.gst).toBe(true);

      const effectiveBasic = computeEffectiveModules("basic", [
        { module: "multi_godown", enabled: true },
      ]);
      expect(effectiveBasic.multi_godown).toBe(false);
    });
  });

  describe("Disabled Manual Overrides", () => {
    it("setModule throws error stating overrides are disabled", async () => {
      await expect(
        setModule({
          licenseId: "lic_test_123",
          module: "multi_godown",
          enabled: false,
          actor: "admin:test",
        })
      ).rejects.toThrow("Individual module overrides are disabled. Module configuration is completely plan-based.");
    });
  });

  describe("UI Read-Only Verification", () => {
    it("renderCustomerNewPage renders read-only plan modules section with data-plan-module attributes", () => {
      const page = renderCustomerNewPage({ csrfToken: "test-token" }).value;

      expect(page).toContain("Included Plan Modules &amp; Features");
      expect(page).toContain("Read-only summary of features authorized by the chosen plan tier");
      expect(page).toContain('data-plan-module="business,enterprise"');
      expect(page).toContain('data-plan-module="enterprise"');
      expect(page).toContain("planSummaryBadge");

      // No manual checkbox/toggle inputs for modules
      for (const mod of MODULE_NAMES) {
        expect(page).not.toContain(`name="module_${mod}"`);
        expect(page).not.toContain(`id="module_${mod}"`);
      }
    });

    it("renderCustomerDetailPage renders read-only module list without toggle buttons or forms", () => {
      const page = renderCustomerDetailPage({
        customer: { id: "cust_1", companyName: "Acme Corp" },
        license: {
          id: "lic_1",
          plan: "business",
          keyPrefix: "INV-DEMO",
          status: "active",
          expiresAt: new Date("2028-01-01"),
          graceDays: 14,
        },
        computedStatus: "active",
        effectiveModules: getPlanDefaultModules("business"),
        deployments: [],
        auditLogs: [],
        csrfToken: "test-token",
      }).value;

      expect(page).toContain("Plan Modules &amp; Feature Entitlements");
      expect(page).toContain("Module authorization is completely determined by the subscription plan");

      // Must NOT contain module override forms or toggle buttons
      expect(page).not.toContain('action="/admin/customers/cust_1/module"');
      expect(page).not.toContain('name="state" value="off"');
      expect(page).not.toContain('name="state" value="on"');
      expect(page).not.toContain("Override");

      // Displays read-only Included and Not Included badges
      expect(page).toContain("Included");
      expect(page).toContain("Not Included");
    });
  });
});
