import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { renderPreview, previewKey, PREVIEW_EDGE, PREVIEW_MAX_BYTES } from "./preview-render";

test("images, animated GIFs and video posters are bounded static JPEGs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "preview-render-test-"));
  try {
    const png = join(dir, "image.png");
    await sharp({ create: { width: 2400, height: 1800, channels: 4, background: "#aa4466" } }).png().toFile(png);
    const gif = join(dir, "animated.gif");
    const mp4 = join(dir, "video.mp4");
    const bmp = join(dir, "image.bmp");
    const exec = promisify(execFile);
    await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=800x600:rate=3", "-t", "1", "-threads", "1", gif]);
    await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=2", "-t", "1", "-pix_fmt", "yuv420p", "-threads", "1", mp4]);
    await exec("ffmpeg", ["-y", "-i", png, "-frames:v", "1", "-threads", "1", bmp]);
    for (const [file, type] of [[png, "image"], [gif, "image"], [bmp, "image"], [mp4, "video"]]) {
      await t.test(type + " " + file.split("/").at(-1), async () => {
        const body = await renderPreview(file!, type!, join(dir, "poster.png"));
        const meta = await sharp(body).metadata();
        assert.equal(meta.format, "jpeg");
        assert.ok(meta.width! <= PREVIEW_EDGE && meta.height! <= PREVIEW_EDGE);
        assert.ok(body.length <= PREVIEW_MAX_BYTES);
        assert.equal(meta.pages ?? 1, 1);
        assert.equal(meta.exif, undefined);
      });
    }
    const corrupt = join(dir, "corrupt");
    await writeFile(corrupt, "not media");
    await assert.rejects(renderPreview(corrupt, "image", join(dir, "bad.png")));
    const playlist = join(dir, "disguised.mp4");
    await writeFile(playlist, `ffconcat version 1.0\nfile '${mp4}'\n`);
    await assert.rejects(renderPreview(playlist, "video", join(dir, "bad-video.png")));
    assert.equal(previewKey("media/account/uuid"), "media/account/uuid.previews/v1/tile.jpg");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
