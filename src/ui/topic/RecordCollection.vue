<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData, type RecordId, type Assignment } from "./patent.ts";
import { filterRecords, queryText, recordsCsv } from "./patent-filter.ts";
import { substructureMatches } from "./patent-chemistry.ts";
import RecordValue from "./RecordValue.vue";
import SourceRef from "./SourceRef.vue";
import PageHeading from "../PageHeading.vue";
import { downloadFile } from "../notify.ts";
const props = defineProps<{
  collection: string;
  mode?: "list" | "detail" | "compare";
}>();
const { content, records: store } = useTopic();
const data = patentData(content);
const collection = computed(() => data.collections![props.collection]);
const route = useRoute(),
  router = useRouter();
const path = computed(() => `/${collection.value.route}`);
const item = computed(() =>
  collection.value.records.find(
    (r) => String(r.id) === String(route.params.id),
  ),
);
const pins = computed(() => store.records.pins[props.collection] ?? []);
const error = ref(""),
  structError = ref(""),
  matching = ref(false),
  matches = ref<Set<string>>();
const struct = ref(queryText(route.query, "substructure"));
watch(
  () => queryText(route.query, "substructure"),
  async (value, _, cleanup) => {
    struct.value = value;
    structError.value = "";
    matches.value = undefined;
    matching.value = false;
    if (!value) return;
    let stale = false;
    cleanup(() => (stale = true));
    matching.value = true;
    const smiles = collection.value.fields.find((f) => f.kind === "smiles");
    try {
      const found = await substructureMatches(
        value,
        collection.value.records.map((r) => ({
          id: r.id,
          smiles: String(r[smiles?.key ?? "smiles"] ?? ""),
        })),
      );
      if (!stale) matches.value = found;
    } catch (e) {
      if (!stale) {
        matches.value = new Set();
        structError.value = e instanceof Error ? e.message : "结构匹配失败";
      }
    } finally {
      if (!stale) matching.value = false;
    }
  },
  { immediate: true },
);
const results = computed(() =>
  filterRecords(collection.value, route.query, matches.value),
);
const size = 6;
const pageCount = computed(() =>
  Math.max(1, Math.ceil(results.value.length / size)),
);
const page = computed(() =>
  Math.min(
    pageCount.value,
    Math.max(1, Math.floor(Number(route.query.page) || 1)),
  ),
);
const visible = computed(() =>
  results.value.slice((page.value - 1) * size, page.value * size),
);
const view = computed(() => (route.query.view === "cards" ? "cards" : "table"));
const fields = computed(() =>
  collection.value.fields.filter((f) => f.kind !== "body"),
);
const selectedFields = ref(fields.value.map((f) => f.key));
const sources = computed(() => [
  ...new Set(collection.value.records.map((r) => r.source)),
]);
const compared = computed(() =>
  pins.value.map((id) => collection.value.records.find((r) => r.id === id)!),
);
const grouped = computed(() => {
  const rows = props.mode === "compare" ? compared.value : visible.value;
  return props.mode === "compare"
    ? [{ source: "", rows }]
    : sources.value.length > 1
      ? [...new Set(rows.map((r) => r.source))].map((source) => ({
          source,
          rows: rows.filter((r) => r.source === source),
        }))
      : [{ source: "", rows }];
});
const compareInput = ref(pins.value.join(","));
watch(
  () => pins.value.join(","),
  (value) => (compareInput.value = value),
);
function setPins(ids: RecordId[]) {
  error.value = "";
  if (!collection.value.pins || ids.length > collection.value.pins.max) {
    error.value = `比较区最多 ${collection.value.pins?.max ?? 0} 条，请先移除一条。`;
    return false;
  }
  store.records.pins[props.collection] = ids;
  return true;
}
function toggle(id: RecordId) {
  const changed = setPins(
    pins.value.includes(id)
      ? pins.value.filter((n) => n !== id)
      : [...pins.value, id],
  );
  if (changed && props.mode === "compare")
    void router.replace({ query: { ids: pins.value.join(",") } });
}
function compare() {
  if (
    item.value &&
    !pins.value.includes(item.value.id) &&
    !setPins([...pins.value, item.value.id])
  )
    return;
  void router.push({
    path: path.value + "/compare",
    query: { ids: pins.value.join(",") },
  });
}
function applyCompare(value: string) {
  const parts = value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const rows = parts.map((p) =>
    collection.value.records.find((r) => String(r.id) === p),
  );
  if (rows.some((r) => !r) || new Set(parts).size !== parts.length) {
    error.value = "比较编号无效或重复";
    return;
  }
  if (setPins(rows.map((r) => r!.id)))
    void router.replace({ query: { ids: parts.join(",") } });
}
watch(
  () => route.query.ids,
  (v) => {
    if (props.mode === "compare" && typeof v === "string") {
      const ids = v.split(",").filter(Boolean);
      const rows = ids.map((id) =>
        collection.value.records.find((r) => String(r.id) === id),
      );
      if (rows.some((r) => !r) || new Set(ids).size !== ids.length)
        error.value = "比较编号无效或重复";
      else setPins(rows.map((r) => r!.id));
    }
  },
  { immediate: true },
);
function change(key: string, value: string) {
  void router.replace({
    query: { ...route.query, page: undefined, [key]: value || undefined },
  });
}
function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}
function csv() {
  downloadFile(
    recordsCsv(
      collection.value,
      props.mode === "compare" ? compared.value : results.value,
    ),
    `${props.collection}.csv`,
    "text/csv;charset=utf-8",
  );
}
const position = computed(() =>
  collection.value.records.findIndex((r) => r === item.value),
);
const incoming = computed(() =>
  Object.entries(data.collections ?? {}).flatMap(([key, c]) =>
    c.records
      .filter((r) => r.refs?.[props.collection]?.includes(item.value!.id))
      .map((r) => ({ key, route: c.route, id: r.id, title: c.title })),
  ),
);
</script>
<template>
  <section class="record-collection" :class="{ 'page-wide': mode }">
    <PageHeading
      v-if="mode"
      :title="
        mode === 'detail'
          ? item
            ? `${collection.title} ${item.id}`
            : '编号不存在'
          : mode === 'compare'
            ? `${collection.title}并排比较`
            : collection.title
      "
    />
    <h2 v-else>{{ collection.title }}</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="mode === 'detail'">
      <RouterLink :to="path">← 全部{{ collection.title }}</RouterLink>
      <template v-if="item">
        <nav class="controls">
          <RouterLink
            v-if="position > 0"
            :to="`${path}/${collection.records[position - 1].id}`"
            >上一条</RouterLink
          ><RouterLink
            v-if="position < collection.records.length - 1"
            :to="`${path}/${collection.records[position + 1].id}`"
            >下一条</RouterLink
          ><button
            v-if="collection.pins"
            class="button"
            @click="toggle(item.id)"
          >
            {{ pins.includes(item.id) ? "移出比较" : "加入比较" }}</button
          ><button v-if="collection.pins" class="button" @click="compare">
            进入并排比较
          </button>
        </nav>
        <p v-if="sources.length > 1">
          来源：{{ data.sources![item.source].title }}
        </p>
        <dl class="record-fields">
          <div v-for="field in collection.fields" :key="field.key">
            <dt>{{ field.label }}</dt>
            <dd>
              <RecordValue
                :collection="collection"
                :field="field"
                :record="item"
                detail
              />
            </dd>
          </div>
        </dl>
        <aside v-for="(note, i) in item.notes" :key="i" class="callout">
          {{ note.text }}
          <SourceRef
            v-if="note.ref"
            :reference="note.ref"
            :source="item.source"
          />
        </aside>
        <nav
          v-for="(ids, target) in item.refs"
          :key="target"
          class="controls"
          :aria-label="`相关${target === 'claims' ? '权利要求' : data.collections![target].title}`"
        >
          <RouterLink
            v-for="id in ids"
            :key="id"
            :to="
              target === 'claims'
                ? `/claims/${id}`
                : `/${data.collections![target].route}/${id}`
            "
            >{{
              target === "claims" ? "Claim" : data.collections![target].title
            }}
            {{ id }}</RouterLink
          >
        </nav>
        <nav class="controls" aria-label="引用本条的记录">
          <RouterLink
            v-for="r in incoming"
            :key="`${r.key}/${r.id}`"
            :to="`/${r.route}/${r.id}`"
            >{{ r.title }} {{ r.id }}</RouterLink
          >
        </nav>
        <label class="note"
          >本条分析笔记<textarea
            class="input"
            maxlength="30000"
            :value="
              store.records.recordNotes[`${props.collection}/${item.id}`] ?? ''
            "
            @input="
              store.records.recordNotes[`${props.collection}/${item.id}`] =
                value($event)
            "
          ></textarea>
        </label>
      </template>
    </template>
    <template v-else-if="mode === 'compare'">
      <RouterLink :to="path">← 全部{{ collection.title }}</RouterLink>
      <form class="controls" @submit.prevent="applyCompare(compareInput)">
        <label>比较编号<input v-model="compareInput" class="input" /></label
        ><button class="button">更新比较</button
        ><button
          v-if="collection.export"
          type="button"
          class="button"
          :disabled="matching"
          @click="csv"
        >
          导出比较 CSV
        </button>
      </form>
      <fieldset class="controls">
        <legend>比较字段</legend>
        <label v-for="field in fields" :key="field.key"
          ><input
            v-model="selectedFields"
            type="checkbox"
            :value="field.key"
          />{{ field.label }}</label
        >
      </fieldset>
      <section v-for="group in grouped" :key="group.source">
        <h2 v-if="group.source">{{ data.sources![group.source].title }}</h2>
        <div class="cards">
          <article
            v-for="record in group.rows"
            :key="record.id"
            class="compare-column"
          >
            <h3>
              <RouterLink :to="`${path}/${record.id}`"
                >{{ collection.title }} {{ record.id }}</RouterLink
              >
            </h3>
            <h4 v-if="sources.length > 1">
              {{ data.sources![record.source].title }}
            </h4>
            <button
              class="button"
              :aria-label="`移除 ${record.id}`"
              @click="toggle(record.id)"
            >
              移除
            </button>
            <dl>
              <div
                v-for="field in fields.filter((f) =>
                  selectedFields.includes(f.key),
                )"
                :key="field.key"
              >
                <dt>{{ field.label }}</dt>
                <dd>
                  <RecordValue
                    :collection="collection"
                    :field="field"
                    :record="record"
                  />
                </dd>
              </div>
            </dl>
            <label
              >比较笔记<textarea
                class="input"
                maxlength="30000"
                :aria-label="`${record.id} 比较笔记`"
                :value="
                  store.records.recordNotes[
                    `${props.collection}/${record.id}`
                  ] ?? ''
                "
                @input="
                  store.records.recordNotes[
                    `${props.collection}/${record.id}`
                  ] = value($event)
                "
              ></textarea>
            </label>
          </article>
        </div>
      </section>
      <p v-if="!compared.length">比较区尚无记录。</p>
    </template>
    <template v-else>
      <div class="controls">
        <label
          >记录搜索<input
            class="input"
            type="search"
            aria-label="记录搜索"
            :value="queryText(route.query, 'q')"
            @input="change('q', value($event))"
        /></label>
        <label v-if="sources.length > 1"
          >来源<select
            class="input"
            :value="queryText(route.query, 'source')"
            @change="change('source', value($event))"
          >
            <option value="">全部来源</option>
            <option v-for="source in sources" :key="source" :value="source">
              {{ data.sources![source].title }}
            </option>
          </select></label
        >
        <label
          v-for="field in collection.fields.filter((f) => f.filter)"
          :key="field.key"
          >{{ field.label }}筛选
          <span v-if="field.kind === 'measurement'" class="controls">
            <select
              class="input"
              :aria-label="`${field.label}测定`"
              :value="queryText(route.query, `${field.key}.assay`)"
              @change="change(`${field.key}.assay`, value($event))"
            >
              <option value="">全部测定（不作数值排序）</option>
              <option
                v-for="(a, id) in collection.assays"
                :key="id"
                :value="id"
              >
                {{ a.title }} · {{ a.unit ?? "单位待核实" }}
              </option>
            </select>
            <select
              class="input"
              :aria-label="`${field.label}状态`"
              :value="queryText(route.query, `${field.key}.status`)"
              @change="change(`${field.key}.status`, value($event))"
            >
              <option value="">全部状态</option>
              <option value="reported">已报告</option>
              <option value="exact">精确值</option>
              <option value="unreported">未报告</option>
              <option value="not-tested">未测定</option>
              <option value="unresolved">待核实</option>
            </select>
            <input
              v-for="bound in ['min', 'max']"
              :key="bound"
              class="input"
              type="number"
              :disabled="
                !collection.assays?.[
                  queryText(route.query, `${field.key}.assay`)
                ]?.unit
              "
              :aria-label="`${field.label}${bound === 'min' ? '最小值' : '最大值'}`"
              :placeholder="bound === 'min' ? '下限' : '上限'"
              :value="queryText(route.query, `${field.key}.${bound}`)"
              @input="change(`${field.key}.${bound}`, value($event))"
            />
          </span>
          <select
            v-else-if="field.kind === 'assignments'"
            class="input"
            :value="queryText(route.query, field.key)"
            @change="change(field.key, value($event))"
          >
            <option value="">全部分组</option>
            <option
              v-for="g in [
                ...new Set(
                  collection.records.flatMap((r) =>
                    (r[field.key] as Assignment[]).map((a) => a.group),
                  ),
                ),
              ]"
              :key="g"
            >
              {{ g }}
            </option>
          </select>
          <select
            v-else-if="field.kind === 'grade'"
            class="input"
            :value="queryText(route.query, field.key)"
            @change="change(field.key, value($event))"
          >
            <option value="">不限</option>
            <option value="reported">已报告分档</option>
            <option value="missing">无报告数值</option>
            <option value="unlisted">未列</option>
            <option value="blank">
              {{ collection.scales[field.scale!].blank }}
            </option>
            <option value="dash">
              {{ collection.scales[field.scale!].dash }}
            </option>
            <option
              v-for="bin in collection.scales[field.scale!].bins"
              :key="bin.value"
              :value="bin.value"
            >
              {{ bin.value }} · {{ bin.label }}
            </option>
          </select>
          <select
            v-else-if="field.kind === 'tags'"
            class="input"
            :value="queryText(route.query, field.key)"
            @change="change(field.key, value($event))"
          >
            <option value="">全部标签</option>
            <option
              v-for="tag in [
                ...new Set(
                  collection.records.flatMap(
                    (r) => (r[field.key] as string[] | undefined) ?? [],
                  ),
                ),
              ]"
              :key="tag"
            >
              {{ tag }}
            </option>
          </select>
          <span v-else-if="field.kind === 'number'" class="controls"
            ><input
              v-for="bound in ['min', 'max']"
              :key="bound"
              class="input"
              type="number"
              :aria-label="`${field.label}${bound === 'min' ? '最小值' : '最大值'}`"
              :value="queryText(route.query, `${field.key}.${bound}`)"
              @input="change(`${field.key}.${bound}`, value($event))"
          /></span>
          <input
            v-else
            class="input"
            :value="queryText(route.query, field.key)"
            @input="change(field.key, value($event))"
          />
        </label>
        <label
          >排序<select
            class="input"
            :value="queryText(route.query, 'sort') || 'id'"
            @change="change('sort', value($event))"
          >
            <option value="id">编号</option>
            <option
              v-for="field in fields.filter((f) => f.sort)"
              :key="field.key"
              :value="field.key"
            >
              {{ field.label }}
            </option>
          </select></label
        >
        <label
          >顺序<select
            class="input"
            :value="queryText(route.query, 'order') || 'asc'"
            @change="change('order', value($event))"
          >
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </select></label
        >
        <label
          >浏览方式<select
            class="input"
            :value="view"
            @change="change('view', value($event))"
          >
            <option value="table">表格</option>
            <option value="cards">结构卡片</option>
          </select></label
        >
      </div>
      <form
        v-if="fields.some((f) => f.kind === 'smiles')"
        class="controls"
        @submit.prevent="change('substructure', struct)"
      >
        <label
          >子结构（SMILES 或 SMARTS）<input
            v-model="struct"
            class="input" /></label
        ><button class="button">筛选子结构</button>
      </form>
      <p v-if="structError" role="alert">{{ structError }}</p>
      <p v-if="matching" role="status">正在匹配结构…</p>
      <div class="controls">
        <button class="button" @click="router.replace({ query: {} })">
          清除筛选</button
        ><button
          v-if="collection.export"
          class="button"
          :disabled="matching"
          @click="csv"
        >
          当前筛选 CSV</button
        ><RouterLink v-if="collection.pins" :to="path + '/compare'"
          >并排比较</RouterLink
        >
      </div>
      <p class="result-count" aria-live="polite">
        匹配 {{ results.length }} / {{ collection.records.length }} 条
      </p>
      <section v-for="group in grouped" :key="group.source">
        <h3 v-if="group.source">{{ data.sources![group.source].title }}</h3>
        <div v-if="view === 'table'" class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>编号</th>
                <th v-for="field in fields" :key="field.key">
                  {{ field.label }}
                </th>
                <th v-if="collection.pins">比较</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in group.rows" :key="record.id">
                <th>
                  <RouterLink :to="`${path}/${record.id}`">{{
                    record.id
                  }}</RouterLink>
                </th>
                <td v-for="field in fields" :key="field.key">
                  <RecordValue
                    :collection="collection"
                    :field="field"
                    :record="record"
                  />
                </td>
                <td v-if="collection.pins">
                  <button
                    class="button"
                    :aria-label="`比较 ${record.id}`"
                    :aria-pressed="pins.includes(record.id)"
                    @click="toggle(record.id)"
                  >
                    {{ pins.includes(record.id) ? "移除" : "加入" }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="cards">
          <article v-for="record in group.rows" :key="record.id">
            <h3>
              <RouterLink :to="`${path}/${record.id}`"
                >{{ collection.title }} {{ record.id }}</RouterLink
              >
            </h3>
            <dl>
              <div v-for="field in fields" :key="field.key">
                <dt>{{ field.label }}</dt>
                <dd>
                  <RecordValue
                    :collection="collection"
                    :field="field"
                    :record="record"
                  />
                </dd>
              </div>
            </dl>
            <button
              v-if="collection.pins"
              class="button"
              :aria-label="`比较 ${record.id}`"
              @click="toggle(record.id)"
            >
              {{ pins.includes(record.id) ? "移除" : "加入比较" }}
            </button>
          </article>
        </div>
      </section>
      <p v-if="!results.length">没有匹配项，请减少筛选条件。</p>
      <nav class="controls" aria-label="分页">
        <button
          class="button"
          :disabled="page === 1"
          @click="
            router.replace({
              query: { ...route.query, page: String(page - 1) },
            })
          "
        >
          ← 上一页</button
        ><span>{{ page }} / {{ pageCount }}</span
        ><button
          class="button"
          :disabled="page === pageCount"
          @click="
            router.replace({
              query: { ...route.query, page: String(page + 1) },
            })
          "
        >
          下一页 →
        </button>
      </nav>
    </template>
  </section>
</template>
<style scoped>
.record-collection {
  min-width: 0;
  overflow-wrap: anywhere;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-block: var(--space-4);
}
label {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
.input {
  max-width: 100%;
  min-width: 0;
}
dd {
  margin: 0;
}
.record-fields > div,
.compare-column {
  padding: var(--space-4);
  background: var(--surface);
  margin-block: var(--space-3);
}
dt {
  font-family: var(--font-sans);
  color: var(--ink-muted);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: var(--space-4);
}
.table-scroll {
  max-width: 100%;
  overflow: auto;
}
.table-scroll td {
  min-width: 8rem;
}
.note textarea {
  min-height: 8rem;
}
</style>
