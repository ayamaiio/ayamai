import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

// A status older than this is presumed stale; the box reports idle rather than lying.
const MAX_AGE_MS = 90_000;

/** Producers publish state next to the data they are changing. Nothing else is consulted. */
function activityFile(): string | null {
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  if (!root) return null;
  return resolve(root, "..", "state", "activity.json");
}

router.get("/activity", async (_req, res): Promise<void> => {
  const file = activityFile();
  if (!file) {
    res.json({ activity: null });
    return;
  }
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
    const updatedAt = Date.parse(String(parsed.updatedAt ?? ""));
    if (!label || !Number.isFinite(updatedAt) || Date.now() - updatedAt > MAX_AGE_MS) {
      res.json({ activity: null });
      return;
    }
    res.json({
      activity: {
        label,
        done: Number(parsed.done ?? 0) || 0,
        total: Number(parsed.total ?? 0) || 0,
        updatedAt: new Date(updatedAt).toISOString(),
      },
    });
  } catch {
    res.json({ activity: null });
  }
});

export default router;
