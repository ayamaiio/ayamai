// The protocol. One handler, two transports: stdio for a spawned client, HTTP
// for the door. Everything here is synchronous request → response.
import { RESOURCES, TOOLS, callTool } from "./tools.mjs";
import { readText } from "./security.mjs";

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER_INFO = { name: "hisho", version: "0.1.0" };

export const PROMPTS = [
  {
    name: "next-task",
    description: "Claim the next item and return the brief for it.",
    arguments: [{ name: "by", description: "who is claiming it", required: true }],
  },
];

/** Pure: one JSON-RPC message in, one response out (or null for notifications). */
export async function handle(message, { by = "agent" } = {}) {
  if (!message || typeof message !== "object") return error(null, -32600, "invalid request");
  const { id = null, method, params } = message;
  if (!method) return error(id, -32600, "method is required");

  try {
    if (method === "initialize") {
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
    }
    if (method === "notifications/initialized" || method.startsWith("notifications/")) return null;
    if (method === "ping") return result(id, {});

    if (method === "tools/list") {
      return result(id, { tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) });
    }
    if (method === "tools/call") {
      const name = params?.name;
      const outcome = await callTool(name, params?.arguments ?? {});
      return result(id, { content: [{ type: "text", text: outcome.text }], isError: !outcome.ok });
    }
    if (method === "resources/list") {
      return result(id, { resources: RESOURCES.map((resource) => ({ uri: resource.uri, name: resource.name, mimeType: "text/markdown" })) });
    }
    if (method === "resources/read") {
      const resource = RESOURCES.find((entry) => entry.uri === params?.uri);
      if (!resource) return error(id, -32602, "unknown resource");
      const read = readText(resource.file);
      if (!read.ok) return error(id, -32000, read.error);
      return result(id, { contents: [{ uri: resource.uri, mimeType: "text/markdown", text: read.text }] });
    }
    if (method === "prompts/list") return result(id, { prompts: PROMPTS });
    if (method === "prompts/get") {
      const claimed = await callTool("plan.next", { by: String(params?.arguments?.by ?? by) });
      const id2 = /#(\d+)/.exec(claimed.text)?.[1];
      const brief = await callTool("context", { taskId: id2 ? Number(id2) : undefined });
      return result(id, {
        description: "the next item, claimed",
        messages: [{ role: "user", content: { type: "text", text: `${claimed.text}\n\n${brief.text}` } }],
      });
    }
    return error(id, -32601, `unknown method "${method}"`);
  } catch (failure) {
    return error(id, -32603, String(failure?.message ?? failure));
  }
}

function result(id, payload) { return { jsonrpc: "2.0", id, result: payload }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
