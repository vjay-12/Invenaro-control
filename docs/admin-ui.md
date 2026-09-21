# Invenaro Control Admin Web UI & Management

## Overview
The Invenaro Control Admin Web UI provides a secure, server-rendered administration dashboard mounted under `/admin`. It enables administrators to manage customers, monitor license lifecycles, configure add-on modules, inspect audit and notification trails, and manage account security—all backed by a unified service layer (`src/services/adminActions.ts`) that guarantees transactional integrity and dispatches email notifications for every important event.

---

## Environment Variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `ADMIN_EMAIL` | Yes | - | Email address of the primary administrator. All alert emails are sent FROM and TO this mailbox. |
| `APP_BASE_URL` | Yes | - | Origin URL of the application (e.g., `http://localhost:3000` or `https://licensing.example.com`). Used to construct password reset links. Host headers are never trusted. |
| `ADMIN_ENC_KEY` | Yes | - | 32-byte base64-encoded key used for AES-256-GCM encryption of TOTP secrets at rest. |
| `CRON_SECRET` | Yes | - | Bearer token required to trigger `/admin/cron/cleanup`. |
| `SMTP_HOST` | No | `smtp.gmail.com` | Hostname of the outgoing SMTP server. |
| `SMTP_PORT` | No | `465` | SMTP port (SSL/TLS). |
| `SMTP_SECURE` | No | `true` | Use direct SSL/TLS socket connection. |
| `SMTP_USER` | Yes | - | SMTP authentication username (same as `ADMIN_EMAIL` for Gmail). |
| `SMTP_PASS` | Yes | - | SMTP authentication password (16-character Google App Password). Never share or commit. |
| `EMAIL_ENABLED` | No | `true` (prod/dev) | Enable or disable outbound email dispatch. Defaults to `false` in test environments. |
| `EMAIL_FROM_NAME` | No | `Invenaro Control` | Display name in the `From:` header. |
| `ADMIN_SESSION_IDLE_MINUTES` | No | `30` | Idle timeout before an inactive session requires re-authentication. |
| `ADMIN_SESSION_ABSOLUTE_HOURS` | No | `12` | Absolute maximum lifespan of an active session. |

---

## How to Create a Gmail App Password
When using Gmail SMTP, standard Google passwords cannot be used if 2-Step Verification is active:
1. Sign in to your Google Account.
2. Go to **Security** &rarr; verify that **2-Step Verification** is turned **ON**.
3. Under 2-Step Verification or using the search bar, navigate to **App passwords**.
4. In the application name field, enter `Invenaro Control` and click **Create**.
5. Copy the generated 16-character passcode.
6. Set `SMTP_PASS` in `.env` to this code (spaces can be removed or kept).
> **CRITICAL**: The App Password grants direct SMTP access to your mailbox. It must never be committed to Git, shared in tickets, or exposed in public repositories.

---

## First Admin Creation
To bootstrap the initial administrator account:
```bash
npm run cli -- admin:create --email <adminEmail>
```
- The CLI generates a high-entropy temporary password and outputs it **once** in the terminal.
- The administrator is created with `mustChangePassword = true` and `totpEnabled = false`.
- The CLI refuses to register additional administrators unless `--force-additional` is explicitly provided.

---

## Authentication & Enrollment Flow
1. **Initial Login (`/admin/login`)**:
   - The admin inputs their email and the temporary password.
   - Authentication is verified using timing-safe bcrypt comparisons (cost factor 12).
2. **Mandatory Password Change (`/admin/setup/password`)**:
   - The session enters a restricted setup state. Navigation to other admin routes is forbidden at the server level.
   - The user selects a new password (minimum 12 characters, checked against common password lists).
   - Once set, all other sessions are revoked and `mustChangePassword` is set to `false`.
3. **Mandatory 2FA Enrollment (`/admin/setup/2fa`)**:
   - A TOTP secret is generated and rendered on-page as a data URI QR code (no external CDNs).
   - The secret is encrypted with AES-256-GCM using `ADMIN_ENC_KEY` before saving to PostgreSQL.
   - The user scans the QR code into their authenticator application (Google Authenticator, Authy, etc.) and enters a valid 6-digit code.
   - Upon verification, **10 single-use recovery codes** are generated, hashed with SHA-256, and displayed **once**.
   - The session is promoted to `active`.
4. **Subsequent Logins**:
   - Password verification creates a `pending_2fa` session stage (5-minute expiration).
   - Submission of a valid 6-digit TOTP code or an unused recovery code completes authentication, rotating the session ID.
   - An email notification (`login_success`) is sent to the administrator with the timestamp, IP, and User-Agent.

---

## Account Recovery
- **Single-Use Recovery Codes**: If the authenticator device is unavailable, any of the 10 recovery codes generated during enrollment can be submitted at `/admin/login/2fa`.
- **Forgot Password Flow (`/admin/forgot`)**:
   - Requesting a reset returns a uniform message regardless of email existence.
   - If the email matches the registered administrator, a single-use token valid for 30 minutes is emailed.
   - Setting a new password revokes all active sessions. **Password reset never bypasses 2FA**; the next login still requires authenticator verification or a recovery code.
