<script setup lang="ts">
import { ref } from "vue";
import { PageHeading, UiDialog } from "@ui";

const dialogOpen = ref(false);
const rows = [
  { sample: "样品 A", condition: "条件 1", value: "0.42", note: "示例数值" },
  { sample: "样品 B", condition: "条件 1", value: "1.37", note: "示例数值" },
  { sample: "样品 C", condition: "条件 2", value: "12.8", note: "示例数值" },
];
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Elements"
      title="正文元素"
      summary="专题正文使用统一的标题层级、段落、引用、提示、表格和弹窗。"
    />
    <div class="prose">
      <p>
        正文放在
        <code>prose</code>
        容器里即可获得统一排版。段落按阅读宽度排布，引用来源用上标式标记<a
          class="ref"
          href="#sources"
          >1</a
        >，数值使用等宽数字，例如 <span class="num">IC50 = 12.5 nM</span>。
      </p>

      <h2>二级标题</h2>
      <p>二级标题划分章节内的主要问题，三级标题用于问题下的具体论证。</p>
      <h3>三级标题</h3>
      <ul>
        <li>列表项用于并列的要点。</li>
        <li>每项保持一句话的长度。</li>
      </ul>

      <aside class="callout">
        <span class="callout-title">要点</span>
        普通提示用于强调本节的核心结论。
      </aside>
      <aside class="callout callout--evidence">
        <span class="callout-title">证据</span>
        证据提示标出结论依据的原始资料与页码。
      </aside>
      <aside class="callout callout--caution">
        <span class="callout-title">注意</span>
        注意提示说明模型假设与适用边界。
      </aside>

      <h2>数据表</h2>
      <figure>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>样品</th>
                <th>条件</th>
                <th>读数</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.sample">
                <td>{{ row.sample }}</td>
                <td>{{ row.condition }}</td>
                <td class="num">{{ row.value }}</td>
                <td>{{ row.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <figcaption>表 1　三线表样式的示例数据。</figcaption>
      </figure>

      <h2>弹窗</h2>
      <p>弹窗用于查看补充信息，关闭后焦点回到打开它的按钮。</p>
      <p>
        <button class="button" type="button" @click="dialogOpen = true">
          查看补充说明
        </button>
      </p>
      <UiDialog v-model:open="dialogOpen" title="补充说明">
        <p>弹窗内容由调用方提供。按 Esc、点击遮罩或关闭按钮都可以关闭。</p>
      </UiDialog>

      <h2 id="sources">来源</h2>
      <ol>
        <li>示例来源：此处列出资料名称、版本与页码。</li>
      </ol>
    </div>
  </article>
</template>
