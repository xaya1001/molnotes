import type { RouteRecordRaw } from "vue-router";
import type { Topic } from "./content";
import { patentBlocks } from "../../../shared/patent-contract.ts";
import { patentData } from "./patent";
export function patentRoutes(content: Topic): RouteRecordRaw[] {
  const blocks = patentBlocks(content),
    data = patentData(content),
    routes: RouteRecordRaw[] = [];
  const add = (route: RouteRecordRaw) => {
    if (!routes.some((r) => r.path === route.path)) routes.push(route);
  };
  for (const block of blocks) {
    if (block.type === "source-pages") {
      add({
        path: "/sources/pages/:page(\\d+)",
        component: () => import("./SourcePages.vue"),
        props: { source: block.source, mode: "page" },
      });
      add({
        path: "/search",
        component: () => import("./SourcePages.vue"),
        props: { source: block.source, mode: "search" },
      });
    }
    if (block.type === "record-collection") {
      const collection = data.collections![block.collection];
      for (const [suffix, mode] of [
        ["", "list"],
        ["/compare", "compare"],
        ["/:id", "detail"],
      ])
        add({
          path: `/${collection.route}${suffix}`,
          component: () => import("./RecordCollection.vue"),
          props: { collection: block.collection, mode },
        });
    }
    if (block.type === "synthesis-network")
      add({
        path: `/synthesis/${block.network}`,
        component: () => import("./SynthesisNetwork.vue"),
        props: { network: block.network, mode: true },
      });
    if (block.type === "claims") {
      for (const [suffix, mode] of [
        ["", "list"],
        ["/compare", "compare"],
        ["/:id(\\d+)", "detail"],
      ])
        add({
          path: `/claims${suffix}`,
          component: () => import("./ClaimsBlock.vue"),
          props: { mode },
        });
    }
    if (block.type === "sar-cases") {
      add({
        path: "/sar",
        component: () => import("./SarCases.vue"),
        props: { cases: block.cases, collection: block.collection, mode: true },
      });
      for (const item of data.sarCases![block.cases])
        add({
          path: `/sar/${item.id}`,
          component: () => import("./SarCases.vue"),
          props: {
            cases: block.cases,
            collection: block.collection,
            mode: true,
            caseId: item.id,
          },
        });
    }
  }
  return routes;
}
