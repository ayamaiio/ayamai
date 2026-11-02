// Ideas: captured before they are understood, kept until they are.
//
// Append-only, like the plan log: one JSON object per line, never rewritten.
// The model is an injected function, so every rule here is testable without a
// network.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const MAX_TEXT = 2000;
export const MAX_STORIES = 6;

export function ideasFile(repo, planDir = process.env.PLAN_DIR ?? path.join(repo, ".plan")) {
  return path.join(planDir, "ideas.jsonl");
}

/** Pure: fold the event log into idea records. */
export function fold(lines) {
  const ideas = new Map();
  for (const line of String(lines ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.t === "idea") {
      ideas.set(event.id, { id: event.id, text: event.text, project: event.project ?? "", mode: event.mode ?? "quick", created: event.ts, status: "seed", stories: [], planIds: [] });
      continue;
    }
    const idea = ideas.get(event.id);
    if (!idea) continue;
    if (event.t === "draft") { idea.stories = event.stories ?? []; idea.status = "drafted"; }
    if (event.t === "accept") { idea.planIds = [...new Set([...(idea.planIds ?? []), ...(event.planIds ?? [])])]; idea.status = "unpacked"; }
    if (event.t === "archive") idea.status = "archived";
  }
  return ideas;
}

export function load(file) {
  try { return fold(readFileSync(file, "utf8")); } catch { return new Map(); }
}

export function record(file, event) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}

/** Pure: the next id, given what exists. */
export function nextId(ideas) {
  return ideas.size ? Math.max(...ideas.keys()) + 1 : 1;
}

/** Pure: is this a capture we can accept? */
export function validateCapture(body) {
  const text = String(body?.text ?? "").trim();
  if (!text) return { ok: false, error: "an idea needs some text" };
  if (text.length > MAX_TEXT) return { ok: false, error: `keep it under ${MAX_TEXT} characters` };
  const project = String(body?.project ?? "").trim();
  if (project && !/^[a-z][a-z0-9-]{0,31}$/.test(project)) return { ok: false, error: "project must be a lowercase slug" };
  const mode = String(body?.mode ?? "quick");
  if (!["quick", "unpack"].includes(mode)) return { ok: false, error: "mode must be quick or unpack" };
  return { ok: true, text, project, mode };
}

/**
 * Pure: the model's answer, made safe. Accepts a bare object, fenced JSON, or an
 * array — and drops anything that would not survive the plan tool.
 */
export function parseDraft(raw, { projects = [] } = {}) {
  const source = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  const candidate = fenced ? fenced[1] : source;
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start < 0 || end < start) return { stories: [], dropped: [{ title: "(whole reply)", reason: "no JSON found" }] };

  let parsed;
  try { parsed = JSON.parse(candidate.slice(start, end + 1)); }
  catch { return { stories: [], dropped: [{ title: "(whole reply)", reason: "JSON did not parse" }] }; }

  const list = Array.isArray(parsed) ? parsed : parsed?.stories;
  if (!Array.isArray(list)) return { stories: [], dropped: [{ title: "(whole reply)", reason: "no stories array" }] };

  const stories = [];
  const dropped = [];
  for (const entry of list) {
    const title = String(entry?.title ?? "").trim();
    const project = String(entry?.project ?? "").trim();
    const priority = Number(entry?.priority ?? 3);
    const body = String(entry?.body ?? "").trim();
    if (!title) { dropped.push({ title: "(untitled)", reason: "no title" }); continue; }
    if (title.length > 120) { dropped.push({ title: title.slice(0, 40), reason: "title over 120 characters" }); continue; }
    if (projects.length && !projects.includes(project)) { dropped.push({ title, reason: `unknown project "${project}"` }); continue; }
    if (![1, 2, 3, 4].includes(priority)) { dropped.push({ title, reason: `priority ${priority} is not 1-4` }); continue; }
    stories.push({ title, project: project || projects[0] || "ayamai", priority, body });
    if (stories.length >= MAX_STORIES) break;
  }
  return { stories, dropped };
}

/** Pure: what we ask the model, so the prompt can be read and tested. */
export function draftPrompt({ idea, projects }) {
  const list = projects.map((project) => `- ${project.id} (${project.kind}): ${project.summary}`).join("\n");
  return `You are decomposing a product idea into implementable stories for a personal software platform.

Projects in this repository:
${list}

The idea, captured verbatim:
"""${idea.text}"""

Write between 1 and 6 stories. Each story is one unit of work a single person can finish in a day or two.
Rules:
- title: imperative, under 90 characters, specific enough to start without further questions.
- project: exactly one id from the list above.
- priority: 1 highest, 4 lowest.
- body: two or three sentences, including how you would know it is done.

Reply with JSON only:
{"stories":[{"title":"…","project":"…","priority":2,"body":"…"}]}`;
}

/** Ask the model and keep the draft. `ask` is injected: (prompt) => raw string. */
export async function draftIdea({ file, idea, projects, ask }) {
  const result = await ask(draftPrompt({ idea, projects }));
  if (!result.ok) return { ok: false, error: result.error };
  const parsed = parseDraft(result.text, { projects: projects.map((project) => project.id) });
  if (!parsed.stories.length) {
    return { ok: false, error: parsed.dropped.map((item) => item.reason).join("; ") || "no stories", raw: String(result.text).slice(0, 400), dropped: parsed.dropped };
  }
  record(file, { t: "draft", id: idea.id, stories: parsed.stories });
  return { ok: true, stories: parsed.stories, dropped: parsed.dropped };
}
