<script setup lang="ts">
import { measurementText } from "./patent-measurements";
import type { Measurement, Assignment } from "./patent";
import SourceText from "./SourceText.vue";
import { ref, watch } from "vue";
import MoleculeView from "../MoleculeView.vue";
import SourceRef from "./SourceRef.vue";
import {
  gradeText,
  type RecordCollection,
  type RecordField,
  type CollectionRecord,
  type PageRef,
  type BodyRef,
} from "./patent";
const props = defineProps<{
  collection: RecordCollection;
  field: RecordField;
  record: CollectionRecord;
  detail?: boolean;
}>();
const body = ref(""),
  error = ref("");
watch(
  () => [props.record, props.field, props.detail],
  async (_, __, cleanup) => {
    body.value = "";
    error.value = "";
    if (
      props.field.kind !== "body" ||
      !props.detail ||
      !props.record[props.field.key]
    )
      return;
    let stale = false;
    cleanup(() => (stale = true));
    const value = props.record[props.field.key] as BodyRef;
    try {
      const response = await fetch(value.url);
      if (!response.ok) throw new Error("正文加载失败");
      const json = await response.json();
      if (typeof json[value.key] !== "string") throw new Error("正文内容缺失");
      if (!stale) body.value = json[value.key];
    } catch (e) {
      if (!stale) error.value = e instanceof Error ? e.message : "正文加载失败";
    }
  },
  { immediate: true },
);
</script>
<template>
  <div v-if="field.kind === 'measurement'">
    <template v-for="m in [record[field.key] as Measurement]" :key="m.assay">
      <strong>{{ measurementText(m, collection.assays![m.assay]) }}</strong>
      <details>
        <summary>{{ collection.assays![m.assay].title }}</summary>
        <p>
          {{ collection.assays![m.assay].target }} ·
          {{ collection.assays![m.assay].endpoint }}
        </p>
        <p>{{ collection.assays![m.assay].conditions }}</p>
        <SourceRef
          v-for="(r, i) in collection.assays![m.assay].evidence"
          :key="i"
          :reference="r"
        />
      </details>
      <SourceRef v-if="m.ref" :reference="m.ref" :source="record.source" />
    </template>
  </div>
  <div v-else-if="field.kind === 'assignments'">
    <details v-for="(a, i) in record[field.key] as Assignment[]" :key="i">
      <summary>
        {{ a.group }} ·
        {{
          {
            author: "原文归类",
            agent: "Agent 归类",
            "chemical-pattern": "化学模式",
          }[a.basis]
        }}
      </summary>
      <p>{{ a.limit }}</p>
      <code v-if="a.pattern">{{ a.pattern }}</code>
      <SourceRef
        v-for="(r, j) in a.evidence"
        :key="j"
        :reference="r"
        :source="record.source"
      />
      <RouterLink v-for="id in a.claims" :key="id" :to="`/claims/${id}`"
        >Claim {{ id }}
      </RouterLink>
    </details>
  </div>
  <span v-else-if="field.kind === 'grade'">{{
    gradeText(record[field.key], collection.scales[field.scale!])
  }}</span>
  <template v-else-if="field.kind === 'smiles'"
    ><MoleculeView
      v-if="record[field.key]"
      :name="`${collection.title} ${record.id}`"
      :smiles="String(record[field.key])"
    /><span v-else>结构未确认</span></template
  >
  <SourceRef
    v-else-if="field.kind === 'ref' && record[field.key]"
    :reference="record[field.key] as PageRef"
    :source="record.source"
    :image="detail"
  />
  <a
    v-else-if="field.kind === 'link' && record[field.key]"
    :href="String(record[field.key])"
    >{{ field.label }}</a
  >
  <template v-else-if="field.kind === 'body' && detail"
    ><p v-if="error" role="alert">{{ error }}</p>
    <p v-else class="body-text">
      <SourceText :text="body || '正在载入正文…'" :source="record.source" /></p
  ></template>
  <span v-else-if="field.kind === 'tags'">{{
    (record[field.key] as string[] | undefined)?.join(" · ")
  }}</span>
  <span v-else-if="field.kind !== 'body'">{{
    record[field.key] ?? "未列"
  }}</span>
  <SourceRef v-if="field.ref" :reference="field.ref" :source="record.source" />
</template>
<style scoped>
.body-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
