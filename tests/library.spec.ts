import { serveFigureViews } from "./helpers/figure-views.ts";
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
    products: [{ id: "output", compound: compound.id, yield: "80%" }],
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
  await serveFigureViews(page, library);
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
    a1: {
      x:
        compound.layout.coords.a1.x +
        (compound.layout.coords.a2.x - compound.layout.coords.a1.x) * 0.4,
      y:
        compound.layout.coords.a1.y +
        (compound.layout.coords.a2.y - compound.layout.coords.a1.y) * 0.4,
    },
  };
  await page.reload();
  await expect(
    page.locator('[data-molecule][data-compound="cmp_example"]'),
  ).toHaveCount(3);
  const after = await signatures();
  expect(after).toEqual(before);
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
  const smallestBond = await canvas
    .locator("[data-bond-lengths]")
    .evaluateAll((nodes) =>
      Math.min(
        ...nodes.map((node) => {
          const molecule = node as SVGGElement,
            matrix = molecule.getScreenCTM()!;
          const lengths: number[] = JSON.parse(molecule.dataset.bondLengths!);
          return Math.min(...lengths) * Math.hypot(matrix.a, matrix.b);
        }),
      ),
    );
  expect(smallestBond).toBeGreaterThanOrEqual(20 - 0.2);
  if (process.env.MOLNOTES_FIGURE_SCREENS)
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await canvas.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${process.env.MOLNOTES_FIGURE_SCREENS}/snapshot-reader-${width}.png`,
      });
    }
});

test("diagnostics reject a saved label collision while keeping the full entry visible for repair", async ({
  page,
}) => {
  const library = await fixture();
  const c = library.entries.cmp_example;
  if (c.kind !== "compound") throw new Error("Invalid fixture");
  c.layout.pins = { a3: { ...c.layout.coords.a5 } };
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  await expect(
    page.locator('#cmp_example [data-diagnostic="LABEL_OVERLAP"]'),
  ).not.toHaveCount(0);
  await expect(page.locator(".entry")).toHaveCount(2);
});

test("wrapped reaction conditions leave visible space between CJK and Latin lines", async ({
  page,
}) => {
  const library = await fixture();
  const reaction = library.entries.rxn_example;
  if (reaction.kind !== "reaction") throw new Error("Invalid fixture");
  reaction.reagents = [
    "试剂甲与试剂乙混合后缓慢加入反应体系",
    "Reagent A / Me2S / H₂O",
  ];
  reaction.conditions = [
    "室温搅拌后加热并保持反应温度",
    "Ambient temperature",
    "DMF，0–25 °C，16 h；THF，0 °C，1 h；DCM，−20–25 °C，2 h",
  ];
  reaction.arrow.textWidth = 4;
  reaction.scene.height = 16;
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  const entry = page.locator("#rxn_example");
  await expect(entry.locator("[data-check]")).toHaveAttribute(
    "data-check",
    /passed|error/,
  );
  expect(await entry.locator("[data-diagnostic]").allTextContents()).toEqual(
    [],
  );
  const lines = await entry
    .locator('[data-label*="rxn_example:condition:"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-text") ?? ""),
    );
  for (const token of ["DCM", "Me2S", "−20–25 °C"])
    expect(lines.some((line) => line.includes(token))).toBe(true);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const gaps = await entry.locator("svg").evaluate((svg) => {
      return [-1, 1].flatMap((sign) => {
        const lines = [
          ...svg.querySelectorAll(
            `[data-label^="rxn_example:condition:${sign}:"]`,
          ),
        ]
          .map((el) => el.getBoundingClientRect())
          .sort((a, b) => a.top - b.top);
        return lines.slice(1).map((line, i) => line.top - lines[i].bottom);
      });
    });
    expect(gaps.length).toBeGreaterThan(2);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
  }
});

test("published labelled ions show one circled charge", async ({ page }) => {
  const compound = prepareCompound(await moleculeToolkit(), {
    id: "cmp_ion",
    title: "Example ion",
    smiles: "[Na+]",
    sources: [{ source: "handbook", locator: "Example 3" }],
  });
  const library = { entries: { [compound.id]: compound }, uses: {} };
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({
      json: library,
    }),
  );
  await page.goto("/library/");
  const entry = page.locator("#cmp_ion");
  await expect(entry.locator('[data-check="passed"]')).toHaveCount(1);
  // N and a are the only native glyphs; the charge is drawn by the shared renderer.
  await expect(
    entry.locator('path.atom-0[data-label="compound:a1"]'),
  ).toHaveCount(2);
  await expect(entry.locator('[data-charge-owner="compound:a1"]')).toHaveCount(
    1,
  );
});

test("published separate components retain labels and readable bonds", async ({
  page,
}) => {
  const toolkit = await moleculeToolkit();
  const compounds = [
    ["cmp_chain", "CCC"],
    ["cmp_components", "CO.OC1CCCCO1"],
    ["cmp_isotope", "[13CH3]O.OC1CCCCO1"],
    ["cmp_radical", "c1ccccc#1.[NH2-]"],
    ["cmp_amine", "CNC1CCCCC1"],
    ["cmp_hashed", "CN[C@@H](F)Cl"],
  ].map(([id, smiles]) =>
    prepareCompound(toolkit, {
      id,
      title: "Example structure",
      smiles,
      sources: [{ source: "example", locator: "Structures" }],
    }),
  );
  const hashed = compounds.find((compound) => compound.id === "cmp_hashed")!;
  hashed.layout = {
    coords: {
      a1: { x: -2, y: 1 },
      a2: { x: -1, y: 1 },
      a3: { x: 0, y: 0 },
      a4: { x: 0, y: -1 },
      a5: { x: 1, y: 0 },
    },
    wedgeBonds: [{ from: "a3", to: "a2", style: "hashed" }],
  };
  const entries = Object.fromEntries(compounds.map((c) => [c.id, c]));
  const library = { entries, uses: {} };
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({
      json: library,
    }),
  );
  await page.goto("/library/");
  await expect(page.locator("#cmp_chain svg")).toBeVisible();
  await expect(page.locator('[data-check="passed"]')).toHaveCount(6);
  await expect(
    page
      .locator(
        '#cmp_components [data-label="compound:a1"][data-label-text="Me"]',
      )
      .first(),
  ).toBeVisible();
  await expect(page.locator('#cmp_isotope [data-label-text="Me"]')).toHaveCount(
    0,
  );
});

test("fused stereocentres use explicit H wedges and salts keep counterions near their charge centre", async ({
  page,
}) => {
  const toolkit = await moleculeToolkit();
  const sources = [{ source: "example", locator: "structures" }];
  const fused = prepareCompound(toolkit, {
    id: "cmp_fused",
    title: "Fused stereocentres",
    sources,
    smiles: "C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CCC4=C3C=CC(=C4)O",
  });
  const source = toolkit.get_mol(fused.smiles)!;
  const query = toolkit.get_qmol("[R]@[R]")!;
  const ringBonds: number[] = JSON.parse(
    source.get_substruct_matches(query),
  ).flatMap((m: { bonds: number[] }) => m.bonds);
  source.delete();
  query.delete();
  const rotated = structuredClone(fused);
  rotated.id = "cmp_fused_rotated";
  for (const p of Object.values(rotated.layout.coords)) {
    const x = -p.y;
    p.y = p.x;
    p.x = x;
  }
  const pairs = [
    "CC(=O)[O-].[Na+]",
    "C[N+](C)(C)C.[Cl-]",
    "C[NH2+]CCO.[O-]C(=O)c1ccccc1",
  ].map((smiles, i) => {
    const c = prepareCompound(toolkit, {
      id: `cmp_pair${i}`,
      title: "Ion pair",
      smiles,
      sources,
    });
    if (i < 2) c.layout.coords[c.atomIds.at(-1)!].x += 10;
    return c;
  });
  const entries = Object.fromEntries(
    [fused, rotated, ...pairs].map((c) => [c.id, c]),
  );
  const library = { entries, uses: {} };
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({
      json: library,
    }),
  );
  await page.goto("/library/");
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expect(page.locator('#cmp_fused [data-check="passed"]')).toHaveCount(
      1,
    );
    const h = page.locator('#cmp_fused [data-label^="compound:hydrogen-"]');
    expect(
      await h.evaluateAll(
        (nodes) => new Set(nodes.map((e) => e.getAttribute("data-label"))).size,
      ),
    ).toBe(3);
    for (const id of [fused.id, rotated.id])
      for (const i of ringBonds) {
        const wedges = await page
          .locator(`#${id} [data-bond="compound:b${i}"]`)
          .evaluateAll(
            (nodes) =>
              nodes.filter((e) => {
                const p = e as SVGPathElement;
                return (
                  getComputedStyle(p).fill !== "none" ||
                  (p.getAttribute("d")?.match(/M/g)?.length ?? 0) > 2
                );
              }).length,
          );
        expect(wedges).toBe(0);
      }
    const adjustments = await page
      .locator("#cmp_fused_rotated [data-bond][transform]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const m = (
            node as SVGGraphicsElement
          ).transform.baseVal.consolidate()!.matrix;
          return [
            Math.hypot(m.a, m.b),
            Math.hypot(m.c, m.d),
            m.a * m.d - m.b * m.c,
          ];
        }),
      );
    for (const values of adjustments)
      for (const value of values) expect(value).toBeCloseTo(1, 6);
    for (const id of Object.keys(entries)) {
      const check = page.locator(`#${id} [data-check]`);
      await expect
        .poll(async () =>
          (await check.count()) ? check.getAttribute("data-check") : "pending",
        )
        .not.toBe("pending");
      expect(
        await page.locator(`#${id} [data-diagnostic]`).allTextContents(),
      ).toEqual([]);
    }
    for (const c of pairs) {
      const distance = await page
        .locator(`#${c.id} [data-molecule]`)
        .evaluate((g) => {
          const markers = [
            ...g.querySelectorAll<SVGGElement>("[data-charge-owner]"),
          ];
          const boxes = markers.map((e) => e.getBBox());
          return Math.hypot(boxes[0].x - boxes[1].x, boxes[0].y - boxes[1].y);
        });
      expect(distance).toBeLessThan(80);
      const margins = await page
        .locator(`#${c.id} svg`)
        .evaluate((svg: SVGSVGElement) => {
          const outer = svg.getBoundingClientRect();
          const ink = svg
            .querySelector<SVGGElement>("[data-molecule]")!
            .getBoundingClientRect();
          return [
            Math.abs(ink.left - outer.left - (outer.right - ink.right)),
            Math.abs(ink.top - outer.top - (outer.bottom - ink.bottom)),
          ];
        });
      expect(Math.max(...margins)).toBeLessThan(1);
    }
  }
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
  await serveFigureViews(page, library, [
    { ref: compound.id, numbers: { compound: "4" } },
  ]);
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

