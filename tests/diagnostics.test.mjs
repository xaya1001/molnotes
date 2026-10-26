import test from "node:test";
import assert from "node:assert/strict";
import { runCommand, deploymentFailure } from "../server/deploy-command.mjs";
import { measureStage } from "../server/stage-timing.mjs";
import { contentCache } from "../server/content-cache.mjs";

const node = (source, options) =>
  runCommand(process.execPath, ["-e", source], options);

test("deployment commands preserve output but classify failures without exposing inputs or stderr", async () => {
  assert.equal(await node("process.stdout.write(' ready \\n')"), "ready");
  for (const [message, category] of [
    ["unauthorized", "access_denied"],
    ["no space left on device", "disk_full"],
    ["container unhealthy", "unhealthy"],
    ["could not resolve host", "network"],
    ["manifest unknown", "image_missing"],
    ["unexpected error", "command_failed"],
  ]) {
    const secret = "private-test-credential";
    await assert.rejects(
      node(
        `console.error(${JSON.stringify(message + " " + secret)}); process.exit(2)`,
        { input: secret },
      ),
      (error) => {
        assert.equal(error.message, category);
        assert.deepEqual(error.diagnostic, {
          category,
          exitCode: 2,
          signal: null,
        });
        assert.ok(!JSON.stringify(error).includes(secret));
        assert.ok(!error.stack.includes(secret));
        return true;
      },
    );
  }
  await assert.rejects(runCommand("/nonexistent/il-diagnostic-command", []), {
    message: "executable_missing",
  });
  await assert.rejects(node("setInterval(() => {}, 1000)", { timeout: 50 }), {
    message: "timeout",
  });
});

test("stage timings preserve values and errors and report only stage, outcome and duration", async () => {
  const events = [];
  const report = (event) => events.push(event);
  const value = {};
  assert.equal(
    await measureStage("test.success", async () => value, report),
    value,
  );
  const failure = new Error("private input");
  await assert.rejects(
    measureStage(
      "test.failure",
      async () => {
        throw failure;
      },
      report,
    ),
    (error) => error === failure,
  );
  assert.deepEqual(
    events.map(({ stage, result }) => ({ stage, result })),
    [
      { stage: "test.success", result: "success" },
      { stage: "test.failure", result: "failed" },
    ],
  );
  for (const event of events) {
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    assert.deepEqual(Object.keys(event).sort(), [
      "durationMs",
      "result",
      "stage",
    ]);
  }
});

test("query timing records cold builds only and never includes content identifiers", async () => {
  const events = [];
  let revision = 1;
  const query = async () => ({ rows: [{ revision }] });
  const cache = contentCache(
    { query, connect: async () => ({ query, release() {} }) },
    (event) => events.push(event),
  );
  const build = async () => ({ value: "private content" });
  await Promise.all([
    cache("/api/topics/private-slug", build),
    cache("/api/topics/private-slug", build),
  ]);
  await cache("/api/topics/private-slug", build);
  assert.equal(events.length, 1);
  revision++;
  await cache("/api/topics/private-slug", build);
  assert.equal(events.length, 2);
  assert.ok(events.every((event) => event.stage === "query.build.topic"));
  assert.ok(!JSON.stringify(events).includes("private"));
});

test("deployment receipts preserve both failures without serializing arbitrary error messages", () => {
  const first = Object.assign(new Error("private command output"), {
    stage: "deploy.compose",
    diagnostic: { category: "unhealthy", exitCode: 1, signal: null },
  });
  const rollback = Object.assign(new Error("private URL"), {
    stage: "rollback.smoke",
  });
  const receipt = deploymentFailure(
    new AggregateError([first, rollback], "private details"),
  );
  assert.equal(receipt.reason, "deployment_and_rollback_failed");
  assert.deepEqual(receipt.failures, [
    {
      stage: "deploy.compose",
      category: "unhealthy",
      exitCode: 1,
      signal: null,
    },
    { stage: "rollback.smoke" },
  ]);
  assert.ok(!JSON.stringify(receipt).includes("private"));
  assert.equal(deploymentFailure(rollback).reason, "operation_failed");
});
