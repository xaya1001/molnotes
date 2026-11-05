import { expect, test } from "./helpers/test.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import type {
  Library,
  LibrarySnapshot,
  Reaction,
} from "../shared/chemical-library/types.ts";

test.setTimeout(90_000);
async function fixture(): Promise<LibrarySnapshot> {
  const toolkit = await moleculeToolkit();
  const sources = [{ source: "handbook", locator: "Example 1" }];
  const compound = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example structure",
    smiles: "CC(N)C(=O)O",
    sources,
  });
  const reaction: Reaction = {
    kind: "reaction",
    id: "rxn_example",
    title: "Example transformation",
    sources,
    reactants: [{ id: "input", compound: compound.id }],
    products: [{ id: "output", compound: compound.id, yield: 0.8 }],
    reagents: ["Reagent"],
    conditions: ["Ambient temperature"],
    explanation: "The selected transformation uses the shared structure.",
    scene: {
      width: 24,
      height: 9,
      molecules: [
        { id: "input", compound: compound.id, at: { x: 4, y: 4 } },
        { id: "output", compound: compound.id, at: { x: 20, y: 4 } },
      ],
    },
    arrow: { from: { x: 8, y: 4 }, to: { x: 16, y: 4 }, textWidth: 8 },
  };
  const entries: Library = { [compound.id]: compound, [reaction.id]: reaction };
  return {
    entries,
    uses: {
      cmp_example: [{ path: "/library/#rxn_example", title: reaction.title }],
      rxn_example: [],
    },
  };
}

test("complete library previews share one saved layout and preserve local scroll on phones", async ({
  page,
}) => {
  const library = await fixture();
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  await expect(page.locator(".entry")).toHaveCount(2);
  await expect(
    page.locator('[data-molecule][data-compound="cmp_example"]'),
  ).toHaveCount(3);
  await expect(page.locator('[role="alert"]')).toHaveCount(0);
  await expect(page.locator('[data-check="passed"]')).toHaveCount(2);
  const signatures = () =>
    page
      .locator('[data-molecule][data-compound="cmp_example"]')
      .evaluateAll((nodes) =>
        nodes.map((n) =>
          [...n.querySelectorAll("[data-bond]")]
            .map((b) => b.getAttribute("d"))
            .join("|"),
        ),
      );
  const before = await signatures();
  const compound = library.entries.cmp_example;
  if (compound.kind !== "compound") throw new Error("Invalid fixture");
  compound.layout.pins = {
    a1: { ...compound.layout.coords.a1, x: compound.layout.coords.a1.x + 0.2 },
  };
  await page.reload();
  await expect(
    page.locator('[data-molecule][data-compound="cmp_example"]'),
  ).toHaveCount(3);
  const after = await signatures();
  expect(after.every((value, i) => value !== before[i])).toBe(true);
  const arrow = page.locator('[data-reaction-id="rxn_example"]');
  await arrow.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#rxn_example .library-figure > p")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const canvas = page.locator("#rxn_example .library-canvas");
  await expect
    .poll(() => canvas.evaluate((e) => e.scrollWidth > e.clientWidth))
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const smallestText = await canvas
    .locator("svg")
    .evaluate((svg: SVGSVGElement) => {
      const scale =
        svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      return Math.min(
        ...[...svg.querySelectorAll("text")].map(
          (text) => parseFloat(getComputedStyle(text).fontSize) * scale,
        ),
      );
    });
  expect(smallestText).toBeGreaterThanOrEqual(11 - 0.1);
});

test("diagnostics reject a saved label collision while keeping the full entry visible for repair", async ({
  page,
}) => {
  const library = await fixture();
  const c = library.entries.cmp_example;
  if (c.kind !== "compound") throw new Error("Invalid fixture");
  c.layout.pins = { a3: { ...c.layout.coords.a5 } };
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  await expect(
    page.locator('#cmp_example [data-diagnostic="LABEL_OVERLAP"]'),
  ).not.toHaveCount(0);
  await expect(page.locator(".entry")).toHaveCount(2);
});

