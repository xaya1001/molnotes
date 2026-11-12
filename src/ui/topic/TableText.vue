<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ text: string }>();
// Shared table text entry point for headings and cells.
const pieces = computed(() =>
  props.text.split(/(\*\*[^*]+\*\*|\n)/).map((text) => {
    if (text === "\n") return { tag: "br", text: "" };
    if (text.startsWith("**") && text.endsWith("**"))
      return { tag: "strong", text: text.slice(2, -2) };
    return { tag: "span", text };
  }),
);
</script>
<template>
  <template v-for="(piece, i) in pieces" :key="i">
    <br v-if="piece.tag === 'br'" />
    <component :is="piece.tag" v-else>{{ piece.text }}</component>
  </template>
</template>
