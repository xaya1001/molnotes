import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedImage } from "../server/release-image.mjs";

const revision = "a".repeat(40);
const digest = "b".repeat(64);
const repository = "ghcr.io/example/molnotes";

function inspectedImage({
  digests = [`${repository}@sha256:${digest}`],
  imageRevision = revision,
  architecture = "arm64",
  os = "linux",
} = {}) {
  return JSON.stringify({
    RepoDigests: digests,
    Config: { Labels: { "org.opencontainers.image.revision": imageRevision } },
    Architecture: architecture,
    Os: os,
  });
}

test("resolves the exact published ARM64 image for a main revision", () => {
  assert.equal(
    publishedImage(repository, revision, inspectedImage()),
    `${repository}@sha256:${digest}`,
  );
});

test("rejects an image with a different revision, repository, or platform", () => {
  assert.throws(() =>
    publishedImage(
      repository,
      revision,
      inspectedImage({ imageRevision: "c".repeat(40) }),
    ),
  );
  assert.throws(() =>
    publishedImage(
      repository,
      revision,
      inspectedImage({ digests: [`ghcr.io/example/other@sha256:${digest}`] }),
    ),
  );
  assert.throws(() =>
    publishedImage(
      repository,
      revision,
      inspectedImage({ architecture: "amd64" }),
    ),
  );
});

test("rejects missing or ambiguous published digests", () => {
  assert.throws(() =>
    publishedImage(repository, revision, inspectedImage({ digests: [] })),
  );
  assert.throws(() =>
    publishedImage(
      repository,
      revision,
      inspectedImage({
        digests: [
          `${repository}@sha256:${digest}`,
          `${repository}@sha256:${"c".repeat(64)}`,
        ],
      }),
    ),
  );
});
