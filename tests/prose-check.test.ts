import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyze, report, strings } from "../scripts/prose-check.ts";

test("citation pointers are not counted as prose", () => {
  const input = {
    lead: "这是一句需要检查的中文正文，长度超过二十个字符以便被收集。",
    locator: "必读 · EPUB 22.4，图 22-51 与相邻正文，页码与图号都在这里",
    file: "materials/textbooks/biology/一本书的很长的文件名称加上中文名称.pdf",
    cite: "src:sample#1",
  };
  assert.deepEqual(strings(input, []), [input.lead]);
});

test("reports inline formulas without relations or operations", () => {
  const formulas = [
    "$\\text{NaN}_3$",
    "$\\mathrm{Cl}^{-}$",
    "$10^{-5}$",
    "$1.2 \\times 10^{-5}$",
    "$k_1$",
    "$10 - 5$",
  ];
  assert.deepEqual(analyze(formulas).formulas, formulas);
  assert.deepEqual(
    analyze([
      "$v = k[A][B]$",
      "$\\frac{k_1}{k_2}$",
      "$\\log K$",
      "$a < b$",
      "$x ≈ y$",
      "$$10^{-5}$$",
      "NaN₃、Cl⁻、10⁻⁵、k₁",
    ]).formulas,
    [],
  );
});

test("long sentence report counts text without punctuation and includes explanations", () => {
  const long = "甲".repeat(71) + "。";
  const texts = strings(
    {
      lead: "甲".repeat(70) + "。",
      explanation: long,
      optionExplanations: ["乙".repeat(71) + "。"],
      punctuated: "，".repeat(80) + "短句。",
    },
    [],
  );
  assert.deepEqual(analyze(texts).long, [long, "乙".repeat(71) + "。"]);
});

test("reads note Markdown and topic JSON, and the CLI remains advisory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "prose-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "notes/sample/author"), { recursive: true });
  mkdirSync(join(root, "sites/sample"), { recursive: true });
  const long = "甲".repeat(71) + "。";
  writeFileSync(
    join(root, "notes/sample/observe.md"),
    `---
title: 观察
summary: 比较样本。
date: 2026-01-01
order: 1
---

## 比较

${long}

数值 $10^{-5}$。

[原页](https://example.org/${"乙".repeat(80)})

\`$10^{-6}$\`

\`\`\`request
kind: image
prompt: ${"丙".repeat(80)} $10^{-7}$
\`\`\`
`,
  );
  writeFileSync(
    join(root, "notes/sample/author/plan.md"),
    "author metadata is outside the reader notes",
  );
  writeFileSync(
    join(root, "sites/sample/site.json"),
    JSON.stringify({
      title: "观察",
      description: "比较样本",
      order: 1,
      group: "练习",
    }),
  );
  writeFileSync(
    join(root, "sites/sample/content.json"),
    JSON.stringify({
      lead: "$\\text{NaN}_3$",
      explanation: long,
      file: "$10^{-8}$",
    }),
  );
  const note = report("notes/sample/observe.md", root);
  assert.deepEqual(note.long, [long]);
  assert.deepEqual(note.formulas, ["$10^{-5}$"]);
  assert.deepEqual(report("notes/sample", root).formulas, note.formulas);
  assert.deepEqual(report("sample", root).formulas, ["$\\text{NaN}_3$"]);
  assert.deepEqual(report("sites/sample", root).long, [long]);
  for (const args of [[], ["notes/sample/observe.md"], ["sample"]]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/prose-check.ts", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, MOLNOTES_CONTENT_DIR: root },
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});
