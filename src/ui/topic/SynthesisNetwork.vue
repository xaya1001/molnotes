<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData, type CompoundRef } from "./patent.ts";
import {
  routeSteps,
  routeStats,
  sharedIntermediates,
} from "./patent-synthesis.ts";
import PageHeading from "../PageHeading.vue";
import SourceRef from "./SourceRef.vue";
const props = defineProps<{ network: string; mode?: boolean }>();
const data = patentData(useTopic().content),
  route = useRoute(),
  router = useRouter();
const network = computed(() => data.synthesis![props.network]);
const scaffold = computed(() => String(route.query.scaffold ?? ""));
const strategy = computed(() => String(route.query.strategy ?? ""));
const options = computed(() =>
  network.value.routes.filter(
    (r) =>
      (!scaffold.value || r.scaffold === scaffold.value) &&
      (!strategy.value ||
        routeSteps(network.value, r).some(
          (s) => s.strategy === strategy.value,
        )),
  ),
);
const shown = computed(() => {
  const ids = String(route.query.routes ?? options.value[0]?.id ?? "").split(
    ",",
  );
  return options.value.filter((r) => ids.includes(r.id)).slice(0, 2);
});
function change(key: string, value: string) {
  void router.replace({
    query: {
      ...route.query,
      [key]: key === "routes" ? value : value || undefined,
    },
  });
}
function select(id: string, checked: boolean) {
  const ids = shown.value.map((r) => r.id).filter((r) => r !== id);
  if (checked) ids.push(id);
  change("routes", ids.slice(-2).join(","));
}
const link = (c: CompoundRef) =>
  `/${data.collections![c.collection].route}/${c.id}`;
