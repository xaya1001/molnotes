import { measureStage, logTiming } from "./stage-timing.mjs";
import { transaction } from "./database.mjs";

export function contentCache(pool, report = logTiming) {
  let revision = null;
  let entries = new Map();
  // Content responses are rebuilt only after a publication bumps content_revision.
  return async function content(key, build) {
    const current = (await pool.query("SELECT revision FROM content_revision"))
      .rows[0].revision;
    if (current !== revision) {
      revision = current;
      entries = new Map();
    }
    let entry = entries.get(key);
    if (!entry) {
      const family = key.startsWith("/api/topics/")
        ? "topic"
        : key.startsWith("/api/notes/")
          ? "note"
          : ({
              "/api/catalog": "catalog",
              "/api/index": "index",
              "/api/review": "review",
              "/api/notes": "notebook",
              "/api/glossary": "glossary",
            }[key] ?? "other");
      entry = measureStage(
        `query.build.${family}`,
        () =>
          transaction(pool, async (client) => {
            await client.query(
              "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
            );
            return build(client);
          }),
        report,
      );
      const owner = entries;
      owner.set(key, entry);
      entry.then(
        (value) => value || owner.delete(key),
        () => owner.delete(key),
      );
    }
    return entry;
  };
}