test("wrapped route connections clear quantities and reaction heads at every row", async ({
  page,
}) => {
  const library = await fixture();
  const base = library.entries.rxn_example;
  if (base.kind !== "reaction") throw new Error("Invalid fixture");
  for (const [id, count, shift] of [
    ["rte_two", 2, 0],
    ["rte_seven", 7, 0],
    ["rte_quantity", 3, 16],
  ] as const) {
    const steps = Array.from({ length: count }, (_, i) => {
      const reaction = structuredClone(base);
      reaction.id = `rxn_${id}_${i}`;
      reaction.products[0].yield = i % 2 ? "100%" : "67.7%";
      library.entries[reaction.id] = reaction;
      return {
        id: `step${i}`,
        reaction: reaction.id,
        at: { x: shift * i, y: 11 * i },
      };
    });
    library.entries[id] = {
      kind: "route",
      id,
      title: "Example route",
      sources: base.sources,
      steps,
      edges: steps.slice(1).map((s, i) => ({
        from: steps[i].id,
        to: s.id,
        product: "output",
        reactant: "input",
      })),
      width: 24 + shift * (count - 1),
      height: 11 * count,
    };
  }
  for (const id of Object.keys(library.entries)) library.uses[id] ??= [];
  library.previews = Object.fromEntries(
    Object.keys(library.entries)
      .filter((id) => !id.startsWith("rte_"))
      .map((id) => [id, "/sites/minimal/static/sample.svg"]),
  );
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  for (const id of ["rte_two", "rte_seven", "rte_quantity"]) {
    const entry = page.locator(`#${id}`);
    await expect(entry.locator("[data-check]")).toHaveAttribute(
      "data-check",
      /passed|error/,
      { timeout: 30000 },
    );
    expect(await entry.locator("[data-diagnostic]").allTextContents()).toEqual(
      [],
    );
    const connections = await entry.locator("svg").evaluate((svg) =>
      [...svg.querySelectorAll<SVGPathElement>("[data-route-edge]")].map(
        (edge) => {
          const [from, to] = edge.dataset.routeEdge!.split("->");
          const quantity = svg
            .querySelector(`[data-label="${from}:quantity"]`)!
            .getBoundingClientRect();
          const target = svg
            .querySelector(`[data-molecule="${to}"]`)!
            .getBoundingClientRect();
          const matrix = edge.getScreenCTM()!;
          const start = edge.getPointAtLength(0).matrixTransform(matrix),
            next = edge.getPointAtLength(1).matrixTransform(matrix),
            end = edge
              .getPointAtLength(edge.getTotalLength())
              .matrixTransform(matrix);
          return {
            afterQuantity: start.y > quantity.bottom,
            beforeInput: end.y < target.top,
            verticalStart: Math.abs(next.x - start.x) < 0.1,
          };
        },
      ),
    );
    expect(
      connections.every(
        (c) => c.afterQuantity && c.beforeInput && c.verticalStart,
      ),
    ).toBe(true);
  }
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
          {
            id: "structure",
            compound: compound.id,
            at: { x: id === "first" ? 5 : 7, y: 4 },
          },
        ],
      },
    })),
  };
  const reference = {
    ref: "mec_example",
    numbers: { structure: "7" },
    focus: { primary: { atoms: [{ molecule: "structure", atom: "a3" }] } },
  };
  await serveFigureViews(page, library, [reference]);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.route("**/api/topics/minimal", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    topic.content.chapters[0].blocks = [{ type: "figure-ref", ...reference }];
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/minimal/start");
  const figure = page.locator(".library-figure");
  await expect(figure.locator('[data-figure="mec_example"]')).toBeVisible();
  await expect(
    figure.getByText("Explanation for first", { exact: true }),
  ).toBeVisible();
  const first = await figure.locator("svg").innerHTML();
  await expect(
    figure.locator('[data-label="structure:number"]'),
  ).toHaveAttribute("data-text", "7");
  await figure.getByRole("button", { name: "second", exact: true }).click();
  await expect(
    figure.getByText("Explanation for second", { exact: true }),
  ).toBeVisible();
  await expect(
    figure.getByText("Explanation for first", { exact: true }),
  ).toHaveCount(0);
  await expect(
    figure.locator('[data-label="structure:number"]'),
  ).toHaveAttribute("data-text", "7");
  await expect.poll(() => figure.locator("svg").innerHTML()).not.toBe(first);
  if (process.env.MOLNOTES_FIGURE_SCREENS)
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      await figure.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${process.env.MOLNOTES_FIGURE_SCREENS}/snapshot-frames-${width}.png`,
      });
    }
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
  await serveFigureViews(page, library);
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

test("adjacent bond transfers use a readable arc when space is available", async ({
  page,
}) => {
  const { compileFigure } = await import("../scripts/figure-scene.ts");
  const { entries, reference } = await compileFigure({
    title: "Bond transfer",
    kind: "mechanism",
    frames: [
      {
        id: "transfer",
        smiles: "[2H:1][CH2:2][C:3](=[O:4])[CH3:5]",
        arrows: [{ id: "electron-1", from: "bond(1,2)", to: "bond(2,3)" }],
      },
    ],
  });
  const library: LibrarySnapshot = { entries, uses: {} };
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  const svg = page.locator(`[data-figure="${reference.ref}"]`);
  await expect(svg.locator('[data-electron-arrow="electron-1"]')).toBeVisible();
  const height = await svg.evaluate((svg) => {
    const shaft = svg.querySelector<SVGPathElement>(
      '[data-electron-arrow="electron-1"]',
    )!;
    const start = shaft.getPointAtLength(0);
    const tip = JSON.parse(
      svg.querySelector<SVGPathElement>('[data-arrow-head="electron-1"]')!
        .dataset.headPoints!,
    )[0];
    const chord = Math.hypot(tip.x - start.x, tip.y - start.y);
    const height = Math.max(
      ...Array.from({ length: 101 }, (_, i) => {
        const p = shaft.getPointAtLength((shaft.getTotalLength() * i) / 100);
        return (
          Math.abs(
            (tip.x - start.x) * (p.y - start.y) -
              (tip.y - start.y) * (p.x - start.x),
          ) / chord
        );
      }),
    );
    return (
      height /
      parseFloat(getComputedStyle(svg).getPropertyValue("--chemical-bond"))
    );
  });
  expect(height).toBeGreaterThanOrEqual(0.69);
});

test("a saved process reuses scenario controls and keyboard steps at both widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const process = {
    kind: "process",
    id: "prc_transfer",
    title: "Transfer process",
    sources: [{ source: "handbook", locator: "Example" }],
    label: "Transfer steps",
    nodes: [{ name: "Input" }, { name: "Output" }],
    scenarios: [
      {
        name: "Transfer",
        steps: [
          {
            title: "Prepare",
            text: "Prepare input",
            state: "Ready",
            kind: "local",
            from: 0,
            to: 0,
          },
          {
            title: "Move",
            text: "Transfer input",
            state: "At output",
            kind: "transfer",
            from: 0,
            to: 1,
          },
        ],
      },
      {
        name: "Blocked",
        steps: [
          {
            title: "Wait",
            text: "Blocked transfer",
            state: "At input",
            kind: "blocked",
            from: 0,
            to: 1,
          },
        ],
      },
    ],
  };
  await page.route("**/api/library", (route) =>
    route.fulfill({
      json: { entries: { [process.id]: process }, uses: { [process.id]: [] } },
    }),
  );
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/library/");
    const player = page.getByRole("region", { name: process.title });
    await expect(
      player.getByRole("heading", { name: process.title, exact: true }),
    ).toBeVisible();
    await player.press("ArrowRight");
    await expect(player.locator(".step-caption")).toContainText("Move");
    await player.getByRole("button", { name: "Blocked", exact: true }).click();
    await expect(player.locator(".step-caption")).toContainText("Wait");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("saved product separators are rendered once", async () => {
  const library = await fixture();
  const reaction = library.entries.rxn_example as Reaction;
  reaction.products.push({
    id: "second",
    compound: "cmp_example",
    yield: "20%",
  });
  reaction.scene.width = 40;
  reaction.scene.molecules.push({
    id: "second",
    compound: "cmp_example",
    at: { x: 31, y: 4 },
  });
  reaction.scene.captions = [{ at: { x: 25.5, y: 4 }, text: "+" }];
  const { prepareFigureViews } =
    await import("../scripts/content/figure-build.ts");
  const result = await prepareFigureViews(
    library.entries,
    [{ ref: reaction.id }],
    ".",
  );
  const svg = result.assets[0].bytes.toString();
  expect((svg.match(/data-text="\+"/g) ?? []).length).toBe(1);
  expect(Object.values(result.renders)[0].diagnostics).toEqual([]);
});

test("page-owned generated compounds stay out of the library list and search", async ({
  page,
}) => {
  const library = await fixture();
  library.entries.cmp_owned = {
    ...library.entries.cmp_example,
    id: "cmp_owned",
    title: "Page-only structure",
    owner: "sites/sample/collections/examples",
  };
  library.entries.rxn_example.owner = "rte_example";
  library.uses.cmp_owned = [{ path: "/sites/sample", title: "Sample" }];
  await serveFigureViews(page, library);
  await page.route("**/api/library", (route) =>
    route.fulfill({ json: library }),
  );
  await page.goto("/library/");
  await expect(page.locator(".entry")).toHaveCount(2);
  await expect(page.locator("#cmp_example")).toBeVisible();
  await expect(page.locator("#cmp_owned")).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "查找" });
  await search.fill("Page-only structure");
  await expect(page.locator(".entry")).toHaveCount(0);
  await search.fill("Example structure");
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator("#cmp_example")).toBeVisible();
});
