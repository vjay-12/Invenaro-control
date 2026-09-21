import nodemailer from "nodemailer";
import { getConfig } from "../config.js";
import { prisma } from "../db.js";

export function escapeHtml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim();
}

export interface SendAdminEmailParams {
  event: string;
  subject: string;
  text: string;
  html: string;
  entityType?: string;
  entityId?: string;
}

export interface SendEmailResult {
  status: "sent" | "failed" | "skipped";
  error?: string;
}

/**
 * Creates a fresh Nodemailer transport per call (no connection pooling for serverless execution).
 */
export function createTransporter() {
  const config = getConfig();
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

/**
 * Sends an email to the admin and writes a record in the notifications table.
 * Never throws an exception to ensure business transactions are never rolled back.
 */
export async function sendAdminEmail(
  params: SendAdminEmailParams
): Promise<SendEmailResult> {
  const config = getConfig();
  const toEmail = config.ADMIN_EMAIL || "unconfigured@example.com";
  const fullSubject = `[Invenaro Control] ${sanitizeSubject(params.subject)}`;

  // Skip if emails are disabled or unconfigured
  if (
    !config.EMAIL_ENABLED ||
    !config.SMTP_USER ||
    !config.SMTP_PASS ||
    !config.ADMIN_EMAIL
  ) {
    try {
      await prisma.notification.create({
        data: {
          event: params.event,
          toEmail,
          subject: fullSubject,
          status: "skipped",
          error: !config.EMAIL_ENABLED
            ? "EMAIL_ENABLED is false"
            : "SMTP credentials or ADMIN_EMAIL missing",
          entityType: params.entityType,
          entityId: params.entityId,
        },
      });
    } catch (e) {
      console.error("[Email] Failed to log skipped notification to DB:", e);
    }
    console.log(`[Email] email skipped for event: ${params.event}`);
    return { status: "skipped" };
  }

  try {
    const transporter = createTransporter();
    const from = `"${config.EMAIL_FROM_NAME}" <${config.SMTP_USER}>`;

    await transporter.sendMail({
      from,
      to: toEmail,
      subject: fullSubject,
      text: params.text,
      html: params.html,
    });

    await prisma.notification.create({
      data: {
        event: params.event,
        toEmail,
        subject: fullSubject,
        status: "sent",
        entityType: params.entityType,
        entityId: params.entityId,
      },
    });

    return { status: "sent" };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    // Sanitize any password or secret strings if present in error
    const redactedError = rawMsg
      .replace(new RegExp(config.SMTP_PASS || "____never____", "gi"), "[REDACTED]")
      .replace(/INV-[A-Z0-9-]{24}/gi, "[REDACTED_KEY]")
      .slice(0, 500);

    try {
      await prisma.notification.create({
        data: {
          event: params.event,
          toEmail,
          subject: fullSubject,
          status: "failed",
          error: redactedError,
          entityType: params.entityType,
          entityId: params.entityId,
        },
      });
    } catch (e) {
      console.error("[Email] Failed to log failed notification to DB:", e);
    }

    console.error(`[Email] email failed for event ${params.event}:`, redactedError);
    return { status: "failed", error: redactedError };
  }
}

const PLAN_RANK: Record<string, number> = {
  basic: 1,
  business: 2,
  enterprise: 3,
};

export function getPlanChangeDirection(
  fromPlan: string,
  toPlan: string
): "UPGRADED" | "DOWNGRADED" | "UNCHANGED" {
  const fromRank = PLAN_RANK[fromPlan] ?? 0;
  const toRank = PLAN_RANK[toPlan] ?? 0;
  if (toRank > fromRank) return "UPGRADED";
  if (toRank < fromRank) return "DOWNGRADED";
  return "UNCHANGED";
}

function baseTemplate(title: string, bodyContent: string): { text: string; html: string } {
  const config = getConfig();
  const envName = config.NODE_ENV;
  const timestamp = new Date().toISOString();

  const text = `${title}
${"=".repeat(title.length)}

${bodyContent.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n")}

--------------------------------------------------
Environment: ${envName}
Timestamp:   ${timestamp}
Invenaro Control - License & Customer Service
`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f2937; margin: 0; padding: 24px; background-color: #f9fafb; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; }
    .header { border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
    .header h2 { margin: 0; color: #111827; font-size: 18px; }
    .content { font-size: 14px; color: #374151; }
    .content p { margin: 8px 0; }
    .meta { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
    .btn { display: inline-block; padding: 8px 16px; background-color: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px; margin-top: 12px; }
    .alert { padding: 12px; border-radius: 6px; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; margin: 12px 0; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-upgrade { background: #dcfce7; color: #166534; }
    .badge-downgrade { background: #fef9c3; color: #854d0e; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>${escapeHtml(title)}</h2>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="meta">
      <div>Environment: <strong>${escapeHtml(envName)}</strong></div>
      <div>Timestamp: ${escapeHtml(timestamp)}</div>
    </div>
  </div>
</body>
</html>`;

  return { text, html };
}

// ----------------------------------------------------------------------
// Business Event Builders
// ----------------------------------------------------------------------

export function buildCustomerCreatedEmail(params: {
  customerId: string;
  companyName: string;
  domain: string;
  plan: string;
  actor: string;
}) {
  const title = `Customer Created: ${params.companyName}`;
  const body = `
    <p>A new customer account has been registered.</p>
    <p><strong>Company:</strong> ${escapeHtml(params.companyName)}</p>
    <p><strong>Customer ID:</strong> ${escapeHtml(params.customerId)}</p>
    <p><strong>Primary Domain:</strong> ${escapeHtml(params.domain)}</p>
    <p><strong>Initial Plan:</strong> ${escapeHtml(params.plan)}</p>
    <p><strong>Created By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildPlanChangedEmail(params: {
  customerId: string;
  companyName: string;
  licenseId: string;
  oldPlan: string;
  newPlan: string;
  actor: string;
}) {
  const direction = getPlanChangeDirection(params.oldPlan, params.newPlan);
  const title = `License Plan ${direction}: ${params.companyName} (${params.oldPlan} -> ${params.newPlan})`;
  const badgeClass = direction === "UPGRADED" ? "badge-upgrade" : "badge-downgrade";
  const body = `
    <p>The license plan for <strong>${escapeHtml(params.companyName)}</strong> was changed.</p>
    <p><span class="badge ${badgeClass}">${direction}</span></p>
    <p><strong>From:</strong> ${escapeHtml(params.oldPlan)}</p>
    <p><strong>To:</strong> ${escapeHtml(params.newPlan)}</p>
    <p><strong>Customer ID:</strong> ${escapeHtml(params.customerId)}</p>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Updated By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildModulesChangedEmail(params: {
  companyName: string;
  licenseId: string;
  module: string;
  enabled: boolean;
  actor: string;
}) {
  const state = params.enabled ? "ENABLED" : "DISABLED";
  const title = `Module ${state}: ${params.module} (${params.companyName})`;
  const body = `
    <p>An add-on module override was changed for <strong>${escapeHtml(params.companyName)}</strong>.</p>
    <p><strong>Module:</strong> ${escapeHtml(params.module)}</p>
    <p><strong>State:</strong> ${state}</p>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Updated By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildLicenseRenewedEmail(params: {
  companyName: string;
  licenseId: string;
  newExpiry: string;
  actor: string;
}) {
  const title = `License Renewed: ${params.companyName}`;
  const body = `
    <p>The license for <strong>${escapeHtml(params.companyName)}</strong> has been renewed.</p>
    <p><strong>New Expiration Date:</strong> ${escapeHtml(params.newExpiry)}</p>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Renewed By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildLicenseSuspendedEmail(params: {
  companyName: string;
  licenseId: string;
  actor: string;
}) {
  const title = `License Suspended: ${params.companyName}`;
  const body = `
    <div class="alert">
      <strong>Attention:</strong> The license for ${escapeHtml(params.companyName)} has been administrative suspended.
    </div>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Suspended By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildLicenseReinstatedEmail(params: {
  companyName: string;
  licenseId: string;
  actor: string;
}) {
  const title = `License Reinstated: ${params.companyName}`;
  const body = `
    <p>The suspended license for <strong>${escapeHtml(params.companyName)}</strong> has been reinstated to ACTIVE.</p>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Reinstated By:</strong> ${escapeHtml(params.actor)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildLicenseKeyReissuedEmail(params: {
  companyName: string;
  licenseId: string;
  newKeyPrefix: string;
  actor: string;
}) {
  const title = `License Key Reissued: ${params.companyName}`;
  const body = `
    <p>A new license key was generated and issued for <strong>${escapeHtml(params.companyName)}</strong>.</p>
    <p><strong>Previous Key:</strong> Revoked and invalidated immediately.</p>
    <p><strong>New Key Prefix:</strong> ${escapeHtml(params.newKeyPrefix)}...</p>
    <p><strong>License ID:</strong> ${escapeHtml(params.licenseId)}</p>
    <p><strong>Issued By:</strong> ${escapeHtml(params.actor)}</p>
    <p><em>Note: Plaintext license keys are never sent via email for security.</em></p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

// ----------------------------------------------------------------------
// Security Event Builders
// ----------------------------------------------------------------------

export function buildPasswordResetRequestedEmail(params: {
  resetUrl: string;
  ip: string;
}) {
  const title = "Password Reset Requested";
  const body = `
    <p>A password reset was requested for your Invenaro Control admin account.</p>
    <p><a class="btn" href="${escapeHtml(params.resetUrl)}">Reset Password</a></p>
    <p>This link is single-use and will expire in 30 minutes.</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
    <p><em>Security note: Two-factor authentication (2FA) will still be required on your next login even after resetting your password.</em></p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildPasswordChangedEmail(params: {
  ip: string;
  userAgent?: string;
}) {
  const title = "Password Changed Successfully";
  const body = `
    <p>The password for your Invenaro Control admin account was changed.</p>
    <p>All other active administrative sessions have been terminated immediately.</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
    <p><strong>User Agent:</strong> ${escapeHtml(params.userAgent || "Unknown")}</p>
    <p>If you did not make this change, please contact security immediately.</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildTwoFactorEnabledEmail(params: { ip: string }) {
  const title = "Two-Factor Authentication Enabled";
  const body = `
    <p>Authenticator app two-factor authentication (2FA) has been successfully activated on your admin account.</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildTwoFactorDisabledEmail(params: { ip: string; actor: string }) {
  const title = "Two-Factor Authentication Disabled";
  const body = `
    <div class="alert">
      <strong>Warning:</strong> Two-factor authentication was disabled for your admin account.
    </div>
    <p>All active sessions have been revoked. You will be required to re-enroll in 2FA upon your next login.</p>
    <p><strong>Action Taken By:</strong> ${escapeHtml(params.actor)}</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildRecoveryCodesRegeneratedEmail(params: { ip: string }) {
  const title = "Recovery Codes Regenerated";
  const body = `
    <p>A new set of one-time recovery codes was generated for your admin account. Any prior unused recovery codes have been invalidated.</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildLoginSuccessEmail(params: {
  ip: string;
  userAgent?: string;
  resetUrl: string;
}) {
  const title = "New Admin Login Detected";
  const body = `
    <p>A successful login to Invenaro Control occurred.</p>
    <p><strong>IP Address:</strong> ${escapeHtml(params.ip)}</p>
    <p><strong>User Agent:</strong> ${escapeHtml(params.userAgent || "Unknown")}</p>
    <p>If this was not you, please <a href="${escapeHtml(params.resetUrl)}">reset your password immediately</a>.</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}

export function buildAccountLockedEmail(params: {
  ip: string;
  email: string;
}) {
  const title = "Admin Account Locked: Too Many Failed Attempts";
  const body = `
    <div class="alert">
      <strong>Security Alert:</strong> The admin account has been temporarily locked due to 5 consecutive failed login attempts.
    </div>
    <p><strong>Attempted Email:</strong> ${escapeHtml(params.email)}</p>
    <p><strong>Origin IP:</strong> ${escapeHtml(params.ip)}</p>
    <p>The lock will expire automatically in 15 minutes.</p>
  `;
  const { text, html } = baseTemplate(title, body);
  return { subject: title, text, html };
}
