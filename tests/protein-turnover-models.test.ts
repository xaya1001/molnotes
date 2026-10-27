import test from "node:test";
import assert from "node:assert/strict";
import {
  degradation,
  absoluteHalfLoss,
  proteinAt,
} from "../src/ui/models/biochemical-kinetics.ts";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";

test("Protein degradation curve distinguishes half-maximal response from absolute loss", () => {
  assert.equal(degradation(40, 10, 10), 20);
  assert.equal(absoluteHalfLoss(40, 10), null);
  assert.equal(absoluteHalfLoss(50, 10), null);
  const dc = absoluteHalfLoss(90, 10);
  assert.equal(dc, 12.5);
  assert.equal(degradation(90, 10, dc), 50);
  assert.equal(degradation(90, 10, 0), 0);
});

test("constant synthesis gives baseline, drug steady state and continuous washout recovery", () => {
  assert.equal(proteinAt(0, 24, 0.25, 24), 100);
  assert.equal(proteinAt(48, 24, 0, 24), 100);
  const at = proteinAt(24, 24, 0.25, 24);
  assert.ok(at > 0 && at < 15);
  assert.ok(Math.abs(proteinAt(24 + 1e-7, 24, 0.25, 24) - at) < 1e-5);
  assert.ok(Math.abs(proteinAt(48, 24, 0.25, 24) - (100 + at) / 2) < 1e-9);
  assert.ok(proteinAt(72, 24, 0.25, 24) > proteinAt(48, 24, 0.25, 24));
  assert.equal(proteinAt(48, 24, 0.25, 0), 100);
});

test("Protein turnover lab defaults preserve the original turnover and dose readouts", () => {
  const turnover = labModels["protein-turnover"];
  const result = turnover().run(
    Object.fromEntries(
      (turnover().inputs as LabInput[]).map((i) => [i.id, i.default]),
    ),
  );
  assert.equal(result.summary!, "24 h 总蛋白：10.5%；48 h 总蛋白：55.2%。");
  assert.equal(result.charts![0].points!.length, 145);
  const dose = labModels["protein-loss-curve"];
  assert.equal(
    dose().run(
      Object.fromEntries(
        (dose().inputs as LabInput[]).map((i) => [i.id, i.default]),
      ),
    ).summary!,
    "在 K = 10 nM 时下降 45%；绝对 50% 损失浓度：12.50 nM。",
  );
});
