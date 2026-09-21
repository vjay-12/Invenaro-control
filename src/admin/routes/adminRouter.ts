import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { getConfig } from "../../config.js";
import {
  hashPassword,
  comparePassword,
  dummyComparePassword,
  validatePasswordPolicy,
  hashToken,
  generateRandomToken,
  encryptAesGcm,
  decryptAesGcm,
  constantTimeCompare,
} from "../auth/crypto.js";
import {
  generateTotpSecret,
  getTotpUri,
  generateQrCodeDataUri,
  verifyTotpCode,
  verifyTotpCodeWithReplay,
  generateRecoveryCodes,
  verifyAndConsumeRecoveryCode,
} from "../auth/totp.js";
import {
  createAdminSession,
  rotateAdminSession,
  setSessionCookie,
  clearSessionCookie,
  revokeAllAdminSessions,
  revokeOtherAdminSessions,
} from "../auth/session.js";
import {
  adminAuthMiddleware,
  checkLoginRateLimitAndLockout,
  checkForgotRateLimit,
} from "../auth/middleware.js";
import {
  sendAdminEmail,
  buildLoginSuccessEmail,
  buildAccountLockedEmail,
  buildPasswordResetRequestedEmail,
  buildPasswordChangedEmail,
  buildTwoFactorEnabledEmail,
  buildRecoveryCodesRegeneratedEmail,
} from "../../services/email.js";
import {
  createCustomerWithLicense,
  changePlan,
  setModule,
  renewLicense,
  suspendLicense,
  reinstateLicense,
  reissueLicenseKey,
  updateCustomerContact,
} from "../../services/adminActions.js";
import { computeLicenseStatus } from "../../services/statusLogic.js";
import { computeEffectiveModules } from "../../services/planDefaults.js";
import { renderLayout, RawString } from "../views/template.js";
import {
  renderLoginPage,
  renderLogin2faPage,
  renderForgotPasswordPage,
  renderForgotVerifyPage,
  renderResetPasswordPage,
  renderSetupPasswordPage,
  renderSetup2faPage,
  renderSetupRecoveryCodesPage,
  renderDashboardPage,
  renderCustomerListPage,
  renderCustomerNewPage,
  renderCustomerCreatedSuccessPage,
  renderReissuedKeySuccessPage,
  renderCustomerDetailPage,
  renderAuditLogsPage,
  renderNotificationsPage,
  renderAccountPage,
} from "../views/pages.js";

export const adminRouter = Router();

// Apply admin auth and stage enforcement middleware to all /admin routes
adminRouter.use(adminAuthMiddleware);

function sendHtml(req: Request, res: Response, title: string, content: string | RawString, extra?: {
  alert?: { type: "success" | "error" | "warning"; message: string };
}) {
  const auth = req.adminAuth;
  const html = renderLayout({
    title,
    content,
    nonce: req.cspNonce,
    userEmail: auth?.admin.email,
    currentPath: req.path,
    csrfToken: auth?.csrfToken,
    alert: extra?.alert,
  });
  res.send(html);
}

// ----------------------------------------------------------------------
// Auth Routes
// ----------------------------------------------------------------------

// GET /admin/login
adminRouter.get("/login", (req, res) => {
  sendHtml(req, res, "Sign In", renderLoginPage({ error: req.query.error as string }));
});

// POST /admin/login
adminRouter.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const ip = req.adminAuth?.clientIp || "127.0.0.1";

  // Rate limit / lockout check
  const lockout = await checkLoginRateLimitAndLockout({ email, ip });
  if (lockout.locked) {
    sendHtml(
      req,
      res,
      "Sign In",
      renderLoginPage({ error: lockout.message })
    );
    return;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (!admin) {
    await dummyComparePassword(password);
    await prisma.adminLoginAttempt.create({
      data: { email, ip, success: false },
    });
    sendHtml(
      req,
      res,
      "Sign In",
      renderLoginPage({ error: "Invalid email or password." })
    );
    return;
  }

  const passwordMatch = await comparePassword(password, admin.passwordHash);

  if (!passwordMatch) {
    await prisma.adminLoginAttempt.create({
      data: { email, ip, success: false },
    });
    // Re-check lockout threshold after recording failure
    const postCheck = await checkLoginRateLimitAndLockout({ email, ip });
    sendHtml(
      req,
      res,
      "Sign In",
      renderLoginPage({
        error: postCheck.locked
          ? postCheck.message
          : "Invalid email or password.",
      })
    );
    return;
  }

  // Record successful login attempt
  await prisma.adminLoginAttempt.create({
    data: { email, ip, success: true },
  });

  // Update lastLoginAt
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const userAgent = req.headers["user-agent"] || null;

  // Case 1: Initial temporary password must be changed
  if (admin.mustChangePassword) {
    const { rawToken } = await createAdminSession({
      adminId: admin.id,
      stage: "active",
      ip,
      userAgent,
    });
    setSessionCookie(res, req, rawToken);
    res.redirect("/admin/setup/password");
    return;
  }

  // Case 2: 2FA is enrolled -> move to pending_2fa
  if (admin.totpEnabled) {
    const { rawToken } = await createAdminSession({
      adminId: admin.id,
      stage: "pending_2fa",
      ip,
      userAgent,
    });
    setSessionCookie(res, req, rawToken);
    res.redirect("/admin/login/2fa");
    return;
  }

  // Case 3: 2FA is not yet enrolled -> force 2FA setup
  const { rawToken } = await createAdminSession({
    adminId: admin.id,
    stage: "active",
    ip,
    userAgent,
  });
  setSessionCookie(res, req, rawToken);
  res.redirect("/admin/setup/2fa");
});

