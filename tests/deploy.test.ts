import assert from "node:assert/strict";
import test from "node:test";
import { deployRevision } from "../server/system/deploy.ts";
import { systemConfig } from "../server/system/system-config.ts";

const revision = "a".repeat(40);
const config = systemConfig({
  MOLNOTES_CHECKOUT: "/unused/checkout",
  MOLNOTES_GITHUB_REPOSITORY: "example/site",
  MOLNOTES_ORIGIN: "https://site.example.test",
  MOLNOTES_CONTAINER: "sample-web",
  MOLNOTES_COMPOSE_FILE: "/unused/compose.yml",
  MOLNOTES_SYSTEM_SOCKET: "/unused/system.sock",
  MOLNOTES_DEPLOY_LOG_DIR: "/unused/logs",
  MOLNOTES_RELEASE_ROOT: "/unused/releases",
});
const current = `${config.image}@sha256:${"b".repeat(64)}`;
const previous = `${config.image}@sha256:${"c".repeat(64)}`;

function fixture(fail = "") {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      command: async (file: string, args: string[]) => {
        // The stage name is deliberately absent from the command executor.
        const operation = `${file} ${args.join(" ")}`;
        calls.push(operation);
        if (fail && operation.includes(fail)) throw new Error("command failed");
        if (args.includes("ls-remote")) return `${revision}\trefs/heads/main`;
        if (file === "gh" && args[0] === "run")
          return JSON.stringify([
            {
              headSha: revision,
              status: "completed",
              conclusion: "success",
              event: "push",
            },
          ]);
        if (args.includes("--show-current")) return "main";
        if (args[0] === "rev-parse") return revision;
        if (args[0] === "inspect") {
          if (args.at(-1) === "{{.Config.Image}}") return previous;
          if (args.at(-1) === "{{.Config.Image}}|{{.State.Health.Status}}")
            return `${previous}|healthy`;
          return `${current}|${revision}|healthy`;
        }
        if (args[0] === "image" && args[1] === "inspect") {
          if (args.includes("--format"))
            return `sha256:${"d".repeat(64)}\nsha256:${"e".repeat(64)}`;
          return JSON.stringify([
            {
              Config: {
                Labels: { "org.opencontainers.image.revision": revision },
              },
              Os: "linux",
              Architecture: "arm64",
              RepoDigests: [current],
            },
          ]);
        }
        if (args[0] === "image" && args[1] === "ls")
          return JSON.stringify({
            Repository: config.image,
            ID: `sha256:${"f".repeat(64)}`,
          });
        if (args[0] === "exec") {
          const route = args.at(-1)!;
          if (route.endsWith("/api/catalog"))
            return JSON.stringify({ sites: [], groups: [], directories: [] });
          if (route.endsWith("/")) return "<!doctype html><html></html>";
        }
        return "";
      },
      prepare: async () => "unused-release",
      activate: async () => {
        calls.push("activate");
        if (fail === "activate") throw new Error("activation failed");
        return { previous: "0".repeat(40), current: revision };
      },
    },
  };
}

test("successful deployment retains images only after verification and activation", async () => {
  const h = fixture();
  const result = await deployRevision(config, revision, h.dependencies);
  assert.equal(result.result, "success");
  assert.deepEqual(result.images.removed, [`sha256:${"f".repeat(64)}`]);
  assert.ok(
    h.calls.findIndex((call) => call.startsWith("docker image ls")) >
      h.calls.indexOf("activate"),
  );
});

test("deployment and rollback paths never clean images after a failure", async () => {
  for (const fail of [
    "compose",
    "/api/catalog",
    "org.opencontainers.image.revision",
    "activate",
  ]) {
    const h = fixture(fail);
    await assert.rejects(deployRevision(config, revision, h.dependencies));
    assert.ok(
      !h.calls.some(
        (call) =>
          call.startsWith("docker image ls") ||
          call.startsWith("docker image rm"),
      ),
    );
  }
});

test("image cleanup failure preserves successful deployment and does not roll back", async () => {
  const h = fixture("image rm");
  const result = await deployRevision(config, revision, h.dependencies);
  assert.equal(result.result, "success");
  assert.equal(result.images.failures.length, 1);
  assert.equal(
    h.calls.filter((call) => call.startsWith("docker compose")).length,
    1,
  );
});
