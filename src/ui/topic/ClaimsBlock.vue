<script setup lang="ts">
import SourceText from "./SourceText.vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData } from "./patent.ts";
import { checkScopes } from "./patent-chemistry.ts";
import SourceRef from "./SourceRef.vue";
import PageHeading from "../PageHeading.vue";
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
  verdicts = ref<
    Record<number, { status: "matched" | "not-matched" | "unmodeled" }>
  >({});
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
      claims.value.map((c) => ({ id: c.id, smarts: c.scope?.smarts })),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "核对失败";
  } finally {
    busy.value = false;
  }
}
const examples = data.collections?.examples;
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
              matched: "匹配所声明子结构",
              "not-matched": "未匹配所声明子结构",
              unmodeled: "未建立化学模式",
            }[verdicts[claim.id].status]
          }}
        </h3>
        <p>{{ claim.scope?.note ?? claim.note }}</p>
        <p v-if="!claim.scope">
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
