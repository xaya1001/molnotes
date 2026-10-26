<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import PageViewer from "./PageViewer.vue";
import UiDialog from "./UiDialog.vue";
import { citationLabel, type Citation } from "./citations";

/** The original behind a citation: cited PDF pages with their neighbours, an archived article or an epub chapter. */
const props = defineProps<{ citation?: Citation }>();
const open = defineModel<boolean>("open", { required: true });
const index = ref(0);
// Each opening starts at the first cited page and the default zoom.
const opening = ref(0);
const html = ref(""),
  error = ref(""),
  loading = ref(false);
const pdf = computed(() =>
  props.citation?.type === "pdf" ? props.citation : undefined,
);
const web = computed(() =>
  props.citation?.type === "web" ? props.citation : undefined,
);
const epub = computed(() =>
  props.citation?.type === "epub" ? props.citation : undefined,
);
const body = computed(() => web.value?.body ?? epub.value?.body);
const root = ref<HTMLElement | null>(null);
const article = ref<HTMLElement | null>(null);
const page = computed(() => pdf.value?.pages[index.value]);
const meta = computed(() =>
  props.citation
    ? [
        props.citation.kind,
        props.citation.author,
        props.citation.edition,
        pdf.value && citationLabel(pdf.value),
      ]
        .filter(Boolean)
        .join(" · ")
    : "",
);
watch(
  [open, () => props.citation],
  async (_, __, cleanup) => {
    if (!open.value) return;
    opening.value++;
    if (pdf.value)
      index.value = pdf.value.pages.findIndex(
        (item) => item.page === pdf.value!.first,
      );
    if (!body.value) return;
    let stale = false;
    cleanup(() => (stale = true));
    html.value = "";
    error.value = "";
    loading.value = true;
    try {
      const response = await fetch(body.value);
      if (!response.ok) throw new Error("原文加载失败，请重试");
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("html" in value) ||
        typeof value.html !== "string"
      )
        throw new Error("原文格式错误");
      if (!stale) html.value = value.html;
    } catch (e) {
      if (!stale)
        error.value = e instanceof Error ? e.message : "原文加载失败，请重试";
    } finally {
      if (!stale) loading.value = false;
    }
    if (stale || error.value) return;
    // An epub citation opens at its section; anything else at the top.
    await nextTick();
    const key = epub.value?.section?.key;
    const target = key
      ? article.value?.querySelector(`[data-section~="${key}"]`)
      : null;
    target?.classList.add("cited-target");
    (target ?? root.value)?.scrollIntoView({ block: "start" });
  },
  { immediate: true },
);
function go(step: number) {
  if (!pdf.value) return;
  index.value = Math.min(
    pdf.value.pages.length - 1,
    Math.max(0, index.value + step),
  );
}
// Arrow keys turn pages while the viewer is open, wherever focus sits.
function key(event: KeyboardEvent) {
  if (
    !open.value ||
    /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)
  )
    return;
  if (event.key === "ArrowRight") go(1);
  if (event.key === "ArrowLeft") go(-1);
}
window.addEventListener("keydown", key);
onBeforeUnmount(() => window.removeEventListener("keydown", key));
</script>
<template>
  <UiDialog
    v-model:open="open"
    :title="citation?.title ?? '原文'"
    size="full"
    close-label="关闭原文"
  >
    <template v-if="epub" #toolbar>
      <p class="cited-location">
        {{ epub.chapter
        }}<template v-if="epub.section"
          ><span aria-hidden="true">›</span>{{ epub.section.title
          }}<span class="cited-flag">被引小节</span></template
        >
      </p>
    </template>
    <div
      v-if="citation"
      ref="root"
      class="cited"
      :class="{ 'cited--article': body, 'cited--epub': epub }"
    >
      <p class="cited-meta">{{ meta }}</p>
      <template v-if="pdf && page">
        <p class="cited-page" aria-live="polite">
          PDF 第 {{ page.page }} 页<template v-if="page.label">
            · 印刷页 {{ page.label }}</template
          ><span
            v-if="page.page >= pdf.first && page.page <= pdf.last"
            class="cited-flag"
            >被引页</span
          >
        </p>
        <PageViewer
          :key="opening"
          :image="page.image"
          :size="page.size"
          :rect="page.page === pdf.first ? pdf.rect : undefined"
          :alt="`${pdf.title}，PDF 第 ${page.page} 页`"
        >
          <nav class="cited-pager" aria-label="翻页">
            <button
              class="button"
              type="button"
              :disabled="index === 0"
              @click="go(-1)"
            >
              ← 上一页</button
            ><button
              class="button"
              type="button"
              :disabled="index === pdf.pages.length - 1"
              @click="go(1)"
            >
              下一页 →
            </button>
          </nav>
        </PageViewer>
      </template>
      <template v-else-if="body">
        <p v-if="web" class="cited-meta">
          <a :href="web.url" target="_blank" rel="noopener noreferrer"
            >原网页</a
          >
          · 下载于 {{ web.downloaded }}
        </p>
        <p v-if="loading">正在加载原文…</p>
        <p v-else-if="error" role="alert">{{ error }}</p>
        <!-- Publication extracts the article or chapter through a tag and attribute whitelist. -->
        <article
          v-else
          ref="article"
          class="prose cited-article"
          v-html="html"
        ></article>
      </template>
    </div>
  </UiDialog>
</template>
<style scoped>
.cited {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4) var(--gutter) var(--space-6);
}
.cited-meta {
  margin: 0;
  color: var(--ink-muted);
  font: 500 var(--text-sm) / 1.6 var(--font-sans);
}
.cited-pager {
  display: flex;
  gap: var(--space-2);
  margin-right: auto;
}
.cited-pager .button {
  padding-inline: var(--space-3);
}
.cited-page {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font: 500 var(--text-sm) / 1.4 var(--font-sans);
  font-variant-numeric: tabular-nums;
}
.cited-location {
  display: flex;
  flex: 1 1 12rem;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-2);
  margin: 0 var(--space-2) 0 0;
  color: var(--ink-muted);
  font: 500 var(--text-sm) / 1.5 var(--font-sans);
}
.cited-flag {
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--evidence-soft);
  color: var(--evidence);
  font-size: var(--text-xs);
  line-height: 1.6;
}
.cited--article {
  max-width: calc(var(--measure) + 2 * var(--gutter));
  margin-inline: auto;
}
.cited-article {
  overflow-wrap: anywhere;
}
.cited-article :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin-inline: auto;
}
/* Book images keep their place in the text; figures stand on their own line. */
.cited--epub .cited-article :deep(img) {
  display: inline;
  vertical-align: middle;
}
.cited--epub .cited-article :deep(figure img) {
  display: block;
}
.cited-article :deep([data-section]) {
  scroll-margin-top: var(--space-4);
}
.cited-article :deep(.cited-target) {
  border-radius: var(--radius-sm);
  background: var(--evidence-soft);
}
</style>
