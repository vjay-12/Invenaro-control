import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import * as jose from "jose";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db.js";
import { generateLicenseKey, hashLicenseKey } from "../src/services/keyService.js";

// Mock DB interactions on prisma client
vi.mock("../src/db.js", () => {
  return {
    prisma: {
      $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
      verificationThrottle: {
        upsert: vi.fn(),
      },
      license: {
        findUnique: vi.fn(),
      },
      deployment: {
        update: vi.fn(),
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    },
  };
});

describe("Verify Endpoint & Error Handling", () => {
  const validKey = generateLicenseKey();
  const validHash = hashLicenseKey(validKey);

  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
      extractable: true,
    });
    const privPem = await jose.exportPKCS8(privateKey);
    const pubPem = await jose.exportSPKI(publicKey);

    process.env.LICENSE_SIGNING_PRIVATE_KEY = Buffer.from(privPem).toString("base64");
    process.env.LICENSE_PUBLIC_KEY = Buffer.from(pubPem).toString("base64");
    process.env.LICENSE_SIGNING_KID = "test_kid_verify";
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    process.env.RATE_LIMIT_PER_HOUR = "60";
    process.env.ALLOW_LOCALHOST = "false";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: throttle allowed
    vi.mocked(prisma.verificationThrottle.upsert).mockResolvedValue({
      id: "throt_1",
      keyPrefix: validKey.slice(0, 8),
      windowStart: new Date(),
      callCount: 1,
      updatedAt: new Date(),
    });
  });

  it("GET /health returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("invenaro-control");
  });

  it("GET /.well-known/jwks.json returns 200 with JWKS", async () => {
    const res = await request(app).get("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    expect(res.body.keys).toBeDefined();
    expect(res.body.keys[0].alg).toBe("EdDSA");
  });

  it("returns 400 invalid_request when required fields are missing", async () => {
    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({ licenseKey: validKey }); // Missing domain and appVersion

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 401 invalid_key for malformed keys (does not leak whether key exists)", async () => {
    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: "not-a-real-key",
        domain: "demo.invenaro.com",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_key");
  });

  it("returns 401 invalid_key for unknown keys that follow valid format", async () => {
    vi.mocked(prisma.license.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "demo.invenaro.com",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_key");
  });

  it("returns 429 rate_limited when key throttle limit is exceeded", async () => {
    vi.mocked(prisma.verificationThrottle.upsert).mockResolvedValue({
      id: "throt_1",
      keyPrefix: validKey.slice(0, 8),
      windowStart: new Date(),
      callCount: 65, // Limit is 60
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "demo.invenaro.com",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("returns 403 domain_mismatch when deployment has restricted allowedDomains", async () => {
    vi.mocked(prisma.license.findUnique).mockResolvedValue({
      id: "lic_1",
      customerId: "cust_1",
      keyHash: validHash,
      keyPrefix: validKey.slice(0, 8),
      plan: "business",
      status: "active",
      expiresAt: new Date(Date.now() + 10000000),
      graceDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: {
        id: "cust_1",
        companyName: "Acme Corp",
        status: "active",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deployments: [
          {
            id: "dep_1",
            customerId: "cust_1",
            domain: "app.acme.com",
            allowedDomains: ["app.acme.com"],
            vercelProjectId: null,
            neonProjectId: null,
            region: null,
            appVersion: null,
            rolloutWave: 1,
            autoDeploy: true,
            lastSeenAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      modules: [],
    } as any);

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "unauthorized.attacker.com",
        appVersion: "1.0.0",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("domain_mismatch");
  });

  it("returns 200 with signed token on valid active license", async () => {
    vi.mocked(prisma.license.findUnique).mockResolvedValue({
      id: "lic_1",
      customerId: "cust_1",
      keyHash: validHash,
      keyPrefix: validKey.slice(0, 8),
      plan: "business",
      status: "active",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      graceDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: {
        id: "cust_1",
        companyName: "Acme Corp",
        status: "active",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deployments: [
          {
            id: "dep_1",
            customerId: "cust_1",
            domain: "app.acme.com",
            allowedDomains: ["app.acme.com"],
            vercelProjectId: null,
            neonProjectId: null,
            region: null,
            appVersion: null,
            rolloutWave: 1,
            autoDeploy: true,
            lastSeenAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      modules: [],
    } as any);

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "app.acme.com",
        appVersion: "1.2.0",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.status).toBe("active");
  });

  it("returns 200 with signed token carrying 'suspended' or 'expired' status", async () => {
    // Expired license beyond grace period
    const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    vi.mocked(prisma.license.findUnique).mockResolvedValue({
      id: "lic_expired",
      customerId: "cust_1",
      keyHash: validHash,
      keyPrefix: validKey.slice(0, 8),
      plan: "business",
      status: "active",
      expiresAt: longAgo,
      graceDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: {
        id: "cust_1",
        companyName: "Acme Corp",
        status: "active",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deployments: [
          {
            id: "dep_1",
            customerId: "cust_1",
            domain: "app.acme.com",
            allowedDomains: ["app.acme.com"],
            vercelProjectId: null,
            neonProjectId: null,
            region: null,
            appVersion: null,
            rolloutWave: 1,
            autoDeploy: true,
            lastSeenAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      modules: [],
    } as any);

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "app.acme.com",
        appVersion: "1.2.0",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.status).toBe("expired");
  });

  it("returns 200 with signed token containing adminEmail when license has adminEmail", async () => {
    vi.mocked(prisma.license.findUnique).mockResolvedValue({
      id: "lic_with_admin",
      customerId: "cust_1",
      keyHash: validHash,
      keyPrefix: validKey.slice(0, 8),
      plan: "business",
      status: "active",
      adminEmail: "designated.admin@customer.org",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      graceDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: {
        id: "cust_1",
        companyName: "Acme Corp",
        status: "active",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deployments: [
          {
            id: "dep_1",
            customerId: "cust_1",
            domain: "app.acme.com",
            allowedDomains: ["app.acme.com"],
            vercelProjectId: null,
            neonProjectId: null,
            region: null,
            appVersion: null,
            rolloutWave: 1,
            autoDeploy: true,
            lastSeenAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      modules: [],
    } as any);

    const res = await request(app)
      .post("/v1/licenses/verify")
      .send({
        licenseKey: validKey,
        domain: "app.acme.com",
        appVersion: "1.2.0",
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    // Verify token claims contains adminEmail
    const { getPublicKey } = await import("../src/services/tokenService.js");
    const { key } = await getPublicKey();
    const { payload } = await jose.jwtVerify(res.body.token, key, {
      issuer: "invenaro-control",
      algorithms: ["EdDSA"],
    });

    expect(payload.adminEmail).toBe("designated.admin@customer.org");
  });
});
