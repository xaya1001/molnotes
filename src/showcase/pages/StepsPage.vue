<script setup lang="ts">
import { PageHeading } from "@ui";
import StepPlayer from "../StepPlayer.vue";
import { sampleProcess } from "../step-scenarios.ts";
</script>

<template>
  <article class="page-reading">
    <PageHeading eyebrow="Steps" title="分步图示" />
    <StepPlayer :data="sampleProcess" />
  </article>
</template>
