import test from "node:test";
import assert from "node:assert/strict";
import { assertCheckedParent } from "../scripts/checked-workflow.ts";

const revision = "a".repeat(40);
const success = {
  id: 10,
  head_sha: revision,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
};
test("only the latest successful main push can authorize parent image reuse", () => {
  assert.doesNotThrow(() => assertCheckedParent([success], revision));
  for (const changes of [
    { head_sha: "b".repeat(40) },
    { head_branch: "topic" },
    { event: "pull_request" },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { status: "in_progress" },
  ])
    assert.throws(() =>
      assertCheckedParent([{ ...success, ...changes }], revision),
    );
  assert.throws(() => assertCheckedParent([], revision));
  assert.throws(() =>
    assertCheckedParent(
      [success, { ...success, id: 11, conclusion: "failure" }],
      revision,
    ),
  );
});
