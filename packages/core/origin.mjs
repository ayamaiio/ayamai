// Where the front door lives, in one place.
//
// A single origin — http://ayamai.local — is the product. Everything that has to
// answer "may this origin talk to me" asks here, and the loopback names stay
// valid so development never depends on the hosts file.
export const DEFAULT_ORIGIN = "http://ayamai.local";
export const DEV_PORT = 25222;

/** The configured public origin, without a trailing slash. */
export function publicOrigin(env = process.env) {
  return String(env.AYAMAI_PUBLIC_ORIGIN ?? DEFAULT_ORIGIN).trim().replace(/\/+$/, "");
}

/** The port the door is expected on: explicit env, then the URL, then 80. */
export function publicPort(env = process.env) {
  const explicit = Number(env.AYAMAI_PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 65535) return explicit;
  try {
    const url = new URL(publicOrigin(env));
    return url.port ? Number(url.port) : 80;
  } catch {
    return 80;
  }
}

/**
 * Every origin allowed to call the API. The public one, the loopback pair on the
 * same port, and the development port — never a wildcard.
 */
export function allowedOrigins(env = process.env) {
  const origins = new Set([publicOrigin(env)]);
  const port = publicPort(env);
  const suffix = port === 80 ? "" : `:${port}`;

  for (const host of ["localhost", "127.0.0.1"]) {
    origins.add(`http://${host}${suffix}`);
    origins.add(`http://${host}:${DEV_PORT}`);
  }

  // The public host with the door's port spelled out, so a fallback port works
  // without reconfiguring the name.
  try {
    const url = new URL(publicOrigin(env));
    if (!url.port) origins.add(`${url.protocol}//${url.hostname}${suffix}`);
  } catch { /* an unparseable origin is caught by the caller */ }
  return origins;
}

/** `*.localhost` is loopback by specification, so it is trusted without a hosts file. */
export function isLocalhostName(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

/** Pure: may this Origin call us? A missing Origin (curl, a local tool) is allowed. */
export function isAllowedOrigin(origin, env = process.env) {
  if (!origin) return true;
  if (allowedOrigins(env).has(origin)) return true;
  try {
    return isLocalhostName(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** The address to print, open or hand to another tool. */
export function publicUrl(path = "/", env = process.env) {
  return `${publicOrigin(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
