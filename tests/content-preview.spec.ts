import { expect, test } from "./helpers/test.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import { topicFigures } from "../shared/content-preview.ts";
import type { Library } from "../shared/chemical-library/types.ts";
import type { TopicContent } from "../src/ui/topic/content.ts";

for (const width of [1366, 390]) {
  test(`content preview checks library figures and every mechanism frame at ${width}px`, async ({
    page,
  }) => {
    const sources = [
      {
        source: "unknown",
        locator: "Example",
        note: "Neutral verification fixture",
      },
    ];
    const c = prepareCompound(await moleculeToolkit(), {
      id: "cmp_example",
      title: "Example",
      smiles: "CC(N)C(=O)O",
      sources,
    });
    const bad = structuredClone(c);
    bad.id = "cmp_collision";
    bad.layout.pins = { a3: { ...bad.layout.coords.a5 } };
    const library: Library = {
      [c.id]: c,
      [bad.id]: bad,
      mec_example: {
        id: "mec_example",
        title: "Mechanism",
        kind: "mechanism",
        sources,
        category: "comparison",
        frames: ["first", "second"].map((id) => ({
          id,
          title: id,
          explanation: id,
          scene: {
            width: 9,
            height: 7,
            molecules: [
              { id: "structure", compound: c.id, at: { x: 4, y: 3 } },
            ],
          },
        })),
      },
    };
    const topic: TopicContent = {
      parts: [],
      sources: [],
      chapters: [
        {
          id: "example",
          title: "Example",
          number: 1,
          short: "Example",
          minutes: 1,
          lead: "Example",
          refs: [],
          blocks: [
            { type: "figure-ref", ref: c.id },
            { type: "figure-ref", ref: "mec_example" },
            {
              type: "mechanism",
              frames: [
                {
                  name: "First",
                  smiles: "CC(=O)C",
                  explanation: "First",
                  arrows: [
                    { from: { bond: 1 }, to: { atom: 2 }, electrons: 2 },
                  ],
                },
                {
                  name: "Second",
                  smiles: "CCO",
                  explanation: "Second",
                  arrows: [],
                },
              ],
            },
            { type: "figure-ref", ref: bad.id },
          ],
        },
      ],
    };
    const errors: string[] = [];
    const figures = topicFigures(topic, "example", errors, library);
    expect(errors).toEqual([]);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(
      ({ figures, library }) => {
        window.__previewFigures = figures;
        window.__previewLibrary = library;
      },
      { figures, library },
    );
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    await expect(page.locator("[data-preview]")).toHaveCount(6);
    await expect(page.locator(".library-canvas svg")).toHaveCount(4);
    await expect(page.locator("figure.molecule svg")).toHaveCount(2);
    await expect(page.locator("figure.molecule .electron-arrow")).toHaveCount(
      1,
    );
    const result = (await page.evaluate(() => window.__previewResult))!;
    expect(
      result.slice(0, 5).flatMap((r) => [...r.warnings, ...(r.errors ?? [])]),
    ).toEqual([]);
    expect(result[5].errors?.some((e) => e.startsWith("LABEL_OVERLAP:"))).toBe(
      true,
    );
  });
}