// GET /admin/login/2fa
adminRouter.get("/login/2fa", (req, res) => {
  const auth = req.adminAuth;
  if (!auth || auth.session.stage !== "pending_2fa") {
    res.redirect("/admin/login");
    return;
  }
  sendHtml(
    req,
    res,
    "Two-Factor Authentication",
    renderLogin2faPage({ csrfToken: auth.csrfToken })
  );
});

// POST /admin/login/2fa
adminRouter.post("/login/2fa", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth || auth.session.stage !== "pending_2fa") {
    res.redirect("/admin/login");
    return;
  }

  const code = String(req.body.code || "").trim();
  const session = auth.session;
  const admin = auth.admin;
  const now = new Date();

  // 0. Check account-level lockout: if already locked, reject immediately
  if (admin.lockedUntil && admin.lockedUntil > now) {
    sendHtml(
      req,
      res,
      "Two-Factor Authentication",
      renderLogin2faPage({
        csrfToken: auth.csrfToken,
        error: "This account is temporarily locked due to multiple failed 2FA attempts. Please try again later.",
      })
    );
    return;
  }

  // 1. Check account-wide failed 2FA attempts across ALL sessions within last 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const accountFailed2fa = await prisma.adminLoginAttempt.count({
    where: {
      email: `2fa:${admin.id}`,
      success: false,
      attemptedAt: { gte: fifteenMinutesAgo },
    },
  });

  if (accountFailed2fa >= 5 || session.attempts >= 5) {
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lockedUntil: lockUntil },
    });
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    clearSessionCookie(res, req);

    const emailPayload = buildAccountLockedEmail({
      email: admin.email,
      ip: auth.clientIp,
    });
    await sendAdminEmail({
      event: "account_locked",
      subject: emailPayload.subject,
      text: emailPayload.text,
      html: emailPayload.html,
      entityType: "AdminUser",
      entityId: admin.id,
    });

    res.redirect("/admin/login?error=Account%20locked%20due%20to%20multiple%20failed%202FA%20attempts.%20Try%20again%20in%2015%20minutes.");
    return;
  }

  let codeValid = false;
  let verifiedTimeStep: number | undefined = undefined;

  // 2. Check TOTP authenticator code with replay protection
  if (admin.totpSecretEnc) {
    try {
      const secret = decryptAesGcm(admin.totpSecretEnc);
      const totpRes = verifyTotpCodeWithReplay(secret, code, (admin as any).totpLastTimeStep);
      if (totpRes.valid) {
        codeValid = true;
        verifiedTimeStep = totpRes.timeStep;
      }
    } catch (err) {
      console.error("[2FA] Error decrypting TOTP secret:", err);
    }
  }

  // 3. Check recovery code if not verified as TOTP
  if (!codeValid && Array.isArray(admin.recoveryCodeHashes)) {
    const recoveryResult = verifyAndConsumeRecoveryCode(
      code,
      admin.recoveryCodeHashes as string[]
    );
    if (recoveryResult.valid) {
      codeValid = true;
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { recoveryCodeHashes: recoveryResult.remainingHashes },
      });
    }
  }

  if (!codeValid) {
    // Record failed attempt for this account across all sessions
    await prisma.adminLoginAttempt.create({
      data: {
        email: `2fa:${admin.id}`,
        ip: auth.clientIp,
        success: false,
      },
    });

    await prisma.adminSession.update({
      where: { id: session.id },
      data: { attempts: session.attempts + 1 },
    });

    const newFailed = accountFailed2fa + 1;
    if (newFailed >= 5 || session.attempts + 1 >= 5) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lockedUntil: lockUntil },
      });
      await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
      clearSessionCookie(res, req);

      const emailPayload = buildAccountLockedEmail({
        email: admin.email,
        ip: auth.clientIp,
      });
      await sendAdminEmail({
        event: "account_locked",
        subject: emailPayload.subject,
        text: emailPayload.text,
        html: emailPayload.html,
        entityType: "AdminUser",
        entityId: admin.id,
      });

      res.redirect("/admin/login?error=Account%20locked%20due%20to%20multiple%20failed%202FA%20attempts.%20Try%20again%20in%2015%20minutes.");
      return;
    }

    sendHtml(
      req,
      res,
      "Two-Factor Authentication",
      renderLogin2faPage({
        csrfToken: auth.csrfToken,
        error: `Invalid 2FA code or recovery code. (${5 - newFailed} attempt${5 - newFailed === 1 ? "" : "s"} remaining)`,
      })
    );
    return;
  }

  // Successful 2FA: Rotate session to 'active' stage
  const { rawToken } = await rotateAdminSession(session.id, {
    adminId: admin.id,
    stage: "active",
    ip: auth.clientIp,
    userAgent: req.headers["user-agent"] || null,
  });
  setSessionCookie(res, req, rawToken);

  // Send login success email
  const config = getConfig();
  const emailPayload = buildLoginSuccessEmail({
    ip: auth.clientIp,
    userAgent: req.headers["user-agent"],
    resetUrl: `${config.APP_BASE_URL}/admin/forgot`,
  });
  await sendAdminEmail({
    event: "login_success",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: admin.id,
  });

  res.redirect("/admin");
});

