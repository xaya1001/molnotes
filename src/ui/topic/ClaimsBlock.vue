<script setup lang="ts">
import SourceText from "./SourceText.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData } from "./patent.ts";
import { checkScopes, scopeCoverage } from "./patent-chemistry.ts";
import SourceRef from "./SourceRef.vue";
import PageHeading from "../PageHeading.vue";
import type { MarkushMatch } from "../../../shared/patent-markush.ts";
const props = defineProps<{
  set?: string;
  mode?: "detail" | "compare" | "list";
}>();
const data = patentData(useTopic().content),
  route = useRoute(),
  router = useRouter();
const sets = Object.entries(data.claims ?? {});
const claims = computed(() =>
  sets
    .filter(([id]) => !props.set || props.set === id)
    .flatMap(([, set]) =>
      set.claims.map((c) => ({ ...c, source: set.source })),
    ),
);
const query = ref(""),
  group = ref(""),
  smiles = ref(""),
  error = ref(""),
  busy = ref(false),
  verdicts = ref<Record<number, MarkushMatch>>({});
const list = computed(() =>
  claims.value.filter(
    (c) =>
      (!group.value || c.group === group.value) &&
      (!query.value ||
        (/^\d+$/.test(query.value)
          ? String(c.id) === query.value
          : `${c.title} ${c.text}`
              .toLowerCase()
              .includes(query.value.toLowerCase()))),
  ),
);
const ids = computed(() =>
  String(route.query.ids ?? "")
    .split(",")
    .map(Number),
);
const shown = computed(() =>
  props.mode === "detail"
    ? claims.value.filter((c) => String(c.id) === String(route.params.id))
    : props.mode === "compare"
      ? claims.value.filter((c) => ids.value.includes(c.id)).slice(0, 2)
      : [],
);
const other = ref(
  claims.value.find((c) => String(c.id) !== String(route.params.id))?.id,
);
async function check() {
  error.value = "";
  verdicts.value = {};
  busy.value = true;
  try {
    verdicts.value = await checkScopes(
      smiles.value,
      claims.value.map((c) => ({ id: c.id, markush: c.markush })),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "核对失败";
  } finally {
    busy.value = false;
  }
}
const examples = data.collections?.examples;
const coverage = ref<Record<number, Awaited<ReturnType<typeof scopeCoverage>>>>(
  {},
);
const coverageError = ref("");
watch(
  shown,
  async (visible, _old, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    coverageError.value = "";
    for (const claim of visible) {
      if (!claim.markush || coverage.value[claim.id]) continue;
      const field = examples?.fields.find((f) => f.kind === "smiles")?.key;
      try {
        const result = await scopeCoverage(
          claim.markush,
          (examples?.records ?? [])
            .filter((r) =>
              claim.examples.some((id) => String(id) === String(r.id)),
            )
            .map((r) => ({
              id: r.id,
              smiles: field ? String(r[field] ?? "") : "",
            })),
        );
        if (active) coverage.value[claim.id] = result;
      } catch (e) {
        if (active)
          coverageError.value = e instanceof Error ? e.message : "覆盖统计失败";
      }
    }
  },
  { immediate: true },
);
const statusText = {
  matched: "定义内",
  "not-matched": "定义外",
  unmodeled: "未建模",
};
function alternativeLabel(
  claim: (typeof claims.value)[number],
  key: string,
  id: string,
) {
  return (
    claim.markush?.groups[key].alternatives.find((a) => a.id === id)?.label ??
    id
  );
}
</script>
<template>
  <section class="claims" :class="{ 'page-wide': mode }">
    <PageHeading
      v-if="mode"
      :title="
        mode === 'compare'
          ? '权利要求并排比较'
          : mode === 'detail'
            ? shown.length
              ? `Claim ${shown[0].id}`
              : '编号不存在'
            : '权利要求'
      "
    />
    <h2 v-else>权利要求</h2>
    <div class="controls">
      <label
        >权利要求检索<input
          v-model="query"
          class="input"
          type="search" /></label
      ><label
        >权利要求分组<select v-model="group" class="input">
          <option value="">全部分组</option>
          <option
            v-for="name in [...new Set(claims.map((c) => c.group))]"
            :key="name"
          >
            {{ name }}
          </option>
        </select></label
      >
    </div>
    <nav aria-label="权利要求列表">
      <ul>
        <li v-for="claim in list" :key="claim.id">
          <RouterLink :to="`/claims/${claim.id}`"
            >Claim {{ claim.id }} · {{ claim.title }}</RouterLink
          >
          <ul v-if="claim.children.length">
            <li v-for="id in claim.children" :key="id">
              <RouterLink :to="`/claims/${id}`">Claim {{ id }}</RouterLink>
            </li>
          </ul>
        </li>
      </ul>
    </nav>
    <form class="controls" @submit.prevent="check">
      <label>化学模式匹配 SMILES<input v-model="smiles" class="input" /></label
      ><button class="button" :disabled="busy">
        {{ busy ? "正在核对…" : "匹配子结构" }}
      </button>
    </form>
    <p>
      化学模式匹配仅描述所声明的子结构。权利要求判断需核对原文、变量定义和限制条件。
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="Object.keys(verdicts).length" class="verdicts">
      <article
        v-for="claim in claims"
        :key="claim.id"
        :data-match-status="verdicts[claim.id].status"
      >
        <h3>
          Claim {{ claim.id }}：{{
            {
              matched: "在声明的化学模式内",
              "not-matched": "在模式外",
              unmodeled: "部分未建模",
            }[verdicts[claim.id].status]
          }}
        </h3>
        <p>{{ claim.markush?.note ?? claim.note }}</p>
        <p v-if="verdicts[claim.id].reason === 'core'">母核不匹配</p>
        <p v-if="verdicts[claim.id].reason === 'excluded'">
          被但书排除：{{
            claim.markush?.exclusions?.find(
              (e) => e.id === verdicts[claim.id].exclusion,
            )?.label
          }}
        </p>
        <p v-if="verdicts[claim.id].outside?.length">
          跳出定义的位置：{{
            verdicts[claim.id].outside
              ?.map((key) =>
                key === "core"
                  ? "母核其他位置"
                  : claim.markush?.groups[key].label,
              )
              .join("、")
          }}
        </p>
        <p v-if="claim.markush?.unmodeled">{{ claim.markush.unmodeled }}</p>
        <div v-if="verdicts[claim.id].groups.length" class="table-scroll">
          <table class="data-table" :aria-label="`Claim ${claim.id} 逐位判定`">
            <thead>
              <tr>
                <th>位置</th>
                <th>实际片段</th>
                <th>判定</th>
                <th>命中备选</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="g in verdicts[claim.id].groups"
                :key="g.key"
                :data-group-status="g.status"
              >
                <th>{{ g.label }}</th>
                <td>
                  <code>{{ g.fragment }}</code>
                </td>
                <td>
                  {{ statusText[g.status] }}
                  <p v-if="g.note">{{ g.note }}</p>
                </td>
                <td>
                  {{
                    g.alternatives
                      .map((id) => alternativeLabel(claim, g.key, id))
                      .join("、") || "—"
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="!claim.markush">
          作者整理的实施例归属：<RouterLink
            v-for="id in claim.examples"
            :key="id"
            :to="`/${examples!.route}/${id}`"
            >{{ id }}
          </RouterLink>
        </p>
      </article>
    </div>
    <form
      v-if="mode === 'detail' && shown.length"
      class="controls"
      @submit.prevent="
        router.push({
          path: '/claims/compare',
          query: { ids: `${shown[0].id},${other}` },
        })
      "
    >
      <label
        >与另一项比较<select v-model="other" class="input">
          <option
            v-for="claim in claims.filter((c) => c.id !== shown[0].id)"
            :key="claim.id"
            :value="claim.id"
          >
            Claim {{ claim.id }}
          </option>
        </select></label
      ><button class="button">并排查看</button>
    </form>
    <div class="columns">
      <article v-for="claim in shown" :key="claim.id" class="claim-detail">
        <h2>{{ claim.title }}</h2>
        <p>{{ claim.note }}</p>
        <p v-for="note in claim.notes" :key="note">{{ note }}</p>
        <section v-if="claim.markush" class="coverage">
          <h3>实施例覆盖</h3>
          <p v-if="coverageError" role="alert">{{ coverageError }}</p>
          <p v-else-if="!coverage[claim.id]" role="status">正在统计…</p>
          <div v-else class="table-scroll">
            <table
              class="data-table"
              :aria-label="`Claim ${claim.id} 实施例覆盖`"
            >
              <thead>
                <tr>
                  <th>位置</th>
                  <th>备选或片段</th>
                  <th>实施例</th>
                </tr>
              </thead>
              <tbody v-for="g in coverage[claim.id].groups" :key="g.key">
                <tr
                  v-for="a in g.alternatives"
                  :key="a.id"
                  :data-alternative="a.id"
                >
                  <th>{{ g.label }}</th>
                  <td>{{ a.label }}</td>
                  <td>
                    <RouterLink
                      v-for="id in a.examples"
                      :key="id"
                      :to="`/${examples!.route}/${id}`"
                      >{{ id }} </RouterLink
                    ><span v-if="!a.examples.length">无实施例</span>
                  </td>
                </tr>
                <tr v-for="r in g.outside" :key="r.id">
                  <th>{{ g.label }} · 定义外</th>
                  <td>
                    <code>{{ r.fragment }}</code>
                  </td>
                  <td>
                    <RouterLink :to="`/${examples!.route}/${r.id}`">{{
                      r.id
                    }}</RouterLink>
                  </td>
                </tr>
                <tr v-if="g.unmodeled.length">
                  <th>{{ g.label }} · 未建模</th>
                  <td>—</td>
                  <td>{{ g.unmodeled.join("、") }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p class="original">
          <SourceText :text="claim.text" :source="claim.source" />
        </p>
        <h3>本项引用</h3>
        <nav class="controls">
          <RouterLink v-for="id in claim.refs" :key="id" :to="`/claims/${id}`"
            >Claim {{ id }}</RouterLink
          >
        </nav>
        <h3>引用本项</h3>
        <nav class="controls">
          <RouterLink
            v-for="id in claim.children"
            :key="id"
            :to="`/claims/${id}`"
            >Claim {{ id }}</RouterLink
          >
        </nav>
        <SourceRef
          v-for="(segment, i) in claim.segments"
          :key="i"
          :reference="segment"
          :source="claim.source"
          image
        />
        <h3>相关实施例</h3>
        <nav class="controls">
          <RouterLink
            v-for="id in claim.examples"
            :key="id"
            :to="`/${examples!.route}/${id}`"
            >{{ examples!.title }} {{ id }}</RouterLink
          >
        </nav>
      </article>
    </div>
  </section>
</template>
<style scoped>
.coverage td a {
  display: inline-block;
  margin-inline-end: var(--space-1);
}
.claims {
  min-width: 0;
  overflow-wrap: anywhere;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  margin-block: var(--space-4);
}
.input {
  max-width: 100%;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: var(--space-5);
}
.original {
  white-space: pre-wrap;
}
</style>
