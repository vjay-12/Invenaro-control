import { z } from "zod";
import crypto from "node:crypto";
import os from "node:os";
import { prisma } from "../../src/db.js";
import { hashPassword } from "../../src/admin/auth/crypto.js";
import { recordAuditLog } from "../../src/services/audit.js";
import { sendAdminEmail, buildTwoFactorDisabledEmail, buildPasswordChangedEmail } from "../../src/services/email.js";

function getCliActor(): string {
  return `cli:${os.userInfo().username || process.env.USERNAME || process.env.USER || "local"}`;
}

export async function adminCreateCommand(options: {
  email?: string;
  forceAdditional?: boolean;
}) {
  const emailParsed = z.string().email("A valid email address is required").safeParse(options.email);
  if (!emailParsed.success) {
    console.error("❌ " + emailParsed.error.errors[0].message);
    process.exit(1);
  }

  const email = emailParsed.data.toLowerCase().trim();
  const actor = getCliActor();

  try {
    const existingCount = await prisma.adminUser.count();
    if (existingCount > 0 && !options.forceAdditional) {
      console.error("❌ An administrator already exists.");
      console.error("   To register an additional administrator, provide the --force-additional flag.");
      process.exit(1);
    }

    const existingUser = await prisma.adminUser.findUnique({
      where: { email },
    });
    if (existingUser) {
      console.error(`❌ An administrator with email "${email}" already exists.`);
      process.exit(1);
    }

    // Generate strong 16-character temporary password
    const tempPassword = `Inv_${crypto.randomBytes(8).toString("hex")}!`;
    const passwordHash = await hashPassword(tempPassword);

    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        mustChangePassword: true,
        totpEnabled: false,
      },
    });

    await recordAuditLog({
      actor,
      action: "admin:create",
      entityType: "AdminUser",
      entityId: admin.id,
      after: {
        email: admin.email,
        mustChangePassword: admin.mustChangePassword,
        totpEnabled: admin.totpEnabled,
      },
    });

    console.log("✅ Admin user created successfully!\n");
    console.log("================================================================================");
    console.log("🔑 TEMPORARY ADMIN PASSWORD (PRINTED ONCE - COPY SECURELY):");
    console.log(`   ${tempPassword}`);
    console.log("================================================================================");
    console.log(`   Admin Email:           ${admin.email}`);
    console.log("   Must Change Password:  YES (Required upon first login)");
    console.log("   2FA Enrollment:        YES (Required upon first login)\n");
  } catch (error) {
    console.error("❌ Failed to create admin user:", error);
    process.exit(1);
  }
}

export async function adminResetPasswordCommand(options: { email?: string }) {
  const emailParsed = z.string().email("A valid email address is required").safeParse(options.email);
  if (!emailParsed.success) {
    console.error("❌ " + emailParsed.error.errors[0].message);
    process.exit(1);
  }

  const email = emailParsed.data.toLowerCase().trim();
  const actor = getCliActor();

  try {
    const admin = await prisma.adminUser.findUnique({
      where: { email },
    });

    if (!admin) {
      console.error(`❌ Admin user not found with email: ${email}`);
      process.exit(1);
    }

    const tempPassword = `Inv_${crypto.randomBytes(8).toString("hex")}!`;
    const passwordHash = await hashPassword(tempPassword);

    await prisma.$transaction([
      prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          mustChangePassword: true,
          lockedUntil: null,
        },
      }),
      prisma.adminSession.deleteMany({
        where: { adminId: admin.id },
      }),
    ]);

    await recordAuditLog({
      actor,
      action: "admin:reset-password",
      entityType: "AdminUser",
      entityId: admin.id,
    });

    const emailPayload = buildPasswordChangedEmail({
      ip: "CLI",
      userAgent: actor,
    });
    await sendAdminEmail({
      event: "password_changed",
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
      entityType: "AdminUser",
      entityId: admin.id,
    });

    console.log("✅ Admin password reset successfully!\n");
    console.log("================================================================================");
    console.log("🔑 NEW TEMPORARY PASSWORD (PRINTED ONCE):");
    console.log(`   ${tempPassword}`);
    console.log("================================================================================");
    console.log("   All active administrative sessions have been terminated.");
    console.log("   The user will be prompted to choose a new password upon signing in.\n");
  } catch (error) {
    console.error("❌ Failed to reset admin password:", error);
    process.exit(1);
  }
}

export async function adminDisable2faCommand(options: {
  email?: string;
  yes?: boolean;
}) {
  const emailParsed = z.string().email("A valid email address is required").safeParse(options.email);
  if (!emailParsed.success) {
    console.error("❌ " + emailParsed.error.errors[0].message);
    process.exit(1);
  }

  if (!options.yes) {
    console.error("⚠️  Disabling 2FA reduces account security.");
    console.error("   To proceed, confirm with: --yes");
    process.exit(1);
  }

  const email = emailParsed.data.toLowerCase().trim();
  const actor = getCliActor();

  try {
    const admin = await prisma.adminUser.findUnique({
      where: { email },
    });

    if (!admin) {
      console.error(`❌ Admin user not found with email: ${email}`);
      process.exit(1);
    }

    await prisma.$transaction([
      prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          totpEnabled: false,
          totpSecretEnc: null,
          recoveryCodeHashes: [],
        },
      }),
      prisma.adminSession.deleteMany({
        where: { adminId: admin.id },
      }),
    ]);

    await recordAuditLog({
      actor,
      action: "admin:disable-2fa",
      entityType: "AdminUser",
      entityId: admin.id,
    });

    const emailPayload = buildTwoFactorDisabledEmail({
      ip: "CLI",
      actor,
    });
    await sendAdminEmail({
      event: "two_factor_disabled",
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
      entityType: "AdminUser",
      entityId: admin.id,
    });

    console.log(`✅ Two-factor authentication disabled for: ${email}`);
    console.log("   All active sessions have been revoked.");
    console.log("   The administrator must re-enroll in 2FA upon next sign in.\n");
  } catch (error) {
    console.error("❌ Failed to disable 2FA:", error);
    process.exit(1);
  }
}

export async function adminListCommand() {
  try {
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: "asc" },
    });

    console.log("================================================================================");
    console.log(`👥 REGISTERED ADMINISTRATORS (${admins.length})`);
    console.log("================================================================================");

    if (admins.length === 0) {
      console.log("   No administrators registered. Run `admin:create --email <email>` to register.");
    } else {
      admins.forEach((a) => {
        console.log(`- Email:             ${a.email}`);
        console.log(`  2FA Enabled:       ${a.totpEnabled ? "YES" : "NO"}`);
        console.log(`  Password Changed:  ${a.mustChangePassword ? "PENDING INITIAL SETUP" : "YES"}`);
        console.log(`  Last Login:        ${a.lastLoginAt ? a.lastLoginAt.toISOString() : "Never"}`);
        console.log(`  Created At:        ${a.createdAt.toISOString()}`);
        console.log("--------------------------------------------------------------------------------");
      });
    }
    console.log();
  } catch (error) {
    console.error("❌ Failed to list administrators:", error);
    process.exit(1);
  }
}
