<script setup lang="ts">
import { PageHeading } from "@ui";
import FlowFigure from "../../ui/diagrams/FlowFigure.vue";
import { defineFlow } from "../../ui/diagrams/flow.ts";
const flow = defineFlow({
  nodes: [
    { id: "input", text: "输入" },
    { id: "result", text: "结果" },
  ],
  edges: ["input > result"],
  steps: [
    {
      at: "input > result",
      title: "处理输入",
      text: "数据沿连线传递，编号对应图下的说明。",
    },
  ],
});
</script>
<template>
  <article class="page-reading">
    <PageHeading eyebrow="Figures" title="组合图示" /><FlowFigure
      :flow="flow"
    />
  </article>
</template>
