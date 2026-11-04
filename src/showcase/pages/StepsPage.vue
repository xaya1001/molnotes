<script setup lang="ts">
import { PageHeading } from "@ui";
import ProcessViewer from "../../ui/topic/ProcessViewer.vue";
import { sampleProcess } from "../step-scenarios.ts";
</script>

<template>
  <article class="page-reading">
    <PageHeading eyebrow="Steps" title="分步图示" />
    <ProcessViewer :data="sampleProcess" />
  </article>
</template>
