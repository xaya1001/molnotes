import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { conformations, scaffolds } from "./figure-template-data.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import { scaffoldLayout } from "./figure-scaffolds.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { parseFigureStyle } from "../src/ui/library/scene-geometry.ts";
import type {
  Conformation,
  LibraryEntry,
} from "../shared/chemical-library/types.ts";

const args = process.argv.slice(2),
  out = args[args.indexOf("--out") + 1];
if (!args.includes("--out") || !out)
  throw new Error("Usage: npm run figure:templates -- --out <directory>");
await mkdir(out, { recursive: true });
const toolkit = await moleculeToolkit(),
  fonts = await loadFigureFonts(),
  style = parseFigureStyle(
    await readFile(
      new URL("../src/ui/styles/tokens.css", import.meta.url),
      "utf8",
    ),
  );
const sources = [
  {
    source: "unknown",
    locator: "Template overview",
    note: "Neutral template examples",
  },
];
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
async function render(entry: LibraryEntry, name: string) {
  const geometry = await prepareFigure(
    { [entry.id]: entry },
    { ref: entry.id },
    { toolkit, fonts, style },
  );
  await writeFile(join(out, name + ".svg"), geometrySvg(geometry));
  return `<img src="${name}.svg" alt="${escape(entry.title)}">`;
}
const rows: string[] = [];
for (const name of [...conformations.keys(), "newman", "fischer", "sawhorse"]) {
  const base: Conformation = {
    kind: "conformation",
    id: "cnf_" + name,
    title: name,
    template: name,
    sources,
  };
  const data = conformations.get(name),
    slotNames = data
      ? Object.keys(data.variants.normal.slots).filter((s) =>
          data.reface ? /[ae]$/.test(s) : /[ud]$/.test(s),
        )
      : [];
  const example: Conformation = data
    ? {
        ...base,
        subs: Object.fromEntries(
          slotNames.slice(0, 2).map((s, i) => [s, i ? "H" : "R^1"]),
        ),
      }
    : name === "fischer"
      ? {
          ...base,
          top: "CHO",
          bottom: "CH2OH",
          rows: [
            ["H", "OH"],
            ["OH", "H"],
          ],
        }
      : { ...base, front: ["CH3", "H", "H"], back: ["H", "CH3", "H"] };
  rows.push(
    `<article><h3>${escape(name)}</h3><div class="pair"><figure>${await render({ ...base, slots: true }, name + "-slots")}<figcaption>槽位</figcaption></figure><figure>${await render(example, name + "-example")}<figcaption>取代基示例</figcaption></figure></div></article>`,
  );
}
const skeletal: string[] = [];
for (const data of scaffolds) {
  const base = prepareCompound(toolkit, {
    id: "cmp_" + data.id,
    title: data.id,
    smiles: data.smiles,
    sources,
  });
  const example = prepareCompound(toolkit, {
    id: "cmp_" + data.id + "_example",
    title: data.id,
    smiles: "C" + data.smiles,
    sources,
  });
  const columns: string[] = [];
  for (const drawing of ["perspective", "flat"] as const)
    for (const [name, c] of [
      ["core", base],
      ["example", example],
    ] as const) {
      const entry = { ...c, layout: scaffoldLayout(toolkit, c, drawing) };
      columns.push(
        `<figure>${await render(entry, `${data.id}-${drawing}-${name}`)}<figcaption>${drawing} · ${name === "core" ? "骨架" : "取代基示例"}</figcaption></figure>`,
      );
    }
  skeletal.push(
    `<article><h3>${escape(data.id)}</h3><div class="pair">${columns.join("")}</div></article>`,
  );
}
await writeFile(
  join(out, "index.html"),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>化学模板总览</title><style>:root{--bg:#fff;--ink:#1b1b1b;--line:#ddd;--gap:24px}body{background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;max-width:1200px}article{border-top:1px solid var(--line);padding:16px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}figure{margin:0;min-width:0}img{width:100%;height:240px;object-fit:contain}figcaption{text-align:center}a{font-weight:500}@media(max-width:600px){body{padding:16px}.pair{grid-template-columns:1fr}}</style><h1>化学模板总览</h1><nav><a href="#conformations">构象与投影式</a> · <a href="#scaffolds">骨架</a></nav><h2 id="conformations">构象与投影式</h2>${rows.join("")}<h2 id="scaffolds">骨架</h2>${skeletal.join("")}</html>`,
);
console.log(join(out, "index.html"));
