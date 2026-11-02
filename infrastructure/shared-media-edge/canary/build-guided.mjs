// Build an upload manifest, not a deployment. Uses no credentials or packages.
import { readFile, writeFile, mkdir } from "node:fs/promises";
const dir = new URL("./", import.meta.url);
const read = name => readFile(new URL(name, dir), "utf8");
const tokens = await readFile(new URL("../../../artifacts/ayamai-design-system/src/index.css", dir), "utf8");
const theme = tokens.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1];
const root = tokens.match(/:root \{([\s\S]*?)\n\}/)?.[1];
if (!theme || !root) throw new Error("Design-system CSS format changed. Update the token adapter.");
const modules = [
  ["guided-worker.mjs", "application/javascript+module", await read("guided-worker.mjs")],
  ["gateway-baseline.mjs", "application/javascript+module", await read("gateway-baseline.mjs")],
  ["guided-session.mjs", "application/javascript+module", await read("guided-session.mjs")],
  ["guided.html", "text/plain", await read("guided.html")],
  ["guided.css", "text/plain", `:root {${theme}\n${root}\n}\n${await read("guided.css")}`],
  ["guided.js.txt", "text/plain", await read("guided.js")],
];
const manifest = {
  canaryOnly: true,
  scriptName: "ayamai-edge-canary",
  metadata: {
    main_module: "guided-worker.mjs", compatibility_date: "2026-10-01",
    keep_bindings: ["secret_text"], logpush: false,
    observability: { enabled: false }, tags: ["ayamai-synthetic-canary"],
    bindings: [
      { type: "service", name: "AUTHORITY", service: "ayamai-edge-canary-api", environment: "production" },
      { type: "r2_bucket", name: "MEDIA", bucket_name: "ayamai-edge-canary" },
      { type: "d1", name: "DB", id: "f64fbb8b-3092-497e-aaff-ca0d06a73776" },
      ...Object.entries({ CANARY_ONLY: "synthetic-v1", CANARY_BUCKET: "ayamai-edge-canary", CANARY_DEPLOYMENT_PHASE: "ready" })
        .map(([name, text]) => ({ type: "plain_text", name, text })),
    ],
  },
  modules: modules.map(([name, type, content]) => ({ name, type, content })),
};
await mkdir("generated-artifacts/shared-delivery", { recursive: true });
await writeFile("generated-artifacts/shared-delivery/guided-upload.json", JSON.stringify(manifest));
console.log("Prepared isolated-canary upload manifest. Nothing deployed.");