// GET /admin/forgot
adminRouter.get("/forgot", (req, res) => {
  sendHtml(req, res, "Forgot Password", renderForgotPasswordPage({}));
});

// POST /admin/forgot
adminRouter.post("/forgot", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const ip = req.adminAuth?.clientIp || "127.0.0.1";
  const genericSuccess = "If that address is registered, a password reset link and 6-digit verification code have been sent to your email.";

  const allowed = await checkForgotRateLimit({ email, ip });
  if (!allowed) {
    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        message: genericSuccess,
      })
    );
    return;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (admin) {
    // Invalidate previous reset tokens for this admin
    await prisma.passwordResetToken.deleteMany({
      where: { adminId: admin.id },
    }).catch(() => {});

    // Generate direct reset link token (32 bytes) + 6-digit numeric OTP
    const rawToken = generateRandomToken(32);
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.passwordResetToken.createMany({
      data: [
        {
          adminId: admin.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
          ip,
        },
        {
          adminId: admin.id,
          tokenHash: hashToken(`${admin.id}:${otp}`),
          expiresAt,
          ip,
        },
      ],
    });

    const config = getConfig();
    const resetUrl = `${config.APP_BASE_URL}/admin/reset/${rawToken}`;
    const emailPayload = buildPasswordResetRequestedEmail({ resetUrl, ip, otp });

    await sendAdminEmail({
      event: "password_reset_requested",
      subject: emailPayload.subject,
      subjectForLog: "Password reset verification code",
      text: emailPayload.text,
      html: emailPayload.html,
      entityType: "AdminUser",
      entityId: admin.id,
    });
  }

  sendHtml(
    req,
    res,
    "Verify Reset Code",
    renderForgotVerifyPage({
      email,
      message: genericSuccess,
    })
  );
});

// GET /admin/forgot/verify
adminRouter.get("/forgot/verify", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const isSent = req.query.sent === "1";
  sendHtml(
    req,
    res,
    "Verify Reset Code",
    renderForgotVerifyPage({
      email,
      message: isSent
        ? "A 6-digit verification code has been dispatched to your email (valid for 15 minutes)."
        : undefined,
    })
  );
});

