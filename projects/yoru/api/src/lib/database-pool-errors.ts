import type { EventEmitter } from "node:events";

type PoolLogger = {
  error(fields: { event: string; code: string }, message: string): void;
};

// Do not log raw database errors: messages may contain SQL, data or locators.
const safeCodes = new Set([
  "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
  "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006", "08P01",
]);

/** pg-pool removes broken idle clients before emitting this event. */
export function observeDatabasePoolErrors(
  pool: Pick<EventEmitter, "on">,
  logger: PoolLogger,
): void {
  pool.on("error", (error: unknown) => {
    const rawCode = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    const code = typeof rawCode === "string" && safeCodes.has(rawCode) ? rawCode : "UNKNOWN";
    logger.error(
      { event: "database_pool_idle_error", code },
      "An idle database connection failed; the pool will replace it when needed.",
    );
  });
}
