export type SiteSection =
  "notes" | "practice" | "cases" | "glossary" | "review";

/** The site's sections in top bar order. */
export const siteSections: { id: SiteSection; label: string; href?: string }[] =
  [
    { id: "notes", label: "笔记", href: "/notes/" },
    { id: "practice", label: "练习" },
    { id: "cases", label: "案例" },
    { id: "glossary", label: "术语", href: "/glossary/" },
    { id: "review", label: "复习", href: "/review/" },
  ];

/** The section a topic belongs to: practice topics under 练习, the rest under 案例. */
export const topicSection = (group: string | undefined): SiteSection =>
  group === "练习" ? "practice" : "cases";

/** Browser tab title: the page name, then the site name. */
export const pageTitle = (...parts: string[]) =>
  [...parts, "分子笔记"].join(" · ");
