<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../ui/api.ts";
import { loadIndex } from "../ui/content-data.ts";
import type { Note, NoteDirectory } from "../../shared/notes-index.ts";
import type { GlossaryTerm } from "../../shared/glossary.ts";
import { notebook as index } from "../ui/content-data.ts";
import { PageHeading, UiDialog } from "@ui";
import SiteBar from "@ui/SiteBar.vue";
import { pageTitle } from "@ui/site-sections";
import CompiledProse from "@ui/CompiledProse.vue";
import TopicNotFound from "@ui/TopicNotFound.vue";
import SectionSidebar from "@ui/SectionSidebar.vue";
import SidebarShelf from "@ui/SidebarShelf.vue";
import { searchNotes, snippet } from "@ui/site-search";
import type { NavGroup } from "@ui/sidebar";
import {
  reading,
  saveReading,
  storageError,
  storageConflict,
  retryReading,
} from "./records.ts";
const route = useRoute(),
  router = useRouter();
const path = computed(() => `/notes${route.path}`);
const note = computed(() => index.notes.find((n) => n.path === path.value));
const detail = ref<Note & { terms: Record<string, GlossaryTerm> }>();
const directoryDetail = ref<
  NoteDirectory & { terms: Record<string, GlossaryTerm> }
>();
const bodyError = ref(false);
let bodyRequest = 0;
async function loadBody() {
  const request = ++bodyRequest;
  detail.value = undefined;
  directoryDetail.value = undefined;
  bodyError.value = false;
  const target = note.value?.path ?? directory.value?.path;
  if (!target) return;
  try {
    const result = await api<
      Note & NoteDirectory & { terms: Record<string, GlossaryTerm> }
    >(`/api${target.replace(/\/$/, "")}`);
    if (request !== bodyRequest) return;
    if (note.value) detail.value = result;
    else directoryDetail.value = result;
  } catch {
    if (request === bodyRequest) bodyError.value = true;
  }
}
const directory = computed(() =>
  index.directories.find(
    (d) => d.path === path.value || d.slug === note.value?.directory,
  ),
);
const siblings = computed(() =>
  index.notes.filter((n) => n.directory === note.value?.directory),
);
const position = computed(() =>
  siblings.value.findIndex((n) => n.path === note.value?.path),
);
const previous = computed(() => siblings.value[position.value - 1]);
const next = computed(() => siblings.value[position.value + 1]);
const query = ref(typeof route.query.q === "string" ? route.query.q : "");
const activeQuery = computed(() =>
  typeof route.query.q === "string" ? route.query.q : "",
);
const drawer = ref(false),
  chapters = ref(false),
  hidden = ref(false),
  currentSection = ref("");
const prose = ref<InstanceType<typeof CompiledProse>>();
const matches = ref(0),
  matchIndex = ref(0);
