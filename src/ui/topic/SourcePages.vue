<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData, sourceLink } from "./patent.ts";
import PageHeading from "../PageHeading.vue";
import PageViewer from "../PageViewer.vue";
const props = defineProps<{ source?: string; mode?: "page" | "search" }>();
const { content } = useTopic();
const data = patentData(content);
const route = useRoute(),
  router = useRouter();
const sourceId = computed(() =>
  typeof route.query.source === "string" &&
  Object.hasOwn(data.sources ?? {}, route.query.source)
    ? route.query.source
    : (props.source ?? Object.keys(data.sources ?? {})[0]),
);
const source = computed(() => data.sources![sourceId.value]);
const page = computed(() =>
  Math.min(source.value.pages, Math.max(1, Number(route.params.page) || 1)),
);
const rect = computed(() => {
  const a = String(route.query.rect ?? "")
    .split(",")
    .map(Number);
  return a.length === 4 &&
    a.every(Number.isFinite) &&
    a[0] >= 0 &&
    a[1] >= 0 &&
    a[2] >= a[0] &&
    a[3] >= a[1] &&
    a[2] <= source.value.size[0] &&
    a[3] <= source.value.size[1]
    ? a
    : null;
});
const jump = ref(page.value),
  query = ref(String(route.query.q ?? ""));
const pages = ref<string[]>([]),
  error = ref(""),
  loading = ref(false);
watch(
  [sourceId, () => props.mode],
  async (_, __, cleanup) => {
    pages.value = [];
    error.value = "";
    if (!props.mode) return;
    let stale = false;
    cleanup(() => (stale = true));
    loading.value = true;
    try {
      const response = await fetch(source.value.text);
      if (!response.ok) throw new Error("原文加载失败");
      const value: unknown = await response.json();
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string"))
        throw new Error("原文格式错误");
      if (!stale) pages.value = value;
    } catch (e) {
      if (!stale) error.value = e instanceof Error ? e.message : "原文加载失败";
    } finally {
      if (!stale) loading.value = false;
    }
  },
  { immediate: true },
);
watch(
  () => route.query.q,
  (v) => (query.value = String(v ?? "")),
);
watch(page, (n) => (jump.value = n));
watch(
  [page, () => route.params.page],
  () => {
    if (
      props.mode === "page" &&
      String(page.value) !== String(route.params.page)
    )
      void router.replace({
        path: `/sources/pages/${page.value}`,
        query: route.query,
      });
  },
  { immediate: true },
);
const hits = computed(() => {
  const q = String(route.query.q ?? "")
    .trim()
    .toLowerCase();
  return q
    ? pages.value.flatMap((text, i) => {
        const at = text.toLowerCase().indexOf(q);
        return at < 0
          ? []
          : [
              {
                page: i + 1,
                text: text.slice(Math.max(0, at - 80), at + q.length + 180),
              },
            ];
      })
    : [];
});
function go(n: number) {
  void router.push(
    sourceLink(
      { page: Math.min(source.value.pages, Math.max(1, Math.round(n) || 1)) },
      sourceId.value,
    ),
  );
}
function search() {
  const p = /^\[(\d+)\]$/.exec(query.value.trim());
  const n =
    p &&
    (source.value.paragraphs[p[1]] ??
      source.value.paragraphs[String(Number(p[1]))]);
  if (n) go(n);
  else
    void router.push({
      path: "/search",
      query: { q: query.value, source: sourceId.value },
    });
}
function key(event: KeyboardEvent) {
  if (
    props.mode !== "page" ||
    /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName) ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.key === "ArrowRight") go(page.value + 1);
  if (event.key === "ArrowLeft") go(page.value - 1);
}
window.addEventListener("keydown", key);
onBeforeUnmount(() => window.removeEventListener("keydown", key));
</script>
<template>
  <section class="source-pages" :class="{ 'page-wide': mode }">
    <PageHeading
      v-if="mode"
      :title="
        mode === 'page'
          ? `PDF ${page} / ${source.pages}`
          : `“${String(route.query.q ?? '')}”`
      "
      :summary="source.title"
    />
    <h2 v-else>{{ source.title }}</h2>
    <form class="controls" @submit.prevent="search">
      <label
        >原文检索<input
          v-model="query"
          class="input"
          type="search"
          aria-label="原文检索" /></label
      ><button class="button">搜索</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="mode === 'page'">
      <form class="controls" @submit.prevent="go(jump)">
        <button
          class="button"
          type="button"
          :disabled="page <= 1"
          @click="go(page - 1)"
        >
          ← 上页</button
        ><input
          v-model.number="jump"
          class="input"
          type="number"
          min="1"
          :max="source.pages"
          aria-label="PDF页序"
        /><button class="button">跳转</button
        ><button
          class="button"
          type="button"
          :disabled="page >= source.pages"
          @click="go(page + 1)"
        >
          下页 →
        </button>
      </form>
      <PageViewer
        class="patent-page"
        :image="source.image.replace('{page}', String(page))"
        :size="source.size"
        :rect="rect"
        :alt="`原始 PDF 第 ${page} 页`"
      />
      <details>
        <summary>此页文本</summary>
        <p>{{ pages[page - 1] }}</p>
      </details>
    </template>
    <template v-else-if="mode === 'search'"
      ><p v-if="loading">正在检索原文…</p>
      <ul v-else class="search-hits">
        <li v-for="hit in hits" :key="hit.page">
          <RouterLink :to="sourceLink({ page: hit.page }, sourceId)"
            >原文 p.{{ hit.page }} · {{ hit.text }}</RouterLink
          >
        </li>
      </ul>
      <p v-if="!loading && !hits.length">没有匹配的原文。</p></template
    >
    <nav v-else class="controls" aria-label="原页索引">
      <RouterLink
        v-for="n in source.pages"
        :key="n"
        :to="sourceLink({ page: n }, sourceId)"
        >p.{{ n }}</RouterLink
      >
    </nav>
  </section>
</template>
<style scoped>
.source-pages {
  min-width: 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  margin-block: var(--space-4);
}
.input {
  max-width: 100%;
}
.patent-page :deep(.page-viewport) {
  max-height: 80vh;
}
.search-hits {
  overflow-wrap: anywhere;
}
</style>
