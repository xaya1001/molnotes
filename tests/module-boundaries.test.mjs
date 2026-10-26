import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { contentCache } from "../server/content-cache.mjs";

test("reading and record validation load without browser state or publication compilers", () => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, next) {
        if (["vue", "@vue", "@rdkit", "markdown-it", "markdown-it-cjk-friendly", "katex", "yaml"].includes(specifier.split("/")[0]) ||
            ["content-publish.mjs", "content-files.mjs", "citations.mjs", "patent-assets.mjs", "notes-index.mjs"].includes(specifier.split("/").at(-1)))
          throw new Error('Reading boundary imported publication or browser dependency: ' + specifier);
        return next(specifier, context);
      },
    });
    const { createRecordCodec } = await import(${JSON.stringify(new URL("../src/contracts/records.ts", import.meta.url).href)});
    const codec = createRecordCodec({ chapterIds: [], quiz: [], extras: {} });
    codec.parseRecords({ version: 1, ...codec.empty() });
    await import(${JSON.stringify(new URL("../server/web.mjs", import.meta.url).href)});
  `,
    ],
    { stdio: "pipe" },
  );
});

test("content cache shares builds and isolates failures across publication revisions", async () => {
  let revision = 1;
  let releases = 0;
  const query = async () => ({ rows: [{ revision }] });
  const cache = contentCache({
    query,
    connect: async () => ({
      query,
      release() {
        releases++;
      },
    }),
  });
  let rejectOld;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const oldBuild = () => {
    started();
    return new Promise((_, reject) => {
      rejectOld = reject;
    });
  };
  const old = cache("topic", oldBuild);
  const rejected = assert.rejects(old, /publication failed/);
  await ready;
  revision++;
  let builds = 0;
  const build = async () => {
    builds++;
    return { title: "current" };
  };
  const [first, second] = await Promise.all([
    cache("topic", build),
    cache("topic", build),
  ]);
  assert.equal(first, second);
  assert.equal(builds, 1);
  rejectOld(new Error("publication failed"));
  await rejected;
  assert.equal(await cache("topic", build), first);
  assert.equal(builds, 1);
  assert.equal(releases, 2);
  await assert.rejects(
    cache("retry", async () => {
      throw new Error("unavailable");
    }),
    /unavailable/,
  );
  assert.deepEqual(await cache("retry", build), { title: "current" });
  assert.equal(builds, 2);
});