let lastY = 0,
  restoring = false,
  activePath = "",
  sectionTitle = "",
  timer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  if (activePath && !restoring)
    saveReading(activePath, { scroll: window.scrollY, section: sectionTitle });
}
function scroll() {
  const y = window.scrollY;
  if (y !== lastY) hidden.value = y > lastY && y > 80;
  lastY = y;
  if (note.value && !restoring) {
    clearTimeout(timer);
    timer = setTimeout(persist, 150);
    if (
      activePath &&
      y + window.innerHeight >= document.documentElement.scrollHeight - 12
    )
      saveReading(activePath, { read: true });
    const headings = (detail.value?.sections ?? [])
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    currentSection.value =
      headings.filter((el) => el.getBoundingClientRect().top < 140).at(-1)
        ?.id ??
      headings[0]?.id ??
      "";
    sectionTitle =
      (detail.value?.sections ?? []).find((s) => s.id === currentSection.value)
        ?.title ?? "";
  }
}
async function ready() {
  if (!note.value) return;
  restoring = true;
  await nextTick();
  if (!activeQuery.value) {
    if (route.hash) jump(decodeURIComponent(route.hash.slice(1)));
    else window.scrollTo(0, reading[note.value.path]?.scroll ?? 0);
  }
  requestAnimationFrame(() => {
    restoring = false;
    scroll();
  });
}
function jump(id: string) {
  const target = document.getElementById(id);
  target?.closest("details")?.setAttribute("open", "");
  target?.scrollIntoView({ block: "start" });
  currentSection.value = id;
  requestAnimationFrame(() => {
    currentSection.value = id;
  });
  chapters.value = false;
}
function clearSearch() {
  query.value = "";
  void router.replace({ query: {} });
}
const searchReady = ref(false);
const searchError = ref(false);
async function loadSearch() {
  try {
    await loadIndex();
    searchReady.value = true;
    searchError.value = false;
  } catch {
    searchError.value = true;
  }
}
watch(
  query,
  (value) => {
    if (value.trim() && !searchReady.value) void loadSearch();
    if (!value.trim() && activeQuery.value) clearSearch();
  },
  { immediate: true },
);
watch(
  () => route.query.q,
  (value) => {
    query.value = typeof value === "string" ? value : "";
  },
);
watch(
  path,
  async () => {
    persist();
    clearTimeout(timer);
    restoring = true;
    activePath = note.value?.path || "";
    drawer.value = false;
    chapters.value = false;
    hidden.value = false;
    void loadBody();
    if (activePath) saveReading(activePath, { opened: Date.now() });
    document.title = pageTitle(
      note.value?.title ?? directory.value?.title ?? "页面不存在",
    );
    await nextTick();
    document
      .querySelector<HTMLElement>("main h1")
      ?.focus({ preventScroll: true });
    if (!note.value) {
      window.scrollTo(0, 0);
      restoring = false;
    }
  },
  { immediate: true },
);
onMounted(() => {
  window.addEventListener("scroll", scroll, { passive: true });
  window.addEventListener("pagehide", persist);
});
onBeforeUnmount(() => {
  persist();
  clearTimeout(timer);
  window.removeEventListener("scroll", scroll);
  window.removeEventListener("pagehide", persist);
});
const local = (value: string) => value.slice("/notes".length);
// A note's order doubles as its number; order 0, such as a guide, has none.
const numberOf = (order: number) =>
  order > 0 ? String(order).padStart(2, "0") : undefined;
