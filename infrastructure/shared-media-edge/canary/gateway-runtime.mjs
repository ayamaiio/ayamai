import { gateway } from "./gateway.mjs";
import { HEADERS } from "./protocol.mjs";

/** REST-upload packaging: same harness files, no external asset service. */
export function createGatewayRuntime(assets) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      // During staged ingress verification, ONLY the authenticated health probe
      // is available. No runs, media or harness are usable until the gate passes.
      if (env.CANARY_DEPLOYMENT_PHASE !== "ready" && path !== "/control/health") {
        return new Response("Canary verification in progress.", {
          status: 503, headers: { ...HEADERS, "X-Canary-Phase": "probe" },
        });
      }
      const response = await gateway(request, {
        ...env,
        ASSETS: {
          fetch: async req => {
            const name = new URL(req.url).pathname === "/measure.js" ? "script" : "html";
            return new Response(assets[name], {
              headers: { "Content-Type": name === "script" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" },
            });
          },
        },
      }, ctx);
      const headers = new Headers(response.headers);
      headers.set("X-Canary-Phase", env.CANARY_DEPLOYMENT_PHASE === "ready" ? "ready" : "probe");
      return new Response(response.body, { status: response.status, headers });
    },
  };
}
