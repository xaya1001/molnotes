<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiDialog from "./UiDialog.vue";
import { loadIndex } from "./content-data.ts";
import { searchNotes, searchSite, snippet } from "./site-search.ts";

/** Site-wide search over notes, topic chapters and glossary terms; the index loads on first open. */
const open = defineModel<boolean>("open", { required: true });
const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const state = ref<"loading" | "ready" | "failed">("loading");

async function load() {
  state.value = "loading";
  try {
    await loadIndex();
    state.value = "ready";
  } catch {
    state.value = "failed";
  }
}

watch(open, (value) => {
  if (!value) return;
  if (state.value !== "ready") void load();
});

const text = computed(() => query.value.trim());
const results = computed(() => {
  if (state.value !== "ready" || [...text.value].length < 2) return null;
  const notes = searchNotes(text.value);
  return {
    notes: { items: notes.slice(0, 20), total: notes.length },
    ...searchSite(text.value),
  };
});
</script>

<template>
  <UiDialog
    v-model:open="open"
    title="搜索"
    class="site-search"
    @open-auto-focus.prevent="input?.focus()"
  >
    <input
      ref="input"
      v-model="query"
      class="input search-input"
      type="search"
      aria-label="搜索全站"
      placeholder="笔记、专题章节与术语"
    />
    <p v-if="state === 'loading' && text" class="search-note">正在加载…</p>
    <p v-else-if="state === 'failed'" class="search-note" role="alert">
      搜索索引读取失败。
      <button class="button" type="button" @click="load">重试</button>
    </p>
    <div v-if="results" class="search-results" aria-live="polite">
      <p
        v-if="
          !results.notes.total &&
          !results.chapters.total &&
          !results.terms.total
        "
        class="search-note"
      >
        没有找到“{{ text }}”
      </p>
      <section v-if="results.notes.total" aria-labelledby="search-notes">
        <h3 id="search-notes" class="search-group">
          笔记
          <span v-if="results.notes.total > results.notes.items.length">
            共 {{ results.notes.total }} 条，显示前
            {{ results.notes.items.length }} 条
          </span>
        </h3>
        <ul class="search-list">
          <li v-for="note in results.notes.items" :key="note.path">
            <a :href="`${note.path}?q=${encodeURIComponent(text)}`">{{
              note.title
            }}</a
            ><span class="search-context">{{ note.directoryTitle }}</span>
            <p class="search-excerpt">
              <template v-for="(part, i) in snippet(note.text, text)" :key="i"
                ><strong v-if="part.hit">{{ part.text }}</strong
                ><template v-else>{{ part.text }}</template></template
              >
            </p>
          </li>
        </ul>
      </section>
      <section v-if="results.chapters.total" aria-labelledby="search-chapters">
        <h3 id="search-chapters" class="search-group">
          专题章节
          <span v-if="results.chapters.total > results.chapters.items.length">
            共 {{ results.chapters.total }} 条，显示前
            {{ results.chapters.items.length }} 条
          </span>
        </h3>
        <ul class="search-list">
          <li v-for="item in results.chapters.items" :key="item.path">
            <a :href="item.path">
              {{ item.topic }} · 第 {{ item.number }} 章 {{ item.title }}
            </a>
            <p class="search-excerpt">
              <template v-for="(part, i) in item.excerpt" :key="i"
                ><strong v-if="part.hit">{{ part.text }}</strong
                ><template v-else>{{ part.text }}</template></template
              >
            </p>
          </li>
        </ul>
      </section>
      <section v-if="results.terms.total" aria-labelledby="search-terms">
        <h3 id="search-terms" class="search-group">
          术语
          <span v-if="results.terms.total > results.terms.items.length">
            共 {{ results.terms.total }} 条，显示前
            {{ results.terms.items.length }} 条
          </span>
        </h3>
        <ul class="search-list">
          <li v-for="item in results.terms.items" :key="item.term">
            <a :href="item.path">{{ item.term }} · {{ item.full }}</a>
            <p class="search-excerpt">
              <template v-for="(part, i) in item.excerpt" :key="i"
                ><strong v-if="part.hit">{{ part.text }}</strong
                ><template v-else>{{ part.text }}</template></template
              >
            </p>
          </li>
        </ul>
      </section>
    </div>
  </UiDialog>
</template>

<style scoped>
.search-input {
  width: 100%;
  font-size: var(--text-base);
}

.search-results {
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.search-note {
  margin: var(--space-4) 0 0;
  color: var(--ink-muted);
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.search-group {
  margin: var(--space-5) 0 var(--space-2);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.14em;
}

.search-group span {
  margin-left: var(--space-2);
  letter-spacing: 0;
}

.search-list {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.search-list a {
  font-weight: 500;
}

.search-context {
  margin-left: var(--space-2);
  color: var(--ink-muted);
}

.search-excerpt {
  margin: var(--space-1) 0 0;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.search-excerpt strong {
  color: var(--ink);
}
</style>
