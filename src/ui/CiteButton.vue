<script setup lang="ts">
import { computed } from "vue";
import { citationLabel, useCitations } from "./citations.ts";

/** A citation href that opens the original in the page's viewer; `label` replaces the location text. */
const props = defineProps<{ href: string; label?: string }>();
const context = useCitations();
const citation = computed(() => context?.citations[props.href]);
</script>
<template>
  <button
    v-if="context && citation"
    type="button"
    class="cite"
    @click="context.open(href)"
  >
    {{ label ?? citationLabel(citation) }}</button
  ><template v-else>{{ label }}</template>
</template>
