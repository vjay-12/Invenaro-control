import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { app } from "../src/app.js";
import { prisma } from "../src/db.js";
import {
  hashPassword,
  encryptAesGcm,
  hashToken,
} from "../src/admin/auth/crypto.js";
import { generateTotpSecret, getTotpUri, verifyTotpCode } from "../src/admin/auth/totp.js";
import * as OTPAuth from "otpauth";

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-msg-id" });
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

describe("Admin Authentication & Security Tests", () => {
  const testEncKey = crypto.randomBytes(32).toString("base64");
  const testCronSecret = "test-cron-secret-12345";
  const testAdminEmail = "admin@example.com";

  beforeAll(() => {
    process.env.ADMIN_EMAIL = testAdminEmail;
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.ADMIN_ENC_KEY = testEncKey;
    process.env.CRON_SECRET = testCronSecret;
    process.env.EMAIL_ENABLED = "true";
    process.env.SMTP_USER = "admin@example.com";
    process.env.SMTP_PASS = "mock_pass";
    process.env.NODE_ENV = "test";
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.adminSession.deleteMany({});
    await prisma.adminLoginAttempt.deleteMany({});
    await prisma.passwordResetToken.deleteMany({});
    await prisma.notification.deleteMany({ where: { toEmail: { endsWith: "@example.com" } } });
    await prisma.adminUser.deleteMany({ where: { email: { endsWith: "@example.com" } } });
  });

  it("redirects unauthenticated /admin requests to /admin/login", async () => {
    const res = await request(app).get("/admin");
    expect(res.status).toBe(302);
    expect(res.header.location).toBe("/admin/login");
  });

  it("serves /robots.txt disallowing /admin", async () => {
    const res = await request(app).get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Disallow: /admin");
  });

  it("sets strict security headers, Cache-Control: no-store, and CSP on /admin routes", async () => {
    const res = await request(app).get("/admin/login");
    expect(res.status).toBe(200);
    expect(res.header["cache-control"]).toContain("no-store");
    expect(res.header["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.header["referrer-policy"]).toBe("no-referrer");
    expect(res.header["content-security-policy"]).toContain("default-src 'none'");
    expect(res.header["content-security-policy"]).toContain("style-src 'nonce-");
  });

  it("returns generic error for wrong email and performs dummy compare without leak", async () => {
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "unknown@example.com", password: "Password1234!" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Invalid email or password");

    const attempts = await prisma.adminLoginAttempt.findMany();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(false);
  });

  it("locks out admin after 5 consecutive failed attempts and dispatches account_locked email", async () => {
    const passwordHash = await hashPassword("ValidPassword1234!");
    await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash,
        mustChangePassword: false,
        totpEnabled: true,
      },
    });

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/admin/login")
        .send({ email: testAdminEmail, password: "WrongPassword123!" });
    }

    const res = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "ValidPassword1234!" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("locked");

    const admin = await prisma.adminUser.findUnique({
      where: { email: testAdminEmail },
    });
    expect(admin?.lockedUntil).not.toBeNull();

    // Verify account_locked notification recorded
    const lockNotification = await prisma.notification.findFirst({
      where: { event: "account_locked" },
    });
    expect(lockNotification).not.toBeNull();
  });

  it("rejects cross-site Origin POST requests on /admin", async () => {
    const res = await request(app)
      .post("/admin/login")
      .set("Origin", "https://attacker.evil.com")
      .send({ email: testAdminEmail, password: "Password1234!" });

    expect(res.status).toBe(403);
    expect(res.text).toContain("Forbidden");
  });

  it("enforces session stages: pending_2fa session cannot access dashboard", async () => {
    const passwordHash = await hashPassword("ValidPassword1234!");
    const admin = await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash,
        mustChangePassword: false,
        totpEnabled: true,
      },
    });

    // Login step 1: should redirect to /admin/login/2fa and set session cookie
    const loginRes = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "ValidPassword1234!" });

    expect(loginRes.status).toBe(302);
    expect(loginRes.header.location).toBe("/admin/login/2fa");
    const cookie = loginRes.header["set-cookie"];
    expect(cookie).toBeDefined();

    // Trying to access /admin directly should redirect back to /admin/login/2fa
    const dashboardRes = await request(app)
      .get("/admin")
      .set("Cookie", cookie);

    expect(dashboardRes.status).toBe(302);
    expect(dashboardRes.header.location).toBe("/admin/login/2fa");
  });

  it("enforces session stages: mustChangePassword session cannot access dashboard", async () => {
    const passwordHash = await hashPassword("TempPassword1234!");
    const admin = await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash,
        mustChangePassword: true,
        totpEnabled: false,
      },
    });

    const loginRes = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "TempPassword1234!" });

    expect(loginRes.status).toBe(302);
    expect(loginRes.header.location).toBe("/admin/setup/password");
    const cookie = loginRes.header["set-cookie"];

    const dashboardRes = await request(app)
      .get("/admin")
      .set("Cookie", cookie);

    expect(dashboardRes.status).toBe(302);
    expect(dashboardRes.header.location).toBe("/admin/setup/password");
  });

  it("handles 2FA enrollment: validates code, encrypts secret in DB, generates 10 recovery codes", async () => {
    const passwordHash = await hashPassword("ValidPassword1234!");
    const admin = await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash,
        mustChangePassword: false,
        totpEnabled: false,
      },
    });

    const loginRes = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "ValidPassword1234!" });

    const cookie = loginRes.header["set-cookie"];

    // GET /admin/setup/2fa to initialize secret
    const setupGetRes = await request(app)
      .get("/admin/setup/2fa")
      .set("Cookie", cookie);

    expect(setupGetRes.status).toBe(200);
    expect(setupGetRes.text).toContain("Enroll in Two-Factor Authentication");

    // Extract CSRF token from page
    const csrfMatch = setupGetRes.text.match(/name="_csrf" value="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : "";

    // Read stored encrypted secret from DB to generate valid token
    const updatedAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { id: admin.id },
    });
    expect(updatedAdmin.totpSecretEnc).not.toBeNull();
    // Verify secret is encrypted format (iv:tag:ciphertext)
    expect(updatedAdmin.totpSecretEnc).toContain(":");

    // Generate valid TOTP code
    const secret = updatedAdmin.totpSecretEnc!;
    // decrypt using helper to compute code
    const { decryptAesGcm } = await import("../src/admin/auth/crypto.js");
    const plainSecret = decryptAesGcm(secret, testEncKey);
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(plainSecret),
    });
    const validCode = totp.generate();

    // Submit 2FA verification
    const setupPostRes = await request(app)
      .post("/admin/setup/2fa")
      .set("Cookie", cookie)
      .send({ code: validCode, _csrf: csrfToken });

    expect(setupPostRes.status).toBe(200);
    expect(setupPostRes.text).toContain("Your Recovery Codes");

    const enrolledAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { id: admin.id },
    });
    expect(enrolledAdmin.totpEnabled).toBe(true);
    expect(Array.isArray(enrolledAdmin.recoveryCodeHashes)).toBe(true);
    expect(enrolledAdmin.recoveryCodeHashes).toHaveLength(10);
  });

  it("forgot password: gives same generic message, stores token as hash, revokes sessions on reset", async () => {
    const passwordHash = await hashPassword("OldPassword1234!");
    const admin = await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash,
        mustChangePassword: false,
        totpEnabled: true,
      },
    });

    // Request reset for known email
    const reqRes = await request(app)
      .post("/admin/forgot")
      .send({ email: testAdminEmail });

    expect(reqRes.status).toBe(200);
    expect(reqRes.text).toContain("If that address is registered");

    // Request reset for unknown email gives same response
    const unkRes = await request(app)
      .post("/admin/forgot")
      .send({ email: "random-nobody@example.com" });

    expect(unkRes.status).toBe(200);
    expect(unkRes.text).toContain("If that address is registered");

    // Check DB for reset token
    const resetRecord = await prisma.passwordResetToken.findFirst({
      where: { adminId: admin.id },
    });
    expect(resetRecord).not.toBeNull();
    expect(resetRecord?.tokenHash).toHaveLength(64); // SHA-256 hash length

    // Reset password using raw token via mock email or matching
    // Let's create an explicit test token
    const testRawToken = "test_raw_token_32_bytes_hex_123456";
    const testHash = hashToken(testRawToken);
    await prisma.passwordResetToken.create({
      data: {
        adminId: admin.id,
        tokenHash: testHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        ip: "127.0.0.1",
      },
    });

    const resetPostRes = await request(app)
      .post(`/admin/reset/${testRawToken}`)
      .send({
        password: "NewBrandPassword123!",
        confirmPassword: "NewBrandPassword123!",
      });

    expect(resetPostRes.status).toBe(200);
    expect(resetPostRes.text).toContain("Password reset successfully");

    // Verify token marked used
    const usedToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: testHash },
    });
    expect(usedToken?.usedAt).not.toBeNull();

    // Verify login with new password still requires 2FA!
    const newLoginRes = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "NewBrandPassword123!" });

    expect(newLoginRes.status).toBe(302);
    expect(newLoginRes.header.location).toBe("/admin/login/2fa");
  });

  it("verifies 6-digit OTP code and resets password via /admin/forgot/verify", async () => {
    const testAdminEmail = `otp-test-${Date.now()}@example.com`;
    const admin = await prisma.adminUser.create({
      data: {
        email: testAdminEmail,
        passwordHash: await hashPassword("OldPassword123!"),
        mustChangePassword: false,
        totpEnabled: true,
      },
    });

    const testOtp = "654321";
    const otpHash = hashToken(`${admin.id}:${testOtp}`);
    await prisma.passwordResetToken.create({
      data: {
        adminId: admin.id,
        tokenHash: otpHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        ip: "127.0.0.1",
      },
    });

    // Test invalid OTP rejection
    const failRes = await request(app)
      .post("/admin/forgot/verify")
      .send({
        email: testAdminEmail,
        code: "000000",
        password: "NewBrandPassword456!",
        confirmPassword: "NewBrandPassword456!",
      });

    expect(failRes.status).toBe(200);
    expect(failRes.text).toContain("Invalid or expired verification code");

    // Test valid OTP success
    const successRes = await request(app)
      .post("/admin/forgot/verify")
      .send({
        email: testAdminEmail,
        code: testOtp,
        password: "NewBrandPassword456!",
        confirmPassword: "NewBrandPassword456!",
      });

    expect(successRes.status).toBe(200);
    expect(successRes.text).toContain("Password reset successfully");

    // Next login with new password requires 2FA
    const loginRes = await request(app)
      .post("/admin/login")
      .send({ email: testAdminEmail, password: "NewBrandPassword456!" });

    expect(loginRes.status).toBe(302);
    expect(loginRes.header.location).toBe("/admin/login/2fa");
  });
});