const shelf = computed(() =>
  index.directories.map((item) => {
    const notes = index.notes.filter((n) => n.directory === item.slug);
    const read = notes.filter((n) => reading[n.path]?.read).length;
    return {
      href: local(item.path),
      label: item.title,
      current: item.slug === directory.value?.slug,
      progress: `${read}/${notes.length}`,
      progressLabel: `已读 ${read} / ${notes.length} 篇`,
    };
  }),
);
const sidebarGroups = computed<NavGroup[]>(() =>
  directory.value
    ? [
        {
          items: [
            { to: local(directory.value.path), label: "目录首页" },
            ...index.notes
              .filter((n) => n.directory === directory.value!.slug)
              .map((n) => ({
                to: local(n.path),
                label: n.title,
                number: numberOf(n.order),
                read: !!reading[n.path]?.read,
              })),
          ],
        },
      ]
    : [],
);
watch(
  () => directory.value?.slug,
  () => {
    query.value = "";
  },
);
const bodyHits = computed(() =>
  (searchReady.value ? searchNotes(query.value) : []).filter(
    (n) =>
      !!directory.value &&
      n.path.startsWith(directory.value.path) &&
      snippet(n.text, query.value).length > 0,
  ),
);
</script>
<template>
  <div class="notes-head" :class="{ 'is-hidden': hidden }">
    <SiteBar current="notes" />
    <div class="notes-subbar">
      <button
        class="button button--quiet"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="drawer"
        @click="drawer = true"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
        目录
      </button>
      <button
        v-if="note"
        class="button button--quiet notes-chapters-button"
        type="button"
        @click="chapters = true"
      >
        章节
      </button>
    </div>
  </div>
  <div class="notes-body">
    <SectionSidebar
      v-model:query="query"
      v-model:drawer="drawer"
      label="笔记目录"
      :groups="sidebarGroups"
      filter-label="筛选篇目"
    >
      <template #shelf>
        <SidebarShelf
          label="笔记书架"
          :items="shelf"
          :drawer="drawer"
          local
          @picked="drawer = false"
        />
      </template>
      <template #results="{ query: text }">
        <section
          v-if="bodyHits.length"
          class="notes-hits"
          aria-labelledby="notes-hits-title"
        >
          <h2 id="notes-hits-title">正文匹配</h2>
          <ul>
            <li v-for="hit in bodyHits" :key="hit.path">
              <RouterLink
                :to="{ path: local(hit.path), query: { q: text } }"
                data-nav
                @click="drawer = false"
              >
                <span>{{ hit.title }}</span>
                <small>{{ hit.directoryTitle }}</small>
                <span class="excerpt">
                  <template
                    v-for="(part, i) in snippet(hit.text, text)"
                    :key="i"
                    ><mark v-if="part.hit">{{ part.text }}</mark
                    ><template v-else>{{ part.text }}</template></template
                  >
                </span>
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </SectionSidebar>
    <main class="notes-main">
      <p v-if="storageError" class="callout callout--caution">
        {{ storageError }}
        <button class="button" @click="retryReading()">
          {{ storageConflict ? "保留本页修改并保存" : "重试" }}
        </button>
      </p>
      <p v-if="bodyError" role="alert" class="callout callout--caution">
        正文读取失败。<button class="button" @click="loadBody">重试</button>
      </p>
      <p v-if="searchError" role="alert">
        搜索读取失败。<button class="button" @click="loadSearch">重试</button>
      </p>
      <article v-if="note" :key="note.path" class="note-article">
        <PageHeading :title="note.title" />
        <p class="metadata">
          <RouterLink :to="local(directory!.path)">{{
            directory!.title
          }}</RouterLink>
          · 写于 {{ note.date
          }}<template v-if="note.updated"> · 更新 {{ note.updated }}</template>
        </p>
        <div v-if="activeQuery" class="match-controls" aria-live="polite">
          “{{ activeQuery }}” 第 {{ matchIndex }} / {{ matches }} 处
          <button
            class="button button--quiet"
            :disabled="!matches"
            @click="prose?.showMatch(matchIndex - 2)"
          >
            上一处</button
          ><button
            class="button button--quiet"
            :disabled="!matches"
            @click="prose?.showMatch(matchIndex)"
          >
            下一处</button
          ><button class="button button--quiet" @click="clearSearch">
            清除
          </button>
        </div>
        <CompiledProse
          v-if="detail"
          ref="prose"
          :html="detail.html"
          :molecules="detail.molecules"
          :diagrams="detail.diagrams"
          :terms="detail.terms"
          :citations="detail.citations"
          :query="activeQuery"
          @matches="matches = $event"
          @current="matchIndex = $event"
          @ready="ready"
        />
        <nav class="pager" aria-label="篇目导航">
          <RouterLink v-if="previous" :to="local(previous.path)"
            >上一篇 · {{ previous.title }}</RouterLink
          ><RouterLink v-if="next" :to="local(next.path)"
            >下一篇 · {{ next.title }}</RouterLink
          >
        </nav>
      </article>
      <article v-else-if="directory" class="note-article">
        <PageHeading :title="directory.title" /><CompiledProse
          v-if="directoryDetail"
          :html="directoryDetail.html"
          :terms="directoryDetail.terms"
          :citations="directoryDetail.citations"
        />
        <ol class="directory-notes">
          <li
            v-for="item in index.notes.filter(
              (n) => n.directory === directory!.slug,
            )"
            :key="item.path"
          >
            <RouterLink :to="local(item.path)">{{ item.title }}</RouterLink>
            <p>{{ item.summary }}</p>
            <small
              >写于 {{ item.date
              }}<template v-if="reading[item.path]?.read">
                · 读过</template
              ></small
            >
          </li>
        </ol>
      </article>
      <TopicNotFound v-else home-label="回到笔记本首页" />
    </main>
  </div>
  <nav v-if="note" class="section-toc" aria-label="章节">
    <a
      v-for="section in detail?.sections"
      :key="section.id"
      :href="`#${section.id}`"
      :class="{
        active: currentSection === section.id,
        sub: section.level === 3,
      }"
      :aria-current="currentSection === section.id ? 'location' : undefined"
      @click.prevent="jump(section.id)"
      >{{ section.title }}</a
    >
  </nav>
  <UiDialog v-model:open="chapters" title="章节"
    ><nav class="mobile-toc">
      <a
        v-for="section in detail?.sections"
        :key="section.id"
        :href="`#${section.id}`"
        @click.prevent="jump(section.id)"
        >{{ section.title }}</a
      >
    </nav></UiDialog
  >
