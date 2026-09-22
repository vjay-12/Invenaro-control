import { describe, it, expect, beforeAll } from "vitest";
import * as jose from "jose";
import { CreateCustomerWithLicenseSchema } from "../src/services/adminActions.js";
import {
  signLicenseToken,
  getPublicKey,
} from "../src/services/tokenService.js";
import {
  LicenseTokenClaimsSchema,
  LicenseTokenClaims,
} from "../src/contract/license-token.js";
import { getPlanDefaultModules } from "../src/services/planDefaults.js";
import { renderCustomerNewPage, renderCustomerCreatedSuccessPage, renderCustomerDetailPage } from "../src/admin/views/pages.js";

describe("Designated Admin Email in License Lifecycle", () => {
  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
      extractable: true,
    });
    const privPem = await jose.exportPKCS8(privateKey);
    const pubPem = await jose.exportSPKI(publicKey);

    process.env.LICENSE_SIGNING_PRIVATE_KEY = Buffer.from(privPem).toString("base64");
    process.env.LICENSE_PUBLIC_KEY = Buffer.from(pubPem).toString("base64");
    process.env.LICENSE_SIGNING_KID = "test_kid_admin_email";
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    process.env.TOKEN_TTL_HOURS = "48";
  });

  // 1. Customer/license creation accepts adminEmail
  it("1. Customer/license creation schema accepts valid adminEmail", () => {
    const result = CreateCustomerWithLicenseSchema.safeParse({
      companyName: "Acme Logistics",
      domain: "acme.invenaro.com",
      adminEmail: "admin@customer.com",
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "admin:operator@invenaro.internal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adminEmail).toBe("admin@customer.com");
    }
  });

  // 2. Missing adminEmail is rejected
  it("2. Missing adminEmail is rejected by schema", () => {
    const result = CreateCustomerWithLicenseSchema.safeParse({
      companyName: "Acme Logistics",
      domain: "acme.invenaro.com",
      // adminEmail is omitted
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "admin:operator@invenaro.internal",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.format();
      expect(err.adminEmail).toBeDefined();
    }
  });

  // 3. Invalid email is rejected
  it("3. Invalid email format is rejected", () => {
    const invalidEmails = ["notanemail", "admin@", "@domain.com", "admin@domain", "plainaddress"];
    for (const email of invalidEmails) {
      const result = CreateCustomerWithLicenseSchema.safeParse({
        companyName: "Acme Logistics",
        domain: "acme.invenaro.com",
        adminEmail: email,
        plan: "business",
        expiresAt: new Date("2028-01-01"),
        actor: "admin:operator@invenaro.internal",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("adminEmail"))).toBe(true);
      }
    }
  });

  // 4. Email is trimmed
  it("4. Email with leading/trailing whitespace is trimmed", () => {
    const result = CreateCustomerWithLicenseSchema.safeParse({
      companyName: "Acme Logistics",
      domain: "acme.invenaro.com",
      adminEmail: "   admin@customer.com   ",
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "admin:operator@invenaro.internal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adminEmail).toBe("admin@customer.com");
    }
  });

  // 5. Email is lowercased
  it("5. Email with uppercase characters is converted to lowercase", () => {
    const result = CreateCustomerWithLicenseSchema.safeParse({
      companyName: "Acme Logistics",
      domain: "acme.invenaro.com",
      adminEmail: "  Admin@Customer.COM  ",
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "admin:operator@invenaro.internal",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adminEmail).toBe("admin@customer.com");
    }
  });

  // 6 & 7. Newly generated license contains adminEmail and it is INSIDE signed JWT payload
  it("6 & 7. Newly generated license token contains adminEmail inside the cryptographically signed JWT payload", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const modules = getPlanDefaultModules("business");

    const { token } = await signLicenseToken({
      sub: "cust_abc123",
      licenseId: "lic_xyz789",
      plan: "business",
      modules,
      status: "active",
      licenseExpiresAt: expiresAt,
      graceDays: 14,
      domain: "tenant.invenaro.com",
      adminEmail: "   Owner@Tenant.COM   ", // will be normalized to owner@tenant.com
    });

    expect(token).toBeDefined();

    // Verify token cryptographically using public key
    const { key } = await getPublicKey();
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: "invenaro-control",
      algorithms: ["EdDSA"],
    });

    // Verify adminEmail is inside payload and normalized
    expect(payload.adminEmail).toBe("owner@tenant.com");

    const claims = LicenseTokenClaimsSchema.parse(payload);
    expect(claims.adminEmail).toBe("owner@tenant.com");
  });

  // 8. Existing license signature verification continues to work without adminEmail
  it("8. Existing legacy license without adminEmail continues to verify successfully", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const modules = getPlanDefaultModules("basic");

    // Old license without adminEmail claim
    const { token } = await signLicenseToken({
      sub: "cust_legacy",
      licenseId: "lic_legacy",
      plan: "basic",
      modules,
      status: "active",
      licenseExpiresAt: expiresAt,
      graceDays: 14,
      domain: "legacy.invenaro.com",
      // adminEmail omitted
    });

    const { key } = await getPublicKey();
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: "invenaro-control",
      algorithms: ["EdDSA"],
    });

    expect(payload.adminEmail).toBeUndefined();
    const claims = LicenseTokenClaimsSchema.parse(payload);
    expect(claims.adminEmail).toBeUndefined();
    expect(claims.sub).toBe("cust_legacy");
    expect(claims.plan).toBe("basic");
  });

  // 9. If the signed adminEmail is tampered with, signature verification fails
  it("9. If the signed adminEmail in JWT is tampered with, signature verification fails", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const modules = getPlanDefaultModules("enterprise");

    const { token } = await signLicenseToken({
      sub: "cust_secure",
      licenseId: "lic_secure",
      plan: "enterprise",
      modules,
      status: "active",
      licenseExpiresAt: expiresAt,
      graceDays: 14,
      domain: "secure.invenaro.com",
      adminEmail: "legit-admin@secure.com",
    });

    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const decodedPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

    // Attacker tries to tamper with adminEmail in the token
    decodedPayload.adminEmail = "attacker@evil.com";
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload)).toString("base64url");
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

    const { key } = await getPublicKey();
    await expect(
      jose.jwtVerify(tamperedToken, key, {
        issuer: "invenaro-control",
        algorithms: ["EdDSA"],
      })
    ).rejects.toThrow();
  });

  // 10. Existing license claims continue to work unchanged
  it("10. Existing license claims (plan, modules, status, domain, dates) continue to work unchanged alongside adminEmail", async () => {
    const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    const modules = getPlanDefaultModules("enterprise");

    const { token } = await signLicenseToken({
      sub: "cust_enterprise_1",
      licenseId: "lic_ent_1",
      plan: "enterprise",
      modules,
      status: "active",
      licenseExpiresAt: expiresAt,
      graceDays: 21,
      domain: "corp.enterprise.com",
      adminEmail: "admin@enterprise.com",
    });

    const { key } = await getPublicKey();
    const { payload } = await jose.jwtVerify(token, key, {
      issuer: "invenaro-control",
      algorithms: ["EdDSA"],
    });

    const claims: LicenseTokenClaims = LicenseTokenClaimsSchema.parse(payload);
    expect(claims.iss).toBe("invenaro-control");
    expect(claims.sub).toBe("cust_enterprise_1");
    expect(claims.licenseId).toBe("lic_ent_1");
    expect(claims.plan).toBe("enterprise");
    expect(claims.status).toBe("active");
    expect(claims.domain).toBe("corp.enterprise.com");
    expect(claims.graceDays).toBe(21);
    expect(claims.licenseExpiresAt).toBe(expiresAt);
    expect(claims.adminEmail).toBe("admin@enterprise.com");
    expect(claims.modules.multi_godown).toBe(true);
    expect(claims.modules.barcode).toBe(true);
    expect(claims.modules.ai_data_assistant).toBe(true);
  });

  // 11. UI views include adminEmail correctly
  it("11. UI pages properly render the adminEmail field and data", () => {
    // New customer form includes adminEmail input with required attribute
    const newPage = renderCustomerNewPage({ csrfToken: "csrf-token-test" });
    expect(newPage.value).toContain('id="adminEmail"');
    expect(newPage.value).toContain('name="adminEmail"');
    expect(newPage.value).toContain('required');

    // Customer created success page displays admin email
    const createdPage = renderCustomerCreatedSuccessPage({
      customer: { id: "cust_1", companyName: "Acme Corp" },
      deployment: { domain: "acme.app" },
      license: {
        id: "lic_1",
        plan: "business",
        expiresAt: new Date("2028-01-01"),
        keyPrefix: "INV-ACME",
        adminEmail: "admin@acme.corp",
      },
      plainLicenseKey: "INV-ACME-KEY-1234",
    });
    expect(createdPage.value).toContain("admin@acme.corp");
    expect(createdPage.value).toContain("Admin Email");

    // Customer detail page shows admin email
    const detailPage = renderCustomerDetailPage({
      customer: { id: "cust_1", companyName: "Acme Corp" },
      license: {
        id: "lic_1",
        keyPrefix: "INV-ACME",
        plan: "business",
        status: "active",
        expiresAt: new Date("2028-01-01"),
        graceDays: 14,
        adminEmail: "admin@acme.corp",
      },
      computedStatus: "active",
      effectiveModules: {},
      overrides: {},
      deployments: [],
      auditLogs: [],
      csrfToken: "csrf-123",
    });
    expect(detailPage.value).toContain("admin@acme.corp");
  });
});
