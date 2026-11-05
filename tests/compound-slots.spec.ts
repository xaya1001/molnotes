import { expect, test } from "./helpers/test.ts";
import { putRecords } from "./helpers/records.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  prepareInputVariant,
} from "../shared/chemical-library/chemistry.ts";
import { resolveCompoundSlots } from "../scripts/content/compound-slots.ts";

test("migrating an indexed structure input keeps its saved prediction and atom order", async ({
  page,
  request,
}) => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_example",
    title: "Example",
    smiles: "OCC",
    sources: [
      {
        source: "unknown",
        locator: "Example",
        note: "Neutral verification fixture",
      },
    ],
  });
  c.variants = { input: prepareInputVariant(rd, c, "CCO") };
  const endpoint = "/api/records/topics/instruments";
  const seed = {
    version: 1,
    complete: [],
    bookmarks: [],
    notes: {},
    answers: {},
    diagnostic: {},
    predictions: { instruments: { selected: [2] } },
    problems: {},
  };
  await putRecords(request, endpoint, { data: seed });
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().endsWith(endpoint))
      writes.push(req.postData() ?? "");
  });
  await page.route("**/api/topics/instruments", async (route) => {
    const response = await route.fetch(),
      topic = await response.json();
    const prediction = topic.content.chapters
      .find((chapter: { id: string }) => chapter.id === "instruments")
      .blocks.find((block: { type: string }) => block.type === "prediction");
    const { smiles, ...local } = prediction.molecule;
    expect(smiles).toBe("CCO");
    prediction.molecule = { ...local, ref: c.id, variant: "input" };
    topic.content = resolveCompoundSlots(
      topic.content,
      { [c.id]: c },
      "example",
    ).value;
    await route.fulfill({ response, json: topic });
  });
  try {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/sites/instruments/instruments");
      const prediction = page.getByTestId("prediction-instruments");
      await expect(prediction).toHaveAttribute("aria-label", "预测结果");
      await expect(prediction.locator(".comparison-choice")).toHaveCount(1);
      const record = await (await request.get(endpoint)).json();
      expect(record.predictions).toEqual(seed.predictions);
    }
    for (const write of writes)
      expect(JSON.parse(write).predictions).toEqual(seed.predictions);
  } finally {
    await putRecords(request, endpoint, { data: { ...seed, predictions: {} } });
  }
});
