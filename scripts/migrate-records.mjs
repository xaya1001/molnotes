// One-time copy of learning records from PostgreSQL into a new record store:
//   node scripts/migrate-records.mjs <file holding the PostgreSQL URL> <SQLite file>
// The stored JSON text is copied as is, so every revision stays the same.
import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { openRecords } from "../server/records.mjs";

const [source, target] = process.argv.slice(2);
if (!source || !target)
  throw new Error(
    "Usage: migrate-records.mjs <postgres-url-file> <sqlite-file>",
  );
if (existsSync(target)) throw new Error(`${target}: already exists`);
const client = new pg.Client({
  connectionString: readFileSync(source, "utf8").trim(),
  connectionTimeoutMillis: 5000,
});
let rows;
try {
  await client.connect();
  ({ rows } = await client.query(
    "SELECT scope, document::text AS document FROM learning_records ORDER BY scope",
  ));
} catch (error) {
  // Driver messages may echo the connection settings.
  throw new Error(`PostgreSQL: ${error.code ?? "CONNECTION_ERROR"}`);
} finally {
  await client.end().catch(() => {});
}
const records = openRecords(target);
try {
  records.exec("BEGIN");
  const insert = records.prepare(
    "INSERT INTO learning_records(scope,document) VALUES (?,?)",
  );
  for (const { scope, document } of rows) insert.run(scope, document);
  records.exec("COMMIT");
} finally {
  records.close();
}
console.log(`${rows.length} records copied to ${target}`);
