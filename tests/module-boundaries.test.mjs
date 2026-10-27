import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentSnapshot } from "../server/web/content-cache.mjs";

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
            ["content-publish.mjs", "content-files.mjs", "citations.mjs", "patent-assets.mjs", "notes-index.ts"].includes(specifier.split("/").at(-1)))
          throw new Error('Reading boundary imported publication or browser dependency: ' + specifier);
        return next(specifier, context);
      },
    });
    const { createRecordCodec } = await import(${JSON.stringify(new URL("../src/contracts/records.ts", import.meta.url).href)});
    const codec = createRecordCodec({ chapterIds: [], quiz: [], extras: {} });
    codec.parseRecords({ version: 1, ...codec.empty() });
    await import(${JSON.stringify(new URL("../server/web/web.mjs", import.meta.url).href)});
  `,
    ],
    { stdio: "pipe" },
  );
});

test("content responses are shared per snapshot and failed builds are retried", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-content-cache-"));
  try {
    for (const name of ["one", "two"]) {
      await mkdir(join(root, name));
      await writeFile(
        join(root, name, "snapshot.json"),
        JSON.stringify({
          format: 1,
          topics: [],
          directories: [],
          notes: [],
          glossary: [],
          registry: null,
          assets: [],
        }),
      );
    }
    await symlink("one", join(root, "current"));
    const content = contentSnapshot(join(root, "current"));
    const one = await content();
    let rejectOld;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const old = one.cached("topic", () => {
      started();
      return new Promise((_, reject) => {
        rejectOld = reject;
      });
    });
    const rejected = assert.rejects(old, /build failed/);
    await ready;
    await rm(join(root, "current"));
    await symlink("two", join(root, "current"));
    const two = await content();
    assert.notEqual(two, one);
    let builds = 0;
    const build = async () => {
      builds++;
      return { title: "current" };
    };
    const [first, second] = await Promise.all([
      two.cached("topic", build),
      two.cached("topic", build),
    ]);
    assert.equal(first, second);
    assert.equal(builds, 1);
    rejectOld(new Error("build failed"));
    await rejected;
    assert.equal(await (await content()).cached("topic", build), first);
    assert.equal(builds, 1);
    await assert.rejects(
      two.cached("retry", async () => {
        throw new Error("unavailable");
      }),
      /unavailable/,
    );
    assert.deepEqual(await two.cached("retry", build), { title: "current" });
    assert.equal(builds, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
