<script setup lang="ts">
import { ref } from "vue";
import { PageHeading } from "@ui";
import StepScene from "../StepScene.vue";

const step = ref(0);
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Steps"
      title="分步图示"
      summary="先确定每个关键帧的含义，再用页面状态驱动过渡动画。"
    />
    <div class="prose">
      <figure>
        <StepScene v-model="step" />
      </figure>
      <p>
        图示由 Vue 渲染的 SVG 与 Motion
        组成，步骤编号保存在页面状态里；文字说明与画面表达同一个状态。
      </p>
    </div>
  </article>
</template>