// POST /admin/forgot/verify
adminRouter.post("/forgot/verify", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const ip = req.adminAuth?.clientIp || "127.0.0.1";
  const userAgent = req.headers["user-agent"];
  const now = new Date();

  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  const activeToken = admin
    ? await prisma.passwordResetToken.findFirst({
        where: {
          adminId: admin.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (!admin || !activeToken) {
    // Constant time dummy comparison
    const dummyCandidate = hashToken(`dummy:${code}`);
    const dummyTarget = hashToken("dummy:target");
    constantTimeCompare(dummyCandidate, dummyTarget);

    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        error: "Invalid or expired verification code.",
      })
    );
    return;
  }

  // Check failed attempts for this code/token
  const failedAttempts = await prisma.adminLoginAttempt.count({
    where: {
      email: `reset_code:${admin.id}`,
      success: false,
      attemptedAt: { gte: activeToken.createdAt },
    },
  });

  if (failedAttempts >= 5) {
    // Invalidate the reset token
    await prisma.passwordResetToken.updateMany({
      where: { adminId: admin.id },
      data: { usedAt: now },
    });
    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        error: "Too many incorrect attempts. This verification code has been invalidated. Please request a new one.",
      })
    );
    return;
  }

  const candidateHash = hashToken(`${admin.id}:${code}`);
  const isMatch = constantTimeCompare(candidateHash, activeToken.tokenHash);

  if (!isMatch) {
    await prisma.adminLoginAttempt.create({
      data: {
        email: `reset_code:${admin.id}`,
        ip,
        success: false,
      },
    });

    const newFailedCount = failedAttempts + 1;
    if (newFailedCount >= 5) {
      await prisma.passwordResetToken.updateMany({
        where: { adminId: admin.id },
        data: { usedAt: now },
      });
      sendHtml(
        req,
        res,
        "Verify Reset Code",
        renderForgotVerifyPage({
          email,
          error: "Too many incorrect attempts. This verification code has been invalidated. Please request a new one.",
        })
      );
      return;
    }

    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        error: `Invalid verification code. (${5 - newFailedCount} attempt${5 - newFailedCount === 1 ? "" : "s"} remaining)`,
      })
    );
    return;
  }

  if (password !== confirmPassword) {
    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        error: "Passwords do not match.",
      })
    );
    return;
  }

  const policy = validatePasswordPolicy(password, admin.email);
  if (!policy.valid) {
    sendHtml(
      req,
      res,
      "Verify Reset Code",
      renderForgotVerifyPage({
        email,
        error: policy.message,
      })
    );
    return;
  }

  const newHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: admin.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    await tx.adminSession.deleteMany({
      where: { adminId: admin.id },
    });

    await tx.passwordResetToken.updateMany({
      where: { adminId: admin.id },
      data: { usedAt: now },
    });
  });

  const emailPayload = buildPasswordChangedEmail({ ip, userAgent });
  await sendAdminEmail({
    event: "password_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: admin.id,
  });

  sendHtml(
    req,
    res,
    "Sign In",
    renderLoginPage({
      error: undefined,
    }),
    {
      alert: {
        type: "success",
        message: "Password reset successfully! Please sign in with your new password.",
      },
    }
  );
});

// GET /admin/reset/:token
adminRouter.get("/reset/:token", async (req, res) => {
  const token = req.params.token;
  const tokenHash = hashToken(token);
  const now = new Date();

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < now) {
    res.redirect("/admin/forgot");
    return;
  }

  sendHtml(req, res, "Choose New Password", renderResetPasswordPage({ token }));
});

// POST /admin/reset/:token
adminRouter.post("/reset/:token", async (req, res) => {
  const token = req.params.token;
  const tokenHash = hashToken(token);
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");
  const now = new Date();

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < now) {
    res.redirect("/admin/forgot");
    return;
  }

  if (password !== confirmPassword) {
    sendHtml(
      req,
      res,
      "Choose New Password",
      renderResetPasswordPage({ token, error: "Passwords do not match." })
    );
    return;
  }

  const policy = validatePasswordPolicy(password, resetRecord.admin.email);
  if (!policy.valid) {
    sendHtml(
      req,
      res,
      "Choose New Password",
      renderResetPasswordPage({ token, error: policy.message })
    );
    return;
  }

  const newHash = await hashPassword(password);

  // Update password, mark token used, revoke all sessions
  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: resetRecord.adminId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: now },
    }),
    prisma.adminSession.deleteMany({
      where: { adminId: resetRecord.adminId },
    }),
  ]);

  const emailPayload = buildPasswordChangedEmail({
    ip: req.adminAuth?.clientIp || "127.0.0.1",
    userAgent: req.headers["user-agent"],
  });
  await sendAdminEmail({
    event: "password_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: resetRecord.adminId,
  });

  clearSessionCookie(res, req);
  sendHtml(
    req,
    res,
    "Sign In",
    renderLoginPage({
      error: "Password reset successfully. Please sign in with your new password and authenticator 2FA.",
    })
  );
});

// GET /admin/setup/password
adminRouter.get("/setup/password", (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");
  sendHtml(
    req,
    res,
    "Set Permanent Password",
    renderSetupPasswordPage({ csrfToken: auth.csrfToken || "" })
  );
});

