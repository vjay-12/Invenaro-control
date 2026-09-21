import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MODULE_NAMES } from "../src/contract/license-token.js";

describe("CLI argument validation schemas", () => {
  const CustomerCreateSchema = z.object({
    name: z.string().min(1, "Customer name is required"),
    domain: z.string().min(1, "Domain is required"),
    notes: z.string().optional(),
  });

  const LicenseCreateSchema = z.object({
    customer: z.string().min(1, "Customer ID is required"),
    plan: z.enum(["basic", "business", "enterprise"]),
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .transform((str) => new Date(`${str}T23:59:59.999Z`)),
    grace: z.coerce.number().int().nonnegative().default(14),
  });

  const SetModuleSchema = z.object({
    id: z.string().min(1),
    module: z.enum(MODULE_NAMES),
    state: z.enum(["on", "off"]),
  });

  it("validates customer create arguments", () => {
    expect(CustomerCreateSchema.safeParse({ name: "Acme", domain: "acme.com" }).success).toBe(true);
    expect(CustomerCreateSchema.safeParse({ name: "", domain: "acme.com" }).success).toBe(false);
    expect(CustomerCreateSchema.safeParse({ name: "Acme" }).success).toBe(false);
  });

  it("validates license create arguments and formats date", () => {
    const valid = LicenseCreateSchema.safeParse({
      customer: "cust_123",
      plan: "business",
      expires: "2027-12-31",
      grace: "14",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.expires.toISOString()).toBe("2027-12-31T23:59:59.999Z");
      expect(valid.data.grace).toBe(14);
    }

    // Invalid plan
    expect(
      LicenseCreateSchema.safeParse({
        customer: "cust_123",
        plan: "ultra_vip",
        expires: "2027-12-31",
      }).success
    ).toBe(false);

    // Invalid date format
    expect(
      LicenseCreateSchema.safeParse({
        customer: "cust_123",
        plan: "basic",
        expires: "31-12-2027",
      }).success
    ).toBe(false);
  });

  it("validates module overrides", () => {
    expect(
      SetModuleSchema.safeParse({
        id: "lic_1",
        module: "batch_expiry",
        state: "on",
      }).success
    ).toBe(true);

    expect(
      SetModuleSchema.safeParse({
        id: "lic_1",
        module: "nonexistent_module",
        state: "on",
      }).success
    ).toBe(false);

    expect(
      SetModuleSchema.safeParse({
        id: "lic_1",
        module: "stock_control",
        state: "maybe",
      }).success
    ).toBe(false);
  });
});
