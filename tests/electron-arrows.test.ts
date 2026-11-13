import { test } from "node:test";
import assert from "node:assert/strict";
import {
  electronArrowShapes,
  chargeMarks,
} from "../src/ui/library/electron-arrows.ts";
import { placeArrowFragments } from "../scripts/figure-fragments.ts";
import type { Point } from "../shared/chemical-library/types.ts";
const B = 32;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

test("circled donor charges use the reaction direction in an open surrounding", () => {
  const box = { left: -5, right: 5, top: -7, bottom: 7 };
  const marks = chargeMarks(
    {
      donor: { x: 0, y: 0 },
      acceptor: { x: 80, y: 0 },
    },
    [],
    { donor: box },
    { donor: -1 },
    { donor: { x: 80, y: 0 } },
    B,
    20,
  );
  const mark = marks.donor;
  assert.ok(mark.point.x > 0);
  const reverse = chargeMarks(
    { donor: { x: 0, y: 0 }, acceptor: { x: -80, y: 0 } },
    [],
    { donor: box },
    { donor: -1 },
    { donor: { x: -80, y: 0 } },
    B,
    20,
  );
  assert.ok(reverse.donor.point.x < 0);
});

test("forming arrows retain the new bond midpoint with clearance", () => {
  const atoms = {
    a: { point: { x: 0, y: 0 }, labelled: true },
    b: { point: { x: 100, y: 0 }, labelled: false },
  };
  const [shape] = electronArrowShapes(
    [
      {
        arrow: {
          id: "new",
          from: { kind: "charge", at: { molecule: "m", atom: "a" } },
          to: {
            kind: "formingBond",
            atoms: [
              { molecule: "m", atom: "a" },
              { molecule: "m", atom: "b" },
            ],
          },
          electrons: 2,
        },
        from: { kind: "charge", atoms: ["a"], point: atoms.a.point },
        to: { kind: "formingBond", atoms: ["a", "b"], point: { x: 50, y: 0 } },
      },
    ],
    atoms,
    [],
    [],
    B,
    20,
  );
  assert.ok(shape);
  assert.equal(shape.vertices[0].x, 50);
  assert.ok(Math.abs(shape.vertices[0].y) <= B * 0.22);
});

test("homolysis separates bond origins and draws one barb per electron", () => {
  const atoms = {
    a: { point: { x: 0, y: 0 }, labelled: false },
    b: { point: { x: B, y: 0 }, labelled: false },
  };
  const from = {
    kind: "bond" as const,
    atoms: [
      { molecule: "m", atom: "a" },
      { molecule: "m", atom: "b" },
    ] as [
      { molecule: string; atom: string },
      { molecule: string; atom: string },
    ],
  };
  const shapes = electronArrowShapes(
    ["a", "b"].map((id) => ({
      arrow: {
        id,
        from,
        to: { kind: "atom", at: { molecule: "m", atom: id } },
        electrons: 1,
      },
      from: { kind: "bond", atoms: ["a", "b"], point: { x: B / 2, y: 0 } },
      to: { kind: "atom", atoms: [id], point: atoms[id as "a" | "b"].point },
    })),
    atoms,
    [["a", "b"]],
    [],
    B,
    20,
  );
  assert.ok(shapes[0] && shapes[1]);
  assert.ok(distance(shapes[0].points[0], shapes[1].points[0]) > B * 0.2);
  assert.deepEqual(
    shapes.map((s) => s!.vertices.length),
    [3, 3],
  );
});

test("two reacting ends fold together and face the second fragment evenly", () => {
  const input = [
    { x: -1.5, y: -0.8 },
    { x: -0.5, y: 0 },
    { x: 0.5, y: 0 },
    { x: 1.5, y: 0.8 },
    { x: 0, y: 4 },
    { x: 1, y: 4 },
  ];
  const graph = {
    atoms: Array.from({ length: 6 }, () => ({})),
    bonds: [
      { atoms: [0, 1] as [number, number], bo: 2 },
      { atoms: [1, 2] as [number, number] },
      { atoms: [2, 3] as [number, number], bo: 2 },
      { atoms: [4, 5] as [number, number], bo: 2 },
    ],
  };
  const placed = placeArrowFragments(graph, input, [
    [0, 4],
    [3, 5],
  ]);
  assert.ok(
    distance(placed[0], placed[3]) < distance(input[0], input[3]) - 0.1,
  );
  assert.ok(Math.abs(placed[0].y - placed[3].y) < 1e-6);
  assert.ok(
    Math.abs(distance(placed[0], placed[4]) - distance(placed[3], placed[5])) <
      1e-6,
  );
});
