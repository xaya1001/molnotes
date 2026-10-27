import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publishSnapshot } from "./content-snapshot.mjs";
import { buildSnapshot } from "../../server/content-publish.mjs";
import { writeSnapshot } from "../../server/content-snapshot.mjs";
import { openRecords } from "../../server/records.mjs";
import { createWebServer } from "../../server/web.mjs";
import { withInstrumentChapters } from "./instrument-chapters.mjs";
import { requireBrowserBuild } from "./browser-build.mjs";

await requireBrowserBuild();
const directory = await mkdtemp(join(tmpdir(), "il-content-browser-"));
const records = openRecords(join(directory, "records.sqlite"));
let server;
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  records.close();
  await rm(directory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void close().then(() => process.exit(0)));
try {
  const content = join(directory, "content");
  await cp(resolve("tests/fixtures/content"), content, { recursive: true });
  const instruments = join(content, "sites/instruments/content.json");
  await writeFile(
    instruments,
    JSON.stringify(
      withInstrumentChapters(JSON.parse(await readFile(instruments, "utf8"))),
    ),
  );
  const releases = join(directory, "releases");
  await publishSnapshot(releases, async (snapshot) =>
    writeSnapshot(
      snapshot,
      await buildSnapshot(content, {
        shelf: {
          materials: resolve("tests/fixtures/shelf"),
          cache: join(directory, "shelf-cache"),
        },
      }),
    ),
  );
  server = createWebServer({
    records,
    snapshot: join(releases, "current"),
  });
  server.listen(Number(process.argv[2]), "127.0.0.1");
} catch (error) {
  console.error(error.message);
  await close();
  process.exitCode = 1;
}
