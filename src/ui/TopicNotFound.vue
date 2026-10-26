<script setup lang="ts">
import PageHeading from "./PageHeading.vue";
withDefaults(defineProps<{ homeLabel?: string }>(), {
  homeLabel: "回到本专题首页",
});
</script>

<template>
  <article class="page-reading">
    <PageHeading title="页面不存在" summary="这个地址没有对应的内容。" />
    <p>
      <RouterLink class="button" to="/">{{ homeLabel }}</RouterLink>
    </p>
  </article>
</template>
