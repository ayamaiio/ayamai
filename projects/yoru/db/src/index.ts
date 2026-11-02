import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Separate, small read-only budget: a media seek storm must not occupy the
// application's entire connection pool. The caller admits at most four queries.
export const mediaAuthorizationPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 500,
  statement_timeout: 1000,
  query_timeout: 1500,
  options: "-c default_transaction_read_only=on",
  allowExitOnIdle: true,
});
export const mediaAuthorizationDb = drizzle(mediaAuthorizationPool, { schema });

export * from "./schema";
