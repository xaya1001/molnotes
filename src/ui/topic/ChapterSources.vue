<script setup lang="ts">
import { computed } from "vue";
import CiteButton from "../CiteButton.vue";
import { useTopic } from "./context";
const props = defineProps<{ id: string }>();
const { content } = useTopic();
const sources = computed(() =>
  content.sources.filter((source) =>
    content.chapterById(props.id).refs.includes(source.id),
  ),
);
</script>
<template>
  <details v-if="sources.length" class="note-sources">
    <summary>资料来源</summary>
    <section
      v-for="source in sources"
      :id="`source-${source.id}`"
      :key="source.id"
    >
      <h3>{{ source.title }}</h3>
      <p>
        {{ source.kind
        }}<template v-if="source.checked">
          · 核对日期 {{ source.checked }}</template
        >
      </p>
      <p>{{ source.note }}</p>
      <ul v-if="source.cite?.length">
        <li v-for="href in source.cite" :key="href">
          <CiteButton :href="href" />
        </li>
      </ul>
    </section>
  </details>
</template>
