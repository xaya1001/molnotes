<script setup lang="ts">
import { useTopic } from "./context";

/** Read and bookmark toggles plus the chapter note, kept in the topic's records. */
defineProps<{ id: string }>();
const { records } = useTopic();
const { toggle } = records;
const state = records.records;
</script>

<template>
  <section aria-label="本章记录" class="callout">
    <div class="actions">
      <button
        class="button"
        :aria-pressed="state.complete.includes(id)"
        @click="toggle('complete', id)"
      >
        {{ state.complete.includes(id) ? "已读" : "标记已读" }}</button
      ><button
        class="button"
        :aria-pressed="state.bookmarks.includes(id)"
        @click="toggle('bookmarks', id)"
      >
        {{ state.bookmarks.includes(id) ? "已加入书签" : "加入书签" }}
      </button>
    </div>
    <label class="field"
      >我的笔记<textarea
        v-model="state.notes[id]"
        class="input"
        maxlength="50000"
        rows="4"
      />
    </label>
    <p class="figure-caption">记录保存在网站中，可在复习页导出备份。</p>
  </section>
</template>

<style scoped>
.actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
textarea {
  width: 100%;
  resize: vertical;
}
</style>
