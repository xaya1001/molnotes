<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "reka-ui";
import { useRoute } from "vue-router";
import SidebarGroup from "./SidebarGroup.vue";
import { useMediaQuery } from "./media";
import {
  currentItem,
  flatItems,
  type NavGroup,
  type NavItem,
  type SidebarState,
} from "./sidebar";

/**
 * The left sidebar of the notebook and of every topic. On wide screens it
 * scrolls on its own and folds into a narrow rail; below 60rem it opens as a
 * bottom sheet through `drawer`, which the page's own 目录 button sets.
 * The folded rail is kept in this browser.
 */
const props = withDefaults(
  defineProps<{
    /** Accessible name of the navigation and title of the sheet. */
    label: string;
    groups: NavGroup[];
    filterLabel?: string;
  }>(),
  { filterLabel: "筛选" },
);
const query = defineModel<string>("query", { default: "" });
const drawer = defineModel<boolean>("drawer", { default: false });
defineSlots<{
  header?(): unknown;
  /** Fixed notebook shelf above the entry filter. */
  shelf?(): unknown;
  /** Extra results under the filtered entries while the reader filters. */
  results?(props: { query: string }): unknown;
}>();

const SHEET = "(max-width: 60rem)";
const RAIL_KEY = "il-sidebar-collapsed";
const narrow = useMediaQuery(SHEET);
const route = useRoute();
const frame = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const filter = ref<HTMLInputElement | null>(null);
const railButton = ref<HTMLButtonElement | null>(null);
const foldButton = ref<HTMLButtonElement | null>(null);

function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Private windows keep the choice for this page only. */
  }
}
const collapsed = ref(readLocal(RAIL_KEY) === "1");
let navigating = false;
const current = computed(() =>
  currentItem(flatItems(props.groups), route.path),
);
watch(
  () => current.value?.to,
  () => void reveal(),
  { immediate: true },
);

const needle = computed(() => query.value.trim().toLowerCase());
function shows(item: NavItem) {
  return (
    !needle.value ||
    `${item.number ?? ""} ${item.label}`.toLowerCase().includes(needle.value)
  );
}
function showsGroup(group: NavGroup): boolean {
  return group.items.some(shows) || (group.groups ?? []).some(showsGroup);
}
const visibleGroups = computed(() => props.groups.filter(showsGroup));
const empty = computed(() => !!needle.value && !visibleGroups.value.length);

const nav: SidebarState = {
  get current() {
    return current.value;
  },
  shows,
  showsGroup,
  picked() {
    // The page that opens takes focus; the 目录 button does not get it back.
    navigating = true;
    drawer.value = false;
  },
};

/** Scrolls the list so the current entry sits in view, centred when it was out of sight. */
async function reveal() {
  await nextTick();
  const box = scroller.value;
  const entry = box?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!box || !entry) return;
  const outer = box.getBoundingClientRect();
  const inner = entry.getBoundingClientRect();
  if (inner.top < outer.top || inner.bottom > outer.bottom)
    box.scrollTop += inner.top - outer.top - (outer.height - inner.height) / 2;
}

async function setCollapsed(value: boolean) {
  collapsed.value = value;
  writeLocal(RAIL_KEY, value ? "1" : null);
  await nextTick();
  if (value) railButton.value?.focus();
  else {
    foldButton.value?.focus();
    void reveal();
  }
}

function rows() {
  return [
    ...(frame.value?.querySelectorAll<HTMLElement>("[data-nav]") ?? []),
  ].filter((element) => element.getClientRects().length > 0);
}
function onFilterKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    query.value = "";
    event.preventDefault();
    event.stopPropagation();
  } else if (event.key === "ArrowDown") {
    rows()[0]?.focus();
    event.preventDefault();
  } else if (event.key === "Enter") {
    rows()
      .find((element) => element.tagName === "A")
      ?.click();
    event.preventDefault();
  }
}
function onNavKey(event: KeyboardEvent) {
  const list = rows();
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  let target: HTMLElement | null | undefined;
  if (event.key === "ArrowDown") target = list[at + 1];
  else if (event.key === "ArrowUp") target = at ? list[at - 1] : filter.value;
  else if (event.key === "Home") target = list[0];
  else if (event.key === "End") target = list.at(-1);
  else return;
  event.preventDefault();
  target?.focus();
}

// The bottom sheet.
const offset = ref(0);
let dragStart: number | null = null;
watch(narrow, (isNarrow) => {
  if (!isNarrow) drawer.value = false;
  void reveal();
});
watch(
  () => route.path,
  () => {
    navigating = true;
    drawer.value = false;
  },
);
watch(drawer, (open) => {
  if (open) navigating = false;
  else {
    offset.value = 0;
    dragStart = null;
  }
});
async function focusCurrent(event: Event) {
  event.preventDefault();
  await reveal();
  const entry = frame.value?.querySelector<HTMLElement>(
    '[aria-current="page"]',
  );
  (entry ?? filter.value)?.focus({ preventScroll: true });
}
function restoreFocus(event: Event) {
  // Route navigation focuses the new heading instead of returning to the opener.
  if (navigating) event.preventDefault();
}
function grab(event: PointerEvent) {
  if ((event.target as Element).closest("button, a")) return;
  dragStart = event.clientY;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
}
function drag(event: PointerEvent) {
  if (dragStart !== null) offset.value = Math.max(0, event.clientY - dragStart);
}
function release(event: PointerEvent) {
  if (dragStart === null) return;
  dragStart = null;
  if (event.type === "pointerup" && offset.value > 64) drawer.value = false;
  else offset.value = 0;
}
</script>

