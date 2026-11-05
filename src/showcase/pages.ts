import type { RouteComponent, RouteRecordRaw } from "vue-router";
import type { NavGroup } from "@ui";

interface ShowcasePage {
  path: string;
  label: string;
  component: () => Promise<RouteComponent>;
}

const sections: { label: string; pages: ShowcasePage[] }[] = [
  {
    label: "界面",
    pages: [
      {
        path: "/",
        label: "概览",
        component: () => import("./pages/OverviewPage.vue"),
      },
      {
        path: "/elements",
        label: "正文元素",
        component: () => import("./pages/ElementsPage.vue"),
      },
    ],
  },
  {
    label: "图示与数据",
    pages: [
      {
        path: "/steps",
        label: "分步图示",
        component: () => import("./pages/StepsPage.vue"),
      },
      {
        path: "/curves",
        label: "公式与曲线",
        component: () => import("./pages/CurvesPage.vue"),
      },
      {
        path: "/diagrams",
        label: "时间线与流程",
        component: () => import("./pages/DiagramPage.vue"),
      },
      {
        path: "/molecule",
        label: "二维分子结构",
        component: () => import("./pages/MoleculePage.vue"),
      },
      {
        path: "/data",
        label: "数据表与散点",
        component: () => import("./pages/DataPage.vue"),
      },
      {
        path: "/matrix",
        label: "预测矩阵",
        component: () => import("./pages/MatrixPage.vue"),
      },
      {
        path: "/protein",
        label: "蛋白三维结构",
        component: () => import("./pages/ProteinPage.vue"),
      },
      {
        path: "/structure",
        label: "结构量距",
        component: () => import("./pages/StructurePage.vue"),
      },
      {
        path: "/video",
        label: "讲解视频",
        component: () => import("./pages/VideoPage.vue"),
      },
    ],
  },
];

let number = 0;
export const groups: NavGroup[] = sections.map((section) => ({
  label: section.label,
  items: section.pages.map((page) => ({
    to: page.path,
    label: page.label,
    number: String(++number).padStart(2, "0"),
  })),
}));

export const routes: RouteRecordRaw[] = [
  ...sections.flatMap((section) =>
    section.pages.map((page) => ({
      path: page.path,
      component: page.component,
    })),
  ),
  // Rendered by the content preview command; not part of the showcase table of contents.
  { path: "/preview", component: () => import("./pages/PreviewPage.vue") },
];
