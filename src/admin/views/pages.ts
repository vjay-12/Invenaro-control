import { html, raw, RawString } from "./template.js";
import { MODULE_NAMES } from "../../contract/license-token.js";

// ----------------------------------------------------------------------
// Auth & Setup Pages
// ----------------------------------------------------------------------

export function renderLoginPage(params: {
  csrfToken?: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Admin Sign In</h1>
      <p class="auth-subtitle">Sign in to manage Invenaro licenses and customers</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}

      <form method="POST" action="/admin/login">
        ${params.csrfToken ? raw(html`<input type="hidden" name="_csrf" value="${params.csrfToken}">`) : ""}
        <div class="form-group">
          <label for="email">Admin Email</label>
          <input type="email" id="email" name="email" required autofocus autocomplete="username" placeholder="admin@example.com">
        </div>
        <div class="form-group" style="margin-bottom: 6px;">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••••••">
        </div>
        <div class="form-actions-row">
          <a href="/admin/forgot" class="forgot-link">Forgot password?</a>
        </div>
        <button type="submit" class="btn btn-block auth-submit-btn">Sign In</button>
      </form>
    </div>
  `;
}

export function renderLogin2faPage(params: {
  csrfToken?: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Two-Factor Authentication</h1>
      <p class="auth-subtitle">Enter the 6-digit verification code from your authenticator app, or a one-time recovery code.</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}

      <form method="POST" action="/admin/login/2fa">
        ${params.csrfToken ? raw(html`<input type="hidden" name="_csrf" value="${params.csrfToken}">`) : ""}
        <div class="form-group">
          <label for="code">Authentication Code or Recovery Code</label>
          <input type="text" id="code" name="code" required autofocus placeholder="123456 or XXXX-XXXX-XXXX" autocomplete="one-time-code" class="mono">
        </div>
        <button type="submit" class="btn btn-block" style="padding: 11px 16px; font-size: 15px;">Verify</button>
      </form>
    </div>
  `;
}

export function renderForgotPasswordPage(params: {
  csrfToken?: string;
  message?: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Reset Password</h1>
      <p class="auth-subtitle">Enter your registered admin email to receive a 6-digit verification code.</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}
      ${params.message ? raw(html`<div class="alert alert-success">${params.message}</div>`) : ""}

      <form method="POST" action="/admin/forgot">
        ${params.csrfToken ? raw(html`<input type="hidden" name="_csrf" value="${params.csrfToken}">`) : ""}
        <div class="form-group">
          <label for="email">Admin Email</label>
          <input type="email" id="email" name="email" required autofocus autocomplete="email" placeholder="admin@example.com">
        </div>
        <div style="margin-top: 24px;">
          <button type="submit" class="btn btn-block auth-submit-btn">Send Verification Code</button>
        </div>
        <div style="margin-top: 20px; text-align: center;">
          <a href="/admin/login" style="font-size: 13px; color: #38bdf8;">Return to Sign In</a>
        </div>
      </form>
    </div>
  `;
}

export function renderForgotVerifyPage(params: {
  email: string;
  csrfToken?: string;
  error?: string;
  message?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Enter Verification Code</h1>
      <p class="auth-subtitle">Enter the 6-digit code sent to <strong>${params.email}</strong> and choose a new password.</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}
      ${params.message ? raw(html`<div class="alert alert-success">${params.message}</div>`) : ""}

      <form method="POST" action="/admin/forgot/verify">
        ${params.csrfToken ? raw(html`<input type="hidden" name="_csrf" value="${params.csrfToken}">`) : ""}
        <input type="hidden" name="email" value="${params.email}">
        <div class="form-group">
          <label for="code">6-Digit Verification Code</label>
          <input type="text" id="code" name="code" required autofocus maxlength="6" pattern="[0-9]{6}" placeholder="123456" autocomplete="one-time-code" class="mono" style="font-size: 20px; letter-spacing: 4px; text-align: center;">
        </div>
        <div class="form-group">
          <label for="password">New Password (min 12 characters)</label>
          <input type="password" id="password" name="password" required minlength="12" autocomplete="new-password" placeholder="••••••••••••">
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm New Password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" required minlength="12" autocomplete="new-password" placeholder="••••••••••••">
        </div>
        <div style="margin-top: 24px;">
          <button type="submit" class="btn btn-block auth-submit-btn">Reset Password</button>
        </div>
        <div style="margin-top: 20px; display: flex; justify-content: space-between; font-size: 13px;">
          <a href="/admin/forgot" style="color: #94a3b8;">Didn't receive code?</a>
          <a href="/admin/login" style="color: #38bdf8;">Return to Sign In</a>
        </div>
      </form>
    </div>
  `;
}

