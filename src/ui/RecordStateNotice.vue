<script setup lang="ts">
import { catalogSite, topicBase } from "./catalog";
import type { SiteRecordState } from "./site-records";

/** Why a topic's records are not shown, with where to fix it. */
defineProps<{ slug: string; state: SiteRecordState }>();
</script>

<template>
  <span v-if="state === 'outdated'">
    记录是旧格式，<a :href="topicBase(catalogSite(slug))">打开该专题</a
    >一次即可更新
  </span>
  <span v-else-if="state === 'unreadable'" class="record-notice--unreadable">
    记录无法读取，请到<a href="/review/">复习页</a>导出记录。
  </span>
</template>

<style scoped>
.record-notice--unreadable {
  color: var(--danger);
}
</style>
