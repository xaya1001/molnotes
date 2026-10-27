import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { measureStage, logTiming } from "./stage-timing.mjs";

const family = (key) =>
  key.startsWith("/api/topics/")
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

async function loadSnapshot(root, report) {
  const data = JSON.parse(await readFile(join(root, "snapshot.json"), "utf8"));
  if (data?.format !== 1) throw new Error("unsupported snapshot format");
  const topics = new Map(data.topics.map((t) => [t.slug, t]));
  const directories = new Map(data.directories.map((d) => [d.dir, d]));
  const notes = new Map(
    data.notes.filter((n) => !n.author).map((n) => [`${n.dir}/${n.slug}`, n]),
  );
  const assets = new Map(data.assets.map((a) => [`${a.scope}/${a.path}`, a]));
  const entries = new Map();
  return {
    root,
    topics: data.topics,
    directories: data.directories,
    notes: data.notes,
    glossary: data.glossary,
    topic: (slug) => topics.get(slug),
    directory: (dir) => directories.get(dir),
    note: (dir, slug) => notes.get(`${dir}/${slug}`),
    asset: (scope, path) => assets.get(`${scope}/${path}`),
    file: (asset) => join(root, "files", asset.scope, asset.path),
    /** A response built once per snapshot; a failed or empty build is retried. */
    cached(key, build) {
      let entry = entries.get(key);
      if (!entry) {
        entry = measureStage(`query.build.${family(key)}`, build, report);
        entries.set(key, entry);
        entry.then(
          (value) => value || entries.delete(key),
          () => entries.delete(key),
        );
      }
      return entry;
    },
  };
}

/**
 * The snapshot `path` resolves to, held in memory. Each call follows the link
 * again and loads a new target first; a target that fails to load is reported
 * once and the previous snapshot keeps serving. Without any loaded snapshot
 * the call rejects.
 */
export function contentSnapshot(path, report = logTiming) {
  let current = null;
  let failed = null;
  let loading = null;
  return async function snapshot() {
    let root;
    try {
      root = await realpath(path);
    } catch (error) {
      if (!current) throw error;
      if (failed !== error.code)
        console.error(`Content snapshot ${path}: ${error.code}`);
      failed = error.code;
      return current;
    }
    if (root === current?.root) return current;
    if (root === failed) {
      if (current) return current;
      throw new Error("No content snapshot");
    }
    if (loading?.root !== root) {
      const pending = {
        root,
        promise: loadSnapshot(root, report).then(
          (loaded) => {
            if (loading !== pending) return;
            current = loaded;
            failed = null;
          },
          (error) => {
            if (loading !== pending) return;
            failed = root;
            console.error(`Content snapshot ${root}: ${error.message}`);
          },
        ),
      };
      loading = pending;
      pending.promise.finally(() => {
        if (loading === pending) loading = null;
      });
    }
    await loading.promise;
    if (!current) throw new Error("No content snapshot");
    return current;
  };
}