export function renderResetPasswordPage(params: {
  token: string;
  csrfToken?: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Choose New Password</h1>
      <p class="auth-subtitle">Choose a strong password with at least 12 characters.</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}

      <form method="POST" action="/admin/reset/${params.token}">
        ${params.csrfToken ? raw(html`<input type="hidden" name="_csrf" value="${params.csrfToken}">`) : ""}
        <div class="form-group">
          <label for="password">New Password</label>
          <input type="password" id="password" name="password" required minlength="12" autofocus autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm New Password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" required minlength="12" autocomplete="new-password">
        </div>
        <div style="margin-top: 24px;">
          <button type="submit" class="btn btn-block" style="padding: 11px 16px; font-size: 15px;">Set New Password</button>
        </div>
      </form>
    </div>
  `;
}

export function renderSetupPasswordPage(params: {
  csrfToken: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card">
      <h1 class="auth-title">Set Initial Password</h1>
      <p class="auth-subtitle">Your temporary credentials require setting a permanent password before continuing.</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}

      <form method="POST" action="/admin/setup/password">
        <input type="hidden" name="_csrf" value="${params.csrfToken}">
        <div class="form-group">
          <label for="password">New Password (min 12 characters)</label>
          <input type="password" id="password" name="password" required minlength="12" autofocus autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <input type="password" id="confirmPassword" name="confirmPassword" required minlength="12" autocomplete="new-password">
        </div>
        <div style="margin-top: 24px;">
          <button type="submit" class="btn btn-block" style="padding: 11px 16px; font-size: 15px;">Save and Continue</button>
        </div>
      </form>
    </div>
  `;
}

export function renderSetup2faPage(params: {
  csrfToken: string;
  qrDataUri: string;
  secretManual: string;
  error?: string;
}): RawString {
  return html`
    <div class="auth-card" style="max-width: 480px;">
      <h1 class="auth-title">Enroll in Two-Factor Authentication</h1>
      <p class="auth-subtitle">Scan the QR code with your authenticator app (e.g. Google Authenticator, Authy, 1Password).</p>

      ${params.error ? raw(html`<div class="alert alert-error">${params.error}</div>`) : ""}

      <div style="text-align: center; margin: 20px 0; background: #ffffff; padding: 16px; border-radius: 8px; display: inline-block; width: 100%;">
        <img src="${params.qrDataUri}" alt="2FA QR Code" style="width: 200px; height: 200px; display: block; margin: 0 auto;">
      </div>

      <div style="margin-bottom: 20px;">
        <label>Manual Entry Key</label>
        <div class="flex-row">
          <input type="text" id="manualSecret" value="${params.secretManual}" readonly class="mono" style="background: #1e293b;">
          <button type="button" class="btn btn-secondary" data-copy="manualSecret">Copy</button>
        </div>
      </div>

      <form method="POST" action="/admin/setup/2fa">
        <input type="hidden" name="_csrf" value="${params.csrfToken}">
        <div class="form-group">
          <label for="code">Enter 6-Digit Code from App</label>
          <input type="text" id="code" name="code" required autofocus placeholder="000000" class="mono" maxlength="6">
        </div>
        <button type="submit" class="btn btn-block">Enable 2FA & View Recovery Codes</button>
      </form>
    </div>
  `;
}

export function renderSetupRecoveryCodesPage(params: {
  recoveryCodes: string[];
}): RawString {
  const codesFormatted = params.recoveryCodes.join("\n");
  return html`
    <div class="auth-card" style="max-width: 540px;">
      <h1 class="auth-title">Your Recovery Codes</h1>
      <div class="alert alert-warning">
        <strong>IMPORTANT:</strong> Save these one-time recovery codes now in a safe place. They will NEVER be shown again. Each code can be used once if you lose your authenticator app.
      </div>

      <div class="key-box" id="codesBox" style="white-space: pre-wrap; line-height: 1.8;">${codesFormatted}</div>

      <div style="margin-bottom: 20px;">
        <button type="button" class="btn btn-secondary" data-copy="codesBox">Copy Recovery Codes</button>
      </div>

      <a href="/admin" class="btn btn-block">I Have Saved My Codes & Continue to Dashboard</a>
    </div>
  `;
}

// ----------------------------------------------------------------------
// Dashboard Page
// ----------------------------------------------------------------------

export interface DashboardData {
  customerCount: number;
  licenseCounts: {
    active: number;
    grace: number;
    expired: number;
    suspended: number;
  };
  expiringLicenses: Array<{
    id: string;
    keyPrefix: string;
    companyName: string;
    customerId: string;
    plan: string;
    expiresAt: Date;
    daysLeft: number;
  }>;
  silentDeployments: Array<{
    id: string;
    domain: string;
    companyName: string;
    customerId: string;
    lastSeenAt: Date | null;
    daysSilent: number;
  }>;
}

