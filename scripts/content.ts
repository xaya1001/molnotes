import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { writerCommand } from "./content/writer.ts";
import { setting } from "../shared/settings.ts";
import { buildSnapshot } from "./content/content-publish.ts";
import { contentRequests } from "./content/requests.ts";
import {
  writeSnapshot,
  publishSnapshot,
  rollbackSnapshot,
} from "./content/content-snapshot.ts";

const usage =
  "Usage: content build <output> | publish [--rollback <commit>] | todo [<unit>] | series <directory> | check <note.md> [--glossary-additions <json>]";
const [command, ...args] = process.argv.slice(2);
const valid = {
  build: args.length === 1,
  publish: args.length === 0 || (args.length === 2 && args[0] === "--rollback"),
  todo: args.length <= 1,
  series: args.length === 1,
  check: args.length >= 1,
}[command];
if (!valid) {
  console.error(usage);
  process.exit(1);
}
try {
  const figureCache = join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "molnotes",
    "figure-proofs",
  );
  if (["series", "check"].includes(command)) {
    await writerCommand(setting("MOLNOTES_CONTENT_DIR"), command, args);
  } else if (command === "todo") {
    for (const request of await contentRequests(
      setting("MOLNOTES_CONTENT_DIR"),
      args[0],
    ))
      console.log(
        `${request.file}:${request.line}\t${request.kind}\t${request.caption}\t${request.skill}`,
      );
  } else if (command === "build") {
    const built = await buildSnapshot(setting("MOLNOTES_CONTENT_DIR"), {
      figureCache,
    });
    await writeSnapshot(resolve(args[0]), built);
    console.log(`${args[0]}: built`);
  } else if (args.length) {
    const name = await rollbackSnapshot(
      setting("MOLNOTES_CONTENT_RELEASES"),
      args[1],
    );
    console.log(`current: ${name}`);
  } else {
    const name = await publishSnapshot(
      setting("MOLNOTES_CONTENT_DIR"),
      setting("MOLNOTES_CONTENT_RELEASES"),
      {
        figureCache,
      },
    );
    console.log(`current: ${name}`);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
