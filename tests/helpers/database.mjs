import pg from "pg";
import { randomBytes } from "node:crypto";
import { setting } from "../../scripts/settings.mjs";
import {
  migrate,
  databaseError,
  openDatabase,
} from "../../server/database.mjs";

/** A dedicated database per run; the development database is never migrated. */
export async function testDatabase() {
  const url = setting("MOLNOTES_TEST_DATABASE_URL");
  const admin = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await admin.connect();
  } catch (error) {
    throw databaseError(error, url);
  }
  const now = Math.floor(Date.now() / 1000);
  const prefix = "molnotes_test_";
  for (const { datname } of (
    await admin.query("SELECT datname FROM pg_database WHERE datname LIKE $1", [
      prefix + "%",
    ])
  ).rows) {
    const match = /^molnotes_test_(\d+)_([a-f0-9]+)$/.exec(datname);
    if (match && Number(match[1]) < now - 3600)
      await admin.query(`DROP DATABASE "${datname}" WITH (FORCE)`);
  }
  const name = `${prefix}${now}_${randomBytes(5).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const connection = new URL(url);
  connection.pathname = "/" + name;
  const pool = openDatabase(connection.href);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await pool.end();
    // pg Pool.end() can resolve before idle sockets have finished closing.
    // Retry only object_in_use while those sockets finish their normal disconnect.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.query(`DROP DATABASE "${name}"`);
        break;
      } catch (error) {
        if (error.code !== "55006" || attempt >= 10) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    await admin.end();
  };
  try {
    await migrate(pool);
  } catch (error) {
    await close();
    throw error;
  }
  return { pool, url: connection.href, name, close };
}
