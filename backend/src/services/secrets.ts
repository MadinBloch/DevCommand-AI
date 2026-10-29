import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyMaterial() {
  const secret = process.env.SESSION_SECRET || process.env.SECRETS_KEY || "dev-only-change-me";
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a secret for DB storage. Format: ivHex:cipherHex */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const out = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

export function maskKey(key: string | null | undefined) {
  if (!key) return null;
  if (key.length < 12) return "••••••••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export function looksLikeOpenAiKey(key: string) {
  return /^sk-[A-Za-z0-9_\-]{20,}$/.test(key.trim());
}
