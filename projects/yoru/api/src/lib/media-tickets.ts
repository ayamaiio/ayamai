import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required for shared media delivery.");
  return createHash("sha256").update(`shared-media-v1:${process.env.SESSION_SECRET}`).digest();
}
export function createMediaTicket(id: string, viewer: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ id, viewer, expires: Date.now() + 300000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openMediaTicket(id: string, ticket: string) {
  try {
    if (ticket.length > 2048) return null;
    const bytes = Buffer.from(ticket, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()) as { id: string; viewer: string; expires: number };
    return data.id === id && typeof data.viewer === "string" && data.expires > Date.now() ? data.viewer : null;
  } catch { return null; }
}
