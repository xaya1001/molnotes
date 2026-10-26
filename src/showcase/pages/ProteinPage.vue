<script setup lang="ts">
import { PageHeading } from "@ui";
import ProteinViewer from "../ProteinViewer.vue";
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Protein"
      title="蛋白三维结构"
      summary="三维查看器按需加载，只在读者请求时下载结构文件和渲染库。"
    />
    <div class="prose">
      <ProteinViewer />
    </div>
  </article>
</template>
