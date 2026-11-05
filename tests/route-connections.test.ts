import { test } from "node:test";
import assert from "node:assert/strict";
import { routeConnection } from "../src/ui/library/arrow-layout.ts";
for (const [count, offset] of [
  [2, 512],
  [7, 512],
  [3, 0],
])
  test(`route connections stay between row boundaries across ${count} steps and ${offset}px horizontal offset`, () => {
    for (let i = 0; i < count - 1; i++) {
      const y = i * 352;
      const from = { left: 600, right: 680, top: y + 100, bottom: y + 200 };
      const to = {
        left: 600 - offset,
        right: 680 - offset,
        top: y + 450,
        bottom: y + 550,
      };
      const rowA = { left: 0, right: 900, top: y + 40, bottom: y + 220 };
      const rowB = { left: 0, right: 900, top: y + 420, bottom: y + 570 };
      const [start, a, b, end] = routeConnection(from, to, rowA, rowB, true);
      assert.ok(
        start.y > from.bottom,
        "start clears the product and its quantity",
      );
      assert.ok(end.y < to.top, "end clears the input");
      assert.equal(a.x, start.x);
      assert.equal(b.x, end.x);
      assert.equal(a.y, b.y);
      assert.ok(
        a.y > rowA.bottom && a.y < rowB.top,
        "horizontal segment lies in the row gap",
      );
    }
  });
test("connections between reactions on one row retain side entry", () => {
  const from = { left: 100, right: 180, top: 100, bottom: 200 },
    to = { left: 300, right: 380, top: 100, bottom: 200 };
  const row = { left: 0, right: 500, top: 50, bottom: 250 };
  const [start, a, b, end] = routeConnection(from, to, row, row, false);
  assert.ok(start.x > from.right);
  assert.ok(end.x < to.left);
  assert.equal(start.y, a.y);
  assert.equal(b.y, end.y);
});
