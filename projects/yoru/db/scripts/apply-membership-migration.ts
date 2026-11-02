import { readFile } from "node:fs/promises";
import { pool } from "../src/index";

try {
  const migration = await readFile(new URL("../migrations/20261030_membership.sql", import.meta.url), "utf8");
  await pool.query(`BEGIN;\n${migration}\nCOMMIT;`);
  console.log("Additive membership schema and existing-member backfill applied.");
} catch {
  await pool.query("ROLLBACK").catch(() => {});
  console.error("Membership migration failed. Review database connectivity and schema; no credentials are logged.");
  process.exitCode = 1;
} finally { await pool.end(); }
