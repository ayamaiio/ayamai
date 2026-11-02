// Two states for a product: information first, or content first.
//
// The URL says which; the browser remembers the last choice per project; the
// developer state is the default and never appears in a URL, so /gemu is always
// the canonical developer page.
export const VIEWS = ["develop", "play"];

/** Pure: which state this request is in. `?view=` beats what was remembered. */
export function resolveView({ search = "", stored = null, allowed = VIEWS } = {}) {
  let requested = null;
  try { requested = new URLSearchParams(String(search ?? "")).get("view"); } catch { requested = null; }
  if (requested && allowed.includes(requested)) return requested;
  if (stored && allowed.includes(stored)) return stored;
  return "develop";
}

/** Pure: the query a state needs. Develop is the default, so it adds nothing. */
export function viewQuery(view, allowed = VIEWS) {
  return view && view !== "develop" && allowed.includes(view) ? `?view=${view}` : "";
}

export function storageKey(projectId) {
  return `ayamai.view.${projectId}`;
}
