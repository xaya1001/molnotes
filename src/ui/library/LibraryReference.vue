<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api.ts";
import type {
  FigureReference,
  LibrarySnapshot,
} from "../../../shared/chemical-library/types.ts";
import LibraryFigure from "./LibraryFigure.vue";
defineProps<{ reference: FigureReference }>();
const library = ref<LibrarySnapshot>();
const error = ref("");
onMounted(async () => {
  try {
    library.value = await api<LibrarySnapshot>("/api/library");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>
<template>
  <LibraryFigure
    v-if="library"
    :library="library.entries"
    :reference="reference"
  />
  <p v-else-if="error" role="alert">{{ error }}</p>
</template>
