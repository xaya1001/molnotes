import assert from "node:assert/strict";
import test from "node:test";
import { retainImages } from "../server/system/image-retention.ts";

const repository = "ghcr.io/example/site";
const id = (value: string) => `sha256:${value.repeat(64)}`;
const current = `${repository}@${id("a")}`;
const previous = `${repository}@${id("b")}`;

function fixture({ same = false, fail = "" } = {}) {
  const removed: string[] = [];
  const run = async (name: string, file: string, args: string[]) => {
    assert.equal(file, "docker");
    assert.ok(!args.includes("--force"));
    if (name === fail) throw new Error("private command output");
    if (name === "images.keep") {
      assert.deepEqual(args, [
        "image",
        "inspect",
        current,
        previous,
        "--format",
        "{{.Id}}",
      ]);
      return `${id("a")}\n${same ? id("a") : id("b")}`;
    }
    if (name === "images.list") {
      assert.equal(args.at(-1), repository);
      return [
        [repository, id("c")],
        [repository, id("b")],
        [repository, id("a")],
        [repository, id("c")],
        [`${repository}-other`, id("d")],
      ]
        .map(([Repository, ID]) => JSON.stringify({ Repository, ID }))
        .join("\n");
    }
    assert.equal(name, "images.remove");
    assert.deepEqual(args.slice(0, 2), ["image", "rm"]);
    removed.push(args[2]);
    return "";
  };
  return { run, removed };
}

test("keeps the exact deployed and previous image IDs and removes only repository candidates once", async () => {
  const h = fixture();
  const result = await retainImages(h.run, repository, current, previous);
  assert.deepEqual(result, {
    kept: [id("a"), id("b")],
    removed: [id("c")],
    failures: [],
  });
  assert.deepEqual(h.removed, [id("c")]);
});

test("redeploying the same image retains a single image ID", async () => {
  const h = fixture({ same: true });
  const result = await retainImages(h.run, repository, current, previous);
  assert.deepEqual(result.kept, [id("a")]);
  assert.deepEqual(h.removed, [id("c"), id("b")]);
});

test("records deletion failures without retrying or exposing raw errors", async () => {
  const h = fixture({ fail: "images.remove" });
  const result = await retainImages(h.run, repository, current, previous);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.failures, [
    { image: id("c"), reason: "operation_failed" },
  ]);
});

test("an inventory or retained-image lookup failure leaves images untouched", async () => {
  for (const fail of ["images.keep", "images.list"]) {
    const h = fixture({ fail });
    const result = await retainImages(h.run, repository, current, previous);
    assert.deepEqual(h.removed, []);
    assert.deepEqual(result.failures, [
      { image: null, reason: "operation_failed" },
    ]);
  }
});
