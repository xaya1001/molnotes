import type { TopicContent } from "../src/ui/topic/content.ts";
import type FixtureFixture from "./fixtures/content/sites/instruments/content.json";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { validateTopicContent } from "../shared/topic-content.ts";
import { strategyHammett } from "../src/ui/models/organic-chemistry.ts";
const { bandOf, logRelativeRate, pka, printedSigma, relativeRate, sigma } =
  strategyHammett;
const fixture = (): typeof FixtureFixture & TopicContent =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
const sample = () => fixture().data.hammettSample;

test("Hammett equations retain rounding, zero and finite-number refusal", () => {
  assert.equal(sigma(5, 4.73), 0.27);
  assert.equal(sigma(5, 5.126), -0.13);
  assert.ok(Object.is(sigma(5, 5.001), -0));
  assert.equal(logRelativeRate(2, -0.2), -0.4);
  assert.equal(relativeRate(2, -0.2), 10 ** -0.4);
  assert.equal(relativeRate(0, 0.4), 1);
  assert.equal(logRelativeRate(2, 0), 0);
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.throws(() => sigma(v, 5));
    assert.throws(() => sigma(5, v));
    assert.throws(() => relativeRate(v, 0.2));
    assert.throws(() => relativeRate(2, v));
  }
});
test("rho bands retain inclusive small and 4.5 large boundaries", () => {
  for (const [rho, expected] of [
    [-6, "large-negative"],
    [-4.5, "large-negative"],
    [-4.499, "moderate-negative"],
    [-1, "small"],
    [0, "small"],
    [1, "small"],
    [4.499, "moderate-positive"],
    [4.5, "large-positive"],
    [6, "large-positive"],
  ] satisfies [number, string][])
    assert.equal(bandOf(rho), expected);
  assert.throws(() => bandOf(NaN));
});
test("sigma exercise uses reference pKa independently of printed values and keeps strict guess tolerance", () => {
  const data = sample(),
    model = labModels["strategy-hammett-sigma"];
  const values = Object.fromEntries(
    modelInputs(model, data).map((i) => [i.id, i.default]),
  );
  assert.deepEqual(values, { subId: "group-a", position: "para", guess: 0 });
  assert.equal(pka(data.substituents[0], "para"), 4.7);
  assert.equal(printedSigma(data.substituents[0], "para"), 0.4);
  assert.match(
    model(data).run({ ...values, guess: 0.3 }).revealed!.summary!,
    /5 − 4.7 = 0.3/,
  );
  const resultFor = (guess: number) =>
    model(data).run({ subId: "group-c", position: "para", guess });
  const exact = resultFor(0),
    incorrect = resultFor(1);
  assert.notDeepEqual(exact, incorrect);
  for (const guess of [0, 0.0049, -0.0049])
    assert.deepEqual(resultFor(guess), exact);
  for (const guess of [0.005, -0.005, 0.0051, -0.0051, -10, 10])
    assert.deepEqual(resultFor(guess), incorrect);
  for (const patch of [
    { subId: "missing" },
    { position: "other" },
    { guess: NaN },
    { guess: Infinity },
  ])
    assert.throws(() => model(data).run({ ...values, ...patch }));
});
test("rate uses printed sigma, ordered source entries, actual point count and original chart domains", () => {
  const data = sample(),
    model = labModels["strategy-hammett-rate"];
  const values = Object.fromEntries(
    modelInputs(model, data).map((i) => [i.id, i.default]),
  );
  assert.deepEqual(values, {
    reaction: "reaction-a",
    subId: "group-a",
    position: "meta",
  });
  for (const reaction of data.reactions) {
    const result = model(data).run({ ...values, reaction: reaction.id }),
      chart = result.charts![0];
    assert.deepEqual(chart.xDomain, [-0.8, 0.9]);
    assert.deepEqual(chart.yDomain, [
      -Math.max(1, Math.ceil(Math.abs(reaction.rho) * 0.8)),
      Math.max(1, Math.ceil(Math.abs(reaction.rho) * 0.8)),
    ]);
    assert.deepEqual(
      chart.points,
      [-0.2, -0.2, 0, 0, 0.4, 0.4].map((x) => ({ x, y: reaction.rho * x })),
    );
    assert.equal(chart.points.length, 6);
  }
  assert.match(model(data).run(values).summary!, /σ = -0.2.*10\^-0.40/);
  for (const patch of [
    { reaction: "missing" },
    { subId: "missing" },
    { position: "other" },
  ])
    assert.throws(() => model(data).run({ ...values, ...patch }));
});
test("publication refuses missing reference, malformed entries and unknown defaults without forcing printed-computed agreement", () => {
  validateTopicContent(fixture());
  for (const mutate of [
    (d: ReturnType<typeof sample>) => Reflect.deleteProperty(d, "referencePka"),
    (d: ReturnType<typeof sample>) => Reflect.set(d, "referencePka", Infinity),
    (d: ReturnType<typeof sample>) => Reflect.set(d, "substituents", []),
    (d: ReturnType<typeof sample>) => Reflect.set(d, "reactions", []),
    (d: ReturnType<typeof sample>) => d.substituents.push(d.substituents[0]),
    (d: ReturnType<typeof sample>) => d.reactions.push(d.reactions[0]),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.substituents[0], "name", ""),
    (d: ReturnType<typeof sample>) => Reflect.set(d.reactions[0], "name", ""),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.substituents[0], "pkaPara", NaN),
    (d: ReturnType<typeof sample>) =>
      Reflect.deleteProperty(d.substituents[0], "sigmaMeta"),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.reactions[0], "rho", Infinity),
    (d: ReturnType<typeof sample>) => Reflect.deleteProperty(d, "defaults"),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.defaults, "subId", "missing"),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.defaults, "reaction", "missing"),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.defaults, "sigmaPosition", "other"),
    (d: ReturnType<typeof sample>) =>
      Reflect.set(d.defaults, "ratePosition", "other"),
  ]) {
    const content = fixture();
    mutate(content.data.hammettSample);
    assert.throws(() => validateTopicContent(content));
  }
});