// POST /admin/setup/password
adminRouter.post("/setup/password", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (password !== confirmPassword) {
    sendHtml(
      req,
      res,
      "Set Permanent Password",
      renderSetupPasswordPage({
        csrfToken: auth.csrfToken || "",
        error: "Passwords do not match.",
      })
    );
    return;
  }

  const policy = validatePasswordPolicy(password, auth.admin.email);
  if (!policy.valid) {
    sendHtml(
      req,
      res,
      "Set Permanent Password",
      renderSetupPasswordPage({
        csrfToken: auth.csrfToken || "",
        error: policy.message,
      })
    );
    return;
  }

  const newHash = await hashPassword(password);
  await prisma.adminUser.update({
    where: { id: auth.admin.id },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  const emailPayload = buildPasswordChangedEmail({
    ip: auth.clientIp,
    userAgent: req.headers["user-agent"],
  });
  await sendAdminEmail({
    event: "password_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: auth.admin.id,
  });

  if (!auth.admin.totpEnabled) {
    res.redirect("/admin/setup/2fa");
  } else {
    res.redirect("/admin");
  }
});

// GET /admin/setup/2fa
adminRouter.get("/setup/2fa", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  // Generate or read unconfirmed secret
  let secret: string;
  if (auth.admin.totpSecretEnc && !auth.admin.totpEnabled) {
    try {
      secret = decryptAesGcm(auth.admin.totpSecretEnc);
    } catch {
      secret = generateTotpSecret();
      await prisma.adminUser.update({
        where: { id: auth.admin.id },
        data: { totpSecretEnc: encryptAesGcm(secret) },
      });
    }
  } else {
    secret = generateTotpSecret();
    await prisma.adminUser.update({
      where: { id: auth.admin.id },
      data: { totpSecretEnc: encryptAesGcm(secret) },
    });
  }

  const uri = getTotpUri(secret, auth.admin.email);
  const qrDataUri = await generateQrCodeDataUri(uri);

  sendHtml(
    req,
    res,
    "2FA Enrollment",
    renderSetup2faPage({
      csrfToken: auth.csrfToken || "",
      qrDataUri,
      secretManual: secret,
    })
  );
});

// POST /admin/setup/2fa
adminRouter.post("/setup/2fa", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const code = String(req.body.code || "").trim();

  if (!auth.admin.totpSecretEnc) {
    res.redirect("/admin/setup/2fa");
    return;
  }

  let secret = "";
  try {
    secret = decryptAesGcm(auth.admin.totpSecretEnc);
  } catch (err) {
    res.redirect("/admin/setup/2fa");
    return;
  }

  const isValid = verifyTotpCode(secret, code);
  if (!isValid) {
    const uri = getTotpUri(secret, auth.admin.email);
    const qrDataUri = await generateQrCodeDataUri(uri);
    sendHtml(
      req,
      res,
      "2FA Enrollment",
      renderSetup2faPage({
        csrfToken: auth.csrfToken || "",
        qrDataUri,
        secretManual: secret,
        error: "Invalid 6-digit code. Make sure your clock is synced and enter the latest code.",
      })
    );
    return;
  }

  // 2FA code is valid! Generate 10 recovery codes
  const { plainCodes, codeHashes } = generateRecoveryCodes();

  await prisma.adminUser.update({
    where: { id: auth.admin.id },
    data: {
      totpEnabled: true,
      recoveryCodeHashes: codeHashes,
    },
  });

  const emailPayload = buildTwoFactorEnabledEmail({ ip: auth.clientIp });
  await sendAdminEmail({
    event: "two_factor_enabled",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: auth.admin.id,
  });

  // Render recovery codes page ONCE
  sendHtml(
    req,
    res,
    "Save Recovery Codes",
    renderSetupRecoveryCodesPage({ recoveryCodes: plainCodes })
  );
});

// POST /admin/logout
adminRouter.post("/logout", async (req, res) => {
  const auth = req.adminAuth;
  if (auth) {
    await prisma.adminSession.delete({ where: { id: auth.session.id } }).catch(() => {});
  }
  clearSessionCookie(res, req);
  res.redirect("/admin/login");
});

// ----------------------------------------------------------------------
// Dashboard & Customer Management Routes
// ----------------------------------------------------------------------

