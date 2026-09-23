import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import * as jose from "jose";
import { prisma } from "../src/db.js";
import { changePlanAndIssueNewLicense } from "../src/services/adminActions.js";
import { verifyLicense } from "../src/services/licenseService.js";
import { generateLicenseKey, hashLicenseKey, extractKeyPrefix } from "../src/services/keyService.js";
import {
  renderCustomerDetailPage,
  renderPlanChangedSuccessPage,
} from "../src/admin/views/pages.js";
import { getPlanDefaultModules } from "../src/services/planDefaults.js";

// Mock DB interactions on prisma client
vi.mock("../src/db.js", () => {
  return {
    prisma: {
      $transaction: vi.fn(),
      customer: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      license: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      verificationThrottle: {
        upsert: vi.fn(),
      },
      deployment: {
        update: vi.fn(),
        create: vi.fn(),
      },
      notification: {
        create: vi.fn(),
      },
    },
  };
});

// Mock email sending
vi.mock("../src/services/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/email.js")>();
  return {
    ...actual,
    sendAdminEmail: vi.fn().mockResolvedValue({ status: "sent" }),
  };
});

describe("Plan Change License Lifecycle", () => {
  let publicKeyPem: string;
  let privateKeyPem: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
      extractable: true,
    });
    const privPem = await jose.exportPKCS8(privateKey);
    const pubPem = await jose.exportSPKI(publicKey);

    privateKeyPem = privPem;
    publicKeyPem = pubPem;

    process.env.LICENSE_SIGNING_PRIVATE_KEY = Buffer.from(privPem).toString("base64");
    process.env.LICENSE_PUBLIC_KEY = Buffer.from(pubPem).toString("base64");
    process.env.LICENSE_SIGNING_KID = "test_kid_lifecycle";
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    process.env.RATE_LIMIT_PER_HOUR = "60";
    process.env.ALLOW_LOCALHOST = "false";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("changePlanAndIssueNewLicense service", () => {
    it("Basic -> Business creates a new license, suspends the old one, and generates a new key", async () => {
      const oldPlainKey = generateLicenseKey();
      const oldKeyHash = hashLicenseKey(oldPlainKey);
      const oldKeyPrefix = extractKeyPrefix(oldPlainKey);

      const mockCustomer = {
        id: "cust_123",
        companyName: "Acme Corp",
        status: "active",
        contactEmail: "owner@acme.com",
        licenses: [
          {
            id: "lic_old",
            customerId: "cust_123",
            keyHash: oldKeyHash,
            keyPrefix: oldKeyPrefix,
            plan: "basic",
            status: "active",
            expiresAt: new Date("2028-12-31"),
            graceDays: 14,
            adminEmail: "admin@acme.com",
            createdAt: new Date("2026-01-01"),
          },
        ],
      };

      vi.mocked(prisma.customer.findUniqueOrThrow).mockResolvedValue(mockCustomer as any);

      // Simulate $transaction execution
      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const txMock = {
          license: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockImplementation((args: any) => {
              return {
                id: "lic_new",
                customerId: "cust_123",
                ...args.data,
                createdAt: new Date(),
                customer: mockCustomer,
              };
            }),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: "audit_1" }),
          },
        };
        return callback(txMock);
      });

      const result = await changePlanAndIssueNewLicense({
        customerId: "cust_123",
        plan: "business",
        actor: "admin:superadmin@example.com",
      });

      // 1. New license is active with the requested plan
      expect(result.newLicense.id).toBe("lic_new");
      expect(result.newLicense.plan).toBe("business");
      expect(result.newLicense.status).toBe("active");

      // 2. Old license is preserved as oldLicense and was suspended
      expect(result.oldLicense?.id).toBe("lic_old");
      expect(result.oldLicense?.plan).toBe("basic");

      // 3. New plaintext license key is returned and is distinct from old key
      expect(result.plainLicenseKey).toBeDefined();
      expect(result.plainLicenseKey).not.toBe(oldPlainKey);
      expect(result.newLicense.keyPrefix).toBe(extractKeyPrefix(result.plainLicenseKey));

      // 4. ExpiresAt and adminEmail are carried over
      expect(result.newLicense.expiresAt).toEqual(mockCustomer.licenses[0].expiresAt);
      expect(result.newLicense.adminEmail).toBe("admin@acme.com");
    });

    it("Business -> Basic creates a new license and suspends the old one", async () => {
      const oldPlainKey = generateLicenseKey();
      const oldKeyHash = hashLicenseKey(oldPlainKey);
      const oldKeyPrefix = extractKeyPrefix(oldPlainKey);

      const mockCustomer = {
        id: "cust_456",
        companyName: "Beta Corp",
        status: "active",
        licenses: [
          {
            id: "lic_biz",
            customerId: "cust_456",
            keyHash: oldKeyHash,
            keyPrefix: oldKeyPrefix,
            plan: "business",
            status: "active",
            expiresAt: new Date("2029-01-01"),
            graceDays: 14,
            adminEmail: "admin@beta.com",
            createdAt: new Date("2026-02-01"),
          },
        ],
      };

      vi.mocked(prisma.customer.findUniqueOrThrow).mockResolvedValue(mockCustomer as any);

      vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
        const txMock = {
          license: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            create: vi.fn().mockImplementation((args: any) => ({
              id: "lic_basic_new",
              customerId: "cust_456",
              ...args.data,
              createdAt: new Date(),
              customer: mockCustomer,
            })),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: "audit_2" }),
          },
        };
        return callback(txMock);
      });

      const result = await changePlanAndIssueNewLicense({
        customerId: "cust_456",
        plan: "basic",
        actor: "admin:superadmin@example.com",
      });

      expect(result.newLicense.plan).toBe("basic");
      expect(result.newLicense.status).toBe("active");
      expect(result.oldLicense?.id).toBe("lic_biz");
      expect(result.oldLicense?.plan).toBe("business");
    });

    it("rejects attempt to change to the identical plan", async () => {
      const mockCustomer = {
        id: "cust_789",
        companyName: "Same Plan Corp",
        status: "active",
        licenses: [
          {
            id: "lic_active",
            customerId: "cust_789",
            plan: "business",
            status: "active",
            expiresAt: new Date("2028-01-01"),
            graceDays: 14,
          },
        ],
      };

      vi.mocked(prisma.customer.findUniqueOrThrow).mockResolvedValue(mockCustomer as any);

      await expect(
        changePlanAndIssueNewLicense({
          customerId: "cust_789",
          plan: "business",
          actor: "admin:tester@example.com",
        })
      ).rejects.toThrow("Customer 'Same Plan Corp' is already on the 'business' plan.");
    });

    it("atomicity: does not create a new license or leave inconsistent state if transaction fails", async () => {
      const mockCustomer = {
        id: "cust_err",
        companyName: "Error Test Corp",
        status: "active",
        licenses: [
          {
            id: "lic_err",
            customerId: "cust_err",
            plan: "basic",
            status: "active",
            expiresAt: new Date("2028-01-01"),
            graceDays: 14,
          },
        ],
      };

      vi.mocked(prisma.customer.findUniqueOrThrow).mockResolvedValue(mockCustomer as any);

      // Force transaction to abort
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error("Database connection dropped mid-transaction"));

      await expect(
        changePlanAndIssueNewLicense({
          customerId: "cust_err",
          plan: "business",
          actor: "admin:tester@example.com",
        })
      ).rejects.toThrow("Database connection dropped mid-transaction");
    });
  });

  describe("Verification behavior for old vs new license keys", () => {
    it("old license key returns status: 'suspended' and cannot verify as active", async () => {
      const oldKey = generateLicenseKey();
      const oldHash = hashLicenseKey(oldKey);

      vi.mocked(prisma.verificationThrottle.upsert).mockResolvedValue({
        id: "throt_1",
        keyPrefix: oldKey.slice(0, 8),
        windowStart: new Date(),
        callCount: 1,
        updatedAt: new Date(),
      });

      // Suspended old license in DB
      vi.mocked(prisma.license.findUnique).mockResolvedValue({
        id: "lic_old_suspended",
        customerId: "cust_verify_test",
        keyHash: oldHash,
        keyPrefix: extractKeyPrefix(oldKey),
        plan: "basic",
        status: "suspended", // Suspended due to plan change
        expiresAt: new Date("2028-12-31"),
        graceDays: 14,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: {
          id: "cust_verify_test",
          companyName: "Verify Test Corp",
          status: "active",
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deployments: [
            {
              id: "dep_1",
              customerId: "cust_verify_test",
              domain: "app.verifytest.com",
              allowedDomains: ["app.verifytest.com"],
              appVersion: "1.0.0",
              lastSeenAt: new Date(),
            },
          ],
        },
        modules: [],
      } as any);

      const result = await verifyLicense({
        licenseKey: oldKey,
        domain: "app.verifytest.com",
        appVersion: "1.0.0",
      });

      // Must return status: 'suspended'
      expect(result.status).toBe("suspended");

      // Verify the signed JWT claims carry suspended status
      const spkiKey = await jose.importSPKI(publicKeyPem, "EdDSA");
      const { payload } = await jose.jwtVerify(result.token, spkiKey);
      expect(payload.status).toBe("suspended");
    });

    it("new license key returns status: 'active' and correct plan/modules in signed token", async () => {
      const newKey = generateLicenseKey();
      const newHash = hashLicenseKey(newKey);

      vi.mocked(prisma.verificationThrottle.upsert).mockResolvedValue({
        id: "throt_2",
        keyPrefix: newKey.slice(0, 8),
        windowStart: new Date(),
        callCount: 1,
        updatedAt: new Date(),
      });

      // Active new business license
      vi.mocked(prisma.license.findUnique).mockResolvedValue({
        id: "lic_new_active",
        customerId: "cust_verify_test",
        keyHash: newHash,
        keyPrefix: extractKeyPrefix(newKey),
        plan: "business",
        status: "active",
        expiresAt: new Date("2028-12-31"),
        graceDays: 14,
        adminEmail: "admin@verifytest.com",
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: {
          id: "cust_verify_test",
          companyName: "Verify Test Corp",
          status: "active",
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deployments: [
            {
              id: "dep_1",
              customerId: "cust_verify_test",
              domain: "app.verifytest.com",
              allowedDomains: ["app.verifytest.com"],
              appVersion: "1.0.0",
              lastSeenAt: new Date(),
            },
          ],
        },
        modules: [],
      } as any);

      const result = await verifyLicense({
        licenseKey: newKey,
        domain: "app.verifytest.com",
        appVersion: "1.0.0",
      });

      expect(result.status).toBe("active");

      // Verify signed JWT contains business modules and adminEmail
      const spkiKey = await jose.importSPKI(publicKeyPem, "EdDSA");
      const { payload } = await jose.jwtVerify(result.token, spkiKey);

      expect(payload.status).toBe("active");
      expect(payload.plan).toBe("business");
      expect(payload.adminEmail).toBe("admin@verifytest.com");

      // Check module entitlements
      const expectedBizModules = getPlanDefaultModules("business");
      expect(payload.modules).toEqual(expectedBizModules);
      expect((payload.modules as any).gst).toBe(true);
      expect((payload.modules as any).multi_godown).toBe(true);
      expect((payload.modules as any).batch_expiry).toBe(false); // Enterprise only
    });
  });

  describe("Admin UI Views for Plan Changes", () => {
    it("renderCustomerDetailPage displays 'Change Plan & Issue New License' with confirmation", () => {
      const page = renderCustomerDetailPage({
        customer: {
          id: "cust_view",
          companyName: "Acme Corp",
          licenses: [
            {
              id: "lic_active",
              keyPrefix: "INV-ACTIVE",
              plan: "basic",
              status: "active",
              expiresAt: new Date("2028-01-01"),
              createdAt: new Date("2026-01-01"),
            },
            {
              id: "lic_old_1",
              keyPrefix: "INV-OLD1",
              plan: "business",
              status: "suspended",
              expiresAt: new Date("2027-01-01"),
              createdAt: new Date("2025-01-01"),
            },
          ],
        },
        license: {
          id: "lic_active",
          keyPrefix: "INV-ACTIVE",
          plan: "basic",
          status: "active",
          expiresAt: new Date("2028-01-01"),
          graceDays: 14,
        },
        computedStatus: "active",
        effectiveModules: getPlanDefaultModules("basic"),
        deployments: [],
        auditLogs: [],
        csrfToken: "csrf-token-123",
      }).value;

      // Check action form
      expect(page).toContain("Change Plan &amp; Issue New License");
      expect(page).toContain('action="/admin/customers/cust_view/plan"');
      expect(page).toContain("data-confirm=");
      expect(page).toContain("Changing the plan will immediately SUSPEND");

      // Check Customer License History section
      expect(page).toContain("Customer License History");
      expect(page).toContain("INV-ACTIVE...");
      expect(page).toContain("CURRENT ACTIVE");
      expect(page).toContain("INV-OLD1...");
      expect(page).toContain("SUSPENDED");
    });

    it("renderPlanChangedSuccessPage renders old -> new transition and copyable new key", () => {
      const plainKey = generateLicenseKey();
      const page = renderPlanChangedSuccessPage({
        customer: { id: "cust_succ", companyName: "Acme Corp" },
        oldLicense: { id: "lic_old", keyPrefix: "INV-OLD", plan: "basic" },
        newLicense: {
          id: "lic_new",
          keyPrefix: "INV-NEW",
          plan: "business",
          expiresAt: new Date("2028-01-01"),
        },
        plainLicenseKey: plainKey,
      }).value;

      expect(page).toContain("Plan Changed &amp; New License Issued");
      expect(page).toContain("COPY THIS NEW LICENSE KEY NOW");
      expect(page).toContain(plainKey);
      expect(page).toContain("INV-OLD...");
      expect(page).toContain("SUSPENDED");
      expect(page).toContain("INV-NEW...");
      expect(page).toContain("ACTIVE");
      expect(page).toContain("BUSINESS Plan");
    });
  });
});
