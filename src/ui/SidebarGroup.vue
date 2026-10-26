<script setup lang="ts">
import { computed } from "vue";
import { flatItems, type NavGroup, type SidebarState } from "./sidebar";

/** A labelled section and its entries, with reading and practice state. */
const props = withDefaults(
  defineProps<{
    group: NavGroup;
    nav: SidebarState;
    depth?: number;
  }>(),
  { depth: 0 },
);
const items = computed(() => props.group.items.filter(props.nav.shows));
const groups = computed(() =>
  (props.group.groups ?? []).filter(props.nav.showsGroup),
);
const numbered = computed(() => props.group.items.some((item) => item.number));
const all = computed(() => flatItems([props.group]));
const tracked = computed(() =>
  all.value.filter((item) => item.read !== undefined),
);
const progress = computed(() =>
  tracked.value.length
    ? `${tracked.value.filter((item) => item.read).length}/${tracked.value.length}`
    : "",
);
const mistakes = computed(() =>
  all.value.reduce((sum, item) => sum + (item.mistakes ?? 0), 0),
);
</script>

<template>
  <section class="sidebar-group" :class="`sidebar-group--depth-${depth}`">
    <h2 v-if="group.label" class="sidebar-group-title">
      <span class="sidebar-group-label">{{ group.label }}</span>
      <span v-if="mistakes" class="sidebar-group-mistakes"
        >错 {{ mistakes }}</span
      >
      <span v-if="progress" class="sidebar-group-progress">{{ progress }}</span>
    </h2>
    <div>
      <ul v-if="items.length" class="sidebar-items">
        <li v-for="item in items" :key="item.to">
          <RouterLink
            class="sidebar-item"
            :to="item.to"
            :title="item.label"
            data-nav
            :aria-current="item === nav.current ? 'page' : undefined"
            @click="nav.picked()"
          >
            <span v-if="numbered" class="sidebar-number">{{
              item.number
            }}</span>
            <span class="sidebar-label">{{ item.label }}</span>
            <span
              v-if="item.mistakes || item.bookmarked || item.read"
              class="sidebar-status"
            >
              <span
                v-if="item.mistakes"
                class="sidebar-mistakes"
                data-state="mistakes"
                aria-hidden="true"
                >错 {{ item.mistakes }}</span
              >
              <svg
                v-if="item.bookmarked"
                class="sidebar-bookmark"
                data-state="bookmarked"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />
              </svg>
              <svg
                v-if="item.read"
                class="sidebar-read"
                data-state="read"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m3.5 8.5 3 3 6-7" />
              </svg>
              <span class="visually-hidden"
                ><template v-if="item.read">，已读</template
                ><template v-if="item.bookmarked">，书签</template
                ><template v-if="item.mistakes"
                  >，{{ item.mistakes }} 道错题</template
                ></span
              >
            </span>
          </RouterLink>
        </li>
      </ul>
      <SidebarGroup
        v-for="child in groups"
        :key="child.id ?? child.label"
        :group="child"
        :nav="nav"
        :depth="depth + 1"
      />
    </div>
  </section>
</template>

<style scoped>
.sidebar-group + .sidebar-group {
  margin-top: var(--space-2);
}

.sidebar-group--depth-1 {
  margin-left: var(--space-3);
}

h2 {
  margin: 0;
  font-size: inherit;
}

.sidebar-group-label {
  flex: 1;
  min-width: 0;
}
.sidebar-group-progress,
.sidebar-group-mistakes {
  flex: none;
  font-variant-numeric: tabular-nums;
  letter-spacing: normal;
}
.sidebar-group-mistakes {
  color: var(--danger);
}
.sidebar-group-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.4 var(--font-sans);
  letter-spacing: 0.08em;
}

.sidebar-items {
  margin: 0 0 var(--space-2);
  padding: 0;
  list-style: none;
}

.sidebar-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--ink-soft);
  font: var(--text-sm) / 1.5 var(--font-sans);
  text-decoration: none;
}

.sidebar-item:hover {
  background: var(--paper-deep);
  color: var(--ink);
}

.sidebar-item[aria-current="page"] {
  background: var(--accent-soft);
}

.sidebar-number {
  flex: none;
  width: 1.375rem;
  color: var(--ink-muted);
  font: var(--text-xs) / 1.75 var(--font-mono);
  font-variant-numeric: tabular-nums;
}

[aria-current="page"] .sidebar-number {
  color: inherit;
}

.sidebar-label {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}

.sidebar-status {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  height: 1.3125rem;
}

.sidebar-status svg {
  width: 0.875rem;
  height: 0.875rem;
}

.sidebar-read {
  fill: none;
  stroke: var(--success);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-bookmark {
  fill: var(--evidence);
}

.sidebar-mistakes {
  padding: 0 0.3125rem;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
