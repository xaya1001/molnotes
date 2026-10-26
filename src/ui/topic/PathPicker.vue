<script setup lang="ts">
import { useTopic } from "./context";

/**
 * The topic's learning paths as a choice. The pick is kept in
 * `records.path`; previous and next in the shell then follow that path, and
 * each path lists its chapters with their read marks.
 */
defineProps<{ title?: string }>();
const { content, records } = useTopic();
const paths = content.paths ?? [];
</script>

<template>
  <section aria-label="学习路径">
    <h2 v-if="title">{{ title }}</h2>
    <fieldset>
      <legend>选择一条路径</legend>
      <div v-for="path in paths" :key="path.id" class="path">
        <label>
          <input
            v-model="records.records.path"
            type="radio"
            name="learning-path"
            :value="path.id"
          />
          <strong>{{ path.title }}</strong>
          <span class="meta">
            {{ path.chapters.length }} 章，已学
            {{
              path.chapters.filter((id) =>
                records.records.complete.includes(id),
              ).length
            }}
            章
          </span>
        </label>
        <p>{{ path.summary }}</p>
        <ol v-if="records.records.path === path.id">
          <li v-for="id in path.chapters" :key="id">
            <RouterLink :to="content.chapterPath(id)">{{
              content.chapterById(id).title
            }}</RouterLink>
            <span v-if="records.records.complete.includes(id)" class="meta"
              >已学</span
            >
          </li>
        </ol>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
fieldset {
  border: 1px solid var(--rule);
  padding: var(--space-4);
}
.path + .path {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule);
}
label {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  font-family: var(--font-sans);
}
.meta {
  color: var(--ink-muted);
  font-family: var(--font-sans);
  font-size: 0.9em;
  margin-inline-start: var(--space-2);
}
</style>
