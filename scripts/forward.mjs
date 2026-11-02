// A tiny TCP forwarder. macOS will not let a user process bind 80, so a
// LaunchDaemon runs this as root and hands connections to the door.
//
//   node scripts/forward.mjs 80 25222
import net from "node:net";

const [, , listenArg, targetArg] = process.argv;
const listen = Number(listenArg ?? 80);
const target = Number(targetArg ?? 25222);

if (!Number.isInteger(listen) || listen < 1 || listen > 65535) {
  console.error("forward: listen port must be 1-65535");
  process.exit(2);
}
if (!Number.isInteger(target) || target < 1 || target > 65535) {
  console.error("forward: target port must be 1-65535");
  process.exit(2);
}

const server = net.createServer((client) => {
  const upstream = net.connect({ host: "127.0.0.1", port: target });
  client.pipe(upstream).pipe(client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on("error", close);
  upstream.on("error", close);
  client.on("close", close);
  upstream.on("close", close);
});

server.on("error", (error) => {
  console.error(`forward: ${error.code === "EACCES" ? "not permitted to bind" : error.message} ${listen}`);
  process.exit(1);
});

server.listen(listen, "0.0.0.0", () => console.log(`forward: 0.0.0.0:${listen} → 127.0.0.1:${target}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
