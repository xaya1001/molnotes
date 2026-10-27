import {
  pullUnit,
  pullRegistry,
  pullGlossary,
  committedSource,
  checkRepository,
} from "../server/content-files.mjs";
import {
  openDatabase,
  migrate,
  databaseUrl,
  databaseError,
} from "../server/database.mjs";
import { homedir, hostname, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { assetStore } from "../server/assets.mjs";
import { setting } from "./settings.mjs";
import {
  pushUnits,
  removeUnit,
  listUnits,
  publication,
  buildSnapshot,
} from "../server/content-publish.mjs";
import {
  writeSnapshot,
  publishSnapshot,
  rollbackSnapshot,
} from "../server/content-snapshot.mjs";

const usage =
  "Usage: content build <output> | publish [--rollback <commit>] | push <units...> | pull <unit|--all> | remove <unit> | list";
const root = setting("MOLNOTES_CONTENT_DIR");
const cache =
  process.env.MOLNOTES_ASSET_CACHE || join(homedir(), ".cache/molnotes/assets");

/** The user and host, then `MOLNOTES_PUSHER` when the environment names the session. */
function pusherName() {
  const parts = [`${userInfo().username}@${hostname()}`];
  if (process.env.MOLNOTES_PUSHER) parts.push(process.env.MOLNOTES_PUSHER);
  return parts.join(" ");
}

const [command, ...units] = process.argv.slice(2);
const [unit] = units;
const valid = {
  build: units.length === 1,
  publish:
    units.length === 0 || (units.length === 2 && units[0] === "--rollback"),
  push: units.length > 0,
  pull: units.length === 1,
  remove: units.length === 1,
  list: units.length === 0,
}[command];
if (!valid) {
  console.error(usage);
  process.exit(1);
}
// Snapshots need no database.
if (command === "build" || command === "publish") {
  try {
    if (command === "build") {
      const built = await buildSnapshot(root);
      await writeSnapshot(resolve(unit), built);
      console.log(`${unit}: built`);
    } else if (units.length) {
      const name = await rollbackSnapshot(
        setting("MOLNOTES_CONTENT_RELEASES"),
        units[1],
      );
      console.log(`current: ${name.slice(0, 7)}`);
    } else {
      const commit = await publishSnapshot(
        root,
        setting("MOLNOTES_CONTENT_RELEASES"),
      );
      console.log(`current: ${commit.slice(0, 7)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  process.exit();
}
const url = databaseUrl();
const pool = openDatabase(url);
try {
  // Every command works on the content repository; fail before touching the database.
  await checkRepository(root);
  await migrate(pool);
  if (command === "list")
    console.log(
      (await listUnits(pool))
        .map((row) => `${row.unit}  ${publication(row)}`)
        .join("\n"),
    );
  else if (command === "remove") {
    await removeUnit(pool, unit, {
      source: await committedSource(root, [unit], pusherName()),
    });
    console.log(`${unit}: removed`);
  } else if (command === "push") {
    const source = await committedSource(
      root,
      [...units, "sources.json", "glossary.json"],
      pusherName(),
    );
    const published = await pushUnits(pool, await assetStore(), root, units, {
      source,
    });
    console.log(
      `${units.join(", ")}: published from ${source.commit.slice(0, 7)}`,
    );
    for (const { unit, author } of published)
      if (author.length)
        console.log(
          `${unit} 作者资料（写作或修订这套笔记前先读）：\n` +
            author.map(({ file, title }) => `  ${file}  ${title}`).join("\n"),
        );
  } else {
    const store = await assetStore();
    const all = unit === "--all";
    const names = all ? (await listUnits(pool)).map((row) => row.unit) : [unit];
    for (const name of names) {
      await pullUnit(pool, store, root, name, cache);
      console.log(`${name}: exported`);
    }
    if (all && (await pullRegistry(pool, root)))
      console.log("sources.json: exported");
    if (all && (await pullGlossary(pool, root)))
      console.log("glossary.json: exported");
  }
} catch (error) {
  console.error(error.code ? databaseError(error, url).message : error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
