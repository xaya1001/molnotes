<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useTopic } from "./context";
import { patentData, sourceLink } from "./patent";
import UiDialog from "../UiDialog.vue";
const data = patentData(useTopic().content),
  router = useRouter();
const query = ref(""),
  input = ref<HTMLInputElement>(),
  help = ref(false);
function search() {
  const q = query.value.trim();
  let match = /^claim\s*(\d+)$/i.exec(q);
  if (match) {
    void router.push(`/claims/${match[1]}`);
    return;
  }
  match = /^(?:example|ex|实施例)\s*(\d+)$/i.exec(q);
  if (match && data.collections?.examples) {
    void router.push(`/${data.collections.examples.route}/${match[1]}`);
    return;
  }
  match = /^p\s*(\d+)$/i.exec(q);
  if (match) {
    void router.push(sourceLink({ page: Number(match[1]) }));
    return;
  }
  void router.push({ path: "/search", query: { q } });
}
function key(event: KeyboardEvent) {
  if (
    event.key === "/" &&
    !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName) &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    input.value?.focus();
  }
}
window.addEventListener("keydown", key);
onBeforeUnmount(() => window.removeEventListener("keydown", key));
</script>
<template>
  <form class="search page-reading" @submit.prevent="search">
    <input
      ref="input"
      v-model="query"
      class="input"
      type="search"
      placeholder="Claim、Example、p 页码或关键词"
      aria-label="全局检索或编号跳转"
    /><button class="button submit">检索</button
    ><button
      type="button"
      class="button button--quiet button--icon"
      aria-label="导航与快捷键"
      @click="help = true"
    >
      ?
    </button>
  </form>
  <UiDialog v-model:open="help" title="导航与比较" close-label="关闭弹窗"
    ><p>按 / 聚焦检索；输入 Claim 编号、Example 编号、p 页序或关键词。</p>
    <p>
      在原页用左右方向键翻页。记录的比较按钮将选中项保存在比较区。
    </p></UiDialog
  >
</template>
<style scoped>
.search {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  min-width: 0;
  margin-bottom: var(--space-5);
}
.input {
  width: min(19rem, 50vw);
  min-width: 0;
}
@media (max-width: 40rem) {
  .input {
    flex: 1;
    width: auto;
  }
  .submit {
    display: none;
  }
}
</style>
