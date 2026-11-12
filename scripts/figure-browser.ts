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
import type { AssetStage } from "./content/asset-stage.ts";

export async function figureBrowser(
  library: Library,
  contentRoot: string,
  stage?: AssetStage,
  pageCount = 1,
) {
  const cache = await mkdtemp(join(tmpdir(), "figure-vite-"));
  const server = await createServer({
    cacheDir: cache,
    optimizeDeps: {
      noDiscovery: true,
    },
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
                `<!doctype html><html lang="zh"><head>
<link rel="stylesheet" href="/src/ui/styles/tokens.css"><link rel="stylesheet" href="/src/ui/styles/base.css">
<style>body{margin:24px;background:#faf9f6;font:16px Arial,sans-serif}#canvas{overflow:auto}#canvas>svg{display:block;margin:auto;max-width:none}h1{font-size:20px}</style>
</head><body><h1 id="title"></h1><div id="canvas"></div><script type="module">
import {createApp,nextTick} from '/node_modules/vue/dist/vue.runtime.esm-bundler.js';
import ProcessViewer from '/src/ui/topic/ProcessViewer.vue';
import {imageSvg} from '/src/ui/library/image-svg.ts';
let app;
const reset=()=>{app?.unmount();app=undefined;const canvas=document.getElementById('canvas');canvas.style.cssText='';canvas.replaceChildren();return canvas;};
const scaleSvg=(svg,render)=>{const scale=Math.max(render.minimumScale,Math.min(1,(innerWidth-48)/render.width));svg.style.width=render.width*scale+'px';svg.style.height=render.height*scale+'px';};
window.frozen=(render)=>{const canvas=reset();canvas.innerHTML=render.svg;document.getElementById('title').textContent='';scaleSvg(canvas.querySelector('svg'),render);};
window.proof=async(library,ref)=>{
  const canvas=reset(),entry=library[ref.ref];
  document.getElementById('title').textContent=entry.title;
  if(entry.kind==='process'){
    app=createApp(ProcessViewer,{data:entry});app.mount(canvas);
    await nextTick();await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const box=canvas.getBoundingClientRect();
    return {svg:null,diagnostics:[],width:box.width,height:box.height,minimumScale:0,atoms:{}};
  }
  if(entry.kind!=='image')throw new Error('Chemical figures require prepared SVG');
  const result=await imageSvg(entry);canvas.replaceChildren(result.svg);scaleSvg(result.svg,result);
  return {...result,svg:result.svg.outerHTML,diagnostics:[],atoms:{}};
};
</script></body></html>`,
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
                const path = stage
                  ? (await stage.get(file.slice(0, 64)))?.file
                  : join(contentRoot, "library/assets", file);
                if (!path) {
                  res.statusCode = 404;
                  res.end();
                  return;
                }
                res.setHeader("Content-Type", contentType(file));
                res.end(await readFile(path));
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
  let pages: Page[];
  let rendered = 0;
  async function openBrowser() {
    const next = await chromium.launch();
    try {
      pages = await Promise.all(
        Array.from({ length: pageCount }, async () => {
          const target = await next.newPage();
          await target.goto(previewUrl);
          await target.waitForFunction(() => "proof" in window);
          await target.evaluate((value) => {
            (window as unknown as { figureLibrary: Library }).figureLibrary =
              value;
          }, library);
          return target;
        }),
      );
      browser = next;
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
    get pages() {
      return pages;
    },
    get page() {
      return pages[0];
    },
    async prepareBatch() {
      if (rendered >= 1000) {
        await browser!.close();
        browser = undefined;
        await openBrowser();
      }
    },
    async render(reference: FigureReference, width = 1366, slot = 0) {
      rendered++;
      const page = pages[slot];
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
              minimumScale: number;
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
    async mount(
      render: {
        svg: string;
        width: number;
        height: number;
        minimumScale: number;
      },
      slot = 0,
      width = 1366,
    ) {
      rendered++;
      await pages[slot].setViewportSize({
        width,
        height: width === 1366 ? 900 : 844,
      });
      await pages[slot].evaluate((render) => {
        (
          window as unknown as {
            frozen: (render: {
              svg: string;
              width: number;
              height: number;
              minimumScale: number;
            }) => void;
          }
        ).frozen(render);
      }, render);
    },
    async thumbnail(slot = 0) {
      const page = pages[slot];
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