test("local numbers sit below the visible ink of folded groups", async ({
  page,
}) => {
  const library = await fixture();
  const compound = prepareCompound(await moleculeToolkit(), {
    id: "cmp_folded",
    title: "Phosphine oxide",
    smiles: "O=P(c1ccccc1)(c1ccccc1)c1ccccc1",
    sources: [{ source: "handbook", locator: "Example 2" }],
  });
  compound.layout.abbreviations = ["PPh3"];
  library.entries[compound.id] = compound;
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.route("**/api/topics/minimal", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    topic.content.chapters[0].blocks = [
      { type: "figure-ref", ref: compound.id, numbers: { compound: "4" } },
    ];
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/minimal/start");
  const molecule = page.locator('[data-compound="cmp_folded"]');
  await expect(molecule).toBeVisible();
  const geometry = await molecule.evaluate((node) => {
    const number = node
      .querySelector('[data-label="compound:number"]')!
      .getBoundingClientRect();
    const ink = [
      ...node.querySelectorAll(
        '[data-label]:not([data-label="compound:number"]), [data-bond]',
      ),
    ].map((e) => e.getBoundingClientRect());
    return {
      numberTop: number.top,
      numberCenter: (number.left + number.right) / 2,
      bottom: Math.max(...ink.map((b) => b.bottom)),
      center:
        (Math.min(...ink.map((b) => b.left)) +
          Math.max(...ink.map((b) => b.right))) /
        2,
    };
  });
  expect(geometry.numberTop).toBeGreaterThan(geometry.bottom);
  expect(Math.abs(geometry.numberCenter - geometry.center)).toBeLessThan(1);
});

test("mechanism step selection keeps the explanation with its drawing", async ({
  page,
}) => {
  const library = await fixture();
  const compound = library.entries.cmp_example;
  library.entries.mec_example = {
    kind: "mechanism",
    id: "mec_example",
    title: "Example steps",
    sources: compound.sources,
    category: "reaction",
    frames: ["first", "second"].map((id) => ({
      id,
      title: id,
      explanation: `Explanation for ${id}`,
      scene: {
        width: 12,
        height: 8,
        molecules: [
          { id: "structure", compound: compound.id, at: { x: 6, y: 4 } },
        ],
      },
    })),
  };
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.route("**/api/topics/minimal", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    topic.content.chapters[0].blocks = [
      { type: "figure-ref", ref: "mec_example" },
    ];
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/minimal/start");
  const figure = page.locator(".library-figure");
  await expect(figure.locator('[data-figure="mec_example"]')).toBeVisible();
  await expect(
    figure.getByText("Explanation for first", { exact: true }),
  ).toBeVisible();
  await figure.getByRole("button", { name: "second", exact: true }).click();
  await expect(
    figure.getByText("Explanation for second", { exact: true }),
  ).toBeVisible();
  await expect(
    figure.getByText("Explanation for first", { exact: true }),
  ).toHaveCount(0);
});

test("deuterium uses one full-size native D glyph without changing identity", async ({
  page,
}) => {
  const compound = prepareCompound(await moleculeToolkit(), {
    id: "cmp_isotope",
    title: "Labelled structure",
    smiles: "[2H]CC(=O)C",
    sources: [{ source: "handbook", locator: "Example" }],
  });
  const library = { entries: { [compound.id]: compound }, uses: {} };
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.route("**/api/topics/minimal", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    topic.content.chapters[0].blocks = [
      { type: "figure-ref", ref: compound.id },
    ];
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/minimal/start");
  const atom = page.locator('[data-label="compound:a1"]');
  await expect(atom).toHaveCount(1);
  await expect(atom).toBeVisible();
  const height = await atom.evaluate(
    (glyph) => glyph.getBoundingClientRect().height,
  );
  expect(height).toBeGreaterThan(10);
  expect(compound.graph).toContain("[2H]");
});
