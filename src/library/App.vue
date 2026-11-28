<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { SiteBar } from "@ui";
import LibraryFigure from "../ui/library/LibraryFigure.vue";
import type {
  Diagnostic,
  LibraryEntry,
  LibrarySnapshot,
} from "../../shared/chemical-library/types.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import { figureRouteMetrics } from "../../shared/chemical-library/routes.ts";
const props = defineProps<{ library: LibrarySnapshot }>();
const statuses = ref<Record<string, Diagnostic[]>>({});
const opened = ref<Record<string, boolean>>({});
const selectedDiagnostic = ref<Record<string, number | null>>({});
const toggleDiagnostic = (entryId: string, index: number) => {
  selectedDiagnostic.value[entryId] =
    selectedDiagnostic.value[entryId] === index ? null : index;
};
const coverSrc = (entry: LibraryEntry) =>
  entry.kind === "image"
    ? entry.crop
      ? undefined
      : `/library/assets/${entry.asset}`
    : props.library.renders?.[figureViewKey({ ref: entry.id })]?.asset;
const entryDiagnostics = (entry: LibraryEntry): Diagnostic[] | undefined =>
  statuses.value[entry.id] ??
  (entry.kind === "image"
    ? entry.crop
      ? undefined
      : []
    : props.library.renders?.[figureViewKey({ ref: entry.id })]?.diagnostics);
const query = ref("");
const kind = ref("");
const names = {
  compound: "化合物",
  figure: "化学图",
  image: "图片",
  markush: "通式与覆盖地图",
  conformation: "构象与投影式",
};
const catalogEntries = computed(() =>
  Object.values(props.library.entries).filter(
    (e) => !e.owner?.startsWith("sites/"),
  ),
);
const entries = computed(() =>
  catalogEntries.value.filter(
    (e) =>
      (!kind.value || e.kind === kind.value) &&
      JSON.stringify(e)
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
  ),
);
onMounted(() => {
  if (location.hash)
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView();
});
</script>
<template>
  <SiteBar />
  <main class="page-wide">
    <h1>图库</h1>
    <div class="controls">
      <label>查找<input v-model="query" type="search" class="input" /></label
      ><label
        >类型<select v-model="kind" class="input">
          <option value="">全部</option>
          <option v-for="(name, k) in names" :key="k" :value="k">
            {{ name }}
          </option>
        </select></label
      ><span>{{ entries.length }} / {{ catalogEntries.length }}</span>
    </div>
    <details
      v-if="
        library.audit &&
        (library.audit.orphans.length || library.audit.duplicates.length)
      "
      class="audit"
    >
      <summary>审核队列</summary>
      <p>未引用条目：{{ library.audit.orphans.length }}</p>
      <ul>
        <li v-for="id in library.audit.orphans" :key="id">
          <a :href="`#${id}`">{{ library.entries[id].title }}</a>
        </li>
      </ul>
      <p v-for="(group, i) in library.audit.duplicates" :key="i">
        相同结构或字节：<a v-for="id in group" :key="id" :href="`#${id}`"
          >{{ library.entries[id].title }}
        </a>
      </p>
    </details>
    <section
      v-for="entry in entries"
      :id="entry.id"
      :key="entry.id"
      class="entry"
    >
      <h2>{{ entry.title }}</h2>
      <p>
        {{ names[entry.kind] }} · {{ entry.id }} ·
        {{ library.uses[entry.id]?.length ?? 0 }} 处引用
      </p>
      <button
        v-if="
          coverSrc(entry) &&
          !opened[entry.id] &&
          !(entryDiagnostics(entry)?.length ?? 0)
        "
        class="preview"
        type="button"
        :aria-label="`查看：${entry.title}`"
        @click="opened[entry.id] = true"
      >
        <img :src="coverSrc(entry)" :alt="entry.title" loading="lazy" />
      </button>
      <LibraryFigure
        v-if="
          !coverSrc(entry) ||
          opened[entry.id] ||
          (entryDiagnostics(entry)?.length ?? 0) > 0
        "
        :library="library"
        :reference="{ ref: entry.id }"
        show-diagnostic-marks
        :active-diagnostic="selectedDiagnostic[entry.id] ?? null"
        @diagnostics="statuses[entry.id] = $event"
      />
      <p v-if="entryDiagnostics(entry)" class="check-status">
        {{
          entryDiagnostics(entry)?.some((d) => d.severity === "error")
            ? "布局待修正"
            : "布局通过"
        }}
      </p>
      <details>
        <summary>来源与引用</summary>
        <p
          :data-check="
            entryDiagnostics(entry) === undefined
              ? 'pending'
              : entryDiagnostics(entry)?.some((d) => d.severity === 'error')
                ? 'error'
                : 'passed'
          "
        >
          {{
            entryDiagnostics(entry) === undefined
              ? "检查中"
              : entryDiagnostics(entry)!.length
                ? `${entryDiagnostics(entry)!.length} 项诊断`
                : "布局通过"
          }}
        </p>
        <ul v-if="entryDiagnostics(entry)?.length" class="diagnostic-list">
          <li
            v-for="(d, i) in entryDiagnostics(entry)"
            :key="i"
            :data-diagnostic="d.code"
          >
            <button
              type="button"
              class="diagnostic-item"
              :class="{ 'is-active': selectedDiagnostic[entry.id] === i }"
              :aria-pressed="selectedDiagnostic[entry.id] === i"
              @click="toggleDiagnostic(entry.id, i)"
            >
              <span class="diagnostic-index">{{ i + 1 }}</span>
              <span class="diagnostic-text">
                {{ d.code }} · {{ d.elements.join("，") }} · {{ d.message }}
              </span>
            </button>
          </li>
        </ul>
        <p v-for="s in entry.sources" :key="s.source + s.locator">
          {{ s.source }} · {{ s.locator }} {{ s.note }}
        </p>
        <p v-if="entry.kind === 'image'">
          {{ entry.width }} × {{ entry.height }} · {{ entry.purpose }} ·
          {{ entry.rights }}
        </p>
        <p
          v-if="
            entry.kind === 'figure' &&
            figureRouteMetrics(entry).longestLinearSteps > 0
          "
        >
          最长线性步骤：{{ figureRouteMetrics(entry).longestLinearSteps }}
        </p>
        <ul>
          <li v-for="use in library.uses[entry.id]" :key="use.path + use.title">
            <a :href="use.path">{{ use.title }}</a>
          </li>
        </ul>
      </details>
    </section>
  </main>
</template>
<style scoped>
.preview {
  display: block;
  border: 0;
  background: transparent;
  padding: var(--space-3);
  cursor: pointer;
}
.preview img {
  display: block;
  max-width: min(100%, 320px);
  max-height: 180px;
  width: auto;
  height: auto;
}
main {
  padding: var(--space-6) var(--gutter) var(--space-8);
}
.controls {
  display: flex;
  gap: var(--space-4);
  align-items: end;
  flex-wrap: wrap;
}
.entry {
  padding: var(--space-6) 0;
  border-bottom: 1px solid var(--rule);
}
.entry > p {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}
.diagnostic-list {
  list-style: none;
  padding: 0;
  margin: var(--space-2) 0 var(--space-3);
  display: grid;
  gap: var(--space-1);
}
.diagnostic-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  text-align: left;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}
.diagnostic-item:hover {
  background: var(--paper-deep);
}
.diagnostic-item.is-active {
  background: var(--danger-soft);
  border-color: var(--danger);
}
.diagnostic-index {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: var(--text-xs);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
