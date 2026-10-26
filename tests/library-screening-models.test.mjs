import test from "node:test";
import assert from "node:assert/strict";
import { fbddMath as m } from "../src/ui/models/medicinal-chemistry.mjs";

const near = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}`,
  );

test("copy-number tails and the reads needed match the closed forms", () => {
  const p = 971 / 66201;
  near(m.probAtLeast(1, 100, p), 1 - (1 - p) ** 100, 1e-12, "k=1");
  near(m.probAtLeast(4, 100, p), 0.0602, 0.0005, "k=4, 100 reads");
  assert.equal(m.probAtLeast(0, 10, p), 1);
  assert.equal(m.probAtLeast(4, 3, p), 0);
  const needed = m.readsNeeded(4, p, 0.95);
  assert.equal(needed, 527);
  assert.ok(m.probAtLeast(4, needed, p) >= 0.95);
  assert.ok(m.probAtLeast(4, needed - 1, p) < 0.95);
  assert.throws(() => m.probAtLeast(1, 10, 1.5), /0 到 1/);
  near(m.keptShare(821, 65230), 0.012, 0.001, "Aurora A kept share");
  near(m.keptShare(61929, 190363), 0.33, 0.005, "p38 kept share");
  assert.throws(() => m.keptShare(70000, 65230), /总读数/);
});

test("concentrations print in the unit that keeps them readable", () => {
  assert.equal(m.formatMolar(2e-10), "200 pM");
  assert.equal(m.formatMolar(1.29e-6), "1.29 µM");
  assert.equal(m.formatMolar(0.3e-3), "300 µM");
  assert.equal(m.formatMolar(19e-9), "19 nM");
  assert.throws(() => m.formatMolar(0), /为正/);
});

test("regions and positions a reader marked are judged against the checked atoms", () => {
  assert.equal(m.regionMatch([], [1, 2]), "none");
  assert.equal(m.regionMatch([1, 2], [1, 2, 3]), "all");
  assert.equal(m.regionMatch([1, 9], [1, 2, 3]), "some");
  assert.equal(m.regionMatch([9], [1, 2, 3]), "none");
  assert.equal(m.positionsFound([0, 6], [0, 6]), 2);
  assert.equal(m.positionsFound([0, 3], [0, 6]), 1);
  assert.equal(m.positionsFound([0, 0], [0, 6]), 1);
});

test("split-and-pool size, enrichment and round projection use explicit counts", () => {
  assert.equal(m.libraryComponents([10, 20, 30]), 6000);
  assert.equal(m.enrichment(10, 1000, 10000), 100);
  const control = { copies: 100, reads: 10000, library: 1000000, rounds: 3 };
  assert.ok(Math.abs(m.shareAfterRounds(3, control) - 0.01) < 1e-12);
  assert.ok(m.shareAfterRounds(1, control) < m.shareAfterRounds(3, control));
  assert.throws(() => m.shareAfterRounds(4, control));
  assert.throws(() => m.libraryComponents([10, 0]));
});

test("linking energy and ligand efficiency use molar concentrations", () => {
  const cost = m.linkingCost(1e-3, 1e-4, 1e-6);
  assert.ok(Math.abs(cost.ideal - 1e-7) < 1e-20);
  assert.ok(Math.abs(cost.ratio - 10) < 1e-12);
  assert.ok(
    Math.abs(cost.energy - 0.001987204 * 298.15 * Math.log(10)) < 1e-10,
  );
  assert.equal(m.ligandEfficiency(1e-6, 20), (1.37 * 6) / 20);
});
