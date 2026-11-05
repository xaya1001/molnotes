<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { SiteBar } from "@ui";
import LibraryFigure from "../ui/library/LibraryFigure.vue";
import type { LibrarySnapshot } from "../../shared/chemical-library/types.ts";
import { routeMetrics } from "../../shared/chemical-library/routes.ts";
const props = defineProps<{ library: LibrarySnapshot }>();
const statuses = ref<
  Record<string, import("../../shared/chemical-library/types.ts").Diagnostic[]>
>({});
const opened = ref<Record<string, boolean>>({});
const query = ref("");
const kind = ref("");
const names = {
  compound: "化合物",
  reaction: "反应",
  route: "路线",
  mechanism: "机理与比较",
  image: "图片",
  process: "过程图",
};
const entries = computed(() =>
  Object.values(props.library.entries).filter(
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
      ><span
        >{{ entries.length }} / {{ Object.keys(library.entries).length }}</span
      >
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
        v-if="library.previews?.[entry.id] && !opened[entry.id]"
        class="preview"
        type="button"
        :aria-label="`查看：${entry.title}`"
        @click="opened[entry.id] = true"
      >
        <img
          :src="library.previews[entry.id]"
          :alt="entry.title"
          loading="lazy"
        />
      </button>
      <LibraryFigure
        v-if="!library.previews?.[entry.id] || opened[entry.id]"
        :library="library.entries"
        :reference="{ ref: entry.id }"
        @diagnostics="statuses[entry.id] = $event"
      />
      <p
        v-if="statuses[entry.id] || library.previews?.[entry.id]"
        class="check-status"
      >
        {{
          statuses[entry.id]?.some((d) => d.severity === "error")
            ? "布局待修正"
            : "布局通过"
        }}
      </p>
      <details>
        <summary>来源与引用</summary>
        <p
          :data-check="
            statuses[entry.id] === undefined
              ? library.previews?.[entry.id]
                ? 'passed'
                : 'pending'
              : statuses[entry.id]?.some((d) => d.severity === 'error')
                ? 'error'
                : 'passed'
          "
        >
          {{
            statuses[entry.id] === undefined
              ? library.previews?.[entry.id]
                ? "布局通过"
                : "检查中"
              : statuses[entry.id].length
                ? `${statuses[entry.id].length} 项诊断`
                : "布局通过"
          }}
        </p>
        <ul v-if="statuses[entry.id]?.length">
          <li
            v-for="(d, i) in statuses[entry.id]"
            :key="i"
            :data-diagnostic="d.code"
          >
            {{ d.code }} · {{ d.elements.join("，") }} · {{ d.message }}
          </li>
        </ul>
        <p v-for="s in entry.sources" :key="s.source + s.locator">
          {{ s.source }} · {{ s.locator }} {{ s.note }}
        </p>
        <p v-if="entry.kind === 'image'">
          {{ entry.width }} × {{ entry.height }} · {{ entry.purpose }} ·
          {{ entry.rights }}
        </p>
        <p v-if="entry.kind === 'route'">
          最长线性步骤：{{
            routeMetrics(entry, library.entries).longestLinearSteps
          }}；总收率：{{
            routeMetrics(entry, library.entries).totalYield === null
              ? "缺少数据"
              : (
                  100 * routeMetrics(entry, library.entries).totalYield!
                ).toFixed(1) + "%"
          }}
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
  max-width: 100%;
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
</style>
