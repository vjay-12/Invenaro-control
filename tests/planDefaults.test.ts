import { describe, it, expect } from "vitest";
import {
  getPlanDefaultModules,
  computeEffectiveModules,
} from "../src/services/planDefaults.js";
import { MODULE_NAMES } from "../src/contract/license-token.js";

describe("planDefaults", () => {
  it("should have all modules set to false for basic plan", () => {
    const modules = getPlanDefaultModules("basic");
    expect(Object.keys(modules)).toHaveLength(13);
    for (const mod of MODULE_NAMES) {
      expect(modules[mod]).toBe(false);
    }
  });

  it("should enable exactly 9 core modules for business plan", () => {
    const modules = getPlanDefaultModules("business");
    expect(modules.multi_godown).toBe(true);
    expect(modules.transfers).toBe(true);
    expect(modules.invoices_returns).toBe(true);
    expect(modules.payments_dues).toBe(true);
    expect(modules.stock_control).toBe(true);
    expect(modules.gst).toBe(true);
    expect(modules.ledger_ui).toBe(true);
    expect(modules.reports_advanced).toBe(true);
    expect(modules.import_export).toBe(true);

    // Add-on modules must be false
    expect(modules.batch_expiry).toBe(false);
    expect(modules.barcode).toBe(false);
    expect(modules.ai_data_assistant).toBe(false);
    expect(modules.ai_knowledge_assistant).toBe(false);
  });

  it("should enable all 13 modules for enterprise plan", () => {
    const modules = getPlanDefaultModules("enterprise");
    expect(Object.keys(modules)).toHaveLength(13);
    for (const mod of MODULE_NAMES) {
      expect(modules[mod]).toBe(true);
    }
  });

  it("should apply module overrides on top of plan defaults", () => {
    const effective = computeEffectiveModules("business", [
      { module: "batch_expiry", enabled: true },
      { module: "multi_godown", enabled: false },
    ]);

    expect(effective.batch_expiry).toBe(true); // overridden from false to true
    expect(effective.multi_godown).toBe(false); // overridden from true to false
    expect(effective.gst).toBe(true); // untouched from plan default
  });
});
