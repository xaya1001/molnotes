<script setup lang="ts">
import StepPlayer from "../StepPlayer.vue";
import type { SceneFrame } from "./blocks.ts";
defineProps<{ label: string; title?: string; frames: SceneFrame[] }>();
</script>
<template>
  <StepPlayer :label="label" :title="title" :steps="frames">
    <template #default="{ index }">
      <figure v-if="frames[index].image" class="figure">
        <img
          :src="frames[index].image!.src"
          :alt="frames[index].image!.alt"
          loading="lazy"
        />
      </figure>
    </template>
  </StepPlayer>
</template>
<style scoped>
img {
  display: block;
  max-width: 100%;
  margin-inline: auto;
}
</style>
