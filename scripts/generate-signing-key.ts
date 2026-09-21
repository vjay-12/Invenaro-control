import * as jose from "jose";

async function main() {
  console.log("Generating Ed25519 (EdDSA) signing key pair...\n");

  const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", {
    extractable: true,
  });

  const privatePem = await jose.exportPKCS8(privateKey);
  const publicPem = await jose.exportSPKI(publicKey);

  const privateBase64 = Buffer.from(privatePem, "utf-8").toString("base64");
  const publicBase64 = Buffer.from(publicPem, "utf-8").toString("base64");

  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}_${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const suggestedKid = `invenaro_key_${yearMonth}_${Math.random().toString(36).substring(2, 6)}`;

  console.log("================================================================================");
  console.log("🔑 NEW INVENARO SIGNING KEYS GENERATED");
  console.log("================================================================================");
  console.log("IMPORTANT: Copy these keys securely. NEVER commit private keys to git.\n");

  console.log("--- Suggested Key ID (kid) ---");
  console.log(suggestedKid);
  console.log();

  console.log("--- Environment Variables for invenaro-control (.env or Vercel) ---");
  console.log(`LICENSE_SIGNING_KID="${suggestedKid}"`);
  console.log(`LICENSE_SIGNING_PRIVATE_KEY="${privateBase64}"`);
  console.log(`LICENSE_PUBLIC_KEY="${publicBase64}"`);
  console.log();

  console.log("--- Environment Variable for customer app repo (Invenaro) ---");
  console.log(`LICENSE_PUBLIC_KEY="${publicBase64}"`);
  console.log();

  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Failed to generate keys:", err);
  process.exit(1);
});
