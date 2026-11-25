import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { checkNote } from "../scripts/content/writer-check.ts";

const root = mkdtempSync(join(tmpdir(), "writer-"));
const term = {
  term: "计数",
  full: "Counting",
  definition: "确定数量的方法。",
  confusion: "大小与数量分开。",
};
function fixture(name: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, "notes/sample"), { recursive: true });
  writeFileSync(
    join(dir, "notes/sample/directory.json"),
    JSON.stringify({ title: "观察", intro: "样本", order: 1 }),
  );
  writeFileSync(join(dir, "glossary.json"), JSON.stringify([term]));
  writeFileSync(join(dir, "prose-terms.json"), "[]");
  return dir;
}
const note = (body: string, order = 1) =>
  `---\ntitle: 观察 ${order}\nsummary: 样本\ndate: 2026-01-01\norder: ${order}\n---\n\n${body}\n`;
const cli = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, ["scripts/content.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, MOLNOTES_CONTENT_DIR: dir },
  });

test("page check rejects a new diagnostic in an unselected compound variant", () => {
  const dir = fixture("figure-baseline");
  const file = "notes/sample/first.md";
  const compound = "library/compounds/cmp_table_sample.json";
  mkdirSync(join(dir, "library/compounds"), { recursive: true });
  writeFileSync(
    join(dir, file),
    note("```figure-ref\nref: cmp_table_sample\n```"),
  );
  const entry = JSON.parse(
    readFileSync(join("tests/fixtures/content", compound), "utf8"),
  );
  writeFileSync(join(dir, compound), JSON.stringify(entry));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.org",
      "commit",
      "-qm",
      "fixture",
    );
  };
  git("init", "-q");
  commit();
  assert.equal(cli(dir, "check", file, "--figure-base", "HEAD").status, 0);
  entry.variants.reverse.coords.a3 = { x: -0.433, y: -0.28 };
  writeFileSync(join(dir, compound), JSON.stringify(entry));
  const check = cli(dir, "check", file, "--figure-base", "HEAD");
  assert.equal(check.status, 1, check.stderr);
  assert.match(
    check.stderr,
    /cmp_table_sample \[variant reverse\]: LABEL_OVERLAP/,
  );
  commit();
  const unchanged = cli(dir, "check", file, "--figure-base", "HEAD");
  assert.equal(unchanged.status, 0, unchanged.stderr);
});

test("series follows order and lists first terms without reading author plans", () => {
  const dir = fixture("series");
  writeFileSync(
    join(dir, "notes/sample/later.md"),
    note("## 后续\n\n[[计数]]\n\n### 细节\n\n结果。", 2),
  );
  writeFileSync(
    join(dir, "notes/sample/first.md"),
    note("## 起点\n\n[[计数]]（Counting）。"),
  );
  mkdirSync(join(dir, "notes/sample/author"));
  writeFileSync(join(dir, "notes/sample/author/plan.md"), "未写的规划。");
  const series = cli(dir, "series", "sample");
  assert.equal(series.status, 0, series.stderr);
  assert.ok(
    series.stdout.indexOf("first.md") < series.stdout.indexOf("later.md"),
  );
  assert.equal(series.stdout.split("terms: 计数").length - 1, 1);
});

test("check reuses compilation and request contracts, reports duplicate additions and unlinked terms", async () => {
  const dir = fixture("check");
  const file = "notes/sample/first.md";
  writeFileSync(
    join(dir, file),
    note(
      "## 比较\n\n计数\n\n```request\nkind: image\nfile: sample.png\ncaption: 样本\nprompt: 两个圆点\n```",
    ),
  );
  const additions = join(dir, "additions.json");
  writeFileSync(
    additions,
    JSON.stringify([{ ...term, term: "Count ing", full: " counting " }]),
  );
  const duplicate = await checkNote(dir, file, additions);
  assert.equal(duplicate.errors.length, 1);
  assert.match(duplicate.errors[0], /duplicates 计数/);
  assert.equal(duplicate.hints.length, 1);
  writeFileSync(join(dir, file), note("## 比较\n\n[[计 数]]"));
  assert.match(
    (await checkNote(dir, file)).errors.join("\n"),
    /duplicates 计数/,
  );
  writeFileSync(join(dir, file), note("## 比较\n\n[[数量法]]（COUNTING）"));
  assert.match(
    (await checkNote(dir, file)).errors.join("\n"),
    /duplicates 计数/,
  );
  const quietTerms = [
    "Cl",
    "F",
    "A",
    "ATP",
    "syn",
    "anti",
    "Hofmann",
    "SN2",
    "E1cB",
    "Clearance",
    "A+B",
    "ΔG",
  ];
  writeFileSync(
    join(dir, "glossary.json"),
    JSON.stringify([
      term,
      ...quietTerms.map((name) => ({ ...term, term: name, full: name })),
      { ...term, term: "样本 A+B", full: "sample sum" },
    ]),
  );
  writeFileSync(
    join(dir, file),
    note(`## 比较\n\n${quietTerms.join("，")}，计数与计数，样本 A+B。`),
  );
  const unlinked = await checkNote(dir, file);
  assert.deepEqual(unlinked.errors, []);
  assert.equal(unlinked.hints.length, 2);
  assert.ok(unlinked.hints.some((hint) => hint.endsWith("link [[计数]]")));
  assert.ok(unlinked.hints.some((hint) => hint.endsWith("link [[样本 A+B]]")));
  writeFileSync(join(dir, file), note("## 比较\n\n[[计数]]，计数。\n\n计数。"));
  assert.deepEqual((await checkNote(dir, file)).hints, []);
  writeFileSync(join(dir, file), note("## 比较\n\n计数。\n\n[[计数]]，计数。"));
  const first = await checkNote(dir, file);
  assert.equal(first.hints.length, 1);
  assert.match(first.hints[0], /first.md:10:/);
  const examples = [
    ["[链接](missing)", /Unknown internal link/],
    ["[[缺失]]", /Unknown term/],
    ["```molecule\nsmiles: wrong\ncaption: 样本\n```", /SMILES/],
    ["[来源](src:missing#1)", /sources.json/],
    ["```request\nkind: image\nfile: x.png\ncaption: 样本\n```", /prompt/],
  ] as const;
  for (const [body, expected] of examples) {
    writeFileSync(join(dir, file), note(`## 比较\n\n${body}`));
    assert.match((await checkNote(dir, file)).errors.join("\n"), expected);
  }
});

