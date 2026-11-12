<script setup lang="ts">
import { computed } from "vue";
import { tableDisplayText } from "./table-text.ts";
const props = defineProps<{ text: string }>();
// Shared table text entry point for headings and cells.
const pieces = computed(() =>
  tableDisplayText(props.text)
    .split(/(\*\*[^*]+\*\*|\n)/)
    .map((text) => {
      if (text === "\n") return { tag: "br", text: "" };
      if (text.startsWith("**") && text.endsWith("**"))
        return { tag: "strong", text: text.slice(2, -2) };
      return { tag: "span", text };
    }),
);
</script>
<template>
  <span class="table-text"
    ><template v-for="(piece, i) in pieces" :key="i">
      <br v-if="piece.tag === 'br'" />
      <component :is="piece.tag" v-else>{{ piece.text }}</component>
    </template></span
  >
</template>

<style scoped>
.table-text {
  overflow-wrap: normal;
}
</style>
