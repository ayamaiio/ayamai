import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SINGLE_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
type MediaReadResponse = {
  Body?: GetObjectCommandOutput["Body"];
  ContentRange?: string;
  ContentLength?: number;
  AcceptRanges?: string;
};

const SUPPORTED_CONTENT_TYPES = {
  image: new Set([
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/heic",
    "image/heif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
  video: new Set([
    "video/3gpp",
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
    "video/x-m4v",
    "video/x-matroska",
    "video/x-msvideo",
  ]),
} as const;

export function isSupportedMediaContentType(
  mediaType: string,
  contentType: string,
): boolean {
  if (mediaType !== "image" && mediaType !== "video") return false;
  return SUPPORTED_CONTENT_TYPES[mediaType].has(contentType.trim().toLowerCase());
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBucketName(): string {
  return getRequiredEnv("CLOUDFLARE_R2_BUCKET_NAME");
}

function getClient(): S3Client {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: getRequiredEnv("CLOUDFLARE_R2_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    },
  });
}

function localRoot(): string | undefined {
  const configured = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  return configured ? resolve(configured) : undefined;
}

function localObjectPath(objectKey: string): string | undefined {
  const root = localRoot();
  if (!root) return undefined;
  const segments = objectKey.split("/");
  if (!objectKey || objectKey.startsWith("/") || segments.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Invalid local media object key.");
  }
  const target = resolve(root, ...segments);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("Invalid local media object key.");
  return target;
}

// Local-library mode exposes the object as a real path so callers that can
// seek (ffmpeg, sharp) do not have to copy the bytes first.
export function localMediaPath(objectKey: string): string | undefined {
  try { return localObjectPath(objectKey); } catch { return undefined; }
}

function rangeNotSatisfiable() {
  return Object.assign(new Error("Media range not satisfiable."), { $metadata: { httpStatusCode: 416 } });
}

function localRange(range: string | undefined, size: number) {
  if (!range) return { start: 0, end: Math.max(0, size - 1), partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || size === 0 || (!match[1] && !match[2])) throw rangeNotSatisfiable();
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw rangeNotSatisfiable();
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) throw rangeNotSatisfiable();
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}


export function makeMediaObjectKey(userId: string): string {
  return `media/${userId}/${randomUUID()}`;
}

export async function readMediaRange(objectKey: string, range?: string, signal?: AbortSignal): Promise<MediaReadResponse> {
  const path = localObjectPath(objectKey);
  if (path) {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Local media object is unavailable.");
    const selected = localRange(range, info.size);
    const length = info.size === 0 ? 0 : selected.end - selected.start + 1;
    const stream = createReadStream(path, info.size === 0 ? {} : { start: selected.start, end: selected.end });
    // A client that disconnects destroys this stream; without a listener the
    // emit('error') has no handler and takes the whole API process down.
    stream.on("error", () => {});
    const body = Object.assign(stream, {
      async transformToByteArray() {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return Buffer.concat(chunks);
      },
      async transformToString(encoding = "utf-8") {
        return Buffer.from(await this.transformToByteArray()).toString(encoding as BufferEncoding);
      },
    });
    if (signal) {
      if (signal.aborted) body.destroy(signal.reason instanceof Error ? signal.reason : new Error("Media read aborted."));
      else signal.addEventListener("abort", () => body.destroy(signal.reason instanceof Error ? signal.reason : new Error("Media read aborted.")), { once: true });
    }
    return { Body: body as unknown as GetObjectCommandOutput["Body"], ContentLength: length,
      ContentRange: selected.partial ? `bytes ${selected.start}-${selected.end}/${info.size}` : undefined,
      AcceptRanges: "bytes" };
  }
  return getClient().send(new GetObjectCommand({ Bucket: getBucketName(), Key: objectKey, ...(range ? { Range: range } : {}) }), { abortSignal: signal });
}

export async function mediaObjectExists(objectKey: string): Promise<boolean> {
  const path = localObjectPath(objectKey);
  if (path) {
    try { return (await stat(path)).isFile(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: getBucketName(), Key: objectKey }));
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

export async function putMediaPreview(objectKey: string, body: Buffer): Promise<void> {
  const path = localObjectPath(objectKey);
  if (path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, body, { mode: 0o600, flag: "wx" }); await rename(temp, path); }
    finally { await rm(temp, { force: true }); }
    return;
  }
  await getClient().send(new PutObjectCommand({
    Bucket: getBucketName(), Key: objectKey, Body: body,
    ContentType: "image/jpeg", CacheControl: "private, no-store",
  }));
}