</template>
<style scoped>
.notes-head {
  position: sticky;
  top: 0;
  z-index: 30;
}
.notes-subbar {
  display: none;
  align-items: center;
  gap: var(--space-2);
  height: var(--topbar-height);
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--rule);
  background: rgb(250 248 243 / 0.94);
  backdrop-filter: blur(8px);
  font-family: var(--font-sans);
}
.notes-subbar svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.notes-chapters-button {
  display: none;
  margin-left: auto;
}
.notes-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
}
.notes-hits {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule);
  font: var(--text-sm) / 1.6 var(--font-sans);
}
.notes-hits h2 {
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-2);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.4 var(--font-sans);
  letter-spacing: 0.08em;
}
.notes-hits ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.notes-hits a {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--ink-soft);
  text-decoration: none;
}
.notes-hits a:hover {
  background: var(--paper-deep);
}
.notes-hits small {
  color: var(--ink-muted);
  font-size: var(--text-xs);
}
.excerpt {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--ink-muted);
}
mark {
  background: var(--evidence-soft);
  color: var(--ink);
}
.notes-main {
  grid-column: 2;
  margin-right: 12rem;
  padding: var(--space-7) var(--gutter);
  min-width: 0;
}
.note-article {
  max-width: var(--measure);
  margin-inline: auto;
  min-width: 0;
}
.metadata {
  font: var(--text-sm)/1.7 var(--font-sans);
  color: var(--ink-muted);
  margin-bottom: var(--space-7);
}
.pager {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-5);
  padding-block: var(--space-7);
  margin-top: var(--space-7);
  border-top: 1px solid var(--rule);
  font-family: var(--font-sans);
}
.section-toc {
  position: fixed;
  right: 0;
  top: calc(var(--topbar-height) + var(--space-7));
  width: 12rem;
  max-height: 75vh;
  overflow: auto;
  padding: var(--space-4);
  font: var(--text-sm)/1.6 var(--font-sans);
}
.section-toc a,
.mobile-toc a {
  display: block;
  padding-block: var(--space-2);
  color: var(--ink-muted);
  text-decoration: none;
}
.section-toc .active {
  color: var(--accent);
  font-weight: 600;
}
.section-toc .sub {
  padding-left: var(--space-3);
}
.directory-notes {
  padding: 0;
  list-style: none;
}
.directory-notes li {
  border-top: 1px solid var(--rule);
  padding-block: var(--space-5);
}
.directory-notes p {
  margin-block: var(--space-2);
}
.directory-notes small {
  color: var(--ink-muted);
  font-family: var(--font-sans);
}
.match-controls {
  font-family: var(--font-sans);
  margin-bottom: var(--space-5);
}
@media (max-width: 60rem) {
  .notes-subbar {
    display: flex;
  }
}
@media (min-width: 760px) and (max-width: 1100px) {
  .notes-main {
    margin-right: 9rem;
    padding-inline: var(--space-4);
  }
  .section-toc {
    width: 9rem;
  }
}
@media (max-width: 759px) {
  .section-toc {
    display: none;
  }
  .notes-chapters-button {
    display: inline-flex;
  }
  .notes-main {
    margin: 0;
    padding: var(--space-5) var(--space-4);
  }
  .notes-head {
    transition: transform var(--duration) var(--ease);
  }
  .notes-head.is-hidden {
    transform: translateY(-100%);
  }
}
</style>
