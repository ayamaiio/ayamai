import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { Readable } from "node:stream";
import { readMediaRange } from "./r2Storage";
import { SocialError } from "./social-access";

export const CAPTURE_LIMIT = 20 * 1024 * 1024;
export const CAPTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "video/mp4", "video/webm"]);
export const capturePrefix = (uid: string, hash: string) => `media/${uid}/capture-${hash}-`;
// Never hand a second capture a PUT grant to an already-published object's key.
export const captureKey = (uid: string, hash: string) => `${capturePrefix(uid, hash)}${randomUUID()}`;
export function captureDigest(key: string, uid: string) {
  const suffix = key.slice(`media/${uid}/`.length);
  return key.startsWith(`media/${uid}/`) && /^capture-[a-f0-9]{64}-[a-f0-9-]{36}$/.test(suffix) ? suffix.slice(8, 72) : null;
}

/** Full bounded verification, not just a client-reported MIME or R2 HEAD. */
export async function validateCaptureBytes(bytes: Buffer, digest: string, mime: string, size: number) {
  if (size < 1 || size > CAPTURE_LIMIT || bytes.length !== size || !CAPTURE_TYPES.has(mime) ||
      createHash("sha256").update(bytes).digest("hex") !== digest) {
    throw new SocialError(415, "Capture content or checksum is invalid. Select the original file again.");
  }
  const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);
  if (detected?.mime !== mime) throw new SocialError(415, "Capture bytes do not match a supported image or video format.");
}

const verifying = new Map<string, number>();
let totalVerifying = 0;
export async function verifyCapture(key: string, uid: string, mime: string, size: number) {
  const digest = captureDigest(key, uid);
  if (!digest) return;
  if (size < 1 || size > CAPTURE_LIMIT || !CAPTURE_TYPES.has(mime)) throw new SocialError(413, "Capture supports files up to 20 MiB in the documented formats.");
  if (totalVerifying >= 8 || (verifying.get(uid) ?? 0) >= 2) throw new SocialError(429, "Capture verification is busy. Retry shortly.");
  verifying.set(uid, (verifying.get(uid) ?? 0) + 1);
  totalVerifying++;
  try {
    const result = await readMediaRange(key, undefined, AbortSignal.timeout(30_000));
    const body = result.Body as Readable | undefined;
    if (Number(result.ContentLength) !== size || !body) { body?.destroy(); throw new SocialError(415, "Capture size does not match."); }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > CAPTURE_LIMIT) { body.destroy(); throw new SocialError(413, "Capture is too large."); }
      chunks.push(Buffer.from(chunk));
    }
    await validateCaptureBytes(Buffer.concat(chunks), digest, mime, size);
  } finally {
    const left = (verifying.get(uid) ?? 1) - 1;
    if (left) verifying.set(uid, left); else verifying.delete(uid);
    totalVerifying--;
  }
}
