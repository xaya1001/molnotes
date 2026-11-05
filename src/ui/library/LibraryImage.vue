<script setup lang="ts">
import type { FigureReference } from "../../../shared/chemical-library/types.ts";
import { useLibraryImage } from "./client.ts";
const props = defineProps<{ image: string | FigureReference; alt?: string }>();
const { image: resolved, error } = useLibraryImage(() => props.image);
</script>
<template>
  <img v-if="resolved.src" :src="resolved.src" :alt="alt ?? resolved.alt" />
  <span v-else-if="error" role="alert">{{ error }}</span>
</template>
