<script setup lang="ts">
import { PageHeading, StructureLab } from "@ui";
import { structures } from "../structures.ts";
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Structure"
      title="结构量距"
      summary="真实坐标的子集，距离由坐标文件算出；三维视图按需加载，读者点两个原子即可量距。"
    />
    <div class="prose">
      <StructureLab :set="structures" />
    </div>
  </article>
</template>
