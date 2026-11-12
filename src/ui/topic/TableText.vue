<script setup lang="ts">
import { computed } from "vue";
import { tableDisplayText } from "./table-text.ts";
const props = defineProps<{ text: string }>();
// Shared table text entry point for headings and cells.
const pieces = computed(() =>
  tableDisplayText(props.text)
    .split(
      /(\*\*[^*]+\*\*|\n|[≥≤<>~]\u00a0?[+−-]?\d[\d.,]*%?(?:\u00a0[^\s*]+)?|\d[\d.,]*\u00a0[^\s*]+)/,
    )
    .map((text) => {
      if (text === "\n") return { tag: "br", text: "", quantity: false };
      if (text.startsWith("**") && text.endsWith("**"))
        return {
          tag: "strong",
          text: text.slice(2, -2),
          quantity: text.includes("\u00a0"),
        };
      return {
        tag: "span",
        text,
        quantity: /^(?:\d[\d.,]*\u00a0|[≥≤<>~]\u00a0?[+−-]?\d)/.test(text),
      };
    }),
);
</script>
<template>
  <span class="table-text"
    ><template v-for="(piece, i) in pieces" :key="i">
      <br v-if="piece.tag === 'br'" />
      <component :is="piece.tag" v-else :class="{ quantity: piece.quantity }">{{
        piece.text
      }}</component>
    </template></span
  >
</template>

<style scoped>
.quantity {
  white-space: nowrap;
}
</style>
