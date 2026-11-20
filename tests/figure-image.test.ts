import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerImage } from "../scripts/figure-image.ts";
import { buildSnapshot } from "../scripts/content/content-publish.ts";

test("image registration builds readable assets and reuses identical bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "figure-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "sample.png");
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(file, bytes);
  await writeFile(join(root, "glossary.json"), "[]");
  await writeFile(join(root, "prose-terms.json"), "[]");
  const metadata = {
    title: "Sample counts",
    sources: [
      { source: "unknown", locator: "Authored sample", note: "Test data" },
    ],
    purpose: "Compare counts",
    rights: "Generated test fixture",
    alt: "Sample point",
  };
  const prompt = "Draw one sample point.";
  const id = await registerImage(file, root, metadata, prompt);
  const built = await buildSnapshot(root);
  t.after(() => built.dispose());
  assert.deepEqual(built.snapshot.library?.entries[id], {
    ...metadata,
    prompt,
    kind: "image",
    id,
    asset: `${id.slice(4)}.png`,
    mime: "image/png",
    width: 1,
    height: 1,
  });
  const asset = built.snapshot.assets.find(
    (asset) =>
      asset.scope === "library" && asset.path.endsWith(`${id.slice(4)}.png`),
  );
  assert.ok(asset);
  assert.equal(asset.size, bytes.length);
  assert.equal(await registerImage(file, root, metadata, prompt), id);
  assert.deepEqual(await readdir(join(root, "library/images")), [`${id}.json`]);
  assert.deepEqual(await readdir(join(root, "library/assets")), [
    `${id.slice(4)}.png`,
  ]);
});
