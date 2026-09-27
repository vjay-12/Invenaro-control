import { describe, it, expect } from "vitest";
import { normalizeDomain, parseAllowedDomains } from "../src/services/domainUtils.js";
import { renderCustomerDetailPage } from "../src/admin/views/pages.js";
import { RawString } from "../src/admin/views/template.js";

describe("Domain Management & Normalization Tests", () => {
  describe("normalizeDomain", () => {
    it("normalizes full URLs with https and trailing slash", () => {
      expect(normalizeDomain("https://invenaro-api.vercel.app/")).toBe("invenaro-api.vercel.app");
    });

    it("normalizes http URLs", () => {
      expect(normalizeDomain("http://app.invenaro.com/")).toBe("app.invenaro.com");
    });

    it("strips subpaths and query strings if entered", () => {
      expect(normalizeDomain("https://sub.domain.com/path?foo=bar")).toBe("sub.domain.com");
    });

    it("strips standard ports 80 and 443", () => {
      expect(normalizeDomain("https://api.domain.com:443/")).toBe("api.domain.com");
      expect(normalizeDomain("http://api.domain.com:80/")).toBe("api.domain.com");
    });

    it("preserves non-standard dev ports like localhost:3000", () => {
      expect(normalizeDomain("localhost:3000")).toBe("localhost:3000");
      expect(normalizeDomain("http://localhost:3000/")).toBe("localhost:3000");
    });

    it("lowercases and trims whitespace", () => {
      expect(normalizeDomain("   InVeNaRo-API.vercel.app   ")).toBe("invenaro-api.vercel.app");
    });

    it("handles empty or falsy strings gracefully", () => {
      expect(normalizeDomain("")).toBe("");
    });
  });

  describe("parseAllowedDomains", () => {
    it("merges primary domain and comma-separated allowed domains", () => {
      const result = parseAllowedDomains(
        "staging.invenaro.com, localhost:3000",
        "https://invenaro-api.vercel.app/"
      );

      expect(result).toContain("invenaro-api.vercel.app");
      expect(result).toContain("https://invenaro-api.vercel.app/");
      expect(result).toContain("staging.invenaro.com");
      expect(result).toContain("localhost:3000");
    });

    it("handles array input for allowed domains", () => {
      const result = parseAllowedDomains(
        ["extra1.com", "extra2.com"],
        "primary.com"
      );

      expect(result).toContain("primary.com");
      expect(result).toContain("extra1.com");
      expect(result).toContain("extra2.com");
    });

    it("deduplicates entries", () => {
      const result = parseAllowedDomains(
        "app.com, app.com, https://app.com/",
        "app.com"
      );

      expect(result).toContain("app.com");
      expect(result.filter((x) => x === "app.com")).toHaveLength(1);
    });
  });

  describe("renderCustomerDetailPage Domain UI", () => {
    it("renders the Edit Authorized Domain form and edit triggers", () => {
      const fakeCustomer = {
        id: "cust_test_123",
        companyName: "Acme Corp",
        contactEmail: "admin@acme.com",
        contactName: "Acme Admin",
        status: "active",
        licenses: [
          {
            id: "lic_test_123",
            keyPrefix: "INV-DEMO",
            plan: "business",
            status: "active",
            expiresAt: new Date("2027-01-01T00:00:00Z"),
            createdAt: new Date("2026-01-01T00:00:00Z"),
            graceDays: 14,
          },
        ],
        deployments: [
          {
            id: "dep_test_123",
            domain: "https://invenaro-api.vercel.app/",
            allowedDomains: ["https://invenaro-api.vercel.app/"],
            appVersion: "1.0.0",
            lastSeenAt: null,
          },
        ],
      };

      const rendered = renderCustomerDetailPage({
        customer: fakeCustomer,
        license: fakeCustomer.licenses[0],
        computedStatus: "active",
        effectiveModules: {},
        deployments: fakeCustomer.deployments,
        auditLogs: [],
        csrfToken: "dummy-csrf-token",
      });

      const html = rendered instanceof RawString ? rendered.value : String(rendered);

      // Check for Deployments card title
      expect(html).toContain("Authorized Deployments");

      // Check for domain in table
      expect(html).toContain("https://invenaro-api.vercel.app/");

      // Check for Edit button with data attributes
      expect(html).toContain("edit-domain-trigger-btn");
      expect(html).toContain(`data-dep-id="${fakeCustomer.deployments[0].id}"`);

      // Check for Domain Edit Form
      expect(html).toContain(`action="/admin/customers/${fakeCustomer.id}/domain"`);
      expect(html).toContain('name="domain"');
      expect(html).toContain('name="allowedDomains"');
      expect(html).toContain("Save Domain Settings");
    });
  });
});
