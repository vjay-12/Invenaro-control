import { describe, it, expect, beforeAll } from "vitest";
import * as jose from "jose";
import {
  signLicenseToken,
  getPublicJwks,
  getPublicKey,
} from "../src/services/tokenService.js";
import { getPlanDefaultModules } from "../src/services/planDefaults.js";
import { LicenseTokenClaimsSchema } from "../src/contract/license-token.js";

describe("tokenService", () => {
  beforeAll(async () => {
    // Generate an ephemeral Ed25519 key pair for tests
    const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
      extractable: true,
    });
    const privPem = await jose.exportPKCS8(privateKey);
    const pubPem = await jose.exportSPKI(publicKey);

    process.env.LICENSE_SIGNING_PRIVATE_KEY = Buffer.from(privPem).toString("base64");
    process.env.LICENSE_PUBLIC_KEY = Buffer.from(pubPem).toString("base64");
    process.env.LICENSE_SIGNING_KID = "test_kid_vitest";
    process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
    process.env.TOKEN_TTL_HOURS = "48";
  });

  it("signs a token that verifies with the public key", async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const modules = getPlanDefaultModules("business");

    const { token, expiresAtIso } = await signLicenseToken({
      sub: "cust_12345",
      licenseId: "lic_98765",
      plan: "business",
      modules,
      status: "active",
      licenseExpiresAt: expiresAt,
      graceDays: 14,
      domain: "tenant.invenaro.com",
    });

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(expiresAtIso).toBeDefined();

    // Verify token with the public key
    const { key, kid } = await getPublicKey();
    expect(kid).toBe("test_kid_vitest");

    const { payload, protectedHeader } = await jose.jwtVerify(token, key, {
      issuer: "invenaro-control",
      algorithms: ["EdDSA"],
    });

    expect(protectedHeader.alg).toBe("EdDSA");
    expect(protectedHeader.kid).toBe("test_kid_vitest");

    const claims = LicenseTokenClaimsSchema.parse(payload);
    expect(claims.sub).toBe("cust_12345");
    expect(claims.licenseId).toBe("lic_98765");
    expect(claims.plan).toBe("business");
    expect(claims.status).toBe("active");
    expect(claims.domain).toBe("tenant.invenaro.com");
    expect(claims.modules.multi_godown).toBe(true);
    expect(claims.modules.barcode).toBe(false);
  });

  it("exports JWKS format with the current public key", async () => {
    const jwks = await getPublicJwks();
    expect(jwks).toBeDefined();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe("test_kid_vitest");
    expect(jwks.keys[0].kty).toBe("OKP");
    expect(jwks.keys[0].crv).toBe("Ed25519");
    expect(jwks.keys[0].use).toBe("sig");
    expect(jwks.keys[0].alg).toBe("EdDSA");
  });
});
