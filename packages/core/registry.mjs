// A project is a folder with a manifest. The platform reads manifests; it never
// knows a project by name.
//
//   projects/<id>/project.json      → shipped with the repo
//   ~/.ayamai/projects.json         → { "external": ["/abs/path/to/project"] }
//
// Everything here is pure: it reads files and returns plain objects, so the
// gateway and the cockpit can both reason about the same registry.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const SCHEMA = "ayamai/project@1";

/** Paths the platform owns. A project may not claim them. */
export const RESERVED = new Set(["/", "/cockpit", "/agent", "/healthz", "/storybook"]);

const SLUG = /^[a-z][a-z0-9-]{1,31}$/;

export function dataRoot(env = process.env) {
  if (env.AYAMAI_DATA) return env.AYAMAI_DATA;
  if (process.platform === "win32") return path.join(env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "ayamai");
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Application Support", "ayamai");
  return path.join(env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "ayamai");
}

/** The two faces a product may declare: where it opens when playing, and when working. */
export const FACE_KEYS = ["play", "dev"];

/** Pure: a face map is a path per mode, relative to the project's own prefix. */
export function validateFaces(faces) {
  const errors = [];
  if (faces === undefined) return { ok: true, errors, faces: {} };
  if (!faces || typeof faces !== "object" || Array.isArray(faces)) return { ok: false, errors: ["faces must be an object"], faces: {} };
  const kept = {};
  for (const [key, value] of Object.entries(faces)) {
    if (!FACE_KEYS.includes(key)) { errors.push(`face "${key}" is not one of ${FACE_KEYS.join(", ")}`); continue; }
    const face = String(value ?? "");
    if (!face.startsWith("/")) { errors.push(`face "${key}" must start with /`); continue; }
    kept[key] = face;
  }
  return { ok: errors.length === 0, errors, faces: kept };
}

/** Returns { ok, errors }. Never throws on bad input — a broken project must not take the door down. */
export function validateProject(project) {
  const errors = [];
  if (!project || typeof project !== "object") return { ok: false, errors: ["manifest is not an object"] };
  if (project.$schema !== SCHEMA) errors.push(`$schema must be "${SCHEMA}"`);
  if (!SLUG.test(String(project.id ?? ""))) errors.push("id must be a lowercase slug");

  const routes = Array.isArray(project.routes) ? project.routes : [];
  for (const route of routes) {
    const prefix = String(route?.prefix ?? "");
    if (!prefix.startsWith("/") || prefix.length < 2) errors.push(`route prefix "${prefix}" must start with /`);
    if (RESERVED.has(prefix)) errors.push(`route prefix "${prefix}" is reserved by the platform`);
    if (["/api", "/ui", "/brand"].some((taken) => prefix === taken || prefix.startsWith(`${taken}/`))) {
      errors.push(`route prefix "${prefix}" collides with a platform path`);
    }
  }

  const services = Array.isArray(project.services) ? project.services : [];
  // A child project is code we work on, not a server: it may declare neither.
  if (project.parent) {
    if (routes.length) errors.push("a child project may not declare routes");
    if (services.length) errors.push("a child project may not run a service");
  } else if (!services.length) {
    errors.push("at least one service is required");
  }
  const ids = new Set();
  for (const service of services) {
    const id = String(service?.id ?? "");
    if (!SLUG.test(id)) errors.push(`service id "${id}" must be a lowercase slug`);
    if (ids.has(id)) errors.push(`service id "${id}" is duplicated`);
    ids.add(id);
    const port = Number(service?.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) errors.push(`service "${id}" needs a port between 1024 and 65535`);
    if (port === 25222) errors.push(`service "${id}" may not take the front door's port`);
    if (!service?.start?.command) errors.push(`service "${id}" needs a start command`);
  }

  errors.push(...validateFaces(project.faces).errors);
  return { ok: errors.length === 0, errors };
}

