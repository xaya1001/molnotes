import { createApp, type Component } from "vue";
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import TopicNotFound from "./TopicNotFound.vue";
import "./styles/index.css";

/** Mounts a page that has no internal routes, such as the site directory. */
export function mountPage(root: Component) {
  createApp(root).mount("#app");
}

/**
 * Mounts a routed application whose pages live under `base` (for example
 * `/showcase/`). The web server answers every extension-less path below
 * `base` with the application's index.html. Topics use `mountTopic`.
 */
export function mountApp(
  root: Component,
  { base, routes }: { base: string; routes: RouteRecordRaw[] },
) {
  const router = createRouter({
    history: createWebHistory(base),
    routes: [...routes, { path: "/:unknown(.*)*", component: TopicNotFound }],
    scrollBehavior(to, from, saved) {
      if (saved) return saved;
      if (to.hash) {
        const target = document.getElementById(
          decodeURIComponent(to.hash.slice(1)),
        );
        target?.closest("details")?.setAttribute("open", "");
        if (target) return { el: target };
      }
      if (to.path !== from.path) return { top: 0 };
      return false;
    },
  });
  createApp(root).use(router).mount("#app");
}
