import { panelReferences, type Panels } from "../shared/panels.ts";
// Renders the figures of content units as a reader will see them, without
// publishing: timelines, flows, panels and structures from the content directory,
// drawn by this checkout's components at desktop and phone width. Prints
// where each screenshot went, the layout warnings the page found and the
// structures whose drawing stacks atoms or bonds.
//
//   npm run content:preview -- notes/<dir>[/<slug>] | sites/<slug> ...
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  topicFigures,
  type PreviewNote,
  type PreviewRequest,
  type PreviewFigure as Figure,
} from "../shared/content-preview.ts";
import { prepareFigureViews } from "./content/figure-build.ts";
import type {
  FigureReference,
  LibrarySnapshot,
} from "../shared/chemical-library/types.ts";
import { previewNotes } from "./content/notes-preview.ts";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { compileUnit } from "./content/compile-unit.ts";
import { inspectRequest } from "./content/requests.ts";
import { parseSiteManifest } from "../shared/site-catalog.ts";
import { layoutProblems } from "../shared/molecule-layout.ts";
import { setting } from "../shared/settings.ts";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const repo = resolve(import.meta.dirname, "..");
const content = setting("MOLNOTES_CONTENT_DIR");
const library = await readChemicalLibrary(content);
const cache = join(
  process.env.XDG_CACHE_HOME || process.env.TMPDIR || join(homedir(), ".cache"),
  "molnotes",
);
const widths = [
  [1366, 900],
  [390, 844],
];
async function unitFigures(unit: string, errors: string[]) {
  const [kind, slug] = unit.split("/");
  if (kind === "sites" && slug) {
    const siteUnit = `sites/${slug}`;
    const file = `sites/${slug}/content.json`;
    const source = JSON.parse(await readFile(join(content, file), "utf8"));
    const site = parseSiteManifest(
      slug,
      JSON.parse(await readFile(join(content, siteUnit, "site.json"), "utf8")),
    );
    const requests: Figure[] = [];
    const common = {
      root: content,
      unit: siteUnit,
      authored: source,
      group: site.group,
      library: library.entries,
      onRequest: async (source: string, file: string, line: number) => {
        const value: PreviewRequest = {
          ...(await inspectRequest(source, file, line)),
          id: `preview-${file.replaceAll("/", "--").replace(".md", "")}-${line}`,
        };
        requests.push({
          kind: "request",
          where: `${file}:${line}`,
          value,
          caption: value.caption,
        });
      },
    };
    const selection = unit.slice(siteUnit.length + 1);
    const compiled = selection
      ? await compileUnit({
          ...common,
          kind: "chapter",
          chapter: selection.startsWith("content.json#")
            ? selection.slice(13)
            : selection,
        })
      : await compileUnit({ ...common, kind: "site" });
    const topic =
      "content" in compiled
        ? compiled.content
        : { chapters: [compiled.chapter], data: compiled.data };
    return [...topicFigures(topic, file, errors, library.entries), ...requests];
  }
  if (kind === "notes" && slug) {
    const { previews, assets } = await previewNotes(
      content,
      unit,
      library.entries,
    );
    for (const asset of assets) {
      const bytes = Buffer.isBuffer(asset.bytes)
        ? asset.bytes
        : await readFile(asset.bytes.file);
      library.assets.push({ ...asset, bytes });
    }
    return previews.map((value): Figure => ({
      kind: "note",
      where: `${value.note.path.slice(1)}.md`,
      value,
      caption: "",
    }));
  }
  throw new Error(
    `${unit}: expected notes/<dir>, notes/<dir>/<slug> or sites/<slug>`,
  );
}

/** This checkout's build; a clean checkout reuses it across runs. */
async function build() {
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync(
    "git",
    ["status", "--porcelain", "src", "shared", "index.html"],
    {
      cwd: repo,
      encoding: "utf8",
    },
  ).trim();
  const out = join(cache, "preview-build", dirty ? `${head}-dirty` : head);
  const ready = await stat(join(out, "showcase/index.html")).then(
    () => true,
    () => false,
  );
  if (!ready || dirty)
    execFileSync(
      join(repo, "node_modules/.bin/vite"),
      [
        "build",
        "--configLoader",
        "runner",
        "--outDir",
        out,
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      { cwd: repo, stdio: "inherit" },
    );
  return out;
}

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
// The page chrome asks for the site's sections and records; a preview has none.
const emptyApi: Record<string, unknown> = {
  "/api/catalog": { groups: [], sites: [], directories: [] },
  "/api/records": {},
};
function serve(root: string, snapshot: LibrarySnapshot) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://local").pathname;
    if (Object.hasOwn(emptyApi, path)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(emptyApi[path]));
      return;
    }
    if (path === "/api/library") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(snapshot));
      return;
    }
    const asset = library.assets.find(
      (asset) => `/${asset.scope}/${asset.path}` === path,
    );
    if (asset) {
      response.writeHead(200, { "content-type": asset.content_type });
      response.end(asset.bytes);
      return;
    }
    const file = extname(path)
      ? join(root, path)
      : join(root, path.split("/")[1], "index.html");
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise<Server>((done) =>
    server.listen(0, "127.0.0.1", () => done(server)),
  );
}