// Remove every derivative version, never the original or a neighboring object.
export async function deleteMediaPreviews(objectKey: string): Promise<void> {
  const previewDirectory = localObjectPath(`${objectKey}.previews`);
  if (previewDirectory) { await rm(previewDirectory, { recursive: true, force: true }); return; }
  let token: string | undefined;
  do {
    const page = await getClient().send(new ListObjectsV2Command({
      Bucket: getBucketName(), Prefix: `${objectKey}.previews/`, ContinuationToken: token,
    }));
    for (const entry of page.Contents ?? []) {
      if (entry.Key) await deleteMediaObject(entry.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function createUploadUrl(
  objectKey: string,
  contentType: string,
): Promise<string> {
  if (localRoot()) throw new Error("Uploads are disabled while using the local media mirror.");
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: 15 * 60 });
}

export async function createViewUrl(
  objectKey: string,
  contentType: string,
): Promise<string> {
  if (localRoot()) throw new Error("Local playback uses the authenticated stream route.");
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: objectKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: "inline",
    ResponseCacheControl: "private, max-age=240",
  });
  return getSignedUrl(getClient(), command, { expiresIn: 5 * 60 });
}

export async function verifyUploadedObject(
  objectKey: string,
  expectedSize: number,
  expectedContentType: string,
): Promise<boolean> {
  const path = localObjectPath(objectKey);
  if (path) {
    try { return (await stat(path)).size === expectedSize; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  const result = await getClient().send(
    new HeadObjectCommand({
      Bucket: getBucketName(),
      Key: objectKey,
    }),
  );

  return (
    Number(result.ContentLength) === expectedSize &&
    result.ContentType === expectedContentType
  );
}

export async function deleteMediaObject(objectKey: string): Promise<void> {
  const path = localObjectPath(objectKey);
  if (path) { await rm(path, { force: true }); return; }
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: objectKey,
    }),
  );
}

export const maxSingleUploadBytes = SINGLE_UPLOAD_LIMIT_BYTES;

export async function beginImportUpload(objectKey: string, contentType: string, signal: AbortSignal) {
  if (localRoot()) throw new Error("Uploads are disabled while using the local media mirror.");
  const result = await getClient().send(new CreateMultipartUploadCommand({
    Bucket: getBucketName(), Key: objectKey, ContentType: contentType,
  }), { abortSignal: signal });
  if (!result.UploadId) throw new Error("Storage did not create a multipart upload.");
  return result.UploadId;
}
export async function uploadImportPart(objectKey: string, uploadId: string, partNumber: number, body: Buffer, signal: AbortSignal) {
  if (localRoot()) throw new Error("Uploads are disabled while using the local media mirror.");
  const result = await getClient().send(new UploadPartCommand({
    Bucket: getBucketName(), Key: objectKey, UploadId: uploadId, PartNumber: partNumber, Body: body,
  }), { abortSignal: signal });
  if (!result.ETag) throw new Error("Storage did not acknowledge this upload part.");
  return { ETag: result.ETag, PartNumber: partNumber };
}
export async function finishImportUpload(objectKey: string, uploadId: string, parts: { ETag: string; PartNumber: number }[], signal: AbortSignal) {
  if (localRoot()) throw new Error("Uploads are disabled while using the local media mirror.");
  await getClient().send(new CompleteMultipartUploadCommand({
    Bucket: getBucketName(), Key: objectKey, UploadId: uploadId, MultipartUpload: { Parts: parts },
  }), { abortSignal: signal });
}
export async function abortImportUpload(objectKey: string, uploadId: string) {
  if (localRoot()) return;
  try {
    await getClient().send(new AbortMultipartUploadCommand({ Bucket: getBucketName(), Key: objectKey, UploadId: uploadId }));
  } catch (error) {
    if ((error as { name?: string }).name !== "NoSuchUpload") throw error;
  }
}