export function renderDashboardPage(data: DashboardData): RawString {
  return html`
    <div class="card-header" style="border: none; padding: 0; margin-bottom: 24px;">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Admin Dashboard</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">System overview, active licenses, and deployment telemetry</p>
      </div>
      <div>
        <a href="/admin/customers/new" class="btn">+ New Customer</a>
      </div>
    </div>

    <div class="grid-metrics">
      <div class="metric-card">
        <div class="metric-label">Total Customers</div>
        <div class="metric-val">${data.customerCount}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Licenses</div>
        <div class="metric-val" style="color: #4ade80;">${data.licenseCounts.active}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Licenses in Grace</div>
        <div class="metric-val" style="color: #facc15;">${data.licenseCounts.grace}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Expired / Suspended</div>
        <div class="metric-val" style="color: #f87171;">${data.licenseCounts.expired + data.licenseCounts.suspended}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Licenses Expiring Within 30 Days</h2>
        <span class="badge badge-warning">${data.expiringLicenses.length} Expiring</span>
      </div>
      ${data.expiringLicenses.length === 0 ? html`
        <p style="color: #94a3b8; margin: 0;">No licenses expiring in the next 30 days.</p>
      ` : html`
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Key Prefix</th>
              <th>Plan</th>
              <th>Expires</th>
              <th>Time Left</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.expiringLicenses.map((l) => html`
              <tr>
                <td><a href="/admin/customers/${l.customerId}">${l.companyName}</a></td>
                <td class="mono">${l.keyPrefix}...</td>
                <td><span class="badge badge-${l.plan}">${l.plan}</span></td>
                <td>${l.expiresAt.toISOString().slice(0, 10)}</td>
                <td style="color: #facc15; font-weight: 600;">${l.daysLeft} days</td>
                <td><a href="/admin/customers/${l.customerId}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;">Manage</a></td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Silent Deployments (> 3 Days Inactive)</h2>
        <span class="badge badge-danger">${data.silentDeployments.length} Silent</span>
      </div>
      ${data.silentDeployments.length === 0 ? html`
        <p style="color: #94a3b8; margin: 0;">All customer deployments have phoned home recently.</p>
      ` : html`
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Domain</th>
              <th>Last Seen</th>
              <th>Silent Duration</th>
            </tr>
          </thead>
          <tbody>
            ${data.silentDeployments.map((d) => html`
              <tr>
                <td><a href="/admin/customers/${d.customerId}">${d.companyName}</a></td>
                <td><span class="mono">${d.domain}</span></td>
                <td>${d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "Never"}</td>
                <td style="color: #f87171; font-weight: 600;">${d.daysSilent} days ago</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `;
}

// ----------------------------------------------------------------------
// Customer Pages
// ----------------------------------------------------------------------

export interface CustomerListItem {
  id: string;
  companyName: string;
  status: string;
  contactName: string | null;
  contactEmail: string | null;
  primaryDomain: string;
  plan: string;
  licenseStatus: string;
  expiresAt: Date | null;
}

export function renderCustomerListPage(data: {
  customers: CustomerListItem[];
  page: number;
  totalPages: number;
  totalCount: number;
  search?: string;
  planFilter?: string;
  statusFilter?: string;
}): RawString {
  return html`
    <div class="card-header" style="border: none; padding: 0; margin-bottom: 24px;">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Customers</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">${data.totalCount} registered customer accounts</p>
      </div>
      <div>
        <a href="/admin/customers/new" class="btn">+ Create Customer</a>
      </div>
    </div>

    <div class="card" style="padding: 16px;">
      <form method="GET" action="/admin/customers" class="flex-row" style="flex-wrap: wrap;">
        <input type="text" name="search" placeholder="Search company, domain, contact..." value="${data.search || ""}" style="width: 240px;">
        <select name="plan" style="width: 140px;">
          <option value="">All Plans</option>
          <option value="basic" ${data.planFilter === "basic" ? "selected" : ""}>Basic</option>
          <option value="business" ${data.planFilter === "business" ? "selected" : ""}>Business</option>
          <option value="enterprise" ${data.planFilter === "enterprise" ? "selected" : ""}>Enterprise</option>
        </select>
        <select name="status" style="width: 140px;">
          <option value="">All Statuses</option>
          <option value="active" ${data.statusFilter === "active" ? "selected" : ""}>Active</option>
          <option value="grace" ${data.statusFilter === "grace" ? "selected" : ""}>Grace</option>
          <option value="expired" ${data.statusFilter === "expired" ? "selected" : ""}>Expired</option>
          <option value="suspended" ${data.statusFilter === "suspended" ? "selected" : ""}>Suspended</option>
        </select>
        <button type="submit" class="btn btn-secondary">Filter</button>
        ${data.search || data.planFilter || data.statusFilter ? html`
          <a href="/admin/customers" class="btn btn-secondary" style="font-size: 12px;">Clear</a>
        ` : ""}
      </form>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Domain</th>
            <th>Contact</th>
            <th>Plan</th>
            <th>License Status</th>
            <th>Expires</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.customers.length === 0 ? html`
            <tr>
              <td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">No customers found matching criteria.</td>
            </tr>
          ` : data.customers.map((c) => html`
            <tr>
              <td><a href="/admin/customers/${c.id}" style="font-weight: 600;">${c.companyName}</a></td>
              <td class="mono">${c.primaryDomain}</td>
              <td style="font-size: 13px;">${c.contactName || c.contactEmail || "-"}</td>
              <td><span class="badge badge-${c.plan}">${c.plan}</span></td>
              <td><span class="badge badge-${c.licenseStatus}">${c.licenseStatus}</span></td>
              <td>${c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : "-"}</td>
              <td><a href="/admin/customers/${c.id}" class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;">View</a></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span style="color: #94a3b8;">Page ${data.page} of ${Math.max(1, data.totalPages)}</span>
      <div class="flex-row">
        ${data.page > 1 ? html`
          <a href="/admin/customers?page=${data.page - 1}&search=${encodeURIComponent(data.search || "")}&plan=${data.planFilter || ""}&status=${data.statusFilter || ""}" class="btn btn-secondary" style="padding: 4px 10px;">Previous</a>
        ` : ""}
        ${data.page < data.totalPages ? html`
          <a href="/admin/customers?page=${data.page + 1}&search=${encodeURIComponent(data.search || "")}&plan=${data.planFilter || ""}&status=${data.statusFilter || ""}" class="btn btn-secondary" style="padding: 4px 10px;">Next</a>
        ` : ""}
      </div>
    </div>
  `;
}

export function renderCustomerNewPage(params: {
  csrfToken: string;
  error?: string;
  formData?: Record<string, string>;
}): RawString {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  const defaultExpiry = d.toISOString().slice(0, 10);

  return html`
    <div style="max-width: 640px; margin: 0 auto;">
      <div style="margin-bottom: 20px;">
        <a href="/admin/customers">&larr; Back to Customers</a>
        <h1 style="margin: 8px 0 0 0; font-size: 24px; font-weight: 700; color: #ffffff;">Create New Customer</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Registers the customer, configures deployment, and generates a new license key.</p>
      </div>

      ${params.error ? html`<div class="alert alert-error">${params.error}</div>` : ""}

      <div class="card">
        <form method="POST" action="/admin/customers/new">
          <input type="hidden" name="_csrf" value="${params.csrfToken}">

          <div class="form-group">
            <label for="companyName">Company / Organization Name *</label>
            <input type="text" id="companyName" name="companyName" required value="${params.formData?.companyName || ""}" autofocus placeholder="Acme Logistics Pvt Ltd">
          </div>

          <div class="form-group">
            <label for="domain">Primary Deployment Domain *</label>
            <input type="text" id="domain" name="domain" required value="${params.formData?.domain || ""}" placeholder="acme.invenaro.app">
            <span style="font-size: 12px; color: #94a3b8;">This domain is authorized for license verification.</span>
          </div>

          <div class="flex-row" style="gap: 16px;">
            <div class="form-group" style="flex: 1;">
              <label for="plan">License Plan *</label>
              <select id="plan" name="plan" required>
                <option value="basic" ${params.formData?.plan === "basic" ? "selected" : ""}>Basic</option>
                <option value="business" ${params.formData?.plan === "business" || !params.formData?.plan ? "selected" : ""}>Business</option>
                <option value="enterprise" ${params.formData?.plan === "enterprise" ? "selected" : ""}>Enterprise</option>
              </select>
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="expires">Initial Expiration Date *</label>
              <input type="date" id="expires" name="expires" required value="${params.formData?.expires || defaultExpiry}">
            </div>
            <div class="form-group" style="flex: 0.7;">
              <label for="graceDays">Grace Days</label>
              <input type="number" id="graceDays" name="graceDays" min="0" value="${params.formData?.graceDays || "14"}">
            </div>
          </div>

          <div class="card-header" style="padding-top: 12px; margin-top: 12px;">
            <h3 style="margin: 0; font-size: 14px; font-weight: 600; color: #cbd5e1;">Contact Information (Optional)</h3>
          </div>

          <div class="flex-row" style="gap: 16px;">
            <div class="form-group" style="flex: 1;">
              <label for="contactName">Contact Name</label>
              <input type="text" id="contactName" name="contactName" value="${params.formData?.contactName || ""}">
            </div>
            <div class="form-group" style="flex: 1;">
              <label for="contactEmail">Contact Email</label>
              <input type="email" id="contactEmail" name="contactEmail" value="${params.formData?.contactEmail || ""}">
            </div>
          </div>

          <div class="form-group">
            <label for="contactPhone">Contact Phone</label>
            <input type="text" id="contactPhone" name="contactPhone" value="${params.formData?.contactPhone || ""}">
          </div>

          <div class="form-group">
            <label for="notes">Internal Notes</label>
            <textarea id="notes" name="notes" rows="2">${params.formData?.notes || ""}</textarea>
          </div>

          <button type="submit" class="btn btn-block" style="margin-top: 12px;">Create Customer & Generate License</button>
        </form>
      </div>
    </div>
  `;
}

export function renderCustomerCreatedSuccessPage(params: {
  customer: { id: string; companyName: string };
  deployment: { domain: string };
  license: { id: string; plan: string; expiresAt: Date; keyPrefix: string };
  plainLicenseKey: string;
}): RawString {
  return html`
    <div style="max-width: 680px; margin: 40px auto;">
      <div class="alert alert-warning" style="font-size: 15px;">
        <strong style="font-size: 16px; display: block; margin-bottom: 6px;">⚠️ COPY THIS LICENSE KEY NOW:</strong>
        This plaintext license key is shown <strong>exactly once</strong> directly from memory. It is stored only as a cryptographic hash in the database and <strong>cannot be viewed or recovered again</strong>.
      </div>

      <div class="card">
        <h2 class="card-title" style="font-size: 18px; margin-bottom: 12px;">🔑 Generated License Key</h2>
        <div class="key-box" id="licenseKeyBox">${params.plainLicenseKey}</div>

        <button type="button" class="btn" data-copy="licenseKeyBox" style="margin-bottom: 24px;">Copy License Key</button>

        <div class="card-header">
          <h3 class="card-title">Customer & License Summary</h3>
        </div>

        <table style="margin-bottom: 24px;">
          <tr>
            <td style="width: 140px; color: #94a3b8;">Customer</td>
            <td><strong>${params.customer.companyName}</strong> (${params.customer.id})</td>
          </tr>
          <tr>
            <td style="color: #94a3b8;">Primary Domain</td>
            <td class="mono">${params.deployment.domain}</td>
          </tr>
          <tr>
            <td style="color: #94a3b8;">Plan</td>
            <td><span class="badge badge-${params.license.plan}">${params.license.plan}</span></td>
          </tr>
          <tr>
            <td style="color: #94a3b8;">Key Prefix</td>
            <td class="mono">${params.license.keyPrefix}...</td>
          </tr>
          <tr>
            <td style="color: #94a3b8;">Expires At</td>
            <td>${params.license.expiresAt.toISOString().slice(0, 10)}</td>
          </tr>
        </table>

        <div class="flex-row">
          <a href="/admin/customers/${params.customer.id}" class="btn btn-secondary">View Customer Profile</a>
          <a href="/admin/customers" class="btn btn-secondary">Customer List</a>
        </div>
      </div>
    </div>
  `;
}

export function renderReissuedKeySuccessPage(params: {
  customer: { id: string; companyName: string };
  license: { id: string; keyPrefix: string };
  plainLicenseKey: string;
}): RawString {
  return html`
    <div style="max-width: 680px; margin: 40px auto;">
      <div class="alert alert-warning">
        <strong style="font-size: 16px; display: block; margin-bottom: 6px;">⚠️ NEW LICENSE KEY REISSUED:</strong>
        The previous license key was immediately revoked. Copy this new key now; it cannot be viewed again.
      </div>

      <div class="card">
        <h2 class="card-title" style="font-size: 18px; margin-bottom: 12px;">🔑 New License Key</h2>
        <div class="key-box" id="newKeyBox">${params.plainLicenseKey}</div>

        <button type="button" class="btn" data-copy="newKeyBox" style="margin-bottom: 24px;">Copy New Key</button>

        <a href="/admin/customers/${params.customer.id}" class="btn btn-secondary">Return to Customer</a>
      </div>
    </div>
  `;
}

export function renderCustomerDetailPage(data: {
  customer: any;
  license: any;
  computedStatus: string;
  effectiveModules: Record<string, boolean>;
  overrides: Record<string, boolean>;
  deployments: any[];
  auditLogs: any[];
  csrfToken: string;
  error?: string;
  success?: string;
}): RawString {
  const c = data.customer;
  const l = data.license;

  return html`
    <div style="margin-bottom: 20px;">
      <a href="/admin/customers">&larr; Back to Customers</a>
      <div class="card-header" style="border: none; padding: 0; margin-top: 8px;">
        <div>
          <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">${c.companyName}</h1>
          <span style="color: #94a3b8; font-size: 13px;" class="mono">ID: ${c.id}</span>
        </div>
        <div>
          <span class="badge badge-${data.computedStatus}" style="font-size: 14px; padding: 4px 12px;">Status: ${data.computedStatus}</span>
        </div>
      </div>
    </div>

    ${data.error ? html`<div class="alert alert-error">${data.error}</div>` : ""}
    ${data.success ? html`<div class="alert alert-success">${data.success}</div>` : ""}

    <!-- License & Lifecycle Actions -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">License Details & Operations</h2>
        <span class="badge badge-${l.plan}">${l.plan}</span>
      </div>

      <div class="grid-metrics" style="margin-bottom: 16px;">
        <div class="metric-card">
          <div class="metric-label">Key Prefix</div>
          <div class="mono" style="font-size: 18px; color: #38bdf8; margin-top: 4px;">${l.keyPrefix}...</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Expiration Date</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${l.expiresAt.toISOString().slice(0, 10)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Grace Period</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${l.graceDays} Days</div>
        </div>
      </div>

      <div class="card-header" style="padding-top: 8px;">
        <h3 style="margin: 0; font-size: 14px; color: #cbd5e1;">Administrative Actions</h3>
      </div>

      <div class="flex-row" style="flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">
        <!-- Change Plan Form -->
        <form method="POST" action="/admin/customers/${c.id}/plan" class="flex-row" style="background: #0f172a; padding: 8px 12px; border-radius: 6px; border: 1px solid #334155;">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <label style="margin: 0; font-size: 13px;">Plan:</label>
          <select name="plan" style="padding: 4px 8px; width: 120px; font-size: 13px;">
            <option value="basic" ${l.plan === "basic" ? "selected" : ""}>Basic</option>
            <option value="business" ${l.plan === "business" ? "selected" : ""}>Business</option>
            <option value="enterprise" ${l.plan === "enterprise" ? "selected" : ""}>Enterprise</option>
          </select>
          <button type="submit" class="btn btn-secondary" style="padding: 4px 10px; font-size: 13px;">Update Plan</button>
        </form>

        <!-- Renew Form -->
        <form method="POST" action="/admin/customers/${c.id}/renew" class="flex-row" style="background: #0f172a; padding: 8px 12px; border-radius: 6px; border: 1px solid #334155;">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <label style="margin: 0; font-size: 13px;">Renew to:</label>
          <input type="date" name="expires" required style="padding: 4px 8px; font-size: 13px; width: 140px;" value="${l.expiresAt.toISOString().slice(0, 10)}">
          <button type="submit" class="btn btn-secondary" style="padding: 4px 10px; font-size: 13px;">Renew</button>
        </form>

        <!-- Suspend / Reinstate -->
        ${l.status === "suspended" ? html`
          <form method="POST" action="/admin/customers/${c.id}/reinstate" style="margin: 0;">
            <input type="hidden" name="_csrf" value="${data.csrfToken}">
            <button type="submit" class="btn" style="background: #16a34a;">Reinstate License</button>
          </form>
        ` : html`
          <form method="POST" action="/admin/customers/${c.id}/suspend" style="margin: 0;" data-confirm="Are you sure you want to suspend this license? Client verifications will return suspended status.">
            <input type="hidden" name="_csrf" value="${data.csrfToken}">
            <button type="submit" class="btn btn-danger">Suspend License</button>
          </form>
        `}

        <!-- Reissue Key -->
        <form method="POST" action="/admin/customers/${c.id}/reissue-key" style="margin: 0;" data-confirm="WARNING: Reissuing the license key will permanently and immediately invalidate the current active key! Continue?">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <button type="submit" class="btn btn-danger" style="background: #b91c1c;">Reissue Lost Key</button>
        </form>
      </div>

      <!-- Module Toggles -->
      <div class="card-header" style="padding-top: 8px;">
        <h3 style="margin: 0; font-size: 14px; color: #cbd5e1;">Effective Add-On Modules</h3>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 12px;">
        ${MODULE_NAMES.map((mod) => {
          const isEnabled = data.effectiveModules[mod];
          const hasOverride = mod in data.overrides;
          return html`
            <div style="background: #0f172a; padding: 10px 12px; border-radius: 6px; border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 13px; font-weight: 600; color: #f1f5f9;">${mod}</div>
                <div style="font-size: 11px; color: #94a3b8;">${hasOverride ? "Override" : "Plan Default"}</div>
              </div>
              <form method="POST" action="/admin/customers/${c.id}/module" style="margin: 0;">
                <input type="hidden" name="_csrf" value="${data.csrfToken}">
                <input type="hidden" name="module" value="${mod}">
                <input type="hidden" name="state" value="${isEnabled ? "off" : "on"}">
                <button type="submit" class="btn ${isEnabled ? "btn-secondary" : ""}" style="padding: 3px 8px; font-size: 12px; ${isEnabled ? "background: #166534; color: #ffffff;" : "background: #334155;"}">
                  ${isEnabled ? "ON" : "OFF"}
                </button>
              </form>
            </div>
          `;
        })}
      </div>
    </div>

    <!-- Contact & Deployments Grid -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
      <!-- Contact Info Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Customer Contact Details</h2>
        </div>
        <form method="POST" action="/admin/customers/${c.id}/contact">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <div class="form-group">
            <label for="contactName">Contact Name</label>
            <input type="text" id="contactName" name="contactName" value="${c.contactName || ""}">
          </div>
          <div class="form-group">
            <label for="contactEmail">Contact Email</label>
            <input type="email" id="contactEmail" name="contactEmail" value="${c.contactEmail || ""}">
          </div>
          <div class="form-group">
            <label for="contactPhone">Contact Phone</label>
            <input type="text" id="contactPhone" name="contactPhone" value="${c.contactPhone || ""}">
          </div>
          <div class="form-group">
            <label for="notes">Notes</label>
            <textarea id="notes" name="notes" rows="3">${c.notes || ""}</textarea>
          </div>
          <button type="submit" class="btn btn-secondary">Save Contact Info</button>
        </form>
      </div>

      <!-- Deployments Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Authorized Deployments</h2>
        </div>
        ${data.deployments.length === 0 ? html`
          <p style="color: #94a3b8;">No deployment records found.</p>
        ` : html`
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Version</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              ${data.deployments.map((d: any) => html`
                <tr>
                  <td class="mono">${d.domain}</td>
                  <td>${d.appVersion || "-"}</td>
                  <td>${d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "Never"}</td>
                </tr>
              `)}
            </tbody>
          </table>
        `}
      </div>
    </div>

    <!-- Recent Audit Logs for Customer -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Customer Audit History</h2>
      </div>
      ${data.auditLogs.length === 0 ? html`
        <p style="color: #94a3b8; margin: 0;">No audit events found.</p>
      ` : html`
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${data.auditLogs.map((log: any) => html`
              <tr>
                <td>${log.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td><span class="mono">${log.action}</span></td>
                <td>${log.actor}</td>
                <td class="mono" style="font-size: 12px; color: #94a3b8;">${JSON.stringify(log.after || log.before || {})}</td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    </div>
  `;
}

// ----------------------------------------------------------------------
// Audit & Notification Logs Pages
// ----------------------------------------------------------------------

export function renderAuditLogsPage(data: {
  logs: any[];
  page: number;
  totalPages: number;
  totalCount: number;
  entityFilter?: string;
}): RawString {
  return html`
    <div class="card-header" style="border: none; padding: 0; margin-bottom: 24px;">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Audit Logs</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Immutable system audit trail of all administration and license modifications</p>
      </div>
    </div>

    <div class="card" style="padding: 16px;">
      <form method="GET" action="/admin/audit" class="flex-row">
        <label style="margin: 0; font-size: 13px;">Filter Entity:</label>
        <select name="entity" style="width: 180px;">
          <option value="">All Entities</option>
          <option value="Customer" ${data.entityFilter === "Customer" ? "selected" : ""}>Customer</option>
          <option value="License" ${data.entityFilter === "License" ? "selected" : ""}>License</option>
          <option value="LicenseModule" ${data.entityFilter === "LicenseModule" ? "selected" : ""}>LicenseModule</option>
          <option value="Deployment" ${data.entityFilter === "Deployment" ? "selected" : ""}>Deployment</option>
        </select>
        <button type="submit" class="btn btn-secondary">Filter</button>
        ${data.entityFilter ? html`<a href="/admin/audit" class="btn btn-secondary" style="font-size: 12px;">Clear</a>` : ""}
      </form>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Actor</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          ${data.logs.length === 0 ? html`
            <tr><td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">No audit records found.</td></tr>
          ` : data.logs.map((log) => html`
            <tr>
              <td>${log.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
              <td><span class="mono" style="color: #38bdf8;">${log.action}</span></td>
              <td>${log.entityType}</td>
              <td class="mono" style="font-size: 12px;">${log.entityId}</td>
              <td>${log.actor}</td>
              <td class="mono" style="font-size: 12px; color: #94a3b8; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${JSON.stringify(log.after || log.before || {})}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span style="color: #94a3b8;">Page ${data.page} of ${Math.max(1, data.totalPages)}</span>
      <div class="flex-row">
        ${data.page > 1 ? html`<a href="/admin/audit?page=${data.page - 1}&entity=${data.entityFilter || ""}" class="btn btn-secondary">Previous</a>` : ""}
        ${data.page < data.totalPages ? html`<a href="/admin/audit?page=${data.page + 1}&entity=${data.entityFilter || ""}" class="btn btn-secondary">Next</a>` : ""}
      </div>
    </div>
  `;
}

export function renderNotificationsPage(data: {
  notifications: any[];
  page: number;
  totalPages: number;
  totalCount: number;
}): RawString {
  return html`
    <div class="card-header" style="border: none; padding: 0; margin-bottom: 24px;">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Notification Logs</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Historical record of administrative emails dispatched</p>
      </div>
    </div>

    <div class="card" style="padding: 0; overflow: hidden;">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event</th>
            <th>Subject</th>
            <th>Recipient</th>
            <th>Status</th>
            <th>Error Info</th>
          </tr>
        </thead>
        <tbody>
          ${data.notifications.length === 0 ? html`
            <tr><td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">No notifications logged yet.</td></tr>
          ` : data.notifications.map((n) => html`
            <tr>
              <td>${n.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
              <td><span class="mono">${n.event}</span></td>
              <td>${n.subject}</td>
              <td class="mono" style="font-size: 12px;">${n.toEmail}</td>
              <td>
                <span class="badge ${n.status === "sent" ? "badge-active" : n.status === "failed" ? "badge-expired" : "badge-suspended"}">
                  ${n.status}
                </span>
              </td>
              <td style="font-size: 12px; color: #f87171; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${n.error || "-"}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <span style="color: #94a3b8;">Page ${data.page} of ${Math.max(1, data.totalPages)}</span>
      <div class="flex-row">
        ${data.page > 1 ? html`<a href="/admin/notifications?page=${data.page - 1}" class="btn btn-secondary">Previous</a>` : ""}
        ${data.page < data.totalPages ? html`<a href="/admin/notifications?page=${data.page + 1}" class="btn btn-secondary">Next</a>` : ""}
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------
// Account Management Page
// ----------------------------------------------------------------------

export function renderAccountPage(data: {
  adminEmail: string;
  sessions: any[];
  currentSessionId: string;
  csrfToken: string;
  error?: string;
  success?: string;
}): RawString {
  return html`
    <div class="card-header" style="border: none; padding: 0; margin-bottom: 24px;">
      <div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff;">Admin Account & Security</h1>
        <p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 14px;">Logged in as <strong>${data.adminEmail}</strong></p>
      </div>
    </div>

    ${data.error ? html`<div class="alert alert-error">${data.error}</div>` : ""}
    ${data.success ? html`<div class="alert alert-success">${data.success}</div>` : ""}

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
      <!-- Change Password Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Change Password</h2>
        </div>
        <form method="POST" action="/admin/account/password">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <div class="form-group">
            <label for="currentPassword">Current Password</label>
            <input type="password" id="currentPassword" name="currentPassword" required autocomplete="current-password">
          </div>
          <div class="form-group">
            <label for="newPassword">New Password (min 12 characters)</label>
            <input type="password" id="newPassword" name="newPassword" required minlength="12" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label for="confirmNewPassword">Confirm New Password</label>
            <input type="password" id="confirmNewPassword" name="confirmNewPassword" required minlength="12" autocomplete="new-password">
          </div>
          <button type="submit" class="btn btn-secondary">Update Password</button>
        </form>
      </div>

      <!-- Regenerate Recovery Codes Card -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Two-Factor Recovery Codes</h2>
        </div>
        <p style="color: #94a3b8; font-size: 14px; margin-bottom: 16px;">
          Regenerating recovery codes will invalidate all prior recovery codes. You must confirm with your current 6-digit authenticator code.
        </p>
        <form method="POST" action="/admin/account/recovery-codes">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <div class="form-group">
            <label for="totpCode">Current 6-Digit Authenticator Code</label>
            <input type="text" id="totpCode" name="totpCode" required maxlength="6" class="mono" placeholder="000000">
          </div>
          <button type="submit" class="btn btn-secondary">Regenerate Recovery Codes</button>
        </form>
      </div>
    </div>

    <!-- Active Sessions Card -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Active Administrative Sessions</h2>
        <form method="POST" action="/admin/account/sessions/revoke-others" style="margin: 0;">
          <input type="hidden" name="_csrf" value="${data.csrfToken}">
          <button type="submit" class="btn btn-secondary" style="font-size: 13px;">Sign Out Other Sessions</button>
        </form>
      </div>

      <table>
        <thead>
          <tr>
            <th>IP Address</th>
            <th>User Agent</th>
            <th>Created</th>
            <th>Last Active</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.sessions.map((s) => {
            const isCurrent = s.id === data.currentSessionId;
            return html`
              <tr>
                <td class="mono">${s.ip}</td>
                <td style="font-size: 12px; color: #94a3b8; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${s.userAgent || "Unknown"}
                </td>
                <td>${s.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>${s.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                <td>
                  ${isCurrent ? html`
                    <span class="badge badge-active">Current Session</span>
                  ` : html`
                    <span class="badge badge-secondary">Active</span>
                  `}
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}
