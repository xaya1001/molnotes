import { boot } from "../ui/api";
import { loadContent } from "../ui/content-data";
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import "@ui/styles/index.css";
import "katex/dist/katex.min.css";
import { notebook as index } from "../ui/content-data";
import App from "./App.vue";
import { loadReading, reading } from "./records";
boot(async () => {
  await loadContent(true);
  await loadReading();
  const router = createRouter({
    history: createWebHistory("/notes/"),
    routes: [{ path: "/:path(.*)*", component: App }],
  });
  router.beforeEach((to) => {
    if (to.path !== "/") return;
    const recent = index.notes
      .filter((note) => reading[note.path])
      .sort((a, b) => reading[b.path].opened - reading[a.path].opened)[0];
    const target = recent?.path ?? index.directories[0]?.path;
    if (target) return target.slice("/notes".length);
  });
  history.scrollRestoration = "manual";
  const app = createApp(App).use(router);
  await router.isReady();
  app.mount("#app");
});
