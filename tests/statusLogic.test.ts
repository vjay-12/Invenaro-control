import { describe, it, expect } from "vitest";
import { computeLicenseStatus } from "../src/services/statusLogic.js";

describe("statusLogic", () => {
  const baseDate = new Date("2026-06-01T00:00:00.000Z");
  const expiresAt = new Date("2026-06-15T00:00:00.000Z");
  const graceDays = 14; // Grace ends 2026-06-29T00:00:00.000Z

  it("returns 'active' when current date is before expiry", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: new Date("2026-06-10T00:00:00.000Z"),
    });
    expect(status).toBe("active");
  });

  it("returns 'active' on exact moment of expiry", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: expiresAt,
    });
    expect(status).toBe("active");
  });

  it("returns 'grace' when expired but within grace days", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: new Date("2026-06-20T00:00:00.000Z"),
    });
    expect(status).toBe("grace");
  });

  it("returns 'grace' at the exact end boundary of grace period", () => {
    const graceEnd = new Date("2026-06-29T00:00:00.000Z");
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: graceEnd,
    });
    expect(status).toBe("grace");
  });

  it("returns 'expired' when beyond grace period", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: new Date("2026-06-29T00:00:01.000Z"),
    });
    expect(status).toBe("expired");
  });

  it("returns 'suspended' if customer is suspended", () => {
    const status = computeLicenseStatus({
      customerStatus: "suspended",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: baseDate,
    });
    expect(status).toBe("suspended");
  });

  it("returns 'suspended' if customer is cancelled", () => {
    const status = computeLicenseStatus({
      customerStatus: "cancelled",
      licenseStatus: "active",
      expiresAt,
      graceDays,
      now: baseDate,
    });
    expect(status).toBe("suspended");
  });

  it("returns 'suspended' if license is suspended", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "suspended",
      expiresAt,
      graceDays,
      now: baseDate,
    });
    expect(status).toBe("suspended");
  });

  it("returns 'suspended' if license is revoked", () => {
    const status = computeLicenseStatus({
      customerStatus: "active",
      licenseStatus: "revoked",
      expiresAt,
      graceDays,
      now: baseDate,
    });
    expect(status).toBe("suspended");
  });
});
