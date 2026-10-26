<script setup lang="ts">
import { PageHeading } from "@ui";
import { groups } from "../pages";

const demos = groups.flatMap((group) => group.items).slice(1);
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Toolbox"
      title="工具箱示例"
      summary="本页用中性数据演示专题共享界面和制作工具的接入方式。每一节对应一种能力，正式专题按需引入。"
    />
    <div class="prose">
      <p>
        专题由共享外壳提供目录、顶栏、上一节与下一节以及页面标题；正文、图示和交互由专题自己编写。下面各节依次展示正文排版元素、分步图示、公式与曲线、二维结构、数据表与散点、预测矩阵、三维结构，以及代码生成的讲解视频。
      </p>
      <ol class="demo-list">
        <li v-for="demo in demos" :key="demo.to">
          <RouterLink :to="demo.to">{{ demo.label }}</RouterLink>
        </li>
      </ol>
      <aside class="callout">
        <span class="callout-title">说明</span>
        本页只演示交互与渲染能力，不代表任何科学模型。
      </aside>
    </div>
  </article>
</template>

<style scoped>
.demo-list {
  columns: 2;
  column-gap: var(--space-6);
}

@media (max-width: 30rem) {
  .demo-list {
    columns: 1;
  }
}
</style>
