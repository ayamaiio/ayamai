import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { observeDatabasePoolErrors } from "./lib/database-pool-errors";
import { startImportWorker } from "./lib/imports/worker";
import { ensureLocalFounderMembership } from "./lib/local-founder-membership";
import { localFounderModeEnabled } from "./lib/local-dev-auth";

// An unhandled pg.Pool idle-client error otherwise terminates the whole API.
// Active query errors still propagate normally; never replay writes here.
observeDatabasePoolErrors(pool, logger);

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  if (localFounderModeEnabled()) {
    await ensureLocalFounderMembership();
  }
  app.listen(port, process.env.HOST ?? "0.0.0.0", (err) => {
    if (err) {
      logger.error({ err }, "Error listening");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startImportWorker();
  });
}

void startServer().catch((error: unknown) => {
  logger.error({ name: error instanceof Error ? error.name : "UnknownError" }, "API startup failed; verify the isolated local developer database and schema.");
  process.exit(1);
});
