import { serveFigureViews } from "./helpers/figure-views.ts";
import { expect, test } from "./helpers/test.ts";
import { createHash } from "node:crypto";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import { topicFigures } from "../shared/content-preview.ts";
import type { Library } from "../shared/chemical-library/types.ts";
import type { TopicContent } from "../src/ui/topic/content.ts";

test.setTimeout(60_000);

for (const width of [1366, 390]) {
  test(`content preview checks library overviews and grouped figures at ${width}px`, async ({
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
    const image =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><circle cx="60" cy="30" r="20"/></svg>';
    const asset = createHash("sha256").update(image).digest("hex") + ".svg";
    const library: Library = {
      [c.id]: c,
      [bad.id]: bad,
      img_example: {
        id: "img_example",
        kind: "image",
        title: "Example image",
        sources,
        asset,
        mime: "image/svg+xml",
        width: 120,
        height: 60,
        alt: "Circle",
        purpose: "Preview verification",
        rights: "Generated verification fixture",
      },
      mec_example: {
        id: "mec_example",
        title: "Mechanism",
        kind: "mechanism",
        sources,
        category: "comparison",
        frames: ["first", "second"].map((id) => ({
          id,
          title: id,
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
              type: "panels",
              mode: "compare",
              items: [
                { title: "First", text: "Input", ref: c.id },
                { title: "Second", text: "Result", ref: "img_example" },
              ],
            },
            { type: "figure-ref", ref: bad.id },
            { type: "figure-ref", ref: "img_example", presentation: "figure" },
          ],
        },
      ],
    };
    const errors: string[] = [];
    const figures = [
      ...topicFigures(topic, "example", errors, library),
      {
        kind: "note" as const,
        where: "notes/example/demo.md",
        caption: "",
        value: {
          note: {
            path: "/notes/example/demo",
            directory: "example",
            slug: "demo",
            title: "Example note",
            summary: "",
            order: 1,
            html: '<div style="height:8000px"></div><div id="note-diagram-0" class="note-diagram"></div>',
            sections: [],
            molecules: [],
            diagrams: [
              {
                id: "note-diagram-0",
                kind: "library" as const,
                reference: {
                  ref: "img_example",
                  presentation: "note" as const,
                },
              },
            ],
            terms: [],
            citations: {},
          },
          terms: {},
          requests: [],
        },
      },
    ];
    expect(errors).toEqual([]);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.route(`**/library/assets/${asset}`, (route) =>
      route.fulfill({ body: image, contentType: "image/svg+xml" }),
    );
    await page.route("**/showcase/preview", async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      expect(html).toContain("</head>");
      await route.fulfill({
        response,
        body: html.replace(
          "</head>",
          '<style>[data-preview="4"]{margin-top:8000px}</style></head>',
        ),
      });
    });
    const snapshot = await serveFigureViews(page, {
      entries: library,
      uses: {},
    });
    await page.route("**/api/library", (route) =>
      route.fulfill({ json: snapshot }),
    );
    await page.addInitScript(
      ({ figures, library }) => {
        window.__previewFigures = figures;
        window.__previewLibrary = library;
      },
      { figures, library: snapshot },
    );
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    await expect(page.locator("[data-preview]")).toHaveCount(6);
    await expect(page.locator(".library-canvas svg")).toHaveCount(4);
    const result = (await page.evaluate(() => window.__previewResult))!;
    await expect(page.locator('[data-frame="first"]')).toBeVisible();
    await expect(page.locator('[data-frame="second"]')).toBeVisible();
    expect(
      result.slice(0, 3).flatMap((r) => [...r.warnings, ...(r.errors ?? [])]),
    ).toEqual([]);
    expect(result[3].errors?.some((e) => e.startsWith("LABEL_OVERLAP:"))).toBe(
      true,
    );
    expect(result[4].errors ?? []).toEqual([]);
    expect(result[5].errors ?? []).toEqual([]);
    await expect(page.locator('[data-preview="4"] img')).toHaveJSProperty(
      "naturalWidth",
      120,
    );
    await expect(page.locator('[data-preview="5"] img')).toHaveJSProperty(
      "naturalWidth",
      120,
    );
  });
}
