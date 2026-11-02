// gemu's view is presentation inside its face, not the platform mode.
//
//   view     play | develop - how the shelf is drawn
//   mode     play | dev     - which face the platform is wearing
//
// The mode is the default; a person may look at the other one, and the override
// is theirs until they drop it.

export const VIEWS = ["play", "develop"];

/** Pure: what gemu should draw when nobody has said otherwise. */
export function defaultView(mode) {
  return String(mode ?? "").toLowerCase() === "play" ? "play" : "develop";
}

/** Pure: URL, then the remembered override, then the mode. */
export function effectiveView({ param = null, stored = null, mode = "dev" } = {}) {
  if (VIEWS.includes(param)) return { view: param, source: "url" };
  if (VIEWS.includes(stored)) return { view: stored, source: "override" };
  return { view: defaultView(mode), source: "mode" };
}
