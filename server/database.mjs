import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { setting } from "../scripts/settings.mjs";

export function databaseUrl() {
  return setting("MOLNOTES_DATABASE_URL");
}
export function databaseError(error, connectionString) {
  let host = "configured host";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    /* Invalid config. */
  }
  const code = /^[A-Z0-9_]{2,30}$/.test(error?.code ?? "")
    ? error.code
    : "CONNECTION_ERROR";
  return new Error(`Database ${host}: ${code}`);
}
export function openDatabase(connectionString = databaseUrl()) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    max: 5,
  });
  // Never let a driver error print a credential-bearing configuration.
  pool.on("error", (error) =>
    console.error(databaseError(error, connectionString).message),
  );
  return pool;
}
export async function transaction(pool, run) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool) {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(64081601)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("./schema/", import.meta.url);
    for (const name of (await readdir(directory))
      .filter((name) => /^\d+-.+\.sql$/.test(name))
      .sort()) {
      if (
        (await client.query("SELECT 1 FROM migrations WHERE name = $1", [name]))
          .rowCount
      )
        continue;
      await client.query(await readFile(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO migrations(name) VALUES ($1)", [name]);
    }
  });
}
