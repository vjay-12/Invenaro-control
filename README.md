# invenaro-control

The centralized, private licensing service, customer registry, and cryptographic signing authority for the **Invenaro** SaaS platform.

> [!IMPORTANT]
> `invenaro-control` is deployed **ONCE** on its own dedicated Vercel project with its own dedicated Neon PostgreSQL database. It holds the private signing key and is **never** deployed to customer environments or bundled with customer codebases.

---

## 1. Architecture Overview

Invenaro operates as a single-tenant dedicated SaaS architecture: each customer receives their own Vercel app deployment and Neon database. `invenaro-control` acts as the single source of truth for license verification and module authorization.

```
                    +-----------------------------+
                    |        ADMINISTRATOR        |
                    |     (Local Shell + CLI)     |
                    +--------------+--------------+
                                   |
                      DIRECT_URL   | (DB-authenticated)
                                   v
+-----------------------------------------------------------------+
|                    invenaro-control (Vercel)                    |
|                                                                 |
|  +--------------------+   +-------------------+   +----------+  |
|  |  Ed25519 Signer    |   |  Verify Endpoint  |   |   JWKS   |  |
|  |  (Private Key)     |   |  POST /v1/verify  |   | Endpoint |  |
|  +---------+----------+   +---------^---------+   +----+-----+  |
|            |                        |                  |        |
|            v                        v                  |        |
|     [ Neon Postgres: Customers, Licenses, Throttles ]  |        |
+-------------------------------------+------------------+--------+
                                      ^                  ^
                     POST /verify     |                  | Public Keys
               (Crockford License Key)|                  |
             +------------------------+                  |
             |                                           |
+------------+------------------+       +----------------+-----------------+
|   Customer A Deployment       |       |   Customer B Deployment          |
|   (Vercel + Neon)             |       |   (Vercel + Neon)                |
|                               |       |                                  |
| - Caches Ed25519 JWT in DB    |       | - Caches Ed25519 JWT in DB       |
| - Verifies via Public Key     |       | - Verifies via Public Key        |
| - Enforces requireModule()    |       | - Enforces requireModule()       |
+-------------------------------+       +----------------------------------+
```

---

## 2. Prerequisites & Setup

### A. Neon Database Setup
1. Create a dedicated project in Neon (e.g. `invenaro-control-prod`).
2. Obtain both connection strings from the Neon Console:
   - **Pooled connection string** (PGBouncer, port 6543) -> `DATABASE_URL`
   - **Direct connection string** (standard port 5432) -> `DIRECT_URL`

### B. Generate Ed25519 Key Pair
Run the keygen script locally:
```bash
npm run keygen
```
This prints:
- `LICENSE_SIGNING_KID`
- `LICENSE_SIGNING_PRIVATE_KEY` (Base64-encoded PKCS8 PEM)
- `LICENSE_PUBLIC_KEY` (Base64-encoded SPKI PEM)

### C. Environment Variables
Create a local `.env` file (or add to Vercel Environment Variables):
```ini
DATABASE_URL="postgresql://user:password@ep-pooler.neon.tech/invenaro_control?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://user:password@ep-direct.neon.tech/invenaro_control?sslmode=require"

LICENSE_SIGNING_KID="invenaro_key_2026_09_xxx"
LICENSE_SIGNING_PRIVATE_KEY="<base64-pkcs8-private-key>"
LICENSE_PUBLIC_KEY="<base64-spki-public-key>"

PORT=3000
TOKEN_TTL_HOURS=48
RATE_LIMIT_PER_HOUR=60
ALLOW_LOCALHOST=false
```

### D. Run Migrations
Run the initial Prisma migration against the Neon database:
```bash
npm run migrate:deploy
```

---

## 3. Administrator CLI

All administrative actions (customer registration, license issuance, plan updates, module overrides) are performed locally via the CLI tool using `npm run cli`. Every mutating command records an immutable `AuditLog` entry tagged with your OS username.

### 1. Create a Customer
```bash
npm run cli customer:create -- --name "Acme Logistics" --domain "acme.invenaro.com"
```

### 2. Issue a License
```bash
npm run cli license:create -- --customer "<customerId>" --plan "business" --expires "2027-12-31" --grace 14
```
> [!WARNING]
> The full plaintext license key (`INV-XXXX-XXXX-XXXX-XXXX-XXXX`) is printed **ONCE** upon creation. Only its SHA-256 hash and 8-character prefix (`INV-XXXX`) are persisted in the database.

### 3. Inspect a License
```bash
npm run cli license:show "<licenseId or keyPrefix>"
```

### 4. Upgrade or Downgrade Plan
```bash
npm run cli license:set-plan "<licenseId>" "enterprise"
```

