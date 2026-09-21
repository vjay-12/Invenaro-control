import { describe, it, expect } from "vitest";
import {
  renderDashboardPage,
  renderCustomerListPage,
  renderCustomerDetailPage,
  renderCustomerCreatedSuccessPage,
  renderReissuedKeySuccessPage,
  renderAuditLogsPage,
  renderNotificationsPage,
  renderAccountPage,
} from "../src/admin/views/pages.js";
import { RawString, renderLayout } from "../src/admin/views/template.js";

describe("admin views rendering (no raw escaped HTML)", () => {
  const maliciousName = `<img src=x onerror=alert(1)> Acme & Corp "Test"`;
  const escapedMaliciousSnippet = "&lt;img src=x onerror=alert(1)&gt; Acme &amp; Corp &quot;Test&quot;";

  const fakeCustomer = {
    id: "cust_12345",
    companyName: maliciousName,
    contactEmail: "admin@example.com",
    contactName: "John Doe",
    status: "active" as const,
    notes: "VIP customer <script>alert(1)</script>",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    licenses: [
      {
        id: "lic_12345",
        keyPrefix: "INV-DEMO",
        plan: "enterprise" as const,
        status: "active" as const,
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        graceDays: 14,
        maxUsers: 50,
        allowedDomains: ["example.com"],
        features: ["audit_logs", "sso"],
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ],
    deployments: [
      {
        id: "dep_12345",
        domain: "portal.example.com",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  };

  function assertValidMarkup(rendered: RawString | string, checkMaliciousEscaped = true) {
    const htmlStr = rendered instanceof RawString ? rendered.value : rendered;

    // Structural HTML tags should exist as real markup
    expect(htmlStr).toContain("<table");
    expect(htmlStr).toContain("<tr");
    expect(htmlStr).toContain("<td");

    // Structural HTML tags must NOT be escaped
    expect(htmlStr).not.toContain("&lt;table");
    expect(htmlStr).not.toContain("&lt;tr");
    expect(htmlStr).not.toContain("&lt;td");
    expect(htmlStr).not.toContain("&lt;th");
    expect(htmlStr).not.toContain("&lt;span");
    expect(htmlStr).not.toContain("&lt;a href");
    expect(htmlStr).not.toContain("&lt;p style");

    // Malicious company name must be properly escaped
    if (checkMaliciousEscaped) {
      expect(htmlStr).not.toContain("<img src=x onerror=alert(1)>");
      expect(htmlStr).toContain(escapedMaliciousSnippet);
    }
  }

  it("renders renderDashboardPage correctly with real HTML tables", () => {
    const page = renderDashboardPage({
      customerCount: 1,
      licenseCounts: {
        active: 1,
        grace: 0,
        expired: 0,
        suspended: 0,
      },
      expiringLicenses: [
        {
          id: fakeCustomer.licenses[0].id,
          keyPrefix: fakeCustomer.licenses[0].keyPrefix,
          companyName: fakeCustomer.companyName,
          customerId: fakeCustomer.id,
          plan: "enterprise",
          expiresAt: new Date("2027-01-01T00:00:00Z"),
          daysLeft: 10,
        },
      ],
      silentDeployments: [
        {
          id: fakeCustomer.deployments[0].id,
          domain: fakeCustomer.deployments[0].domain,
          companyName: fakeCustomer.companyName,
          customerId: fakeCustomer.id,
          lastSeenAt: new Date("2026-01-01T00:00:00Z"),
          daysSilent: 5,
        },
      ],
    });

    assertValidMarkup(page);
  });

  it("renders renderCustomerListPage correctly with real HTML tables", () => {
    const page = renderCustomerListPage({
      customers: [
        {
          id: fakeCustomer.id,
          companyName: fakeCustomer.companyName,
          contactName: fakeCustomer.contactName,
          contactEmail: fakeCustomer.contactEmail,
          status: "active",
          primaryDomain: "portal.example.com",
          plan: "enterprise",
          licenseStatus: "active",
          expiresAt: fakeCustomer.licenses[0].expiresAt,
        },
      ],
      page: 1,
      totalPages: 1,
      totalCount: 1,
      search: "",
    });

    assertValidMarkup(page);
  });

  it("renders renderCustomerDetailPage correctly with real HTML tables", () => {
    const page = renderCustomerDetailPage({
      customer: {
        id: fakeCustomer.id,
        companyName: fakeCustomer.companyName,
        contactEmail: fakeCustomer.contactEmail,
        contactName: fakeCustomer.contactName,
        notes: fakeCustomer.notes,
        status: fakeCustomer.status,
      },
      license: fakeCustomer.licenses[0],
      computedStatus: "active",
      effectiveModules: {
        multi_godown: true,
        batch_tracking: false,
        e_invoicing: true,
        audit_trail: true,
        advanced_pricing: false,
      },
      overrides: {
        multi_godown: true,
      },
      deployments: fakeCustomer.deployments,
      auditLogs: [
        {
          createdAt: new Date("2026-01-03T12:00:00Z"),
          action: "license.renew",
          actor: fakeCustomer.companyName,
          details: "test",
        },
      ],
      csrfToken: "csrf-token-xyz",
    });

    assertValidMarkup(page);
  });

  it("renders renderAuditLogsPage correctly with real HTML tables", () => {
    const page = renderAuditLogsPage({
      logs: [
        {
          id: "aud_123",
          action: "license.renew",
          entityType: "Customer",
          entityId: fakeCustomer.id,
          actor: fakeCustomer.companyName,
          after: { companyName: fakeCustomer.companyName },
          before: null,
          createdAt: new Date("2026-01-03T12:00:00Z"),
        },
      ],
      page: 1,
      totalPages: 1,
      totalCount: 1,
    });

    assertValidMarkup(page);
  });

  it("renders renderNotificationsPage correctly with real HTML tables", () => {
    const page = renderNotificationsPage({
      notifications: [
        {
          id: "notif_123",
          event: "license_expiring",
          subject: fakeCustomer.companyName,
          toEmail: "admin@example.com",
          status: "sent",
          error: null,
          createdAt: new Date("2026-01-03T12:00:00Z"),
        },
      ],
      page: 1,
      totalPages: 1,
      totalCount: 1,
    });

    assertValidMarkup(page);
  });

  it("renders renderAccountPage correctly with real HTML tables", () => {
    const page = renderAccountPage({
      adminEmail: "admin@invenaro.internal",
      sessions: [
        {
          id: "sess_1",
          ip: "127.0.0.1",
          userAgent: "Mozilla/5.0",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          lastSeenAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
      currentSessionId: "sess_1",
      csrfToken: "csrf-token-123",
    });

    assertValidMarkup(page, false);
  });

  it("renders renderCustomerCreatedSuccessPage and renderReissuedKeySuccessPage without escaped structural markup", () => {
    const createdPage = renderCustomerCreatedSuccessPage({
      customer: { id: fakeCustomer.id, companyName: fakeCustomer.companyName },
      deployment: { domain: "portal.example.com" },
      license: {
        id: "lic_1",
        plan: "enterprise",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        keyPrefix: "INV-DEMO",
      },
      plainLicenseKey: "INV-SECRET-KEY-12345",
    });

    expect(createdPage.value).toContain("<div");
    expect(createdPage.value).toContain("<h2");
    expect(createdPage.value).not.toContain("&lt;div");
    expect(createdPage.value).not.toContain("&lt;h2");
    expect(createdPage.value).toContain(escapedMaliciousSnippet);

    const reissuedPage = renderReissuedKeySuccessPage({
      customer: { id: fakeCustomer.id, companyName: fakeCustomer.companyName },
      license: { id: "lic_1", keyPrefix: "INV-DEMO" },
      plainLicenseKey: "INV-REISSUED-KEY-99999",
    });

    expect(reissuedPage.value).toContain("<div");
    expect(reissuedPage.value).toContain("<h2");
    expect(reissuedPage.value).not.toContain("&lt;div");
    expect(reissuedPage.value).not.toContain("&lt;h2");
    expect(reissuedPage.value).toContain("INV-REISSUED-KEY-99999");
  });

  it("renders full layout without double escaping", () => {
    const pageContent = renderCustomerListPage({
      customers: [],
      page: 1,
      totalPages: 1,
      totalCount: 0,
    });

    const fullHtml = renderLayout({
      title: "Customers",
      content: pageContent,
      userEmail: "admin@invenaro.internal",
      currentPath: "/admin/customers",
      csrfToken: "csrf-test",
    });

    expect(fullHtml).toContain("<!DOCTYPE html>");
    expect(fullHtml).toContain("<table");
    expect(fullHtml).not.toContain("&lt;table");
    expect(fullHtml).toContain('<a href="/admin/customers" class="active">Customers</a>');
  });
});