// GET /admin
adminRouter.get("/", async (req, res) => {
  const [customerCount, licenses, deployments] = await Promise.all([
    prisma.customer.count(),
    prisma.license.findMany({
      include: { customer: true },
    }),
    prisma.deployment.findMany({
      include: { customer: true },
    }),
  ]);

  const now = new Date();
  const counts = { active: 0, grace: 0, expired: 0, suspended: 0 };
  const expiringLicenses: Array<{
    id: string;
    keyPrefix: string;
    companyName: string;
    customerId: string;
    plan: string;
    expiresAt: Date;
    daysLeft: number;
  }> = [];

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const lic of licenses) {
    const effectiveStatus = computeLicenseStatus({
      customerStatus: lic.customer.status,
      licenseStatus: lic.status,
      expiresAt: lic.expiresAt,
      graceDays: lic.graceDays,
      now,
    });
    counts[effectiveStatus]++;

    const msUntilExpiry = lic.expiresAt.getTime() - now.getTime();
    if (msUntilExpiry > 0 && msUntilExpiry <= thirtyDaysMs && effectiveStatus === "active") {
      expiringLicenses.push({
        id: lic.id,
        keyPrefix: lic.keyPrefix,
        companyName: lic.customer.companyName,
        customerId: lic.customerId,
        plan: lic.plan,
        expiresAt: lic.expiresAt,
        daysLeft: Math.ceil(msUntilExpiry / (24 * 3600 * 1000)),
      });
    }
  }

  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const silentDeployments = deployments
    .filter((d) => !d.lastSeenAt || d.lastSeenAt < threeDaysAgo)
    .map((d) => {
      const daysSilent = d.lastSeenAt
        ? Math.floor((now.getTime() - d.lastSeenAt.getTime()) / (24 * 3600 * 1000))
        : 999;
      return {
        id: d.id,
        domain: d.domain,
        companyName: d.customer.companyName,
        customerId: d.customerId,
        lastSeenAt: d.lastSeenAt,
        daysSilent,
      };
    });

  sendHtml(
    req,
    res,
    "Dashboard",
    renderDashboardPage({
      customerCount,
      licenseCounts: counts,
      expiringLicenses,
      silentDeployments,
    })
  );
});

// GET /admin/customers
adminRouter.get("/customers", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = 20;
  const search = String(req.query.search || "").trim();
  const planFilter = String(req.query.plan || "").trim();
  const statusFilter = String(req.query.status || "").trim();

  const whereClause: any = {};

  if (search) {
    whereClause.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { contactName: { contains: search, mode: "insensitive" } },
      { contactEmail: { contains: search, mode: "insensitive" } },
      { deployments: { some: { domain: { contains: search, mode: "insensitive" } } } },
    ];
  }

  if (planFilter) {
    whereClause.licenses = { some: { plan: planFilter } };
  }

  const [totalCount, customers] = await Promise.all([
    prisma.customer.count({ where: whereClause }),
    prisma.customer.findMany({
      where: whereClause,
      include: {
        licenses: { take: 1, orderBy: { createdAt: "desc" } },
        deployments: { take: 1, orderBy: { createdAt: "asc" } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { companyName: "asc" },
    }),
  ]);

  const now = new Date();
  const items = customers.map((c) => {
    const lic = c.licenses[0];
    const dep = c.deployments[0];
    const licStatus = lic
      ? computeLicenseStatus({
          customerStatus: c.status,
          licenseStatus: lic.status,
          expiresAt: lic.expiresAt,
          graceDays: lic.graceDays,
          now,
        })
      : "unknown";

    return {
      id: c.id,
      companyName: c.companyName,
      status: c.status,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      primaryDomain: dep?.domain || "-",
      plan: lic?.plan || "-",
      licenseStatus: licStatus,
      expiresAt: lic?.expiresAt || null,
    };
  });

  // Filter by computed status if requested
  const filteredItems = statusFilter
    ? items.filter((i) => i.licenseStatus === statusFilter)
    : items;

  sendHtml(
    req,
    res,
    "Customers",
    renderCustomerListPage({
      customers: filteredItems,
      page,
      totalPages: Math.ceil(totalCount / pageSize),
      totalCount,
      search,
      planFilter,
      statusFilter,
    })
  );
});

// GET /admin/customers/new
adminRouter.get("/customers/new", (req, res) => {
  sendHtml(
    req,
    res,
    "New Customer",
    renderCustomerNewPage({ csrfToken: req.adminAuth?.csrfToken || "" })
  );
});