const label = (c: CompoundRef) => {
  const collection = data.collections![c.collection];
  const record = collection.records.find((r) => r.id === c.id)!;
  return typeof record.shortName === "string"
    ? record.shortName
    : `${collection.title} ${c.id}`;
};
const input = (e: Event) => (e.target as HTMLInputElement).value;
</script>
<template>
  <section class="synthesis-network page-wide">
    <PageHeading v-if="mode" :title="network.title" />
    <h2 v-else>{{ network.title }}</h2>
    <div class="controls">
      <label
        >骨架<select
          class="input"
          :value="scaffold"
          @change="change('scaffold', input($event))"
        >
          <option value="">全部骨架</option>
          <option
            v-for="s in [...new Set(network.routes.map((r) => r.scaffold))]"
            :key="s"
          >
            {{ s }}
          </option>
        </select></label
      >
      <label
        >反应策略<select
          class="input"
          :value="strategy"
          @change="change('strategy', input($event))"
        >
          <option value="">全部策略</option>
          <option
            v-for="s in [...new Set(network.steps.map((r) => r.strategy))]"
            :key="s"
          >
            {{ s }}
          </option>
        </select></label
      >
    </div>
    <fieldset class="controls">
      <legend>路线比较（最多两条）</legend>
      <label v-for="r in options" :key="r.id"
        ><input
          type="checkbox"
          :checked="shown.includes(r)"
          @change="select(r.id, ($event.target as HTMLInputElement).checked)"
        />{{ r.title }}</label
      >
    </fieldset>
    <aside v-if="sharedIntermediates(network).length" class="callout">
      分支共用原料／中间体：<RouterLink
        v-for="c in sharedIntermediates(network)"
        :key="JSON.stringify(c)"
        :to="link(c)"
        >{{ label(c) }}
      </RouterLink>
    </aside>
    <div class="columns route-columns">
      <article
        v-for="r in shown"
        :key="r.id"
        :data-step-count="routeStats(network, r).total"
        :data-longest-path="routeStats(network, r).longest"
      >
        <h3>{{ r.title }}</h3>
        <p>
          {{ r.scaffold }} ·
          {{ r.extent === "fragment" ? "已核验片段" : "完整路线" }} · 总步骤
          {{ routeStats(network, r).total }} · 最长路径
          {{ routeStats(network, r).longest }}
        </p>
        <p>{{ r.limit }}</p>
        <p v-if="r.reportedYield">
          原文合并收率 {{ r.reportedYield.value }}% · 步骤
          {{ r.reportedYield.scopeStepIds.join(" → ") }} ·
          {{ r.reportedYield.basis }}
          <SourceRef :reference="r.reportedYield.ref" />
        </p>
        <p>
          目标：<RouterLink :to="link(r.target)">{{
            label(r.target)
          }}</RouterLink>
        </p>
        <SourceRef v-for="(ref, i) in r.evidence" :key="i" :reference="ref" />
        <ol class="steps">
          <li v-for="s in routeSteps(network, r)" :key="s.id">
            <details open>
              <summary>{{ s.title }} · {{ s.strategy }}</summary>
              <p>
                <span v-for="(c, i) in s.reactants" :key="JSON.stringify(c)"
                  >{{ i ? " + " : ""
                  }}<RouterLink :to="link(c)">{{ label(c) }}</RouterLink></span
                >
                →
                <span v-for="(c, i) in s.products" :key="JSON.stringify(c)"
                  >{{ i ? " + " : ""
                  }}<RouterLink :to="link(c)">{{ label(c) }}</RouterLink></span
                >
              </p>
              <dl>
                <dt>试剂</dt>
                <dd>
                  {{ s.reagents ?? network.procedures![s.procedure!].reagents }}
                </dd>
                <dt>条件</dt>
                <dd>
                  {{
                    s.conditions ?? network.procedures![s.procedure!].conditions
                  }}
                </dd>
                <dt>收率</dt>
                <dd>
                  {{
                    s.yield.status === "reported"
                      ? `${s.yield.value}% · ${s.yield.basis}`
                      : `未报告 · ${s.yield.reason}`
                  }}
                </dd>
              </dl>
              <p v-if="s.isolatedMass">
                {{ s.isolatedMass.state === "crude" ? "粗品质量" : "分离质量" }}
                {{ s.isolatedMass.value }} {{ s.isolatedMass.unit }} ·
                <RouterLink :to="link(s.isolatedMass.product)">{{
                  label(s.isolatedMass.product)
                }}</RouterLink>
                <SourceRef :reference="s.isolatedMass.ref" />
              </p>
              <p v-if="s.limit">{{ s.limit }}</p>
              <p v-if="s.owner">
                制备归属：<RouterLink :to="link(s.owner)">{{
                  label(s.owner)
                }}</RouterLink>
              </p>
              <p v-if="s.procedure">
                程序 {{ s.procedure }} · {{ s.procedureNote }}
              </p>
              <SourceRef
                v-for="(ref, i) in s.evidence"
                :key="`step${i}`"
                :reference="ref"
              />
              <SourceRef
                v-if="s.yield.status === 'reported'"
                :reference="s.yield.ref"
              />
              <p
                v-if="
                  s.procedure && network.procedures![s.procedure].sourceRecord
                "
              >
                引用程序：<RouterLink
                  :to="link(network.procedures![s.procedure].sourceRecord!)"
                  >{{
                    label(network.procedures![s.procedure].sourceRecord!)
                  }}</RouterLink
                >
              </p>
              <SourceRef
                v-for="(ref, i) in s.procedure
                  ? network.procedures![s.procedure].evidence
                  : []"
                :key="`procedure${i}`"
                :reference="ref"
              />
              <SourceRef
                v-for="(ref, i) in s.overrideEvidence"
                :key="`override${i}`"
                :reference="ref"
              />
            </details>
          </li>
        </ol>
      </article>
    </div>
    <section v-if="network.references?.length">
      <h3>原文明示的程序引用</h3>
      <div class="columns">
        <article
          v-for="r in network.references"
          :key="JSON.stringify(r.record)"
        >
          <h4>
            <RouterLink :to="link(r.record)">{{ label(r.record) }}</RouterLink>
            →
            <RouterLink
              :to="link(network.procedures![r.procedure].sourceRecord!)"
              >{{
                label(network.procedures![r.procedure].sourceRecord!)
              }}</RouterLink
            >
          </h4>
          <p>{{ r.note }}</p>
          <p>替换试剂：{{ r.reagents ?? "未另列" }}</p>
          <p v-if="r.conditions">{{ r.conditions }}</p>
          <p>收率未报告 · {{ r.yield.reason }}</p>
          <SourceRef v-for="(ref, i) in r.evidence" :key="i" :reference="ref" />
          <SourceRef
            v-for="(ref, i) in r.overrideEvidence"
            :key="`override${i}`"
            :reference="ref"
          />
          <SourceRef
            v-for="(ref, i) in network.procedures![r.procedure].evidence"
            :key="`procedure${i}`"
            :reference="ref"
          />
        </article>
      </div>
    </section>
    <p v-if="!shown.length">当前筛选没有选中路线。</p>
  </section>
</template>
<style scoped>
.synthesis-network {
  min-width: 0;
  overflow-wrap: anywhere;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-block: var(--space-4);
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
  gap: var(--space-5);
}
.steps {
  padding-inline-start: var(--space-5);
}
.steps li {
  margin-block: var(--space-4);
}
dd {
  margin-inline-start: 0;
}
.input {
  max-width: 100%;
}
</style>