### 5. Configure Module Overrides (Add-ons)
Enable or disable specific modules independently of plan defaults:
```bash
npm run cli license:set-module "<licenseId>" "batch_expiry" "on"
npm run cli license:set-module "<licenseId>" "ai_data_assistant" "on"
```

### 6. Renew / Extend License
```bash
npm run cli license:renew "<licenseId>" --expires "2028-12-31"
```

### 7. Suspend / Reinstate License
```bash
npm run cli license:suspend "<licenseId>"
npm run cli license:reinstate "<licenseId>"
```

### 8. Configure Deployment Constraints
```bash
npm run cli deployment:set "<customerId>" --domain "acme.invenaro.com" --allowed-domains "acme.invenaro.com,api.acme.invenaro.com" --wave 1
```

### 9. List All Customers
```bash
npm run cli list:customers
```

---

## 4. API Endpoints

### `POST /v1/licenses/verify`
Called by customer app deployments to request a signed JWT.

**Request:**
```bash
curl -X POST https://license.invenaro.com/v1/licenses/verify \
  -H "Content-Type: application/json" \
  -d '{
    "licenseKey": "INV-XXXX-XXXX-XXXX-XXXX-XXXX",
    "domain": "acme.invenaro.com",
    "appVersion": "1.2.0"
  }'
```

**Success (200 OK):**
```json
{
  "token": "eyJhbGciOiJFZERTQSI...",
  "expiresAt": "2026-09-23T12:00:00.000Z",
  "status": "active"
}
```

**Error Responses:**
- `400 invalid_request`: Missing or invalid JSON parameters.
- `401 invalid_key`: Key unknown or malformed (uniform response to prevent enumeration).
- `403 domain_mismatch`: Domain does not match authorized deployment domains.
- `429 rate_limited`: Verification limit exceeded (default 60 requests/hour per key prefix).

### `GET /health`
Returns service and database health status:
```json
{
  "status": "ok",
  "service": "invenaro-control",
  "timestamp": "2026-09-21T13:50:00.000Z"
}
```

### `GET /.well-known/jwks.json`
Returns active and legacy Ed25519 public keys formatted as RFC 7517 JSON Web Key Set (JWKS).

---

## 5. Key Rotation Procedure

To rotate signing keys without interrupting running customer deployments:

1. Generate a new key pair:
   ```bash
   npm run keygen
   ```
2. In `invenaro-control` environment:
   - Set `LICENSE_SIGNING_KID` to the new Key ID.
   - Set `LICENSE_SIGNING_PRIVATE_KEY` to the new private key.
   - Set `LICENSE_PUBLIC_KEY` to the new public key.
   - Add the previous public key JWK into `LICENSE_PUBLIC_JWKS` JSON array.
3. Deploy `invenaro-control`.
4. Update `LICENSE_PUBLIC_KEY` across customer app deployments (or let them fetch updated keys via `/.well-known/jwks.json`).
5. After the token TTL has elapsed (48 hours), all customer deployments will have refreshed to tokens signed by the new key.
6. Safely remove the retired key from `LICENSE_PUBLIC_JWKS`.

---

## 6. Backup & Security Guidelines

1. **Private Key Storage**: The private key must exist solely in the Vercel production environment variables and in one encrypted password-manager vault. It must **never** be committed to version control.
2. **Database Restores**: Perform periodic restore drills in Neon to test point-in-time recovery.
3. **WAF Protection**: In production, configure Vercel Web Application Firewall (WAF) rate limiting on `/v1/licenses/verify` alongside the built-in database throttle.
4. **Read-Only Expiry**: Invenaro guarantees customer data safety. Expired licenses put the application into read-only mode — **customer data is never deleted or locked out**.

---

## 7. Admin Web UI & Management Panel

The administrative panel is mounted under `/admin` and provides web-based management for customers, licenses, plan upgrades/downgrades, add-on modules, audit trails, and security settings with mandatory 2FA and email notifications.

For complete documentation on setup, configuration, CLI recovery commands, and architecture, see [Admin Web UI Documentation](docs/admin-ui.md).

---

## 8. Testing & Test Database Safety Guard

Tests are split into two categories to protect operational database environments:
1. **Pure Unit Tests (`npm run test:unit`)**: Stateless unit tests that execute without database dependencies.
2. **Database-Backed Tests (`npm run test:db`)**: Tests that verify end-to-end database operations, transactions, and authentication workflows.

> [!CAUTION]
> **DB-backed tests NEVER run against Development or Production databases.**
> Vitest is configured with a strict safety guard (`tests/setup/dbGuard.ts`) that verifies `.env.test` exists, asserts `TEST_DATABASE_URL` is distinct from the primary database, and requires the database hostname or name to contain the configured `TEST_DB_MARKER` (e.g. `test`). Any attempt to run DB tests against non-test databases will immediately abort execution.


