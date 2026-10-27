import type { Server } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publishSnapshot } from "./content-snapshot.ts";
import { buildSnapshot } from "../../scripts/content/content-publish.ts";
import { writeSnapshot } from "../../scripts/content/content-snapshot.ts";
import { openRecords } from "../../server/web/records.ts";
import { createWebServer } from "../../server/web/web.ts";
import { withInstrumentChapters } from "./instrument-chapters.ts";
import { requireBrowserBuild } from "./browser-build.ts";

await requireBrowserBuild();
const directory = await mkdtemp(join(tmpdir(), "il-content-browser-"));
// One server per Playwright worker on consecutive ports, each with its own
// records file, all serving the same snapshot.
const [firstPort, count] = process.argv.slice(2).map(Number);
const records = Array.from({ length: count }, (_, i) =>
  openRecords(join(directory, `records-${i}.sqlite`)),
);
let servers: Server[] = [];
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    servers.map((server) => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
  for (const store of records) store.close();
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
  servers = records.map((store, i) => {
    const server = createWebServer({
      records: store,
      snapshot: join(releases, "current"),
    });
    server.listen(firstPort + i, "127.0.0.1");
    return server;
  });
} catch (error) {
  console.error((error as Error).message);
  await close();
  process.exitCode = 1;
}
