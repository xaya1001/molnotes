<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { SiteBar } from "@ui";
import type { GlossaryEntry } from "../../scripts/glossary.mjs";

/** Every site glossary term with the notes and topic chapters that use it. */
const props = defineProps<{ entries: GlossaryEntry[] }>();
const query = ref("");
const shown = computed(() => {
  const words = query.value.trim().toLowerCase();
  return props.entries.filter((entry) =>
    `${entry.term} ${entry.full} ${entry.definition}`
      .toLowerCase()
      .includes(words),
  );
});
// The entry named by the address (from search or a term card) comes into view once rendered.
onMounted(() => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) document.getElementById(id)?.scrollIntoView();
});
</script>

<template>
  <div class="glossary">
    <SiteBar current="glossary" />
    <main class="glossary-main page-reading">
      <header class="glossary-heading">
        <p class="eyebrow">Glossary</p>
        <h1>术语表</h1>
      </header>
      <label class="field"
        >查找术语<input v-model="query" class="input" type="search"
      /></label>
      <p class="caption count">
        {{ shown.length }} / {{ entries.length }} 个术语
      </p>
      <p v-if="!shown.length" class="empty">没有匹配的术语。</p>
      <div class="prose">
        <section
          v-for="entry in shown"
          :id="entry.term"
          :key="entry.term"
          class="entry"
        >
          <h2>{{ entry.term }} · {{ entry.full }}</h2>
          <p>{{ entry.definition }}</p>
          <p>容易混淆：{{ entry.confusion }}</p>
          <ul v-if="entry.uses.length" class="uses" aria-label="用到它的地方">
            <li v-for="use in entry.uses" :key="use.path">
              <a :href="use.path">{{ use.title }}</a>
              <span class="use-context">{{ use.context }}</span>
            </li>
          </ul>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.glossary-main {
  padding: var(--space-7) var(--gutter) var(--space-8);
}

.glossary-heading {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1.5px solid var(--ink);
}

h1 {
  margin: var(--space-2) 0 0;
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.count {
  margin: var(--space-3) 0 0;
}

.empty {
  color: var(--ink-muted);
}

.entry {
  scroll-margin-top: var(--space-5);
}

.entry:target h2 {
  color: var(--accent);
}

.prose .uses {
  padding: 0;
  list-style: none;
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.use-context {
  margin-left: var(--space-2);
  color: var(--ink-muted);
}
</style>
