<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
} from "reka-ui";
import { RouterLink } from "vue-router";
import type { ShelfItem } from "./sidebar";
const props = defineProps<{
  label: string;
  items: ShelfItem[];
  local?: boolean;
  drawer: boolean;
}>();
const emit = defineEmits<{ picked: []; expanded: [open: boolean] }>();
const expanded = ref(false);
watch(expanded, (open) => emit("expanded", open));
watch(
  () => props.drawer,
  () => {
    expanded.value = false;
  },
);
const current = computed(() => props.items.find((item) => item.current));
const groups = computed(() => {
  const grouped = new Map<string, ShelfItem[]>();
  for (const item of props.items.filter((item) => !item.current)) {
    const key = item.group ?? "";
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped].map(([label, items]) => ({ label, items }));
});
function picked() {
  expanded.value = false;
  emit("picked");
}
</script>

<template>
  <CollapsibleRoot
    v-model:open="expanded"
    as="nav"
    class="sidebar-shelf"
    :aria-label="label"
  >
    <div v-if="current" class="shelf-row">
      <component
        :is="local ? RouterLink : 'a'"
        class="shelf-book"
        v-bind="local ? { to: current.href } : { href: current.href }"
        :title="current.label"
        aria-current="true"
        @click="picked"
      >
        <span class="shelf-title">{{ current.label }}</span>
        <span class="shelf-progress" :aria-label="current.progressLabel">{{
          current.progress
        }}</span>
      </component>
      <CollapsibleTrigger
        v-if="items.length > 1"
        class="button button--quiet button--icon shelf-toggle"
        type="button"
        :aria-label="expanded ? '收起书架' : '展开书架'"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </CollapsibleTrigger>
    </div>
    <component :is="current ? CollapsibleContent : 'div'" class="shelf-list">
      <section v-for="group in groups" :key="group.label">
        <h2 v-if="group.label" class="shelf-group">{{ group.label }}</h2>
        <div v-for="item in group.items" :key="item.href" class="shelf-row">
          <component
            :is="local ? RouterLink : 'a'"
            class="shelf-book"
            v-bind="local ? { to: item.href } : { href: item.href }"
            :title="item.label"
            @click="picked"
          >
            <span class="shelf-title">{{ item.label }}</span>
            <span class="shelf-progress" :aria-label="item.progressLabel">{{
              item.progress
            }}</span>
          </component>
        </div>
      </section>
    </component>
  </CollapsibleRoot>
</template>

<style scoped>
.sidebar-shelf {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  min-width: 0;
}
.shelf-list {
  min-height: 0;
  max-height: 30dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.shelf-row {
  display: flex;
  align-items: center;
  min-width: 0;
}
.shelf-book {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--ink);
  text-decoration: none;
}
.shelf-book:hover {
  background: var(--paper-deep);
}
.shelf-book[aria-current="true"] {
  background: var(--accent-soft);
}
.shelf-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: 500 var(--text-sm) / 1.5 var(--font-sans);
}
.shelf-progress {
  flex: none;
  color: var(--ink-muted);
  font: var(--text-xs) / var(--leading-body) var(--font-mono);
}
.shelf-group {
  margin: var(--space-3) var(--space-2) var(--space-1);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / var(--leading-body) var(--font-sans);
}
.shelf-toggle {
  flex: none;
  margin-left: var(--space-1);
}
.shelf-toggle svg {
  width: var(--space-4);
  height: var(--space-4);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
}
.shelf-toggle[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
</style>
