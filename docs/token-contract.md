# Invenaro License Token Contract

This document specifies the cryptographic and data contract between `invenaro-control` (the license authority) and the `invenaro` app (the customer-facing inventory application).

---

## 1. Overview

Each customer deployment runs its own instance of `invenaro` with a dedicated database and Vercel project.
The app does not maintain user quotas or payment logic directly; instead, it reads:
1. `LICENSE_KEY`: The Crockford Base32 license key assigned to that customer (`INV-XXXX-...`).
2. `LICENSE_PUBLIC_KEY`: The base64-encoded Ed25519 SPKI public key of `invenaro-control`.

At application cold start and periodically via Vercel Cron (e.g. every 6–12 hours), the customer deployment contacts `invenaro-control` at `POST /v1/licenses/verify` to receive a signed JWT. The app verifies the cryptographic signature with its local public key and caches the token in its local database.

---

## 2. JWT Specification

### Header
```json
{
  "alg": "EdDSA",
  "typ": "JWT",
  "kid": "invenaro_key_2026_09_xxx"
}
```

- **Algorithm**: `EdDSA` (Edwards-curve Digital Signature Algorithm using Curve25519 / Ed25519).
- **Key ID (`kid`)**: Identifies which signing key generated this token to facilitate rotation.

### Claims Payload
```json
{
  "iss": "invenaro-control",
  "sub": "cuid_customer_id",
  "licenseId": "cuid_license_id",
  "plan": "business",
  "modules": {
    "multi_godown": true,
    "transfers": true,
    "invoices_returns": true,
    "payments_dues": true,
    "stock_control": true,
    "gst": true,
    "ledger_ui": true,
    "reports_advanced": true,
    "import_export": true,
    "batch_expiry": false,
    "barcode": false,
    "ai_data_assistant": false,
    "ai_knowledge_assistant": false
  },
  "status": "active",
  "licenseExpiresAt": "2027-01-01T23:59:59.999Z",
  "graceDays": 14,
  "domain": "acme.invenaro.com",
  "iat": 1758441600,
  "exp": 1758614400
}
```

| Field | Type | Description |
|---|---|---|
| `iss` | `string` | Always `"invenaro-control"`. |
| `sub` | `string` | The unique Customer ID (`customerId`). |
| `licenseId` | `string` | The unique License ID. |
| `plan` | `"basic" \| "business" \| "enterprise"` | Plan tier determining defaults. |
| `modules` | `Record<ModuleName, boolean>` | Exact map of 13 module entitlement flags. |
| `status` | `"active" \| "grace" \| "expired" \| "suspended"` | Calculated server-side license lifecycle status. |
| `licenseExpiresAt` | `string` (ISO datetime) | Expiration timestamp of the license subscription. |
| `graceDays` | `number` | Number of days of grace period granted after expiry. |
| `domain` | `string` | Verified deployment domain. |
| `iat` | `number` | Issued-at UNIX timestamp (seconds). |
| `exp` | `number` | Token expiration UNIX timestamp (`iat + TOKEN_TTL_HOURS * 3600`, default 48h). |

---

## 3. Supported Module Flags

The following 13 module names are standardized across the control service and the application:

1. `multi_godown`: Multiple warehouses/godowns support
2. `transfers`: Inter-godown transfers and goods tracking
3. `invoices_returns`: Invoicing, credit notes, sales and purchase returns
4. `payments_dues`: Payment receipts, accounts payable & receivable
5. `stock_control`: Low-stock thresholds, reorder alerts, stock valuation
6. `gst`: GST calculation, HSN/SAC codes, tax filing exports
7. `ledger_ui`: Interactive party and account ledgers UI
8. `reports_advanced`: Advanced sales, inventory analytics, and projections
9. `import_export`: Bulk CSV/Excel import and export tools
10. `batch_expiry`: Batch tracking, lot numbers, manufacturing and expiry dates
11. `barcode`: Barcode scanning and label printing
12. `ai_data_assistant`: Conversational query assistant for business data
13. `ai_knowledge_assistant`: Documentation, workflow guidance, and AI SOPs

---

## 4. Status Lifecycle & App Enforcement

The token carries one of four statuses computed by `invenaro-control`:

1. **`active`**:
   - **Condition**: `now <= licenseExpiresAt`
   - **App behavior**: Full functionality for all enabled modules.
2. **`grace`**:
   - **Condition**: `licenseExpiresAt < now <= (licenseExpiresAt + graceDays)`
   - **App behavior**: Full access maintained; display a non-blocking administrative banner alerting the owner to renew.
3. **`expired`**:
   - **Condition**: `now > (licenseExpiresAt + graceDays)`
   - **App behavior**: **Read-only mode**. Users may view records, export data, and generate reports, but write mutations (POST/PUT/DELETE) are blocked. **Customer data is never deleted or locked out.**
4. **`suspended`**:
   - **Condition**: Customer or License marked suspended/cancelled by Invenaro administrators.
   - **App behavior**: Access blocked for operational/administrative reasons; displays contact support screen.

---

## 5. App Verification Flow

1. Fetch cached token from App DB (`SystemSetting` table or `LicenseCache`).
2. If token exists and is not expired (`Date.now() / 1000 < exp`):
   - Verify JWT cryptographic signature using `LICENSE_PUBLIC_KEY` with `jose.jwtVerify`.
   - Use claims directly.
3. If token is missing, expired, or refresh cron triggered:
   - Make HTTP `POST` request to `invenaro-control`:
     ```json
     POST /v1/licenses/verify
     Content-Type: application/json

     {
       "licenseKey": "INV-XXXX-XXXX-XXXX-XXXX-XXXX",
       "domain": "acme.invenaro.com",
       "appVersion": "1.2.0"
     }
     ```
   - On 200 response `{ token, expiresAt, status }`:
     - Verify signature locally with `jose.jwtVerify`.
     - Write token string into local App DB.
     - Return verified claims.
