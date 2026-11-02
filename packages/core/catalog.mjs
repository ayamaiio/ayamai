// The projects we are building — a curated list, not a filesystem scan.
//
// `projects/*/project.json` describes what can be *run*; this describes what is
// *ours*: ayamai, gehirn, yoru. The two meet at `registryProject`.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const SCHEMA = "ayamai/catalog@2";
export const LEGACY_SCHEMA = "ayamai/catalog@1";
export const KINDS = new Set(["platform", "panel", "project"]);

const SLUG = /^[a-z][a-z0-9-]{1,31}$/;

/** Pure: is this entry well-formed, and do its files exist under `root`? */
export function validateEntry(entry, root) {
  const errors = [];
  if (!entry || typeof entry !== "object") return ["entry is not an object"];
  if (!SLUG.test(String(entry.id ?? ""))) errors.push("id must be a lowercase slug");
  if (!KINDS.has(String(entry.kind ?? ""))) errors.push(`kind must be one of ${[...KINDS].join(", ")}`);
  const target = path.resolve(root, String(entry.path ?? ""));
  if (!target.startsWith(path.resolve(root))) errors.push("path escapes the repository");
  else if (!existsSync(target)) errors.push(`path does not exist: ${entry.path}`);

  for (const doc of entry.docs ?? []) {
    // Docs may live beside the project or at the repository's docs/.
    const base = String(doc).startsWith("docs/") ? path.resolve(root) : target;
    const file = path.resolve(base, String(doc));
    if (!file.startsWith(base) || !existsSync(file)) errors.push(`doc missing: ${String(doc)}`);
  }
  for (const link of entry.links ?? []) {
    if (!String(link.url ?? "").startsWith("/")) errors.push(`link url must start with /: ${link.url}`);
  }
  return errors;
}

/** Pure: a person or an organization is well-formed. */
export function validateEntity(entity, kind) {
  const errors = [];
  if (!entity || typeof entity !== "object") return [`${kind} is not an object`];
  if (!SLUG.test(String(entity.id ?? ""))) errors.push(`${kind} id must be a lowercase slug`);
  if (!String(entity.name ?? "").trim()) errors.push(`${kind} needs a name`);
  return errors;
}

export function loadCatalog(root = process.cwd()) {
  const file = path.join(root, "catalog.json");
  if (!existsSync(file)) return { entries: [], invalid: [{ file, errors: ["catalog.json is missing"] }] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { entries: [], invalid: [{ file, errors: [`unreadable: ${String(error.message).split("\n")[0]}`] }] };
  }
  const legacy = parsed?.$schema === LEGACY_SCHEMA;
  if (parsed?.$schema !== SCHEMA && !legacy) {
    return { entries: [], people: [], organizations: [], invalid: [{ file, errors: [`$schema must be ${SCHEMA}`] }], legacy: false };
  }

  const invalid = [];
  const empty = legacy ? [] : [];

  // People and organizations first: an entry may only point at what exists.
  const people = [];
  for (const person of parsed.people ?? empty) {
    const errors = validateEntity(person, "person");
    if (errors.length) invalid.push({ file, id: person?.id, errors });
    else people.push(person);
  }
  const organizations = [];
  for (const org of parsed.organizations ?? empty) {
    const errors = validateEntity(org, "organization");
    if (!errors.length && org.owner && !people.some((person) => person.id === org.owner)) {
      errors.push(`owner "${org.owner}" is not a person`);
    }
    if (errors.length) invalid.push({ file, id: org?.id, errors });
    else organizations.push(org);
  }

  // Duplicate ids across each list would make ownership ambiguous.
  const unique = (list, kind) => {
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item.id)) invalid.push({ file, id: item.id, errors: [`duplicate ${kind} id`] });
      seen.add(item.id);
    }
    return list;
  };
  unique(people, "person");
  unique(organizations, "organization");

  const entries = [];
  for (const entry of parsed.entries ?? []) {
    const errors = validateEntry(entry, root);
    if (!legacy && entry.org && !organizations.some((org) => org.id === entry.org)) {
      errors.push(`org "${entry.org}" is not defined`);
    }
    if (errors.length) invalid.push({ file, id: entry?.id, errors });
    else entries.push(entry);
  }
  return { entries, people, organizations, invalid, legacy };
}

/** `~/ayamai-deepseek/…` — the shape a human reads. */
export function shortPath(abs) {
  const home = homedir();
  return abs.startsWith(home) ? `~${abs.slice(home.length)}` : abs;
}

/** WSL paths are meaningless to Windows' VS Code and Explorer. */
export function wslWindowsPath(abs, distro = process.env.AYAMAI_WSL_DISTRO ?? process.env.WSL_DISTRO_NAME ?? "Ubuntu") {
  // \\wsl$\\<distro>\\... works on Windows 10 and 11; wsl.localhost needs a newer build.
  return `\\\\wsl$\\${distro}${abs.replace(/\//g, "\\")}`;
}

export function editorUri(abs, { wsl = false } = {}) {
  // VS Code wants forward slashes: vscode://file//wsl$/Ubuntu/home/...
  if (wsl) return `vscode://file/${wslWindowsPath(abs).replace(/\\/g, "/")}`;
  return `vscode://file/${abs}`;
}

export function revealUri(abs, { wsl = false, platform = process.platform } = {}) {
  if (wsl) return `file://${wslWindowsPath(abs).replace(/\\/g, "/").replace(/^\/+/, "///")}`;
  if (platform === "win32") return `file:///${abs.replace(/\\/g, "/")}`;
  return `file://${abs}`;
}

/** Everything the panel needs about one entry, with paths resolved. */
export function resolveEntry(entry, root = process.cwd(), { wsl = false, organizations = [], people = [] } = {}) {
  const absPath = path.resolve(root, entry.path ?? ".");
  const org = organizations.find((candidate) => candidate.id === entry.org) ?? null;
  const owner = org ? people.find((person) => person.id === org.owner) ?? null : null;
  return {
    ...entry,
    org: org ? { id: org.id, name: org.name, jp: org.jp ?? "", summary: org.summary ?? "", owner: org.owner, ownerName: owner?.name ?? org.owner } : null,
    absPath,
    homePath: shortPath(absPath),
    windowsPath: wsl ? wslWindowsPath(absPath) : absPath,
    editorUri: editorUri(absPath, { wsl }),
    revealUri: revealUri(absPath, { wsl }),
    docsResolved: (entry.docs ?? []).map((doc) => ({
      doc,
      exists: existsSync(String(doc).startsWith("docs/") ? path.resolve(root, String(doc)) : path.resolve(absPath, doc)),
    })),
    extraPaths: (entry.paths ?? []).map((item) => ({ ...item, homePath: shortPath(String(item.path)) })),
  };
}
