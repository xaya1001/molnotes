import type { TopicContent } from "../src/ui/topic/content.ts";
import type FixtureFixture from "./fixtures/content/sites/fable-patent/content.json";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTopicContent } from "../shared/topic-content.ts";
import { patentRoutePaths } from "../shared/patent-contract.ts";
import { filterRecords, recordsCsv } from "../src/ui/topic/patent-filter.ts";
import { topicRecordsCodec } from "../server/web/records.ts";
import { validatePatentAssets } from "../scripts/content/patent-assets.ts";
import { readUnit, type SiteUnit } from "../scripts/content/content-files.ts";
const fixture = (): typeof FixtureFixture & TopicContent =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/fable-patent/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
test("patent records preserve missing grades, numeric filters, ids and ordered bins", () => {
  const c = validateTopicContent(fixture()).data!.collections!.examples;
  assert.deepEqual(
    filterRecords(c, { activity: "unlisted" }).map((r) => r.id),
    [10],
  );
  assert.deepEqual(
    filterRecords(c, { activity: "blank" }).map((r) => r.id),
    [11],
  );
  assert.deepEqual(
    filterRecords(c, { activity: "dash" }).map((r) => r.id),
    [12],
  );
  assert.equal(filterRecords(c, { activity: "missing" }).length, 3);
  assert.deepEqual(
    filterRecords(c, { q: "2-4" }).map((r) => r.id),
    [2, 3, 4],
  );
  assert.deepEqual(
    filterRecords(c, { "amount.min": "40", "amount.max": "60" }).map(
      (r) => r.id,
    ),
    [4, 5, 6],
  );
  assert.equal(filterRecords(c, { source: "beta" }).length, 6);
  assert.deepEqual(
    filterRecords(c, { sort: "activity", order: "desc" })
      .slice(-3)
      .map((r) => r.id),
    [10, 11, 12],
  );
  assert.match(recordsCsv(c, c.records), /"smiles"/);
  assert.match(recordsCsv(c, c.records), /"CCO"/);
});
test("content rejects bad cross references and page locations", () => {
  validateTopicContent(fixture());
  for (const mutate of [
    (c: typeof FixtureFixture) =>
      Reflect.apply(
        c.data.collections.examples.records[0].refs.examples.push,
        c.data.collections.examples.records[0].refs.examples,
        [99],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[0].structure, "page", 4),
    (c: typeof FixtureFixture) =>
      Reflect.apply(
        c.data.claims.main.claims[0].refs.push,
        c.data.claims.main.claims[0].refs,
        [99],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.apply(
        c.data.claims.main.claims[0].examples.push,
        c.data.claims.main.claims[0].examples,
        [99],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[0], "activity", "Z"),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].structure,
        "rect",
        [0, 0, 900, 900],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.sources.alpha.paragraphs, "0005", 4),
  ]) {
    const c = fixture();
    mutate(c);
    assert.throws(() => validateTopicContent(c));
  }
  for (const size of [
    undefined,
    [],
    [595],
    [595, 842, 1],
    [0, 842],
    [595, -1],
    [Infinity, 842],
    ["595", 842],
  ]) {
    const c = fixture();
    Reflect.set(c.data.sources.beta, "size", size);
    assert.throws(() => validateTopicContent(c), /size must contain/);
  }
  const a4 = fixture();
  const record = a4.data.collections.examples.records[0];
  record.source = "beta";
  Reflect.set(record, "structure", { page: 1, rect: [0, 0, 595, 842] });
  const field = a4.data.collections.examples.fields.find(
    (f) => f.key === "activity",
  )!;
  field.ref = { source: "beta", page: 1, rect: [0, 800, 595, 842] };
  validateTopicContent(a4);
  for (const target of [record.structure, field.ref]) {
    const valid = target.rect;
    for (const rect of [
      [0, 0, 596, 842],
      [0, 0, 595, 843],
    ]) {
      target.rect = rect;
      assert.throws(() => validateTopicContent(a4), /invalid rectangle/);
    }
    target.rect = valid;
  }
  Reflect.set(record.structure, "source", "alpha");
  assert.throws(() => validateTopicContent(a4), /invalid rectangle/);
  const paths = patentRoutePaths(fixture());
  assert.ok(paths.includes("/examples/compare"));
  assert.ok(paths.includes("/synthesis/intermediates/A"));
  assert.ok(paths.includes("/sources/pages/3"));
  const secondary = fixture();
  secondary.data.sources.beta.pages = 5;
  assert.ok(patentRoutePaths(secondary).includes("/sources/pages/5"));
});
test("browser/server record codec rejects unknown ids, duplicates, overflow and long notes", () => {
  const codec = topicRecordsCodec(fixture());
  const record = {
    version: 1,
    ...codec.empty(),
    pins: { examples: [1, 2] },
    recordNotes: { "examples/1": "核对" },
  };
  assert.deepEqual(codec.parseRecords(record).pins, { examples: [1, 2] });
  for (const patch of [
    { pins: { examples: [99] } },
    { pins: { examples: [1, 1] } },
    { pins: { examples: [1, 2, 3, 4, 5, 6, 7] } },
    { pins: { unknown: [] } },
    { recordNotes: { "examples/99": "x" } },
    { recordNotes: { "examples/1": "x".repeat(30001) } },
  ])
    assert.throws(() => codec.parseRecords({ ...record, ...patch }));
});
test("publication checks molecules, scopes, assets and lazy JSON keys", async () => {
  const unit = (await readUnit(
    new URL("./fixtures/content/", import.meta.url).pathname,
    "sites/fable-patent",
  )) as SiteUnit;
  await validatePatentAssets(unit.content, "fable-patent", unit.assets);
  for (const mutate of [
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[0], "smiles", "C("),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.claims.main.claims[0].scope!, "smarts", "["),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[0].body, "key", "absent"),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.claims.main.claims[0].segments[0],
        "asset",
        "/sites/fable-patent/static/missing.svg",
      ),
  ]) {
    const c = fixture();
    mutate(c);
    await assert.rejects(validatePatentAssets(c, "fable-patent", unit.assets));
  }
});

