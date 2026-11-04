<script setup lang="ts">
import ReactionScheme from "./ReactionScheme.vue";
import type { ReactionStep } from "../../shared/reaction-scheme.ts";
defineProps<{ step: ReactionStep }>();
</script>
<template>
  <ReactionScheme
    :route="{ id: 'reaction', title: step.title, steps: [step] }"
  />
</template>
