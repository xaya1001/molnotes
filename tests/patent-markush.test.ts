import test from "node:test";
import assert from "node:assert/strict";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { validateMarkush, type Markush } from "../shared/patent-markush.ts";
import {
  validateMarkushChemistry,
  matchMarkush,
  markushCoverage,
} from "../shared/patent-markush-chemistry.ts";
const toolkit = await moleculeToolkit();
const alkyl = {
  id: "alkyl",
  label: "C1–3 alkyl",
  type: "count" as const,
  element: 6,
  min: 1,
  max: 3,
  atomSmarts: "[C;X4;!R]",
};
const model = (): Markush => ({
  core: "c1cc([*:1])ccc1",
  note: "Teaching model",
  groups: { 1: { label: "R¹", alternatives: [alkyl] } },
});
test("Markush contract and publication reject invalid definitions and parse every structure", () => {
  validateMarkush(model(), "claim");
  validateMarkushChemistry(toolkit, model(), "claim");
  for (const change of [
    (m: Markush) => {
      m.groups[1].alternatives.push({ ...alkyl, min: 4 });
    },
    (m: Markush) => {
      m.groups[1].alternatives = [
        {
          id: "s",
          label: "s",
          type: "substituted",
          core: "*c1ccccc1",
          group: "2",
          min: 0,
          max: 2,
        },
      ];
    },
    (m: Markush) => {
      m.groups[1].positions = [-1];
    },
    (m: Markush) => {
      m.groups[1].alternatives = [
        {
          id: "x",
          label: "x",
          type: "substituted",
          core: "*C",
          group: "1",
          min: 0,
          max: 1,
        },
      ];
    },
  ]) {
    const m = model();
    change(m);
    assert.throws(() => validateMarkush(m, "claim"));
  }
  for (const change of [
    (m: Markush) => {
      m.core = "[";
    },
    (m: Markush) => {
      m.core = "C([*:1])[*:1]";
    },
    (m: Markush) => {
      m.core = "C[*:2]";
    },
    (m: Markush) => {
      m.groups[1].positions = [3];
    },
    (m: Markush) => {
      m.groups[1].alternatives = [
        { id: "x", label: "x", type: "fragment", smiles: "CC" },
      ];
    },
    (m: Markush) => {
      m.groups[1].alternatives = [
        { id: "x", label: "x", type: "class", smarts: "[" },
      ];
    },
    (m: Markush) => {
      m.exclusions = [{ id: "x", label: "x", smiles: "[" }];
    },
  ]) {
    const m = model();
    change(m);
    assert.throws(() => validateMarkushChemistry(toolkit, m, "claim"));
  }
});
test("core decomposition keeps actual fragments and distinguishes outside, absent core and exclusions", () => {
  const m = model();
  const inside = matchMarkush(toolkit, "CCc1ccccc1", m);
  assert.equal(inside.status, "matched");
  assert.equal(inside.groups[0].fragment, "*CC");
  assert.deepEqual(inside.groups[0].alternatives, ["alkyl"]);
  const outside = matchMarkush(toolkit, "CCCCc1ccccc1", m);
  assert.equal(outside.status, "not-matched");
  assert.deepEqual(outside.outside, ["1"]);
  assert.equal(outside.groups[0].fragment, "*CCCC");
  assert.equal(matchMarkush(toolkit, "C1CCCCC1", m).reason, "core");
  m.exclusions = [{ id: "exclude", label: "Excluded", smarts: "CCc1ccccc1" }];
  assert.equal(matchMarkush(toolkit, "CCc1ccccc1", m).exclusion, "exclude");
  m.exclusions = [{ id: "exact", label: "Exact", smiles: "Cc1ccccc1" }];
  assert.equal(matchMarkush(toolkit, "Cc1ccccc1", m).reason, "excluded");
  assert.equal(matchMarkush(toolkit, "CCc1ccccc1", m).status, "matched");
});
test("an outside substituent is retained when hydrogen is also an alternative", () => {
  const m = model();
  m.groups[1].alternatives.push({
    id: "hydrogen",
    label: "H",
    type: "fragment",
    smiles: "*[H]",
  });
  const result = matchMarkush(toolkit, "CCCCc1ccccc1", m);
  assert.equal(result.groups[0].fragment, "*CCCC");
  assert.deepEqual(result.outside, ["1"]);
});
test("fixed and variable positions test every core mapping", () => {
  const m: Markush = {
    core: "n1c([*:1])cccc1",
    note: "position",
    groups: { 1: { label: "R¹", alternatives: [alkyl] } },
  };
  assert.equal(matchMarkush(toolkit, "Cc1cccnc1", m).status, "not-matched");
  m.groups[1].positions = [1, 3];
  validateMarkushChemistry(toolkit, m, "claim");
  assert.equal(matchMarkush(toolkit, "Cc1cccnc1", m).status, "matched");
});
test("nested optional substitution uses referenced R definitions and exact fragment boundaries", () => {
  const m = model();
  m.groups[1].alternatives = [
    {
      id: "aryl",
      label: "Optionally substituted phenyl",
      type: "substituted",
      core: "*c1ccccc1",
      group: "2",
      min: 0,
      max: 2,
    },
  ];
  m.groups[2] = {
    label: "R²",
    alternatives: [
      {
        id: "halogen",
        label: "Halogen",
        type: "class",
        smarts: "[#0]-[F,Cl,Br,I]",
      },
    ],
  };
  validateMarkushChemistry(toolkit, m, "claim");
  assert.equal(
    matchMarkush(toolkit, "c1ccc(-c2ccccc2)cc1", m).status,
    "matched",
  );
  assert.equal(
    matchMarkush(toolkit, "Fc1ccc(-c2ccccc2)cc1", m).status,
    "matched",
  );
  assert.equal(
    matchMarkush(toolkit, "COc1ccc(-c2ccccc2)cc1", m).status,
    "not-matched",
  );
});
test("repeating units enforce both bounds and terminal identity", () => {
  const m = model();
  m.groups[1].alternatives = [
    {
      id: "repeat",
      label: "Repeat",
      type: "repeat",
      unit: "[*:1]CC[*:2]",
      end: "*O",
      min: 1,
      max: 2,
    },
  ];
  validateMarkushChemistry(toolkit, m, "claim");
  assert.equal(matchMarkush(toolkit, "OCCc1ccccc1", m).status, "matched");
  assert.equal(matchMarkush(toolkit, "OCCCCc1ccccc1", m).status, "matched");
  assert.equal(matchMarkush(toolkit, "OCCCc1ccccc1", m).status, "not-matched");
  assert.equal(
    matchMarkush(toolkit, "OCCCCCCc1ccccc1", m).status,
    "not-matched",
  );
});
test("unmodeled definitions and bridging fragments remain unresolved; known violations stay outside", () => {
  const m = model();
  m.unmodeled = "Additional substitution conditions";
  m.groups[1].unmodeled = "Additional alternatives";
  assert.equal(matchMarkush(toolkit, "Cc1ccccc1", m).status, "unmodeled");
  m.groups[1].alternatives = [];
  assert.equal(matchMarkush(toolkit, "Oc1ccccc1", m).status, "unmodeled");
  assert.equal(matchMarkush(toolkit, "CC", m).status, "not-matched");
  assert.equal(matchMarkush(toolkit, "CC").status, "unmodeled");
  const bridge: Markush = {
    core: "C([*:1])C[*:2]",
    note: "bridge",
    groups: {
      1: { label: "R1", alternatives: [alkyl] },
      2: { label: "R2", alternatives: [alkyl] },
    },
  };
  assert.equal(matchMarkush(toolkit, "C1CCCCC1", bridge).status, "unmodeled");
});
test("coverage lists every alternative including empty alternatives and observed outside fragments", async () => {
  const m = model();
  m.groups[1].alternatives.push(
    { id: "fluoro", label: "Fluoro", type: "fragment", smiles: "*F" },
    { id: "chloro", label: "Chloro", type: "fragment", smiles: "*Cl" },
  );
  const coverage = await markushCoverage(toolkit, m, [
    { id: 1, smiles: "Cc1ccccc1" },
    { id: 2, smiles: "Fc1ccccc1" },
    { id: 3, smiles: "Oc1ccccc1" },
    { id: 4, smiles: "" },
  ]);
  assert.deepEqual(
    coverage.groups[0].alternatives.map((a) => a.examples),
    [[1], [2], []],
  );
  assert.deepEqual(coverage.groups[0].outside, [{ id: 3, fragment: "*O" }]);
  assert.deepEqual(coverage.groups[0].unmodeled, [4]);
});
test("the neutral publication fixture covers all five definition types and six query outcomes", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/fable-patent/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const m: Markush = fixture.data.claims.main.claims[0].markush;
  validateMarkushChemistry(toolkit, m, "fixture");
  for (const [smiles, status, reason] of [
    ["CCO", "matched", "within"],
    ["NCO", "not-matched", "groups"],
    ["N", "not-matched", "core"],
    ["CCCO", "not-matched", "excluded"],
    ["C1CO1", "unmodeled", "unmodeled"],
    ["COC", "matched", "within"],
  ]) {
    const result = matchMarkush(toolkit, smiles, m);
    assert.equal(result.status, status, smiles);
    assert.equal(result.reason, reason, smiles);
  }
});