const units = process.argv.slice(2);
if (!units.length) {
  console.error(
    "Usage: npm run content:preview -- notes/<dir>[/<slug>] | sites/<slug> ...",
  );
  process.exit(1);
}
const errors: string[] = [];
const figures: Figure[] = [];
for (const unit of units) figures.push(...(await unitFigures(unit, errors)));
for (const error of errors) console.error(error);
if (!figures.length) {
  console.log("没有可预览的时间线、流程图、分格图或结构式。");
  process.exit(errors.length ? 1 : 0);
}
const out =
  process.env.MOLNOTES_PREVIEW_DIR ||
  join(cache, "preview", units.map((u) => u.split("/").at(-1)).join("+"));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const prepared = await prepareFigureViews(
  library.entries,
  figures.flatMap((figure) =>
    figure.kind === "library"
      ? [figure.value as FigureReference]
      : figure.kind === "panels"
        ? panelReferences(figure.value as Panels)
        : figure.kind === "note"
          ? ((figure.value as PreviewNote).note.diagrams ?? []).flatMap(
              (diagram) =>
                diagram.kind === "library"
                  ? [diagram.reference]
                  : diagram.kind === "panels"
                    ? panelReferences(diagram.panels)
                    : [],
            )
          : [],
  ),
  content,
);
library.assets.push(...prepared.assets);
const snapshot: LibrarySnapshot = {
  entries: library.entries,
  uses: {},
  renders: prepared.renders,
};
const server = await serve(await build(), snapshot);
const browser = await chromium.launch();
const report = figures.map((figure) => ({
  ...figure,
  shots: [] as string[],
  warnings: [] as string[],
}));
try {
  for (const [width, height] of widths) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await page.addInitScript(
      ({ figures, snapshot }) => {
        window.__previewFigures = figures;
        window.__previewLibrary = snapshot;
      },
      { figures, snapshot },
    );
    await page.goto(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/showcase/preview`,
    );
    await page.waitForFunction(() => window.__previewResult, null, {
      timeout: 90_000,
    });
    // The wait above returned once the page set its result.
    const result = (await page.evaluate(() => window.__previewResult))!;
    for (const [i, entry] of report.entries()) {
      const shot = join(out, `${String(i + 1).padStart(2, "0")}-${width}.png`);
      await page.locator(`[data-preview="${i}"]`).screenshot({ path: shot });
      entry.shots.push(shot);
      for (const warning of result[i].warnings)
        entry.warnings.push(`${width}px：${warning}`);
      for (const error of result[i].errors ?? []) {
        const message = `${entry.where} ${width}px: ${error}`;
        errors.push(message);
        console.error(message);
      }
    }
    if (figures.some((figure) => figure.kind === "note")) {
      const shot = join(out, `page-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      console.log(shot);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
const toolkit = await moleculeToolkit();
for (const entry of report) {
  const molecules =
    entry.kind === "note"
      ? (entry.value as PreviewNote).note.molecules.flatMap(
          (row) => row.molecules,
        )
      : entry.kind === "molecule"
        ? (entry.value as { smiles: string }[])
        : [];
  molecules.forEach(({ smiles }: { smiles: string }, k: number) => {
    // A SMILES RDKit cannot read already shows as a render failure above.
    const mol = toolkit.get_mol(smiles);
    if (!mol) return;
    mol.delete();
    const problems = layoutProblems(toolkit, smiles);
    if (problems.length)
      entry.warnings.push(
        `第 ${k + 1} 个结构：${problems.join("，")}；用 npm run molecule:layout 生成坐标`,
      );
  });
}
let warned = 0;
for (const [i, entry] of report.entries()) {
  console.log(`\n${i + 1}. ${entry.kind}  ${entry.where}`);
  for (const shot of entry.shots) console.log(`   ${shot}`);
  for (const warning of entry.warnings) console.log(`   ⚠ ${warning}`);
  if (entry.warnings.length) warned++;
}
console.log(
  `\n${report.length} 张图，${warned} 张有版面警告${errors.length ? `，${errors.length} 处写法错误` : ""}。`,
);
process.exit(errors.length ? 1 : 0);