test("check reports terms in table headers and rows at their source lines", async () => {
  const dir = fixture("table");
  const file = "notes/sample/first.md";
  writeFileSync(
    join(dir, "glossary.json"),
    JSON.stringify([term, { ...term, term: "数量", full: "Quantity" }]),
  );
  writeFileSync(
    join(dir, file),
    note("## 比较\n\n| 计数 | 结果 |\n| --- | --- |\n| 数量 | 1 |"),
  );
  const result = await checkNote(dir, file);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.hints, [
    `${file}:10: link [[计数]]`,
    `${file}:12: link [[数量]]`,
  ]);
});

test("check resolves sparse note and practice links without compiling unrelated drafts", async () => {
  const dir = fixture("sparse");
  mkdirSync(join(dir, "notes/other"));
  writeFileSync(
    join(dir, "notes/other/directory.json"),
    JSON.stringify({ title: "其他", intro: "样本", order: 2 }),
  );
  writeFileSync(
    join(dir, "notes/other/next.md"),
    note("## 比较\n\n```request\nkind: unknown\n```"),
  );
  writeFileSync(
    join(dir, "notes/sample/first.md"),
    note("## 比较\n\n[下一篇](../other/next)"),
  );
  mkdirSync(join(dir, "sites/sample/chapters"), { recursive: true });
  writeFileSync(
    join(dir, "sites/sample/site.json"),
    JSON.stringify({
      title: "练习",
      description: "样本",
      order: 1,
      group: "练习",
    }),
  );
  writeFileSync(
    join(dir, "sites/sample/content.json"),
    JSON.stringify({
      chapterRoute: "/lesson/{number}",
      chapters: ["chapters/written.md"],
    }),
  );
  writeFileSync(
    join(dir, "sites/sample/chapters/written.md"),
    "---\ntitle: 练习\nnumber: 7\n---\n\n```request\nkind: unknown\n```\n",
  );
  writeFileSync(
    join(dir, "notes/sample/first.md"),
    note(
      "## 比较\n\n[下一篇](../other/next) 与 [练习](/practice/sample/lesson/7)",
    ),
  );
  // An unfinished neighboring note must not block checking the selected note.
  writeFileSync(
    join(dir, "notes/other/draft.md"),
    "还没写 front matter 的草稿。",
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-qm",
    "fixture",
  );
  git("sparse-checkout", "set", "--cone", "notes/sample");
  assert.deepEqual((await checkNote(dir, "notes/sample/first.md")).errors, []);
});

test("check rejects forbidden prose forms", async () => {
  const dir = fixture("prose-rules");
  const file = "notes/sample/first.md";
  writeFileSync(join(dir, "prose-terms.json"), JSON.stringify(["内部术语"]));
  for (const [body, expected] of [
    ["内部术语", /forbidden prose term/],
    ["第 3 篇", /chapter announcement/],
    ["`{苯}`", /chemical name marked as code/],
  ] as const) {
    writeFileSync(join(dir, file), note(body));
    assert.match((await checkNote(dir, file)).errors.join("\n"), expected);
  }
  writeFileSync(join(dir, file), note("`LUMO{+}` 与第一篇药理论文"));
  assert.deepEqual((await checkNote(dir, file)).errors, []);
});