test("measurement filters retain assay context, interval meaning, missing states and units", () => {
  const c = validateTopicContent(fixture()).data!.collections!.examples;
  const ids = (q: Parameters<typeof filterRecords>[1]) =>
    filterRecords(c, q).map((r) => r.id);
  assert.deepEqual(
    ids({ "potency.assay": "alpha-potency", "potency.max": "25" }),
    [1, 2],
  );
  assert.deepEqual(
    ids({ "potency.assay": "alpha-potency", "potency.min": "30" }),
    [3, 4, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(ids({ "potency.max": "25" }), []);
  assert.deepEqual(
    ids({ "potency.assay": "unknown-unit", "potency.max": "25" }),
    [],
  );
  assert.deepEqual(ids({ "potency.status": "unreported" }), [6]);
  assert.deepEqual(
    ids({ sort: "potency", order: "desc" }),
    c.records.map((r) => r.id),
  );
  assert.deepEqual(
    ids({
      "potency.assay": "alpha-potency",
      sort: "potency",
      order: "desc",
    }).slice(-4),
    [2, 3, 4, 6],
  );
  const exported = recordsCsv(c, [c.records[1]]);
  assert.ok(exported.includes('""qualifier"":""<""'));
  assert.ok(exported.includes('""assay"":""alpha-potency""'));
  assert.deepEqual(ids({ scaffold: "核心乙" }), [7, 8, 9, 10, 11, 12]);
});

test("research publication rejects missing measurement semantics, ungrounded grouping and invalid route graphs", () => {
  for (const mutate of [
    (c: typeof FixtureFixture) =>
      Reflect.deleteProperty(c.data.collections.examples.records[0], "potency"),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].potency,
        "assay",
        "absent",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].potency,
        "qualifier",
        "approx",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[3].potency, "upper", 10),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.collections.examples.records[5].potency, "value", 0),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].scaffold[0],
        "evidence",
        [],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].scaffold[0],
        "claims",
        [999],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.steps[0].products[0], "id", 999),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.steps[0], "yield", {
        status: "reported",
        value: 24,
        unit: "g",
      }),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.steps[2], "procedure", "absent"),
    (c: typeof FixtureFixture) =>
      Reflect.deleteProperty(
        c.data.synthesis.fable.steps[2],
        "overrideEvidence",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.steps[0], "reactants", [
        { collection: "examples", id: 3 },
      ]),
    (c: typeof FixtureFixture) =>
      Reflect.apply(
        c.data.synthesis.fable.routes[0].steps.push,
        c.data.synthesis.fable.routes[0].steps,
        ["partner"],
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.routes[0], "target", {
        collection: "examples",
        id: 4,
      }),
  ]) {
    const c = fixture();
    mutate(c);
    assert.throws(() => validateTopicContent(c));
  }
});

