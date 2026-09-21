import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { prisma } from "../src/db.js";
import {
  createCustomerWithLicense,
  changePlan,
  setModule,
  renewLicense,
  suspendLicense,
  reinstateLicense,
  reissueLicenseKey,
} from "../src/services/adminActions.js";
import { verifyLicense } from "../src/services/licenseService.js";
import * as jose from "jose";

const mockSendMail = vi.fn().mockResolvedValue({ messageId: "msg_123" });
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: mockSendMail,
    }),
  },
  createTransport: () => ({
    sendMail: mockSendMail,
  }),
}));

describe("Admin Actions Service Layer Tests", () => {
  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
      extractable: true,
    });
    const privPem = await jose.exportPKCS8(privateKey);
    const pubPem = await jose.exportSPKI(publicKey);

    process.env.LICENSE_SIGNING_PRIVATE_KEY = Buffer.from(privPem).toString("base64");
    process.env.LICENSE_PUBLIC_KEY = Buffer.from(pubPem).toString("base64");
    process.env.LICENSE_SIGNING_KID = "test_kid_actions";
    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.SMTP_USER = "admin@example.com";
    process.env.SMTP_PASS = "dummy_pass";
    process.env.EMAIL_ENABLED = "true";
    process.env.ALLOW_LOCALHOST = "true";
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.notification.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.licenseModule.deleteMany({});
    await prisma.license.deleteMany({});
    await prisma.deployment.deleteMany({});
    await prisma.customer.deleteMany({});
  });

  it("createCustomerWithLicense: shows key once, stores only hash+prefix, never emails key", async () => {
    const expiresAt = new Date("2028-01-01T23:59:59.999Z");
    const result = await createCustomerWithLicense({
      companyName: "Acme Logistics Test",
      domain: "acme.test.invenaro.com",
      plan: "business",
      expiresAt,
      graceDays: 14,
      actor: "admin:admin@example.com",
    });

    expect(result.plainLicenseKey).toMatch(/^INV-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-/);

    // Verify DB holds hash and prefix, NOT the plain key
    const dbLicense = await prisma.license.findUniqueOrThrow({
      where: { id: result.license.id },
    });
    expect(dbLicense.keyHash).toHaveLength(64);
    expect(dbLicense.keyPrefix).toBe(result.plainLicenseKey.slice(0, 8));

    // Verify AuditLog exists
    const audit = await prisma.auditLog.findFirst({
      where: { action: "customer:create", entityId: result.customer.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor).toBe("admin:admin@example.com");

    // Verify plain key is NOT in any notification or email
    const notification = await prisma.notification.findFirst({
      where: { event: "customer_created" },
    });
    expect(notification).not.toBeNull();
    expect(notification?.subject).not.toContain(result.plainLicenseKey);

    // Check mockSendMail arguments
    expect(mockSendMail).toHaveBeenCalled();
    const emailArgs = mockSendMail.mock.calls[0][0];
    expect(emailArgs.text).not.toContain(result.plainLicenseKey);
    expect(emailArgs.html).not.toContain(result.plainLicenseKey);
  });

  it("changePlan: computes UPGRADED vs DOWNGRADED properly in notifications", async () => {
    const created = await createCustomerWithLicense({
      companyName: "Plan Change Test",
      domain: "plan.test.com",
      plan: "basic",
      expiresAt: new Date("2028-01-01"),
      actor: "cli:testuser",
    });

    // Upgrade from basic to business
    await changePlan({
      licenseId: created.license.id,
      plan: "business",
      actor: "admin:admin@example.com",
    });

    const upgradeNotification = await prisma.notification.findFirst({
      where: { event: "plan_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(upgradeNotification?.subject).toContain("UPGRADED");

    // Upgrade from business to enterprise
    await changePlan({
      licenseId: created.license.id,
      plan: "enterprise",
      actor: "admin:admin@example.com",
    });

    const enterpriseNotification = await prisma.notification.findFirst({
      where: { event: "plan_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(enterpriseNotification?.subject).toContain("UPGRADED");

    // Downgrade from enterprise to basic
    await changePlan({
      licenseId: created.license.id,
      plan: "basic",
      actor: "admin:admin@example.com",
    });

    const downgradeNotification = await prisma.notification.findFirst({
      where: { event: "plan_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(downgradeNotification?.subject).toContain("DOWNGRADED");
  });

  it("reissueLicenseKey: invalidates old key immediately at verify endpoint", async () => {
    const created = await createCustomerWithLicense({
      companyName: "Key Invalidation Test",
      domain: "reissue.test.com",
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "cli:testuser",
    });

    const oldKey = created.plainLicenseKey;

    // Verify old key works initially
    const firstVerify = await verifyLicense({
      licenseKey: oldKey,
      domain: "reissue.test.com",
      appVersion: "1.0.0",
    });
    expect(firstVerify.token).toBeDefined();

    // Reissue key
    const reissued = await reissueLicenseKey({
      licenseId: created.license.id,
      actor: "admin:admin@example.com",
    });
    const newKey = reissued.newPlainLicenseKey;
    expect(newKey).not.toBe(oldKey);

    // Old key must be rejected now!
    await expect(
      verifyLicense({
        licenseKey: oldKey,
        domain: "reissue.test.com",
        appVersion: "1.0.0",
      })
    ).rejects.toThrow();

    // New key must work!
    const newVerify = await verifyLicense({
      licenseKey: newKey,
      domain: "reissue.test.com",
      appVersion: "1.0.0",
    });
    expect(newVerify.token).toBeDefined();
  });

  it("email failure resilience: failure never rolls back the business transaction", async () => {
    // Force nodemailer to throw an error
    mockSendMail.mockRejectedValueOnce(new Error("SMTP connection timed out"));

    const result = await createCustomerWithLicense({
      companyName: "Resilience Test Corp",
      domain: "resilience.test.com",
      plan: "business",
      expiresAt: new Date("2028-01-01"),
      actor: "admin:admin@example.com",
    });

    // Customer and license were committed despite email failure!
    expect(result.customer.id).toBeDefined();
    const customerInDb = await prisma.customer.findUnique({
      where: { id: result.customer.id },
    });
    expect(customerInDb).not.toBeNull();

    // Notification table recorded failure
    const failedNotification = await prisma.notification.findFirst({
      where: { event: "customer_created" },
    });
    expect(failedNotification?.status).toBe("failed");
    expect(failedNotification?.error).toContain("SMTP connection timed out");
  });
});
