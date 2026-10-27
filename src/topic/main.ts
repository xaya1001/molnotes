import { defineComponent, h } from "vue";
import { mountApp } from "../ui/app";
import SiteBar from "../ui/SiteBar.vue";
import TopicNotFound from "../ui/TopicNotFound.vue";
import { pageTitle } from "../ui/site-sections";
import { mountTopic } from "../ui/topic/mount";
import { api, boot, ApiError } from "../ui/api";
import type { CatalogSite } from "../ui/catalog";
import { loadCatalog } from "../ui/content-data";
import { loadSiteRecords } from "../ui/site-records";
import type { Citation } from "../ui/citations";
import type { GlossaryTerm } from "../../shared/glossary.ts";
import "../ui/styles/index.css";
boot(async () => {
  const slug = location.pathname.split("/")[2];
  try {
    const topic = await api<
      Pick<CatalogSite, "slug" | "title" | "description"> & {
        content: object;
        label?: string;
        citations: Record<string, Citation>;
        glossary: GlossaryTerm[];
      }
    >(`/api/topics/${encodeURIComponent(slug)}`);
    await Promise.all([loadCatalog(), loadSiteRecords()]);
    document.title = pageTitle(topic.title);
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", topic.description);
    await mountTopic(topic);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      mountApp(
        defineComponent({
          setup: () => () => [
            h(SiteBar, { current: "cases" }),
            h(TopicNotFound, { homeLabel: "回到首页" }),
          ],
        }),
        { base: "/", routes: [] },
      );
    } else throw error;
  }
});