test("connected synthesis counts convergent steps separately from longest path", async () => {
  const { routeStats, routeSteps, sharedIntermediates } =
    await import("../src/ui/topic/patent-synthesis.ts");
  const n = validateTopicContent(fixture()).data!.synthesis!.fable;
  assert.deepEqual(routeStats(n, n.routes[1]), { total: 3, longest: 2 });
  assert.deepEqual(
    routeSteps(n, n.routes[1]).map((s) => s.id),
    ["core", "partner", "branch-b"],
  );
  assert.deepEqual(sharedIntermediates(n), [{ collection: "examples", id: 2 }]);
  assert.equal(routeSteps(n, n.routes[1])[2].yield.status, "unreported");
  assert.ok(patentRoutePaths(fixture()).includes("/synthesis/fable"));
});

test("global research evidence requires source, mass stays separate, procedure links cannot cycle", () => {
  for (const mutate of [
    (c: typeof FixtureFixture) =>
      Reflect.deleteProperty(
        c.data.collections.examples.assays["alpha-potency"].evidence[0],
        "source",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.deleteProperty(
        c.data.synthesis.fable.steps[0].evidence[0],
        "source",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.deleteProperty(
        c.data.synthesis.fable.routes[0].reportedYield!.ref,
        "source",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.synthesis.fable.steps[0].isolatedMass!.product,
        "id",
        4,
      ),
    (c: typeof FixtureFixture) =>
      c.data.synthesis.fable.routes[0].reportedYield!.scopeStepIds.reverse(),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.routes[0], "startingMaterials", []),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable.procedures["method-a"], "yield", {
        status: "reported",
        value: 70,
      }),
    (c: typeof FixtureFixture) =>
      Reflect.set(c.data.synthesis.fable, "references", [
        {
          record: { collection: "examples", id: 1 },
          procedure: "method-a",
          note: "self reference",
          evidence: [{ source: "alpha", page: 1 }],
          yield: { status: "unreported", reason: "not reported" },
        },
      ]),
  ]) {
    const c = fixture();
    c.data.synthesis.fable.procedures["method-a"].sourceRecord = {
      collection: "examples",
      id: 1,
    };
    mutate(c);
    assert.throws(() => validateTopicContent(c));
  }
  const c = fixture();
  Reflect.deleteProperty(
    c.data.collections.examples.records[0].potency,
    "assay",
  );
  assert.throws(
    () => validateTopicContent(c),
    /collections.examples.records.1.potency/,
  );
});

test("publication validates assignment patterns and new nested evidence assets", async () => {
  const unit = (await readUnit(
    new URL("./fixtures/content/", import.meta.url).pathname,
    "sites/fable-patent",
  )) as SiteUnit;
  for (const mutate of [
    (c: typeof FixtureFixture) =>
      Object.assign(c.data.collections.examples.records[0].scaffold[0], {
        basis: "chemical-pattern",
        pattern: "[",
      }),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].potency.ref!,
        "asset",
        "/sites/fable-patent/static/absent.svg",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.collections.examples.records[0].scaffold[0].evidence[0],
        "asset",
        "/sites/fable-patent/static/absent.svg",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.synthesis.fable.routes[0].evidence[0],
        "asset",
        "/sites/fable-patent/static/absent.svg",
      ),
    (c: typeof FixtureFixture) =>
      Reflect.set(
        c.data.synthesis.fable.steps[0].evidence[0],
        "asset",
        "/sites/fable-patent/static/absent.svg",
      ),
  ]) {
    const c = fixture();
    mutate(c);
    await assert.rejects(validatePatentAssets(c, "fable-patent", unit.assets));
  }
});
