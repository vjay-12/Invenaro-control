import * as jose from "jose";
import { getConfig } from "../config.js";
import {
  LicenseTokenClaims,
  LicenseTokenClaimsSchema,
} from "../contract/license-token.js";

let cachedPrivateKey: jose.KeyLike | null = null;
let cachedPublicKey: jose.KeyLike | null = null;
let cachedKid: string | null = null;

function decodePem(keyOrBase64: string): string {
  const trimmed = keyOrBase64.trim();
  if (trimmed.startsWith("-----BEGIN")) {
    return trimmed;
  }
  return Buffer.from(trimmed, "base64").toString("utf8");
}

/**
 * Loads the Ed25519 private key from configuration.
 */
export async function getPrivateKey(): Promise<{
  key: jose.KeyLike;
  kid: string;
}> {
  const config = getConfig();

  if (cachedPrivateKey && cachedKid === config.LICENSE_SIGNING_KID) {
    return { key: cachedPrivateKey, kid: cachedKid };
  }

  const pem = decodePem(config.LICENSE_SIGNING_PRIVATE_KEY);
  const key = (await jose.importPKCS8(pem, "EdDSA")) as jose.KeyLike;

  cachedPrivateKey = key;
  cachedKid = config.LICENSE_SIGNING_KID;

  return { key, kid: config.LICENSE_SIGNING_KID };
}

/**
 * Loads the Ed25519 public key from configuration.
 */
export async function getPublicKey(): Promise<{
  key: jose.KeyLike;
  kid: string;
}> {
  const config = getConfig();

  if (cachedPublicKey && cachedKid === config.LICENSE_SIGNING_KID) {
    return { key: cachedPublicKey, kid: cachedKid };
  }

  const pem = decodePem(config.LICENSE_PUBLIC_KEY);
  const key = (await jose.importSPKI(pem, "EdDSA")) as jose.KeyLike;

  cachedPublicKey = key;

  return { key, kid: config.LICENSE_SIGNING_KID };
}

/**
 * Signs a license token JWT with Ed25519 (EdDSA).
 */
export async function signLicenseToken(
  claims: Omit<LicenseTokenClaims, "iss" | "iat" | "exp">
): Promise<{ token: string; expiresAtIso: string }> {
  const config = getConfig();
  const { key, kid } = await getPrivateKey();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + config.TOKEN_TTL_HOURS * 3600;

  const fullClaims: LicenseTokenClaims = {
    ...claims,
    iss: "invenaro-control",
    iat: nowSeconds,
    exp: expSeconds,
  };

  // Validate claims strictly against schema before signing
  LicenseTokenClaimsSchema.parse(fullClaims);

  const token = await new jose.SignJWT(fullClaims as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setIssuer("invenaro-control")
    .setSubject(claims.sub)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .sign(key);

  const expiresAtIso = new Date(expSeconds * 1000).toISOString();

  return { token, expiresAtIso };
}

/**
 * Returns the public keys formatted as RFC 7517 JWKS for GET /.well-known/jwks.json
 */
export async function getPublicJwks(): Promise<{ keys: jose.JWK[] }> {
  const config = getConfig();
  const { key, kid } = await getPublicKey();

  const currentJwk = await jose.exportJWK(key);
  currentJwk.kid = kid;
  currentJwk.alg = "EdDSA";
  currentJwk.use = "sig";

  const keys: jose.JWK[] = [currentJwk];

  // If previous public keys are configured for rotation support
  if (config.LICENSE_PUBLIC_JWKS) {
    try {
      const parsed = JSON.parse(config.LICENSE_PUBLIC_JWKS);
      if (Array.isArray(parsed)) {
        for (const k of parsed) {
          if (k.kid && k.kid !== kid) {
            keys.push(k);
          }
        }
      }
    } catch {
      console.warn("Failed to parse LICENSE_PUBLIC_JWKS JSON");
    }
  }

  return { keys };
}
