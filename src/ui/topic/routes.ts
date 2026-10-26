import { patentRoutes } from "./patent-routes";
import type { RouteRecordRaw } from "vue-router";
import type { NavGroup } from "../sidebar";
import type { Topic } from "./content";
import TopicChapterPage from "./TopicChapterPage.vue";
import TopicHome from "./TopicHome.vue";

/** Topic home followed by the chapters in reading order. */
export function defineTopicRoutes({
  content,
  label,
}: {
  content: Topic;
  label?: string;
}): {
  groups: NavGroup[];
  routes: RouteRecordRaw[];
} {
  // A chapter's own number (a positive integer) is shown; a chapter numbered
  // 0, such as a map, is listed without one.
  const numberOf = (chapter: { number?: number }, index: number) =>
    chapter.number === undefined
      ? index + 1
      : chapter.number > 0
        ? chapter.number
        : undefined;
  const item = (id: string) => {
    const index = content.chapters.findIndex((chapter) => chapter.id === id);
    const number = numberOf(content.chapters[index], index);
    return {
      to: content.chapterPath(id),
      label: content.chapters[index].title,
      number:
        number === undefined ? undefined : String(number).padStart(2, "0"),
    };
  };
  const groups: NavGroup[] =
    content.parts.length > 1
      ? content.parts.map((part) => ({
          label: part.title,
          items: part.chapters.map(item),
        }))
      : [{ label, items: content.chapters.map((chapter) => item(chapter.id)) }];
  groups.unshift({ items: [{ to: "/", label: "专题首页" }] });
  const routes: RouteRecordRaw[] = [
    { path: "/", component: TopicHome },
    ...content.chapters.map((chapter, index) => ({
      path: content.chapterPath(chapter.id),
      component: TopicChapterPage,
      props: {
        chapter: {
          id: chapter.id,
          title: chapter.title,
          summary: chapter.lead,
          layout: chapter.layout,
        },
        number: numberOf(chapter, index),
      },
    })),
  ];
  const extra = patentRoutes(content);
  routes.push(
    ...extra.filter(
      (route) => !routes.some((existing) => existing.path === route.path),
    ),
  );
  return {
    groups,
    routes,
  };
}