function readManifest(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { __error: `unreadable manifest: ${String(error.message).split("\n")[0]}` };
  }
}

/** Every shipped project under `<root>/projects/*`. */
/** Children live under a project's own folders, e.g. gemu/emulators/azahar. */
export function scanChildren(root = process.cwd()) {
  const dir = path.join(root, "projects");
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const next = path.join(current, entry.name);
      const manifest = path.join(next, "project.json");
      if (depth > 1 && existsSync(manifest)) found.push({ file: manifest, project: readManifest(manifest) });
      walk(next, depth + 1);
    }
  };
  walk(dir, 1);
  return found;
}

export function scanProjects(root = process.cwd()) {
  const dir = path.join(root, "projects");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "project.json"))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, project: readManifest(file) }));
}

/** Projects registered from outside the repo, via ~/.ayamai/projects.json. */
export function externalProjects(env = process.env) {
  const registryFile = path.join(dataRoot(env), "projects.json");
  if (!existsSync(registryFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(registryFile, "utf8"));
    const list = Array.isArray(parsed?.external) ? parsed.external : [];
    return list
      .map((dir) => path.join(String(dir), "project.json"))
      .filter((file) => existsSync(file))
      .map((file) => ({ file, project: readManifest(file) }));
  } catch {
    return [];
  }
}

/**
 * The registry as the platform sees it: valid projects only, each with the
 * routes it owns. Invalid ones come back separately so the cockpit can say why.
 */
export function loadRegistry(root = process.cwd(), env = process.env) {
  const projects = [];
  const invalid = [];
  for (const entry of [...scanProjects(root), ...externalProjects(env)]) {
    if (entry.project?.__error) {
      invalid.push({ file: entry.file, errors: [entry.project.__error] });
      continue;
    }
    const result = validateProject(entry.project);
    if (!result.ok) {
      invalid.push({ file: entry.file, id: entry.project?.id, errors: result.errors });
      continue;
    }
    projects.push({ ...entry.project, root: path.dirname(entry.file) });
  }
  const known = new Set(projects.map((project) => project.id));
  const children = [];
  for (const entry of scanChildren(root)) {
    if (entry.project?.__error) { invalid.push({ file: entry.file, errors: [entry.project.__error] }); continue; }
    const result = validateProject(entry.project);
    if (!result.ok) { invalid.push({ file: entry.file, id: entry.project?.id, errors: result.errors }); continue; }
    if (!known.has(String(entry.project.parent))) {
      invalid.push({ file: entry.file, id: entry.project.id, errors: [`parent "${entry.project.parent}" is not a project`] });
      continue;
    }
    children.push({ ...entry.project, root: path.dirname(entry.file), displayId: `${entry.project.parent}/${entry.project.id}` });
  }
  return { projects, children, invalid };
}

/** Flatten projects into the route table the gateway speaks. */
export function projectRoutes(projects) {
  const routes = [];
  for (const project of projects) {
    for (const route of project.routes ?? []) {
      const service = (project.services ?? []).find((candidate) => candidate.id === route.service);
      if (!service) continue;
      const start = service.start
        ? { command: service.start.command, args: service.start.args ?? [], env: service.start.env ?? {} }
        : null;
      routes.push({
        path: route.prefix,
        port: Number(service.port),
        name: `${project.id}:${service.id}`,
        project: project.id,
        ws: Boolean(route.ws),
        // the door offers a start button on its 502 page, so it needs the spec
        startSpec: start,
        start: start ? [start.command, ...start.args].join(" ") : null,
      });
    }
  }
  return routes;
}

/** The project a path belongs to, longest prefix first. */
export function projectForPath(projects, pathname) {
  let match = null;
  for (const route of projectRoutes(projects)) {
    if (pathname === route.path || pathname.startsWith(`${route.path}/`)) {
      if (!match || route.path.length > match.path.length) match = route;
    }
  }
  return match;
}
