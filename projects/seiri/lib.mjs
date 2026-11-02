// The board's rules, pure and importable without starting a server.
export const STATUSES = new Set(["todo", "doing", "blocked", "done"]);

/** The catalog order, so a new project appears without touching this file. */
export function projectOrder(catalogIds) {
  return Array.isArray(catalogIds) && catalogIds.length ? catalogIds : ["ayamai", "gehirn", "yoru", "seiri", "kata", "hisho"];
}

/** Pure: which plans the board shows for a project + status choice. */
export function visiblePlans(plans, { project = "all", status = "all" } = {}) {
  return (plans ?? []).filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (project === "all") return true;
    if (project === "other") return !item.project;
    return item.project === project;
  });
}

/** Pure: the rail rows — every catalog project, plus `other` when it has work. */
export function buildRail(plans, catalogIds) {
  const counts = new Map();
  for (const item of plans ?? []) {
    if (item.status === "done") continue;   // the rail counts work, not history
    const key = item.project || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const open = (plans ?? []).filter((item) => item.status !== "done").length;
  const rows = [{ id: "all", open, total: (plans ?? []).length }];
  for (const id of projectOrder(catalogIds)) rows.push({ id, open: counts.get(id) ?? 0 });
  const orphan = [...counts.entries()].filter(([key]) => key && !projectOrder(catalogIds).includes(key));
  if (orphan.length) rows.push({ id: "other", open: orphan.reduce((sum, [, count]) => sum + count, 0), extra: true });
  return rows;
}

/** Pure: validate a write before any process starts. */
export function validateAction(body) {
  const action = String(body?.action ?? "");
  if (action === "set-status") {
    const id = Number(body?.id);
    const status = String(body?.status ?? "");
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "id must be a positive integer" };
    if (!STATUSES.has(status)) return { ok: false, error: `status must be one of ${[...STATUSES].join(", ")}` };
    return { ok: true, argv: ["set", String(id), "--status", status] };
  }
  if (action === "add") {
    const title = String(body?.title ?? "").trim();
    if (!title) return { ok: false, error: "title is required" };
    if (title.length > 120) return { ok: false, error: "title must be 120 characters or fewer" };
    const priority = Number(body?.priority ?? 3);
    if (![1, 2, 3, 4].includes(priority)) return { ok: false, error: "priority must be 1-4" };
    const project = String(body?.project ?? "ayamai").trim();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(project)) return { ok: false, error: "project must be a lowercase slug" };
    return { ok: true, argv: ["add", title, "--priority", String(priority), "--project", project] };
  }
  if (action === "claim") {
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "id must be a positive integer" };
    const by = String(body?.by ?? "operator").trim();
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(by)) return { ok: false, error: "by must be a lowercase slug" };
    const ttl = String(body?.ttl ?? "30m");
    if (!/^\d+[smh]$/.test(ttl)) return { ok: false, error: "ttl must look like 30m, 2h or 90s" };
    return { ok: true, argv: ["claim", String(id), "--by", by, "--ttl", ttl] };
  }
  if (action === "release") {
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "id must be a positive integer" };
    return { ok: true, argv: ["release", String(id)] };
  }
  return { ok: false, error: `unknown action "${action}"` };
}
