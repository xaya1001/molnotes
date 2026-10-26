<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref } from "vue";
import { START_LOCATION, useRoute, useRouter } from "vue-router";
import SectionSidebar from "./SectionSidebar.vue";
import SidebarShelf from "./SidebarShelf.vue";
import { sites, topicBase } from "./catalog";
import {
  chapterProgress,
  readChapterProgress,
  readSiteRecords,
} from "./site-records";
import { topics, loadIndex } from "./content-data";
import SiteBar from "./SiteBar.vue";
import { useMediaQuery } from "./media";
import { showToast } from "./notify";
import { flatItems, type NavGroup, type NavItem } from "./sidebar";
import { pageTitle, type SiteSection } from "./site-sections";
import { topicContextKey } from "./topic-context";

const props = withDefaults(
  defineProps<{
    title: string;
    topicSlug?: string;
    completedChapters?: string[];
    description?: string;
    groups: NavGroup[];
    mistakes?: number;
    pager?: boolean;
    /** Reading order for the pager; defaults to the table of contents order. */
    sequence?: NavItem[];
    /** The top bar section the topic belongs to. */
    section?: SiteSection;
  }>(),
  { pager: true },
);

const route = useRoute();
const router = useRouter();
const narrow = useMediaQuery("(max-width: 60rem)");
const drawer = ref(false);
const announcement = ref("");
let focusPending = false;

if (props.description) {
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", props.description);
}

const removeAfterEach = router.afterEach((to, from) => {
  if (from !== START_LOCATION && to.path !== from.path) focusPending = true;
});
onBeforeUnmount(removeAfterEach);

provide(topicContextKey, {
  title: props.title,
  showHeading(title, element) {
    document.title =
      title === props.title
        ? pageTitle(props.title)
        : pageTitle(title, props.title);
    if (!focusPending) return;
    focusPending = false;
    element.focus({ preventScroll: true });
    announcement.value = `已打开：${title}`;
  },
});

const indexLoaded = ref(false);
const site = sites.find((item) => item.slug === props.topicSlug);
const shelf = computed(() =>
  site
    ? sites
        .filter((item) => (item.group === "练习") === (site.group === "练习"))
        .map((item) => {
          const saved = readChapterProgress(item);
          const progress =
            item.slug === props.topicSlug && props.completedChapters
              ? {
                  ...chapterProgress(item.chapterIds, props.completedChapters),
                  error: "",
                }
              : saved;
          const wrong =
            item.slug === props.topicSlug
              ? (props.mistakes ?? 0)
              : indexLoaded.value
                ? (readSiteRecords(topics).topics.find(
                    (topic) => topic.slug === item.slug,
                  )?.mistakes.length ?? 0)
                : "—";
          return {
            href: topicBase(item),
            group: site.group === "练习" ? undefined : (item.group ?? "其他"),
            label: item.title,
            current: item.slug === props.topicSlug,
            progress: progress.error
              ? "—"
              : `${progress.read}/${progress.total}${site.group === "练习" ? ` · 错 ${wrong}` : ""}`,
            progressLabel:
              progress.error ||
              `${site.group === "练习" ? "完成" : "已读"} ${progress.read} / ${progress.total} 章${site.group === "练习" ? `，错题 ${wrong}` : ""}`,
          };
        })
    : [],
);
async function loadShelfIndex(open: boolean) {
  if (
    !open ||
    site?.group !== "练习" ||
    shelf.value.length < 2 ||
    indexLoaded.value
  )
    return;
  try {
    await loadIndex();
    indexLoaded.value = true;
  } catch {
    showToast("错题记录读取失败，请重新展开书架重试。");
  }
}
const sequence = computed(() => props.sequence ?? flatItems(props.groups));
const position = computed(() =>
  sequence.value.findIndex((item) => item.to === route.path),
);
const previous = computed(() =>
  position.value > 0 ? sequence.value[position.value - 1] : undefined,
);
const next = computed(() =>
  position.value >= 0 ? sequence.value[position.value + 1] : undefined,
);
</script>

<template>
  <div class="topic">
    <a class="skip-link" href="#topic-main">跳到正文</a>
    <SiteBar :current="section" />
    <div class="topic-body">
      <SectionSidebar
        v-model:drawer="drawer"
        label="专题目录"
        :groups="groups"
        filter-label="筛选章节"
      >
        <template #shelf>
          <SidebarShelf
            label="专题书架"
            :items="shelf"
            :drawer="drawer"
            @picked="drawer = false"
            @expanded="loadShelfIndex"
          />
        </template>
      </SectionSidebar>

      <div class="topic-frame">
        <header v-if="narrow" class="topic-topbar">
          <button
            class="button button--quiet"
            type="button"
            aria-haspopup="dialog"
            :aria-expanded="drawer"
            @click="drawer = true"
          >
            <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
            目录
          </button>
        </header>

        <main id="topic-main" class="topic-main" tabindex="-1">
          <slot />
          <nav
            v-if="pager && (previous || next)"
            class="topic-pager page-reading"
            aria-label="上一节与下一节"
          >
            <RouterLink
              v-if="previous"
              class="topic-pager-link"
              :to="previous.to"
              rel="prev"
            >
              <small>上一节</small>
              <span>{{ previous.label }}</span>
            </RouterLink>
            <RouterLink
              v-if="next"
              class="topic-pager-link topic-pager-link--next"
              :to="next.to"
              rel="next"
            >
              <small>下一节</small>
              <span>{{ next.label }}</span>
            </RouterLink>
          </nav>
        </main>
      </div>
    </div>
    <p class="visually-hidden" role="status">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.icon {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.skip-link {
  position: fixed;
  top: var(--space-2);
  left: var(--space-2);
  z-index: 30;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--accent);
  color: #fff;
  font: 500 var(--text-sm) / 1.4 var(--font-sans);
  transform: translateY(-200%);
}

.skip-link:focus {
  transform: none;
}

.topic-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
}

.topic-frame {
  grid-column: 2;
}

.topic-topbar {
  position: sticky;
  top: var(--topbar-height);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--topbar-height);
  padding: 0 var(--gutter) 0 var(--space-4);
  border-bottom: 1px solid var(--rule);
  background: rgb(250 248 243 / 0.94);
  backdrop-filter: blur(8px);
  font-family: var(--font-sans);
}

.topic-main {
  padding: var(--space-7) var(--gutter) var(--space-8);
}

.topic-main:focus {
  outline: none;
}

.topic-pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  margin-top: var(--space-8);
  padding-top: var(--space-5);
  border-top: 1px solid var(--rule);
}

.topic-pager-link {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  color: var(--ink);
  text-decoration: none;
}

.topic-pager-link:hover {
  border-color: var(--accent);
  color: var(--accent-strong);
}

.topic-pager-link--next {
  grid-column: 2;
  text-align: right;
}

.topic-pager-link small {
  color: var(--ink-muted);
  font: var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.08em;
}

@media (max-width: 30rem) {
  .topic-main {
    padding-top: var(--space-6);
  }

  .topic-pager {
    grid-template-columns: 1fr;
  }

  .topic-pager-link--next {
    grid-column: 1;
  }
}
</style>

<style>
/* Anchored headings clear the visible navigation. */
html:has(.topic) {
  scroll-padding-top: calc(var(--topbar-height) + var(--space-4));
}
@media (max-width: 60rem) {
  html:has(.topic) {
    scroll-padding-top: calc(2 * var(--topbar-height) + var(--space-4));
  }
}
</style>
