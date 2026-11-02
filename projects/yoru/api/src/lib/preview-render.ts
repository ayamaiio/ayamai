import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import sharp from "sharp";

const exec = promisify(execFile);
export const PREVIEW_VERSION = "v1";
export const PREVIEW_EDGE = 640;
export const PREVIEW_MAX_BYTES = 96 * 1024;
export function previewKey(objectKey: string) {
  return `${objectKey}.previews/${PREVIEW_VERSION}/tile.jpg`;
}

const FORMAT_WHITELIST = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpeg,mpegvideo,asf,bmp_pipe,hevc";

// A video's first frame is very often black: an episode opens on a fade, a cold
// open, or a title card. Sampling only t=0 gave 1.2 KB black tiles for every
// video in the library, so we probe the duration, look a third of the way in,
// and keep the brightest sample we get.
const LUMA_TARGET = 30;   // 0-255; a real frame is almost always brighter

async function probeDuration(input: string): Promise<number | null> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input,
    ], { timeout: 20_000, maxBuffer: 8 * 1024 });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

async function meanLuma(file: string): Promise<number> {
  const { channels } = await sharp(file).stats();
  const [r, g, b] = channels.map((channel) => channel.mean);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// GIFs intentionally use the first frame. Animation and full quality remain in the viewer.
export async function renderPreview(input: string, mediaType: string, posterPath: string): Promise<Buffer> {
  const scale = `scale=${PREVIEW_EDGE}:${PREVIEW_EDGE}:force_original_aspect_ratio=decrease`;

  async function extractFrame(seek: number | null, filter: string) {
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-max_alloc", "134217728", "-protocol_whitelist", "file,pipe",
      // Reject playlists/concat manifests that could reference other local files.
      "-format_whitelist", FORMAT_WHITELIST,
      "-threads", "1", "-filter_threads", "1",
    ];
    if (seek !== null) args.push("-ss", String(seek));
    args.push("-i", input, "-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-vf", filter, posterPath);
    await exec("ffmpeg", args, { timeout: 60_000, maxBuffer: 64 * 1024 });
  }

  async function encode(source: string) {
    for (const quality of [76, 58, 40, 24]) {
      const body = await sharp(source, { animated: false, limitInputPixels: 80_000_000 })
        .rotate()
        .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#090809" })
        .jpeg({ quality, mozjpeg: true })
        .timeout({ seconds: 30 })
        .toBuffer();
      if (body.length <= PREVIEW_MAX_BYTES) return body;
    }
    throw new Error("Preview exceeds the tile byte budget.");
  }

  if (mediaType === "video") {
    const duration = await probeDuration(input);
    const samples: { seek: number | null; filter: string }[] = [];
    if (duration && duration > 30) {
      samples.push({ seek: Math.round(duration * 0.35), filter: scale });
      samples.push({ seek: Math.round(duration * 0.65), filter: scale });
    }
    samples.push({ seek: null, filter: `thumbnail=90,${scale}` });
    if (duration && duration > 20) samples.push({ seek: Math.round(duration * 0.85), filter: scale });

    let best: { luma: number; body: Buffer } | null = null;
    for (const sample of samples) {
      try {
        await extractFrame(sample.seek, sample.filter);
        if (!existsSync(posterPath)) continue;
        const luma = await meanLuma(posterPath);
        if (!best || luma > best.luma) best = { luma, body: await encode(posterPath) };
        if (luma >= LUMA_TARGET) break;
      } catch {
        // A sample can land past the end of a short clip; the next one may work.
      }
    }
    if (!best) throw new Error("No video frame could be decoded.");
    return best.body;
  }

  try { return await encode(input); }
  catch (error) {
    // BMP and some HEIF variants need FFmpeg rather than the bundled libvips
    // codecs. Do not bypass pixel limits or timeouts with this decoder fallback.
    if (!/unsupported image format|unsupported compression|heif: Unsupported feature/i.test((error as Error).message)) throw error;
    await extractFrame(null, scale);
    return encode(posterPath);
  }
}
