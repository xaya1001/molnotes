<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from "reka-ui";
import { useMediaQuery } from "./media.ts";
import SiteSearch from "./SiteSearch.vue";
import { siteSections as sections, type SiteSection } from "./site-sections.ts";

import { showToast, toastMessage } from "./notify.ts";
import { loadCatalog } from "./content-data.ts";
import { sites } from "./catalog.ts";
import { loadSiteRecords, sectionHref } from "./site-records.ts";
const navigationReady = ref(false);
onMounted(async () => {
  try {
    await Promise.all([loadCatalog(), loadSiteRecords()]);
    navigationReady.value = true;
  } catch {
    showToast("栏目读取失败，请刷新重试。");
  }
});
const siteSections = computed(() =>
  sections.map((section) => ({
    ...section,
    href:
      section.id === "practice" || section.id === "cases"
        ? navigationReady.value
          ? sectionHref(section.id, sites)
          : undefined
        : section.href,
  })),
);

/**
 * The bar every page shares: the site name back to the home page, the
 * sections with the current one marked, and site search. Below 48rem the
 * sections fold into a menu button and search keeps only its icon.
 */
const props = defineProps<{ current?: SiteSection }>();
const menuOpen = ref(false);
const narrow = useMediaQuery("(max-width: 48rem)");
watch(narrow, (value) => {
  if (!value) menuOpen.value = false;
});
const searchOpen = ref(false);
const currentLabel = computed(
  () =>
    siteSections.value.find((section) => section.id === props.current)?.label,
);
</script>

<template>
  <header class="site-bar">
    <a class="site-name" href="/">分子笔记</a>
    <nav class="site-sections" aria-label="栏目">
      <a
        v-for="section in siteSections"
        :key="section.id"
        :href="section.href"
        :aria-current="section.id === current ? 'page' : undefined"
        >{{ section.label }}</a
      >
    </nav>
    <div class="site-tools">
      <div class="site-menu">
        <DropdownMenuRoot v-model:open="menuOpen" :modal="false">
          <DropdownMenuTrigger
            class="button button--quiet site-menu-button"
            type="button"
          >
            {{ currentLabel ?? "栏目" }}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              align="end"
              :side-offset="8"
              as-child
              aria-label="栏目"
            >
              <div class="site-menu-panel">
                <DropdownMenuItem
                  v-for="section in siteSections"
                  :key="section.id"
                  as-child
                >
                  <a
                    :href="section.href"
                    :aria-current="section.id === current ? 'page' : undefined"
                    >{{ section.label }}</a
                  >
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
      <button
        class="button site-search-button"
        type="button"
        aria-label="全站搜索"
        @click="searchOpen = true"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <span class="site-search-label" aria-hidden="true">搜索</span>
      </button>
    </div>
    <SiteSearch v-model:open="searchOpen" />
    <p class="topic-toast" role="status" :hidden="!toastMessage">
      {{ toastMessage }}
    </p>
  </header>
</template>

<style scoped>
.topic-toast {
  position: fixed;
  bottom: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
  left: 50%;
  z-index: 40;
  max-width: calc(100vw - 2rem);
  margin: 0;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  background: var(--ink);
  color: #fff;
  font: var(--text-sm) / 1.5 var(--font-sans);
  transform: translateX(-50%);
  box-shadow: var(--shadow-float);
}

.site-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  height: var(--topbar-height);
  padding: 0 var(--gutter);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  font-family: var(--font-sans);
}

.site-name {
  flex: none;
  color: var(--ink);
  font: 600 var(--text-lg) / 1 var(--font-serif);
  letter-spacing: 0.06em;
  text-decoration: none;
}

.site-name:hover {
  color: var(--accent);
}

.site-sections {
  display: flex;
  align-self: stretch;
  gap: var(--space-1);
}

.site-sections a {
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  color: var(--ink-soft);
  font: 500 var(--text-sm) / 1 var(--font-sans);
  letter-spacing: 0.04em;
  text-decoration: none;
  box-shadow: inset 0 -2px transparent;
}

.site-sections a:hover {
  color: var(--accent);
}

.site-sections a[aria-current="page"] {
  color: var(--accent);
  box-shadow: inset 0 -2px var(--accent);
}

.site-tools {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.site-search-button {
  min-width: 12rem;
  justify-content: flex-start;
  border-color: var(--rule-strong);
  background: var(--surface);
  color: var(--ink-muted);
  font-weight: 500;
}

.site-menu {
  position: relative;
  display: none;
}

.site-menu-button {
  gap: var(--space-1);
  font-weight: 500;
}

.site-menu-panel {
  z-index: 50;
  display: grid;
  min-width: 9rem;
  padding: var(--space-2) 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-float);
}

.site-menu-panel a {
  padding: var(--space-2) var(--space-5);
  color: var(--ink-soft);
  font: 500 var(--text-base) / 1.6 var(--font-sans);
  text-decoration: none;
}

.site-menu-panel a:hover,
.site-menu-panel a[data-highlighted] {
  background: var(--paper-deep);
  color: var(--ink);
}

.site-menu-panel a[aria-current="page"] {
  color: var(--accent);
}

@media (max-width: 48rem) {
  .site-bar {
    gap: var(--space-3);
    padding-inline: var(--space-4);
  }

  .site-sections {
    display: none;
  }

  .site-menu {
    display: block;
  }

  .site-search-button {
    width: 2.25rem;
    min-width: 0;
    padding: 0;
    justify-content: center;
    border-color: transparent;
    background: transparent;
    color: var(--ink-soft);
  }

  .site-search-label {
    display: none;
  }
}
</style>
