import { resolve } from "node:path";
import { setting } from "./settings.mjs";
import { buildSnapshot } from "../server/content-publish.mjs";
import {
  writeSnapshot,
  publishSnapshot,
  rollbackSnapshot,
} from "../server/content-snapshot.mjs";

const usage = "Usage: content build <output> | publish [--rollback <commit>]";
const [command, ...args] = process.argv.slice(2);
const valid = {
  build: args.length === 1,
  publish: args.length === 0 || (args.length === 2 && args[0] === "--rollback"),
}[command];
if (!valid) {
  console.error(usage);
  process.exit(1);
}
try {
  if (command === "build") {
    const built = await buildSnapshot(setting("MOLNOTES_CONTENT_DIR"));
    await writeSnapshot(resolve(args[0]), built);
    console.log(`${args[0]}: built`);
  } else if (args.length) {
    const name = await rollbackSnapshot(
      setting("MOLNOTES_CONTENT_RELEASES"),
      args[1],
    );
    console.log(`current: ${name.slice(0, 7)}`);
  } else {
    const commit = await publishSnapshot(
      setting("MOLNOTES_CONTENT_DIR"),
      setting("MOLNOTES_CONTENT_RELEASES"),
    );
    console.log(`current: ${commit.slice(0, 7)}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
