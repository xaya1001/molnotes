import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium, type Browser, type Page } from "@playwright/test";
import type {
  FigureReference,
  Library,
  Diagnostic,
} from "../shared/chemical-library/types.ts";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contentType } from "../shared/assets.ts";
import { verifyFigureProofs } from "./content/figure-proofs.ts";
import { figureRendererFingerprint } from "./content/figure-renderer-fingerprint.ts";

export async function figureBrowser(library: Library, contentRoot: string) {
  const cache = await mkdtemp(join(tmpdir(), "figure-vite-"));
  const server = await createServer({
    cacheDir: cache,
    optimizeDeps: { noDiscovery: true, include: [] },
    configFile: false,
    root: join(import.meta.dirname, ".."),
    server: { host: "127.0.0.1", port: 0, hmr: false },
    logLevel: "error",
    plugins: [
      vue(),
      {
        name: "figure-proof",
        configureServer(s) {
          s.middlewares.use(async (req, res, next) => {
            if (req.url === "/__figure.html") {
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                `<!doctype html><html lang="zh"><head><link rel="stylesheet" href="/src/ui/styles/tokens.css"><link rel="stylesheet" href="/src/ui/styles/base.css"><style>body{margin:24px;background:#faf9f6;font:16px Arial,sans-serif}#canvas{overflow:auto}#canvas>svg{display:block;margin:auto;max-width:none}h1{font-size:20px}</style></head><body><h1 id="title"></h1><div id="canvas"></div><p id="context"></p><script type="module">import {createApp,nextTick} from '/node_modules/vue/dist/vue.runtime.esm-bundler.js';import ProcessViewer from '/src/ui/topic/ProcessViewer.vue';import {renderFigure} from '/src/ui/library/render.ts';import {figureDiagnostics} from '/src/ui/library/diagnostics.ts';let app;window.proof=async(library,ref)=>{app?.unmount();app=undefined;const canvas=document.getElementById('canvas');canvas.style.cssText='';canvas.replaceChildren();if(library[ref.ref].kind==='process'){document.getElementById('title').textContent=library[ref.ref].title;document.getElementById('context').textContent=ref.caption??'';app=createApp(ProcessViewer,{data:library[ref.ref]});app.mount(canvas);await nextTick();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const box=canvas.getBoundingClientRect();return {svg:null,diagnostics:[],width:box.width,height:box.height,atoms:{}};}const r=await renderFigure(library,ref);document.getElementById('title').textContent=library[ref.ref].title;document.getElementById('canvas').replaceChildren(r.svg);const entry=library[ref.ref];document.getElementById('context').textContent=ref.caption??(entry.kind==='reaction'?entry.explanation:entry.kind==='mechanism'?(entry.frames.find(f=>f.id===ref.frame)??entry.frames[0]).explanation:'');const scale=Math.max(r.minimumScale,Math.min(1,(innerWidth-48)/r.width));r.svg.style.width=r.width*scale+'px';r.svg.style.height=r.height*scale+'px';await document.fonts.ready;const diagnostics=figureDiagnostics(r.svg);const style=getComputedStyle(r.svg);for(const key of ["--chemical-ink","--chemical-muted","--chemical-comparison","--chemical-support","--chemical-support-line","--chemical-focus","--chemical-line","--chemical-focus-line","--chemical-arrow-line","--chemical-font","--chemical-script-font","--chemical-caption-font"])r.svg.style.setProperty(key,style.getPropertyValue(key));const outer=r.svg.getBoundingClientRect();const geometry=[...r.svg.querySelectorAll('[data-label],[data-bond],[data-electron-arrow],[data-arrow-head]')].map(e=>{const b=e.getBoundingClientRect();return {ids:{...e.dataset},bounds:{x:(b.x-outer.x)/scale,y:(b.y-outer.y)/scale,width:b.width/scale,height:b.height/scale},path:e.getAttribute('d')};});return {svg:r.svg.outerHTML,diagnostics,width:r.width,height:r.height,atoms:r.atomPoints,geometry,viewport:{width:innerWidth,height:innerHeight},scale};};</script></body></html>`,
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
  const previewUrl = `http://127.0.0.1:${address.port}/__figure.html`;
  let browser: Browser | undefined;
  let page: Page;
  let rendered = 0;
  async function openBrowser() {
    const next = await chromium.launch();
    try {
      const target = await next.newPage();
      await target.goto(previewUrl);
      await target.waitForFunction(() => "proof" in window);
      await target.evaluate((value) => {
        (window as unknown as { figureLibrary: Library }).figureLibrary = value;
      }, library);
      browser = next;
      page = target;
      rendered = 0;
    } catch (error) {
      await next.close();
      throw error;
    }
  }
  try {
    await openBrowser();
  } catch (error) {
    await server.close();
    await rm(cache, { recursive: true, force: true });
    throw error;
  }
  return {
    get page() {
      return page;
    },
    async render(reference: FigureReference, width = 1366) {
      // Reuse Vite, but bound the lifetime of image decoders and the WASM page.
      if (rendered >= 100) {
        await browser!.close();
        browser = undefined;
        await openBrowser();
      }
      rendered++;
      await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
      return page.evaluate(async (reference) => {
        const proof = (
          window as unknown as {
            proof: (
              l: Library,
              r: FigureReference,
            ) => Promise<{
              svg: string | null;
              diagnostics: Diagnostic[];
              width: number;
              height: number;
              atoms: Record<string, { x: number; y: number }>;
            }>;
          }
        ).proof;
        return proof(
          (window as unknown as { figureLibrary: Library }).figureLibrary,
          reference,
        );
      }, reference);
    },
    async thumbnail() {
      if ((await page.locator("#canvas > svg").count()) === 0) {
        const canvas = page.locator("#canvas");
        await canvas.evaluate((node) => {
          const scale = Math.min(
            1,
            320 / node.clientWidth,
            180 / node.clientHeight,
          );
          node.style.width = `${node.clientWidth}px`;
          node.style.transformOrigin = "top left";
          node.style.transform = `scale(${scale})`;
        });
        return canvas.screenshot({ omitBackground: true });
      }
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
      try {
        await browser?.close();
      } finally {
        await server.close();
        await rm(cache, { recursive: true, force: true });
      }
    },
  };
}
export async function verifyLibraryFigures(
  library: Library,
  references: FigureReference[],
  root: string,
  cacheDirectory?: string,
) {
  if (!Object.keys(library).length) return { assets: [], previews: {} };
  const temporary = cacheDirectory
    ? undefined
    : await mkdtemp(join(tmpdir(), "figure-proofs-"));
  try {
    const proof = await verifyFigureProofs(library, references, {
      directory: cacheDirectory ?? temporary!,
      renderer: await figureRendererFingerprint(
        join(import.meta.dirname, ".."),
      ),
      createRunner: () => figureBrowser(library, root),
    });
    console.log(
      `Figure proofs: ${proof.stats.hits} cached, ${proof.stats.rendered} rendered, ${proof.stats.total} total`,
    );
    return proof;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
