import assert from "node:assert/strict";
import { test } from "node:test";
import { phrases } from "../src/ui/diagrams/model.ts";

test("figure labels break between phrases, never before closing or after opening punctuation", () => {
  assert.deepEqual(phrases("布立马胺：只堵不启动，口服不行"), [
    ["布立马胺：", "只堵不启动，", "口服不行"],
  ]);
  assert.deepEqual(
    phrases("H2 受体命名（布立马胺在人身上证明）\n西咪替丁合成"),
    [["H2 受体命名", "（布立马胺在人身上证明）"], ["西咪替丁合成"]],
  );
  assert.deepEqual(phrases("IC50 为 90 nM，对照 200 nM，强 1.5 倍"), [
    ["IC50 为 90 nM，", "对照 200 nM，", "强 1.5 倍"],
  ]);
  assert.deepEqual(phrases("管理局有条件批准 Enovid 用于避孕"), [
    ["管理局有条件批准 ", "Enovid ", "用于避孕"],
  ]);
  assert.deepEqual(phrases("4 年，200 多个类似物"), [
    ["4 年，", "200 多个类似物"],
  ]);
  assert.deepEqual(phrases("88,000 到 139,000 例，股价跌 26.8%，大了 1.5 倍"), [
    ["88,000 到 139,000 例，", "股价跌 26.8%，", "大了 1.5 倍"],
  ]);
});
