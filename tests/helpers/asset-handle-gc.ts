import { once } from "node:events";
import { get } from "node:http";
import { setImmediate, setTimeout } from "node:timers/promises";
import { createWebServer } from "../../server/web/web.ts";
import { openRecords } from "../../server/web/records.ts";

const collect = globalThis.gc;
if (!collect) throw new Error("GC must be exposed");
const records = openRecords(":memory:");
const server = createWebServer({ records, snapshot: process.argv[2] });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("No address");
const url = `http://127.0.0.1:${address.port}/sites/test/static/movie.mp4`;
try {
  for (let batch = 0; batch < 12; batch++) {
    await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<void>((resolve, reject) => {
            const request = get(url, (response) => {
              response.once("data", () => {
                response.destroy();
                resolve();
              });
              response.on("error", () => {});
            });
            request.on("error", reject);
          }),
      ),
    );
    await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          new Promise<void>((resolve) => {
            const request = get(url, { agent: false }, (response) =>
              response.resume(),
            );
            request.on("error", () => {});
            request.once("close", () => resolve());
            request.once("finish", () => {
              void setImmediate().then(() => request.destroy());
            });
          }),
      ),
    );
    await setTimeout(5);
    collect();
    await setImmediate();
  }
  const response = await fetch(url, { headers: { Range: "bytes=0-9" } });
  if (response.status !== 206 || (await response.text()) !== "0123456789")
    throw new Error("Asset service failed after aborted reads");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  records.close();
}
for (let i = 0; i < 10; i++) {
  collect();
  await setImmediate();
}
