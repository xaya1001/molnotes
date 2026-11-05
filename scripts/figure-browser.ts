import { createServer } from "vite";
import { chromium } from "@playwright/test";
import type {
  FigureReference,
  Library,
  Diagnostic,
} from "../shared/chemical-library/types.ts";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256, contentType } from "../shared/assets.ts";
import type { UnitAsset } from "./content/content-files.ts";

export async function figureBrowser(library: Library, contentRoot: string) {
  const cache = await mkdtemp(join(tmpdir(), "figure-vite-"));
  const server = await createServer({
    cacheDir: cache,
    optimizeDeps: { noDiscovery: true, include: [] },
    configFile: false,
    root: join(import.meta.dirname, ".."),
    server: { host: "127.0.0.1", port: 0 },
    logLevel: "error",
    plugins: [
      {
        name: "figure-proof",
        configureServer(s) {
          s.middlewares.use(async (req, res, next) => {
            if (req.url === "/__figure.html") {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                `<!doctype html><html lang="zh"><head><link rel="stylesheet" href="/src/ui/styles/tokens.css"><style>body{margin:24px;background:#faf9f6;font:16px Arial,sans-serif}#canvas{overflow:auto}svg{display:block;margin:auto}h1{font-size:20px}</style></head><body><h1 id="title"></h1><div id="canvas"></div><p id="context"></p><script type="module">import {renderFigure} from '/src/ui/library/render.ts';import {figureDiagnostics} from '/src/ui/library/diagnostics.ts';window.proof=async(library,ref)=>{const r=await renderFigure(library,ref);document.getElementById('title').textContent=library[ref.ref].title;document.getElementById('canvas').replaceChildren(r.svg);const entry=library[ref.ref];document.getElementById('context').textContent=ref.caption??(entry.kind==='reaction'?entry.explanation:entry.kind==='mechanism'?(entry.frames.find(f=>f.id===ref.frame)??entry.frames[0]).explanation:'');const scale=Math.min(1,Math.max(r.minimumScale,(innerWidth-48)/r.width));r.svg.style.width=r.width*scale+'px';r.svg.style.height=r.height*scale+'px';await document.fonts.ready;const diagnostics=figureDiagnostics(r.svg);const style=getComputedStyle(r.svg);for(const key of ["--chemical-ink","--chemical-support","--chemical-support-line","--chemical-focus","--chemical-line","--chemical-focus-line","--chemical-arrow-line","--chemical-font","--chemical-script-font","--chemical-caption-font"])r.svg.style.setProperty(key,style.getPropertyValue(key));const outer=r.svg.getBoundingClientRect();const geometry=[...r.svg.querySelectorAll('[data-label],[data-bond],[data-electron-arrow],[data-arrow-head]')].map(e=>{const b=e.getBoundingClientRect();return {ids:{...e.dataset},bounds:{x:(b.x-outer.x)/scale,y:(b.y-outer.y)/scale,width:b.width/scale,height:b.height/scale},path:e.getAttribute('d')};});return {svg:r.svg.outerHTML,diagnostics,width:r.width,height:r.height,atoms:r.atomPoints,geometry,viewport:{width:innerWidth,height:innerHeight},scale};};</script></body></html>`,
              );
              return;
            }
            if (req.url?.startsWith("/library/assets/")) {
              const file = req.url.slice("/library/assets/".length);
              if (!/^[a-f0-9]{64}\.(png|jpe?g|webp|svg|gif)$/.test(file)) {
                res.statusCode = 404;
                res.end();
                return;
              }
              try {
                res.setHeader("Content-Type", contentType(file));
                res.end(
                  await readFile(join(contentRoot, "library/assets", file)),
                );
              } catch {
                res.statusCode = 404;
                res.end();
              }
              return;
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("No preview address");
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    await server.close();
    await rm(cache, { recursive: true, force: true });
    throw e;
  }
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${address.port}/__figure.html`);
    await page.waitForFunction(() => "proof" in window);
  } catch (error) {
    await browser.close();
    await server.close();
    await rm(cache, { recursive: true, force: true });
    throw error;
  }
  return {
    page,
    async render(reference: FigureReference, width = 1366) {
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      return page.evaluate(
        async ({ library, reference }) => {
          const proof = (
            window as unknown as {
              proof: (
                l: Library,
                r: FigureReference,
              ) => Promise<{
                svg: string;
                diagnostics: Diagnostic[];
                width: number;
                height: number;
                atoms: Record<string, { x: number; y: number }>;
              }>;
            }
          ).proof;
          return proof(library, reference);
        },
        { library, reference },
      );
    },
    async thumbnail() {
      const svg = page.locator("#canvas > svg");
      await svg.evaluate((node: SVGSVGElement) => {
        const box = node.viewBox.baseVal;
        const scale = Math.min(1, 320 / box.width, 180 / box.height);
        node.style.width = box.width * scale + "px";
        node.style.height = box.height * scale + "px";
      });
      await page.evaluate(
        () => (document.body.style.background = "transparent"),
      );
      try {
        return await svg.screenshot({ omitBackground: true });
      } finally {
        await page.evaluate(() => (document.body.style.background = ""));
      }
    },
    async close() {
      await browser.close();
      await server.close();
      await rm(cache, { recursive: true, force: true });
    },
  };
}
export async function verifyLibraryFigures(
  library: Library,
  references: FigureReference[],
  root: string,
) {
  const assets: UnitAsset[] = [];
  const previews: Record<string, string> = {};
  if (!Object.keys(library).length) return { assets, previews };
  const runner = await figureBrowser(library, root);
  try {
    const refs = [
      ...Object.values(library).flatMap((e) =>
        e.kind === "mechanism"
          ? e.frames.map((f) => ({ ref: e.id, frame: f.id }))
          : e.kind === "compound"
            ? [
                { ref: e.id },
                ...Object.keys(e.variants ?? {}).map((variant) => ({
                  ref: e.id,
                  variant,
                })),
              ]
            : [{ ref: e.id }],
      ),
      ...references,
    ];
    const unique = [
      ...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values(),
    ];
    for (const ref of unique)
      for (const width of [1366, 390]) {
        const result = await runner.render(ref, width);
        const errors = result.diagnostics.filter((d) => d.severity === "error");
        if (width === 1366 && !previews[ref.ref]) {
          const bytes = await runner.thumbnail();
          const hash = sha256(bytes);
          const path = `assets/${hash}.png`;
          assets.push({
            scope: "library",
            path,
            bytes,
            sha256: hash,
            size: bytes.length,
            content_type: "image/png",
            prompt: null,
          });
          previews[ref.ref] = `/library/${path}`;
        }
        if (errors.length)
          throw new Error(
            `${ref.ref}: ${errors.map((d) => `${d.code} ${d.elements.join(",")}`).join("; ")}`,
          );
      }
  } finally {
    await runner.close();
  }
  return { assets, previews };
}
