<script setup lang="ts">
import LibraryImage from "../library/LibraryImage.vue";
import StepPlayer from "../StepPlayer.vue";
import type { SceneFrame } from "./blocks.ts";
defineProps<{ label: string; title?: string; frames: SceneFrame[] }>();
</script>
<template>
  <StepPlayer :label="label" :title="title" :steps="frames">
    <template #default="{ index }">
      <figure v-if="frames[index].image" class="figure">
        <LibraryImage
          :image="
            'ref' in frames[index].image!
              ? frames[index].image!
              : frames[index].image!.src
          "
          :alt="
            'alt' in frames[index].image! ? frames[index].image!.alt : undefined
          "
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
