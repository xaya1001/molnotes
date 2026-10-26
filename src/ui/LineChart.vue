<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsType } from "echarts/core";

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

/** One plotted series: a line, or scattered points such as measured readings. */
export interface ChartSeries {
  name: string;
  points: { x: number; y: number }[];
  scatter?: boolean;
}

const props = defineProps<{
  /** The single series, when `series` is not given. */
  points?: { x: number; y: number }[];
  /** Several named series with a legend; scatter ones are drawn as points only. */
  series?: ChartSeries[];
  xLabel: string;
  yLabel: string;
  /** Fixed axis range; without it the axis starts at 0 and follows the data. */
  xDomain?: readonly [number, number];
  yDomain?: readonly [number, number];
}>();
const element = ref<HTMLElement | null>(null);
let chart: EChartsType | undefined;
let resizeObserver: ResizeObserver | undefined;

function token(name: string) {
  if (!element.value) throw new Error("Chart mount element is missing");
  return getComputedStyle(element.value).getPropertyValue(name).trim();
}

const range = (domain?: readonly [number, number]) =>
  domain ? { min: domain[0], max: domain[1] } : {};

function render() {
  const ink = token("--ink-muted");
  const rule = token("--rule");
  const font = token("--font-sans");
  const axis = {
    type: "value" as const,
    min: 0,
    nameTextStyle: { color: ink, fontFamily: font },
    axisLabel: { color: ink, fontFamily: font },
    axisLine: { lineStyle: { color: token("--rule-strong") } },
    splitLine: { lineStyle: { color: rule } },
  };
  const palette = [
    token("--accent"),
    token("--ink"),
    token("--success") || "#2a7",
    token("--danger") || "#c33",
    token("--ink-muted"),
  ];
  const series = props.series ?? [
    { name: props.yLabel, points: props.points ?? [] },
  ];
  chart?.setOption(
    {
      grid: {
        left: 54,
        right: 18,
        top: props.series ? 40 : 24,
        bottom: 48,
      },
      legend: props.series
        ? { top: 0, textStyle: { color: ink, fontFamily: font } }
        : undefined,
      tooltip: { trigger: "axis", textStyle: { fontFamily: font } },
      xAxis: {
        ...axis,
        ...range(props.xDomain),
        name: props.xLabel,
        nameLocation: "middle",
        nameGap: 30,
      },
      yAxis: { ...axis, ...range(props.yDomain), name: props.yLabel },
      series: series.map((item, i) => ({
        name: item.name,
        type: item.scatter ? "scatter" : "line",
        data: item.points.map(({ x, y }) => [x, y]),
        symbolSize: item.scatter ? 9 : 6,
        symbol: item.scatter ? "diamond" : "circle",
        color: palette[i % palette.length],
      })),
    },
    { replaceMerge: ["series"] },
  );
}

onMounted(() => {
  if (!element.value) throw new Error("Chart mount element is missing");
  chart = echarts.init(element.value, undefined, { renderer: "svg" });
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(element.value);
  render();
});
watch(
  () => [
    props.points,
    props.series,
    props.xLabel,
    props.yLabel,
    props.xDomain,
    props.yDomain,
  ],
  render,
);
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div
    ref="element"
    class="line-chart"
    role="img"
    :aria-label="`${yLabel} 随 ${xLabel} 变化的曲线`"
  ></div>
</template>

<style scoped>
.line-chart {
  width: 100%;
  height: 18rem;
}
</style>
