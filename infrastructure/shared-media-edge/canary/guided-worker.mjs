import baseline from "./gateway-baseline.mjs";
import { sessionRoute, headers, json } from "./guided-session.mjs";
// Text module imports are supplied with the Cloudflare module upload.
import html from "./guided.html";
import css from "./guided.css";
import script from "./guided.js.txt";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/session")) {
      const control = (action, body) => baseline.fetch(new Request(`${url.origin}/control/${action}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${env.CANARY_OPERATOR_SECRET}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      }), env, ctx);
      return sessionRoute(request, env, control);
    }
    const asset = { "/": [html, "text/html"], "/guided.js": [script, "text/javascript"], "/guided.css": [css, "text/css"] }[url.pathname];
    if (asset && request.method === "GET") return new Response(asset[0], { headers: {
      ...headers, "Content-Type": `${asset[1]}; charset=utf-8`,
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    } });
    // Retain the existing operator controls and actual edge handler unchanged.
    if (/^\/(control|relay|edge)\//.test(url.pathname)) return baseline.fetch(request, env, ctx);
    return json({ error: "Not found." }, 404);
  },
};