- **Lost Authenticator CLI Override**:
   ```bash
   npm run cli -- admin:disable-2fa --email <adminEmail> --yes
   ```
   Clears 2FA, revokes all sessions, and emails a `two_factor_disabled` notification. The admin must re-enroll upon next login.
- **Password Reset CLI Override**:
   ```bash
   npm run cli -- admin:reset-password --email <adminEmail>
   ```
   Generates a new temporary password printed once in the console and forces a password change upon login.

---

## Email Events
All emails are sent via Nodemailer to `ADMIN_EMAIL` with sanitized subjects and clean HTML/text bodies. Email delivery failures are recorded in the `Notification` table with status `failed` and **never roll back the business transaction**.

### Business Events:
- `customer_created`: Customer, domain, plan, expiry date, and actor. (License key is never included).
- `plan_changed`: Specifies `[UPGRADED]` or `[DOWNGRADED]` based on tier hierarchy (`basic` < `business` < `enterprise`).
- `modules_changed`: Enabled add-on modules list.
- `license_renewed`: Updated expiration date.
- `license_suspended`: License suspension notice.
- `license_reinstated`: License reinstatement notice.
- `license_key_reissued`: Alerts that a key was reissued and the prior key invalidated.

### Security Events:
- `password_reset_requested`: Contains single-use 30-minute reset link.
- `password_changed`: Notice of password change with advice to reset if unauthorized.
- `two_factor_enabled`: Confirms successful TOTP enrollment.
- `two_factor_disabled`: Sent when 2FA is reset via CLI.
- `recovery_codes_regenerated`: Notice of code regeneration.
- `login_success`: Timestamp, IP, and User-Agent.
- `account_locked`: Dispatched when 5 consecutive failed attempts lock the account for 15 minutes.

---

## Vercel Deployment Notes
1. **Configure Environment Variables**:
   In the Vercel Project Settings &rarr; Environment Variables, add all required variables (`ADMIN_EMAIL`, `APP_BASE_URL`, `DATABASE_URL`, `DIRECT_URL`, `KEY_ID`, `PRIVATE_KEY_PEM`, `PUBLIC_KEY_PEM`, `SMTP_USER`, `SMTP_PASS`, `ADMIN_ENC_KEY`, `CRON_SECRET`).
2. **Apply Database Migrations**:
   Run database migrations against your production database:
   ```bash
   npx prisma migrate deploy
   ```
3. **Scheduled Cleanup Cron**:
   `vercel.json` configures the daily cleanup job:
   ```json
   {
     "crons": [
       {
         "path": "/admin/cron/cleanup",
         "schedule": "0 3 * * *"
       }
     ]
   }
   ```
   Ensure `CRON_SECRET` is set in Vercel to authenticate cron requests (`Authorization: Bearer <CRON_SECRET>`).
4. **Outbound SMTP Verification**:
   Verify outbound SMTP connectivity from your deployment. If your hosting provider blocks port 465 or 587, configure alternative secure relay ports or an SMTP relay service.

---

## Security Architecture
- **Stateless Serverless Execution**: No sticky in-memory session state; all session states and lockout throttles are persisted in PostgreSQL.
- **Strict Content Security Policy (CSP)**: Per-request cryptographic nonces for inline styles and the license copy script (`default-src 'none'; style-src 'nonce-...'; script-src 'nonce-...'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`).
- **Zero-Storage for Raw Keys**: License keys are generated in-memory and rendered **once**. Only SHA-256 hashes and key prefixes (`INV-XXXX-...`) are stored in the database.
- **Database Encryption**: Admin TOTP secrets are encrypted at rest using AES-256-GCM.
- **Anti-CSRF & Origin Protection**: All state-modifying requests require session-bound CSRF tokens and validate origin headers against cross-site submissions.
- **Brute-Force & Lockout Mitigation**: Accounts are locked for 15 minutes after 5 failed login attempts per email or IP; wrong 2FA submissions are limited to 5 attempts per session.
- **Search Engine Exclusion**: Strict `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, and `/robots.txt` disallowing `/admin`.

---

## Manual Browser Test Checklist
- [ ] **Initial Login**: Sign in at `/admin/login` using the CLI-generated temporary password.
- [ ] **Forced Password Setup**: Verify immediate redirection to `/admin/setup/password`. Submit a new 12+ character password.
- [ ] **2FA Enrollment**: Scan the rendered QR code with an authenticator app, enter the 6-digit code, and verify that 10 recovery codes are displayed once. Confirm receipt of the `two_factor_enabled` email.
- [ ] **Dashboard Access**: Access `/admin` and confirm customer/license metric cards render correctly.
- [ ] **Customer Creation**: Create a customer at `/admin/customers/new`. Verify that the full license key is displayed once with a functional copy button. Confirm receipt of the `customer_created` email without the raw key.
- [ ] **Plan Change**: Navigate to the created customer, change their plan, and verify that the resulting email indicates `[UPGRADED]` or `[DOWNGRADED]`.
- [ ] **Module Toggle & Renewal**: Toggle a module and renew the expiration date; verify audit log entries and email dispatches.
- [ ] **Key Reissue**: Reissue the license key. Verify the new key is shown once and the previous key returns 401 when verified at `/v1/licenses/verify`.
- [ ] **Forgot Password**: Use `/admin/forgot` to request a password reset, follow the link, set a new password, and verify that 2FA is still enforced on the subsequent login.
