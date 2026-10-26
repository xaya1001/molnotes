import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
const root = import.meta.dirname;
const entries = Object.fromEntries(
  Object.entries({
    home: "index.html",
    notes: "notes/index.html",
    review: "review/index.html",
    glossary: "glossary/index.html",
    system: "system/index.html",
    showcase: "showcase/index.html",
    topic: "topic/index.html",
  }).map(([name, path]) => [name, resolve(root, path)]),
);
const routed: Plugin = {
  name: "routed-applications",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!path.includes(".")) {
        if (/^\/(sites|practice)\/[^/]+(?:\/|$)/.test(path))
          request.url = "/topic/index.html";
        else if (/^\/(notes|showcase)(?:\/|$)/.test(path))
          request.url = `/${path.split("/")[1]}/index.html`;
      }
      next();
    });
  },
};
const backend = process.env.MOLNOTES_DEV_API || "http://127.0.0.1:8080";
export default defineConfig({
  plugins: [vue(), routed],
  resolve: { alias: { "@ui": resolve(root, "src/ui") } },
  server: {
    proxy: {
      "/api": backend,
      "/system/api": backend,
      "^/sites/[^/]+/static/": backend,
      "^/notes/[^/]+/assets/": backend,
      "^/(sites|notes)/[^/]+/cited/": backend,
    },
  },
  build: { rolldownOptions: { input: entries } },
});
