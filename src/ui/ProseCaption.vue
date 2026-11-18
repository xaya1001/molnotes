<script setup lang="ts">
import { computed } from "vue";
import { captionParts } from "../../shared/prose-format.ts";

const props = defineProps<{ text: string }>();
const parts = computed(() => captionParts(props.text));
</script>

<template>
  <template v-for="(part, i) in parts" :key="i"
    ><em v-if="i % 2">{{ part }}</em
    ><template v-else>{{ part }}</template></template
  >
</template>
