import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutRoute,
  type RouteMolecule,
  type RouteLayoutStep,
} from "../src/ui/library/route-layout.ts";
const molecule = (key: string, width = 50): RouteMolecule => ({
  width,
  top: 20,
  bottom: 35,
  label: [key],
  text: [key],
  structure: true,
});
const step = (id: string, from: string[], to: string[]): RouteLayoutStep => ({
  id,
  from: from.map((id) => ({ id })),
  to: to.map((id) => ({ id })),
  above: [],
  below: [],
});
const options = (width: number, serpentine = false) => ({
  width,
  bond: 10,
  gap: 8,
  serpentine,
  text: (lines: string[]) => ({
    width: Math.max(0, ...lines.map((l) => l.length * 6)),
    height: lines.length * 10,
    lines,
  }),
});
const molecules = Object.fromEntries(
  ["a", "b", "c", "d", "e", "f"].map((k) => [k, molecule(k)]),
);

test("wrapped linear routes continue at an arrow without redrawing the previous product", () => {
  const result = layoutRoute(
    [
      step("one", ["a"], ["b"]),
      step("two", ["b"], ["c"]),
      step("three", ["c"], ["d"]),
    ],
    molecules,
    options(180),
  );
  assert.equal(result.items.filter((i) => i.kind === "molecule").length, 4);
  const arrows = result.items.filter((i) => i.kind === "arrow");
  assert.equal(arrows.length, 3);
  assert.ok(arrows[1].points![0].y > arrows[0].points![0].y);
  assert.equal(arrows[1].points![0].x, 0);
});
test("serpentine routes turn downward and continue in the reverse direction", () => {
  const result = layoutRoute(
    [
      step("one", ["a"], ["b"]),
      step("two", ["b"], ["c"]),
      step("three", ["c"], ["d"]),
    ],
    molecules,
    options(180, true),
  );
  const arrows = result.items.filter((i) => i.kind === "arrow");
  assert.equal(arrows[1].points![0].x, arrows[1].points![1].x);
  assert.ok(arrows[1].points![1].y > arrows[1].points![0].y);
  assert.ok(arrows[2].points![1].x < arrows[2].points![0].x);
});
test("two branches of the same fork align their terminal structures before joining", () => {
  const result = layoutRoute(
    [
      step("one", ["a"], ["b"]),
      step("two", ["b"], ["c"]),
      step("three", ["a"], ["d"]),
      step("four", ["c", "d"], ["e"]),
    ],
    molecules,
    options(900),
  );
  const terminal = (key: string) =>
    result.items.find((i) => i.kind === "molecule" && i.key === key)!;
  assert.equal(terminal("c").at.x, terminal("d").at.x);
  assert.notEqual(terminal("c").at.y, terminal("d").at.y);
  assert.equal(
    result.items.filter((i) => i.kind === "molecule" && i.key === "a").length,
    1,
  );
  assert.equal(result.connections.length, 2);
  assert.equal(result.items.filter((i) => i.kind === "plus").length, 1);
});
test("a short branch reverses into a downward convergence when the product cannot fit at the right", () => {
  const result = layoutRoute(
    [
      step("one", ["a"], ["b"]),
      step("two", ["c"], ["d"]),
      step("three", ["b", "d"], ["e"]),
    ],
    { ...molecules, e: molecule("e", 220) },
    options(390),
  );
  const arrows = result.items.filter((i) => i.kind === "arrow");
  assert.ok(arrows[1].points![1].x < arrows[1].points![0].x);
  assert.equal(arrows[2].points![0].x, arrows[2].points![1].x);
  assert.ok(arrows[2].points![1].y > arrows[2].points![0].y);
  assert.ok(result.width <= 390);
});

test("downward arrows reserve side space for boxed reagents and their conditions", () => {
  const second = step("two", ["b", "d"], ["c"]);
  second.from[1].show = "box";
  second.turn = "down";
  second.above = ["Catalyst"];
  const result = layoutRoute(
    [step("one", ["a"], ["b"]), second],
    molecules,
    options(400),
  );
  const arrow = result.items.find(
    (i) => i.kind === "arrow" && i.step === "two",
  )!;
  const box = arrow.boxes![0];
  assert.ok(box.at.x > arrow.points![0].x);
  assert.ok(box.at.y - molecules.d.top > arrow.points![0].y);
  assert.ok(box.at.y + molecules.d.bottom < arrow.points![1].y);
  assert.ok(arrow.width >= options(400).text(second.above).width);
});