// POST /admin/customers/new
adminRouter.post("/customers/new", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  try {
    const body = req.body;
    const expiresDate = new Date(`${body.expires}T23:59:59.999Z`);
    const graceDays = parseInt(body.graceDays || "14", 10);

    const result = await createCustomerWithLicense({
      companyName: body.companyName,
      domain: body.domain,
      plan: body.plan,
      expiresAt: expiresDate,
      graceDays,
      notes: body.notes,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      actor: `admin:${auth.admin.email}`,
    });

    // Render success directly from memory with Cache-Control: no-store
    sendHtml(
      req,
      res,
      "Customer Created",
      renderCustomerCreatedSuccessPage({
        customer: result.customer,
        deployment: result.deployment,
        license: result.license,
        plainLicenseKey: result.plainLicenseKey,
      })
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create customer.";
    sendHtml(
      req,
      res,
      "New Customer",
      renderCustomerNewPage({
        csrfToken: auth.csrfToken || "",
        error: errorMsg,
        formData: req.body,
      })
    );
  }
});

// GET /admin/customers/:id
adminRouter.get("/customers/:id", async (req, res) => {
  const customerId = req.params.id;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      licenses: {
        include: { modules: true },
        orderBy: { createdAt: "desc" },
      },
      deployments: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!customer || customer.licenses.length === 0) {
    res.redirect("/admin/customers");
    return;
  }

  const license = customer.licenses[0];
  const computedStatus = computeLicenseStatus({
    customerStatus: customer.status,
    licenseStatus: license.status,
    expiresAt: license.expiresAt,
    graceDays: license.graceDays,
  });

  const effectiveModules = computeEffectiveModules(license.plan, license.modules);
  const overrides: Record<string, boolean> = {};
  license.modules.forEach((m) => {
    overrides[m.module] = m.enabled;
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Customer", entityId: customer.id },
        { entityType: "License", entityId: license.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  sendHtml(
    req,
    res,
    customer.companyName,
    renderCustomerDetailPage({
      customer,
      license,
      computedStatus,
      effectiveModules,
      overrides,
      deployments: customer.deployments,
      auditLogs,
      csrfToken: req.adminAuth?.csrfToken || "",
      error: req.query.error as string,
      success: req.query.success as string,
    })
  );
});

// POST /admin/customers/:id/plan
adminRouter.post("/customers/:id/plan", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  const plan = req.body.plan as "basic" | "business" | "enterprise";

  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await changePlan({
      licenseId: license.id,
      plan,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=Plan%20updated%20successfully.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update plan.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/module
adminRouter.post("/customers/:id/module", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  const module = req.body.module;
  const enabled = req.body.state === "on";

  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await setModule({
      licenseId: license.id,
      module,
      enabled,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=Module%20override%20saved.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to toggle module.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/renew
adminRouter.post("/customers/:id/renew", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  const expiresAt = new Date(`${req.body.expires}T23:59:59.999Z`);

  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await renewLicense({
      licenseId: license.id,
      expiresAt,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=License%20renewed%20successfully.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to renew license.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/suspend
adminRouter.post("/customers/:id/suspend", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await suspendLicense({
      licenseId: license.id,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=License%20suspended.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to suspend license.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/reinstate
adminRouter.post("/customers/:id/reinstate", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    await reinstateLicense({
      licenseId: license.id,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=License%20reinstated%20to%20active.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reinstate license.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/reissue-key
adminRouter.post("/customers/:id/reissue-key", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  try {
    const license = await prisma.license.findFirstOrThrow({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });

    const result = await reissueLicenseKey({
      licenseId: license.id,
      actor: `admin:${auth.admin.email}`,
    });

    sendHtml(
      req,
      res,
      "New Key Reissued",
      renderReissuedKeySuccessPage({
        customer: result.license.customer,
        license: result.license,
        plainLicenseKey: result.newPlainLicenseKey,
      })
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reissue license key.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// POST /admin/customers/:id/contact
adminRouter.post("/customers/:id/contact", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const customerId = req.params.id;
  try {
    await updateCustomerContact({
      customerId,
      contactName: req.body.contactName,
      contactEmail: req.body.contactEmail,
      contactPhone: req.body.contactPhone,
      notes: req.body.notes,
      actor: `admin:${auth.admin.email}`,
    });

    res.redirect(`/admin/customers/${customerId}?success=Contact%20information%20updated.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update contact.";
    res.redirect(`/admin/customers/${customerId}?error=${encodeURIComponent(msg)}`);
  }
});

// ----------------------------------------------------------------------
// Audit, Notifications & Account
// ----------------------------------------------------------------------

// GET /admin/audit
adminRouter.get("/audit", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = 20;
  const entityFilter = String(req.query.entity || "").trim();

  const whereClause = entityFilter ? { entityType: entityFilter } : {};

  const [totalCount, logs] = await Promise.all([
    prisma.auditLog.count({ where: whereClause }),
    prisma.auditLog.findMany({
      where: whereClause,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  sendHtml(
    req,
    res,
    "Audit Logs",
    renderAuditLogsPage({
      logs,
      page,
      totalPages: Math.ceil(totalCount / pageSize),
      totalCount,
      entityFilter,
    })
  );
});

// GET /admin/notifications
adminRouter.get("/notifications", async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = 20;

  const [totalCount, notifications] = await Promise.all([
    prisma.notification.count(),
    prisma.notification.findMany({
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  sendHtml(
    req,
    res,
    "Notification Logs",
    renderNotificationsPage({
      notifications,
      page,
      totalPages: Math.ceil(totalCount / pageSize),
      totalCount,
    })
  );
});

// GET /admin/account
adminRouter.get("/account", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const sessions = await prisma.adminSession.findMany({
    where: { adminId: auth.admin.id },
    orderBy: { lastSeenAt: "desc" },
  });

  sendHtml(
    req,
    res,
    "Account Security",
    renderAccountPage({
      adminEmail: auth.admin.email,
      sessions,
      currentSessionId: auth.session.id,
      csrfToken: auth.csrfToken || "",
      error: req.query.error as string,
      success: req.query.success as string,
    })
  );
});

// POST /admin/account/password
adminRouter.post("/account/password", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmNewPassword = String(req.body.confirmNewPassword || "");

  const match = await comparePassword(currentPassword, auth.admin.passwordHash);
  if (!match) {
    res.redirect("/admin/account?error=Current%20password%20is%20incorrect.");
    return;
  }

  if (newPassword !== confirmNewPassword) {
    res.redirect("/admin/account?error=New%20passwords%20do%20not%20match.");
    return;
  }

  const policy = validatePasswordPolicy(newPassword, auth.admin.email);
  if (!policy.valid) {
    res.redirect(`/admin/account?error=${encodeURIComponent(policy.message || "Invalid password.")}`);
    return;
  }

  const newHash = await hashPassword(newPassword);

  // Update password and revoke all other sessions
  await prisma.$transaction([
    prisma.adminUser.update({
      where: { id: auth.admin.id },
      data: { passwordHash: newHash },
    }),
    prisma.adminSession.deleteMany({
      where: {
        adminId: auth.admin.id,
        id: { not: auth.session.id },
      },
    }),
  ]);

  const emailPayload = buildPasswordChangedEmail({
    ip: auth.clientIp,
    userAgent: req.headers["user-agent"],
  });
  await sendAdminEmail({
    event: "password_changed",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: auth.admin.id,
  });

  res.redirect("/admin/account?success=Password%20updated%20successfully.%20Other%20sessions%20have%20been%20revoked.");
});

// POST /admin/account/recovery-codes
adminRouter.post("/account/recovery-codes", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  const totpCode = String(req.body.totpCode || "").trim();

  if (!auth.admin.totpSecretEnc) {
    res.redirect("/admin/account?error=2FA%20is%20not%20configured.");
    return;
  }

  let secret = "";
  try {
    secret = decryptAesGcm(auth.admin.totpSecretEnc);
  } catch {
    res.redirect("/admin/account?error=Failed%20to%20decrypt%202FA%20secret.");
    return;
  }

  const isValid = verifyTotpCode(secret, totpCode);
  if (!isValid) {
    res.redirect("/admin/account?error=Invalid%20authenticator%20code.");
    return;
  }

  const { plainCodes, codeHashes } = generateRecoveryCodes();

  await prisma.adminUser.update({
    where: { id: auth.admin.id },
    data: { recoveryCodeHashes: codeHashes },
  });

  const emailPayload = buildRecoveryCodesRegeneratedEmail({ ip: auth.clientIp });
  await sendAdminEmail({
    event: "recovery_codes_regenerated",
    subject: emailPayload.subject,
    text: emailPayload.text,
    html: emailPayload.html,
    entityType: "AdminUser",
    entityId: auth.admin.id,
  });

  sendHtml(
    req,
    res,
    "New Recovery Codes",
    renderSetupRecoveryCodesPage({ recoveryCodes: plainCodes })
  );
});

// POST /admin/account/sessions/revoke-others
adminRouter.post("/account/sessions/revoke-others", async (req, res) => {
  const auth = req.adminAuth;
  if (!auth) return res.redirect("/admin/login");

  await revokeOtherAdminSessions(auth.admin.id, auth.session.id);
  res.redirect("/admin/account?success=All%20other%20sessions%20have%20been%20revoked.");
});
