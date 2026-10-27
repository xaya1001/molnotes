import { readFileSync } from "node:fs";
import { expect, test } from "./helpers/test";
import { parse } from "yaml";

// Every published kind of timeline and flow, at desktop and phone width:
// the preview page must find nothing a reader would trip over.
const gallery: { kind: string; caption: string; value: unknown }[] = parse(
  readFileSync("tests/fixtures/diagrams/gallery.yaml", "utf8"),
);

for (const [width, height] of [
  [1366, 900],
  [390, 844],
])
  test(`the figure gallery lays out without warnings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      (figures) => {
        window.__previewFigures = figures;
      },
      gallery.map((f, i) => ({ ...f, where: `gallery ${i + 1}` })),
    );
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult, null, {
      timeout: 60_000,
    });
    for (const [i] of gallery.entries())
      await page.locator(`[data-preview="${i}"]`).screenshot({
        path: test.info().outputPath(`${String(i + 1).padStart(2, "0")}.png`),
      });
    const result = await page.evaluate(() => window.__previewResult);
    expect(result!.filter((r) => r.warnings.length)).toEqual([]);
  });
