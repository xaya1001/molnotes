<script setup lang="ts">
import type { ResourceRequest } from "../../shared/content-preview.ts";
defineProps<{ request: ResourceRequest }>();
</script>
<template>
  <figure class="request-placeholder">
    <div>{{ request.kind }}</div>
    <figcaption>{{ request.caption }}</figcaption>
    <pre>{{ request.fields }}</pre>
  </figure>
</template>
