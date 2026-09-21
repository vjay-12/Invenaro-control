import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db.js";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "cron-msg" }),
    }),
  },
  createTransport: () => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: "cron-msg" }),
  }),
}));

describe("Admin Cleanup Cron Tests", () => {
  const testSecret = "super-secret-cron-token-123456789";

  beforeAll(() => {
    process.env.CRON_SECRET = testSecret;
    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.EMAIL_ENABLED = "false";
  });

  beforeEach(async () => {
    await prisma.adminSession.deleteMany({});
    await prisma.passwordResetToken.deleteMany({});
    await prisma.adminLoginAttempt.deleteMany({});
    await prisma.verificationThrottle.deleteMany({});
  });

  it("rejects cleanup requests without valid Bearer authorization", async () => {
    // Missing header
    const res1 = await request(app).post("/admin/cron/cleanup");
    expect(res1.status).toBe(401);

    // Wrong token
    const res2 = await request(app)
      .post("/admin/cron/cleanup")
      .set("Authorization", "Bearer wrong-secret");
    expect(res2.status).toBe(401);
  });

  it("executes cleanup when valid Bearer token provided", async () => {
    // Create an expired session
    const admin = await prisma.adminUser.create({
      data: {
        email: "cron-test@example.com",
        passwordHash: "hash123",
      },
    });

    await prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: "expired-token-hash-1",
        stage: "active",
        csrfToken: "csrf1",
        ip: "127.0.0.1",
        idleExpiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago (definitely expired)
        absoluteExpiresAt: new Date(Date.now() + 10000),
      },
    });

    const res = await request(app)
      .post("/admin/cron/cleanup")
      .set("Authorization", `Bearer ${testSecret}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted.sessions).toBe(1);

    const remainingSessions = await prisma.adminSession.findMany({
      where: { adminId: admin.id },
    });
    expect(remainingSessions).toHaveLength(0);
  });
});
