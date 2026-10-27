import { defineComponent, h } from "vue";
import { mountApp } from "../ui/app.ts";
import SiteBar from "../ui/SiteBar.vue";
import TopicNotFound from "../ui/TopicNotFound.vue";
import { pageTitle } from "../ui/site-sections.ts";
import { mountTopic } from "../ui/topic/mount.ts";
import { api, boot, ApiError } from "../ui/api.ts";
import type { CatalogSite } from "../ui/catalog.ts";
import { loadCatalog } from "../ui/content-data.ts";
import { loadSiteRecords } from "../ui/site-records.ts";
import type { Citation } from "../ui/citations.ts";
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
