<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useTopic } from "./context";
import { patentData } from "./patent";
import SourceRef from "./SourceRef.vue";
import RecordValue from "./RecordValue.vue";
import PageHeading from "../PageHeading.vue";
const props = defineProps<{
  cases: string;
  collection: string;
  mode?: boolean;
  caseId?: string;
}>();
const data = patentData(useTopic().content),
  route = useRoute();
const collection = data.collections![props.collection],
  cases = data.sarCases![props.cases];
const shown = computed(() =>
  (props.caseId ?? route.params.caseId)
    ? cases.filter((c) => c.id === (props.caseId ?? route.params.caseId))
    : cases,
);
const grades = collection.fields.filter((f) => f.kind === "grade");
const x = ref(grades[0]?.key ?? ""),
  y = ref(grades[1]?.key ?? grades[0]?.key ?? "");
const gradeKeys = (key: string) => [
  ...collection.scales[grades.find((f) => f.key === key)!.scale!].bins.map(
    (b) => b.value,
  ),
  "--",
  "",
  "未列",
];
function ids(a: string, b: string) {
  return collection.records
    .filter((r) => (r[x.value] ?? "未列") === a && (r[y.value] ?? "未列") === b)
    .map((r) => r.id);
}
</script>
<template>
  <section class="sar-cases" :class="{ 'page-wide': mode }">
    <PageHeading
      v-if="mode"
      :title="shown.length ? '构效关系案例' : '编号不存在'"
    />
    <h2 v-else>构效关系案例</h2>
    <nav class="controls">
      <RouterLink
        v-for="item in cases"
        :key="item.id"
        :to="`/sar/${item.id}`"
        >{{ item.title }}</RouterLink
      >
    </nav>
    <article v-for="item in shown" :key="item.id" class="case-card">
      <h3>{{ item.title }}</h3>
      <p>{{ item.area }} · {{ item.change }}</p>
      <p v-if="item.analysis">
        {{
          {
            observation: "原文观察",
            "design-around-hypothesis": "设计绕开假设",
            unresolved: "待核实",
          }[item.analysis.kind]
        }}
        · {{ item.analysis.rationale }}
      </p>
      <SourceRef
        v-for="(ref, i) in item.analysis?.evidence"
        :key="i"
        :reference="ref"
      />
      <p>{{ item.finding }}</p>
      <aside class="callout">{{ item.limit }}</aside>
      <div class="columns">
        <article v-for="id in item.ids" :key="id">
          <h4>
            <RouterLink :to="`/${collection.route}/${id}`"
              >{{ collection.title }} {{ id }}</RouterLink
            >
          </h4>
          <dl>
            <div
              v-for="field in collection.fields.filter((f) =>
                [
                  'smiles',
                  'grade',
                  'ref',
                  'measurement',
                  'assignments',
                ].includes(f.kind),
              )"
              :key="field.key"
            >
              <dt>{{ field.label }}</dt>
              <dd>
                <RecordValue
                  :collection="collection"
                  :field="field"
                  :record="collection.records.find((r) => r.id === id)!"
                />
              </dd>
            </div>
          </dl>
        </article>
      </div>
      <nav class="controls">
        <RouterLink
          v-if="collection.pins"
          :to="{
            path: `/${collection.route}/compare`,
            query: { ids: item.ids.join(',') },
          }"
          >结构与活性并排比较 →</RouterLink
        ><RouterLink v-for="id in item.claims" :key="id" :to="`/claims/${id}`"
          >Claim {{ id }}</RouterLink
        >
      </nav>
    </article>
    <section v-if="grades.length">
      <h3>分档交叉计数</h3>
      <div class="controls">
        <label v-for="axis in ['x', 'y']" :key="axis"
          >{{ axis === "x" ? "横轴" : "纵轴"
          }}<select
            class="input"
            :value="axis === 'x' ? x : y"
            @change="
              axis === 'x'
                ? (x = ($event.target as HTMLSelectElement).value)
                : (y = ($event.target as HTMLSelectElement).value)
            "
          >
            <option v-for="field in grades" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select></label
        >
      </div>
      <div class="table-scroll">
        <table class="data-table matrix">
          <thead>
            <tr>
              <th>纵 / 横</th>
              <th v-for="a in gradeKeys(x)" :key="a">{{ a || "空白" }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in gradeKeys(y)" :key="b">
              <th>{{ b || "空白" }}</th>
              <td v-for="a in gradeKeys(x)" :key="a">
                <RouterLink
                  v-if="ids(a, b).length"
                  :aria-label="`${a}/${b}：${ids(a, b).length} 条`"
                  :to="{
                    path: `/${collection.route}`,
                    query: { ids: ids(a, b).join(',') },
                  }"
                  >{{ ids(a, b).length }}</RouterLink
                ><span v-else>0</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
<style scoped>
.sar-cases {
  min-width: 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-block: var(--space-4);
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: var(--space-4);
}
.table-scroll {
  overflow: auto;
  max-width: 100%;
}
dd {
  margin: 0;
}
.case-card {
  margin-block: var(--space-5);
}
</style>
