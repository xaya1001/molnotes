// Renders the figures of content units as a reader will see them, without
// publishing: timelines, flows and structures from the content directory,
// drawn by this checkout's components at desktop and phone width. Prints
// where each screenshot went and the layout warnings the page found.
//
//   npm run content:preview -- notes/<dir>[/<slug>] | sites/<slug> ...
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { chromium } from "playwright";
import { defineFlow } from "../src/ui/diagrams/flow.ts";
import { defineTimeline } from "../src/ui/diagrams/model.ts";
import { resolveData } from "./topic-blocks.mjs";
import { setting } from "./settings.mjs";

const repo = resolve(import.meta.dirname, "..");
const content = setting("MOLNOTES_CONTENT_DIR");
const cache = join(homedir(), ".cache/molnotes");
const widths = [
  [1366, 900],
  [390, 844],
];
const define = { timeline: defineTimeline, flow: defineFlow };

/** The figures of one note: fenced timeline, flow and molecule blocks. */
function noteFigures(source, file, errors) {
  const figures = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kind = /^```(timeline|flow|molecule)\s*$/.exec(lines[i])?.[1];
    if (!kind) continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !lines[end].startsWith("```")) end++;
    const body = lines.slice(start, end).join("\n");
    const where = `${file}:${start}`;
    i = end;
    if (kind === "molecule") {
      const molecules = [];
      for (const line of body.split("\n")) {
        const [, key, value] = /^(smiles|caption):\s*(.+)$/.exec(line) ?? [];
        if (key === "smiles") molecules.push({ smiles: value, caption: "" });
        else if (key === "caption" && molecules.length)
          molecules.at(-1).caption = value;
      }
      figures.push({ where, kind, value: molecules, caption: "" });
      continue;
    }
    const document = parseDocument(body);
    if (document.errors.length) {
      errors.push(`${where}: ${kind}: ${document.errors[0].message}`);
      continue;
    }
    const { caption = "", ...value } = document.toJS() ?? {};
    try {
      define[kind](value);
    } catch (error) {
      errors.push(`${where}: ${error.message}`);
      continue;
    }
    figures.push({ where, kind, value, caption });
  }
  return figures;
}

/** The figures of a topic's blocks, tabs included. */
function topicFigures(topic, file, errors) {
  const figures = [];
  const visit = (blocks, where) =>
    blocks.forEach((block, i) => {
      const at = `${where} 第 ${i + 1} 块`;
      if (block.type === "tabs")
        block.items.forEach((item) =>
          visit(item.blocks, `${at}「${item.label}」`),
        );
      if (block.type === "timeline" || block.type === "flow") {
        try {
          const value = resolveData(block[block.type], topic.data, at);
          define[block.type](value);
          figures.push({
            where: at,
            kind: block.type,
            value,
            caption: block.caption ?? "",
          });
        } catch (error) {
          errors.push(`${at}: ${error.message}`);
        }
      }
      if (block.type === "molecule")
        figures.push({
          where: at,
          kind: "molecule",
          value: [{ smiles: block.smiles, caption: block.name }],
          caption: "",
        });
      if (block.type === "molecules")
        figures.push({
          where: at,
          kind: "molecule",
          value: resolveData(block.items, topic.data, at).map((m) => ({
            smiles: m.smiles,
            caption: m.name,
          })),
          caption: "",
        });
    });
  topic.chapters.forEach((chapter, c) =>
    visit(chapter.blocks ?? [], `${file} 第 ${c + 1} 章「${chapter.title}」`),
  );
  return figures;
}

async function unitFigures(unit, errors) {
  const [kind, slug, note] = unit.split("/");
  if (kind === "sites" && slug && !note) {
    const file = `sites/${slug}/content.json`;
    return topicFigures(
      JSON.parse(await readFile(join(content, file), "utf8")),
      file,
      errors,
    );
  }
  if (kind === "notes" && slug) {
    const files = note
      ? [`${note}.md`]
      : (await readdir(join(content, "notes", slug))).filter((f) =>
          f.endsWith(".md"),
        );
    const figures = [];
    for (const name of files.sort()) {
      const file = `notes/${slug}/${name}`;
      figures.push(
        ...noteFigures(
          await readFile(join(content, file), "utf8"),
          file,
          errors,
        ),
      );
    }
    return figures;
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
    ["status", "--porcelain", "src", "index.html"],
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
      ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "warn"],
      { cwd: repo, stdio: "inherit" },
    );
  return out;
}

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
// The page chrome asks for the site's sections and records; a preview has none.
const emptyApi = {
  "/api/catalog": { groups: [], sites: [], directories: [] },
  "/api/records": {},
};
function serve(root) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://local").pathname;
    if (Object.hasOwn(emptyApi, path)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(emptyApi[path]));
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
  return new Promise((done) =>
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
const errors = [];
const figures = [];
for (const unit of units) figures.push(...(await unitFigures(unit, errors)));
for (const error of errors) console.error(error);
if (!figures.length) {
  console.log("没有可预览的时间线、流程图或结构式。");
  process.exit(errors.length ? 1 : 0);
}
const out =
  process.env.MOLNOTES_PREVIEW_DIR ||
  join(cache, "preview", units.map((u) => u.split("/").at(-1)).join("+"));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const server = await serve(await build());
const browser = await chromium.launch();
const report = figures.map((figure) => ({
  ...figure,
  shots: [],
  warnings: [],
}));
try {
  for (const [width, height] of widths) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((value) => {
      window.__previewFigures = value;
    }, figures);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/showcase/preview`,
    );
    await page.waitForFunction(() => window.__previewResult, null, {
      timeout: 90_000,
    });
    const result = await page.evaluate(() => window.__previewResult);
    for (const [i, entry] of report.entries()) {
      const shot = join(out, `${String(i + 1).padStart(2, "0")}-${width}.png`);
      await page.locator(`[data-preview="${i}"]`).screenshot({ path: shot });
      entry.shots.push(shot);
      for (const warning of result[i].warnings)
        entry.warnings.push(`${width}px：${warning}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
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