<template>
  <DialogRoot v-model:open="drawer">
    <aside
      v-if="!narrow && collapsed"
      class="section-sidebar section-sidebar--rail"
    >
      <button
        ref="railButton"
        class="button button--quiet button--icon"
        type="button"
        aria-label="展开目录"
        aria-expanded="false"
        @click="setCollapsed(false)"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M6 2.5v11M8.5 6.5 10 8l-1.5 1.5" />
        </svg>
      </button>
    </aside>
    <DialogPortal v-else :disabled="!narrow">
      <DialogOverlay v-if="narrow" class="section-sidebar-overlay" />
      <component
        :is="narrow ? DialogContent : 'aside'"
        class="section-sidebar"
        :class="{ 'section-sidebar--sheet': narrow }"
        :aria-label="narrow ? label : undefined"
        :style="offset ? { transform: `translateY(${offset}px)` } : undefined"
        :aria-describedby="undefined"
        @open-auto-focus="focusCurrent"
        @close-auto-focus="restoreFocus"
      >
        <div
          v-if="narrow"
          class="sheet-grip"
          @pointerdown="grab"
          @pointermove="drag"
          @pointerup="release"
          @pointercancel="release"
        >
          <span class="sheet-handle" aria-hidden="true" />
          <div class="sheet-title">
            <DialogTitle as-child>
              <div>
                <slot name="header"
                  ><strong>{{ label }}</strong></slot
                >
              </div>
            </DialogTitle>
            <button
              class="button button--quiet button--icon"
              type="button"
              aria-label="关闭目录"
              @click="drawer = false"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        <div v-else-if="$slots.header" class="section-sidebar-header">
          <slot name="header" />
        </div>
        <div v-if="$slots.shelf" class="section-sidebar-shelf">
          <slot name="shelf" />
        </div>
        <div class="section-sidebar-filter">
          <input
            ref="filter"
            v-model="query"
            class="input"
            type="search"
            :aria-label="filterLabel"
            :placeholder="filterLabel"
            enterkeyhint="go"
            @keydown="onFilterKey"
          />
          <button
            v-if="!narrow"
            ref="foldButton"
            class="button button--quiet button--icon"
            type="button"
            aria-label="收起目录"
            aria-expanded="true"
            @click="setCollapsed(true)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
              <path d="M6 2.5v11M10 6.5 8.5 8l1.5 1.5" />
            </svg>
          </button>
        </div>
        <nav
          ref="frame"
          class="section-sidebar-nav"
          :aria-label="label"
          @keydown="onNavKey"
        >
          <div ref="scroller" class="section-sidebar-scroll">
            <SidebarGroup
              v-for="group in visibleGroups"
              :key="group.id ?? group.label"
              :group="group"
              :nav="nav"
            />
            <p v-if="empty" class="section-sidebar-empty">没有匹配的条目</p>
            <slot v-if="needle" name="results" :query="query.trim()" />
          </div>
        </nav>
      </component>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.section-sidebar {
  position: sticky;
  top: var(--topbar-height);
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: calc(100dvh - var(--topbar-height));
  border-right: 1px solid var(--rule);
  background: var(--paper);
  font-family: var(--font-sans);
}

.section-sidebar--rail {
  align-items: center;
  width: 3rem;
  padding-top: var(--space-4);
}

svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.section-sidebar-header {
  padding: var(--space-5) var(--space-4) 0;
}

.section-sidebar-shelf {
  flex: none;
  display: flex;
  min-height: 0;
  max-height: 50%;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--rule-strong);
}

.section-sidebar-filter {
  flex: none;
  display: flex;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-3) var(--space-3) var(--space-4);
}

.section-sidebar-filter .input {
  flex: 1;
  min-width: 0;
}

.section-sidebar-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.section-sidebar-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 var(--space-3) var(--space-5);
}

.section-sidebar-empty {
  margin: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.section-sidebar--sheet {
  position: fixed;
  z-index: 50;
  inset: auto 0 0;
  width: 100%;
  max-width: none;
  height: 85dvh;
  margin: 0;
  padding: 0 0 env(safe-area-inset-bottom, 0px);
  border: 0;
  border-top: 1px solid var(--rule);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow-float);
  color: var(--ink);
  animation: sheet-in var(--duration) var(--ease);
}

.section-sidebar--sheet .section-sidebar-shelf {
  display: flex;
  min-height: 0;
  max-height: 50%;
}

.section-sidebar-overlay {
  position: fixed;
  z-index: 50;
  inset: 0;
  background: rgb(28 30 34 / 0.32);
}

.section-sidebar--sheet:not(:has(.section-sidebar-shelf))
  .section-sidebar-filter {
  padding-top: 0;
}

.sheet-grip {
  flex: none;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  touch-action: none;
  cursor: grab;
}

.sheet-handle {
  display: block;
  width: 2.5rem;
  height: 4px;
  margin: 0 auto var(--space-2);
  border-radius: 2px;
  background: var(--rule-strong);
}

.sheet-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 2.25rem;
}

/* Applies before the media query listener swaps the aside for the sheet. */
@media (max-width: 60rem) {
  .section-sidebar:not(.section-sidebar--sheet) {
    display: none;
  }
}

@keyframes sheet-in {
  from {
    transform: translateY(100%);
  }
}
</style>
