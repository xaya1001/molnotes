<script setup lang="ts">
import { catalogSite, topicBase } from "../ui/catalog";
import { isChoice } from "../ui/topic/prediction";
import { ref } from "vue";
import { quiz } from "../ui/content-data";
import { topics } from "../ui/content-data";
import {
  downloadFile,
  exportSiteRecords,
  readSiteRecords,
  RecordStateNotice,
  SiteBar,
} from "@ui";

const { topics: records, storageError } = readSiteRecords(topics);
const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic]));
const questions = new Map(
  quiz.map((item) => [`${item.slug}/${item.id}`, item]),
);

function chapter(slug: string, id: string) {
  const found = topicBySlug.get(slug)?.chapters.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown chapter: ${slug}/${id}`);
  return found;
}

const shown = records
  .filter((item) => item.state !== "none")
  .map((item) => ({ ...item, topic: topicBySlug.get(item.slug)! }));
const readable = shown.filter((item) => item.state === "ok");

const total = (count: (item: (typeof readable)[number]) => number) =>
  readable.reduce((sum, item) => sum + count(item), 0);
const totals = {
  complete: total((item) => item.complete.length),
  chapters: total((item) => item.topic.chapters.length),
  bookmarks: total((item) => item.bookmarks.length),
  notes: total((item) => Object.keys(item.notes).length),
  mistakes: total((item) => item.mistakes.length),
};

const paragraphs = (text: string | string[]) =>
  Array.isArray(text) ? text : [text];

const mistakes = readable
  .filter((item) => item.mistakes.length)
  .map((item) => ({
    topic: item.topic,
    questions: [
      ...Object.keys(item.answers)
        .filter((id) => item.answers[id] !== item.topic.answerKey[id])
        .map((id) => {
          const question = questions.get(`${item.slug}/${id}`)!;
          return {
            id: `quiz-${id}`,
            question: [question.question],
            parts: [],
            lang: "zh",
            chosen: question.options[item.answers[id]],
            correct: question.options[question.answer],
            explanation: [question.explanation],
            basis: "",
            origin: "",
            chapter: chapter(item.slug, question.chapter),
          };
        }),
      ...item.topic.predictions
        .filter(({ id }) => item.predictionMistakes.includes(id))
        .map(({ id, prediction, chapter: chapterId }) => {
          const answer = item.predictions[id];
          return {
            id: `prediction-${id}`,
            question: [
              ...(prediction.context ? [prediction.context] : []),
              prediction.question,
            ],
            parts: [],
            lang: "zh",
            chosen:
              isChoice(prediction) && "option" in answer
                ? prediction.options[answer.option]
                : undefined,
            correct: isChoice(prediction)
              ? prediction.options[prediction.answer]
              : undefined,
            explanation: [prediction.explanation],
            basis: "",
            origin: "",
            chapter: chapter(item.slug, chapterId),
          };
        }),
      ...item.topic.problems
        .filter(({ id }) => item.problemMistakes.includes(id))
        .map((problem) => ({
          id: `problem-${problem.id}`,
          question:
            problem.prompt === undefined ? [] : paragraphs(problem.prompt),
          parts: problem.parts ?? [],
          lang: problem.lang,
          chosen: item.problems[problem.id].response,
          correct: undefined,
          explanation: paragraphs(problem.answer.text),
          basis: problem.answer.basis,
          origin: problem.answer.origin === "book" ? "书内答案" : "AI 答案",
          chapter: chapter(item.slug, problem.chapter),
        })),
    ],
  }));

const marks = readable
  .filter((item) => item.bookmarks.length || Object.keys(item.notes).length)
  .map((item) => ({
    topic: item.topic,
    bookmarks: item.bookmarks.map((id) => chapter(item.slug, id)),
    notes: Object.entries(item.notes).map(([id, note]) => ({
      chapter: chapter(item.slug, id),
      text:
        [...note].length > 120 ? `${[...note].slice(0, 120).join("")}…` : note,
    })),
  }));

const exportError = ref("");

async function exportAll() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    downloadFile(
      await exportSiteRecords(),
      `molnotes-records-${date}.json`,
      "application/json",
    );
    exportError.value = "";
  } catch {
    exportError.value = "学习记录读取失败，未能导出。";
  }
}
</script>

<template>
  <div class="review">
    <SiteBar current="review" />
    <main class="review-main page-reading">
      <header class="review-heading">
        <p class="eyebrow">Review</p>
        <h1>复习</h1>
        <p class="lede">
          全站的阅读进度、错题、书签与笔记。记录保存在网站中，可导出备份。
        </p>
      </header>

      <p v-if="storageError" class="callout callout--caution" role="alert">
        {{ storageError }}
      </p>

      <section aria-labelledby="progress-title">
        <h2 id="progress-title" class="section-label">进度</h2>
        <p v-if="!shown.length" class="empty">
          还没有学习记录。<a href="/">回到首页</a>
        </p>
        <div v-else class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">专题</th>
                <th scope="col" class="count">已读 / 总章</th>
                <th scope="col" class="count">书签</th>
                <th scope="col" class="count">笔记</th>
                <th scope="col" class="count">错题</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in shown" :key="item.slug">
                <th scope="row">
                  <a :href="topicBase(catalogSite(item.slug))">{{
                    item.topic.title
                  }}</a>
                </th>
                <template v-if="item.state === 'ok'">
                  <td class="count num">
                    {{ item.complete.length }} /
                    {{ item.topic.chapters.length }}
                  </td>
                  <td class="count num">{{ item.bookmarks.length }}</td>
                  <td class="count num">
                    {{ Object.keys(item.notes).length }}
                  </td>
                  <td class="count num">{{ item.mistakes.length }}</td>
                </template>
                <td v-else colspan="4">
                  <RecordStateNotice :slug="item.slug" :state="item.state" />
                </td>
              </tr>
            </tbody>
            <tfoot v-if="readable.length">
              <tr>
                <th scope="row">合计</th>
                <td class="count num">
                  {{ totals.complete }} / {{ totals.chapters }}
                </td>
                <td class="count num">{{ totals.bookmarks }}</td>
                <td class="count num">{{ totals.notes }}</td>
                <td class="count num">{{ totals.mistakes }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section v-if="mistakes.length" aria-labelledby="mistakes-title">
        <h2 id="mistakes-title" class="section-label">错题本</h2>
        <section
          v-for="group in mistakes"
          :key="group.topic.slug"
          :aria-label="group.topic.title"
          class="topic-group"
        >
          <h3>{{ group.topic.title }}</h3>
          <article
            v-for="question in group.questions"
            :key="question.id"
            class="mistake"
            :lang="question.lang"
            :data-testid="`mistake-${question.id}`"
          >
            <p
              v-for="(text, i) in question.question"
              :key="i"
              class="mistake-question"
            >
              {{ text }}
            </p>
            <ol v-if="question.parts.length" type="a">
              <li v-for="(part, i) in question.parts" :key="i">{{ part }}</li>
            </ol>
            <dl v-if="question.chosen !== undefined" class="mistake-answers">
              <div>
                <dt>{{ question.origin ? "我的答案" : "你的选择" }}</dt>
                <dd class="chosen">{{ question.chosen }}</dd>
              </div>
              <div v-if="question.correct !== undefined">
                <dt>正确答案</dt>
                <dd class="correct">{{ question.correct }}</dd>
              </div>
            </dl>
            <p v-if="question.origin" class="caption">
              参考答案 · {{ question.origin }}
            </p>
            <p
              v-for="(text, i) in question.explanation"
              :key="i"
              class="mistake-explanation"
            >
              {{ text }}
            </p>
            <p v-if="question.basis" class="caption">{{ question.basis }}</p>
            <a :href="question.chapter.path">
              回到第 {{ question.chapter.number }} 章 ·
              {{ question.chapter.title }}
            </a>
          </article>
        </section>
      </section>

      <section v-if="marks.length" aria-labelledby="marks-title">
        <h2 id="marks-title" class="section-label">书签与笔记</h2>
        <section
          v-for="group in marks"
          :key="group.topic.slug"
          :aria-label="group.topic.title"
          class="topic-group"
        >
          <h3>{{ group.topic.title }}</h3>
          <ul v-if="group.bookmarks.length" class="bookmarks">
            <li v-for="item in group.bookmarks" :key="item.id">
              <a :href="item.path">第 {{ item.number }} 章 {{ item.title }}</a>
            </li>
          </ul>
          <div v-for="note in group.notes" :key="note.chapter.id" class="note">
            <a :href="note.chapter.path">
              第 {{ note.chapter.number }} 章 {{ note.chapter.title }}
            </a>
            <p>{{ note.text }}</p>
          </div>
        </section>
      </section>

      <section aria-labelledby="export-title">
        <h2 id="export-title" class="section-label">备份</h2>
        <p class="export-text">导出全站专题与笔记阅读记录。</p>
        <button
          class="button"
          type="button"
          :disabled="Boolean(storageError)"
          @click="exportAll"
        >
          导出全部记录
        </button>
        <p
          v-if="exportError"
          class="callout callout--caution export-error"
          role="alert"
        >
          {{ exportError }}
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.review-main {
  padding: var(--space-7) var(--gutter) var(--space-8);
}

.review-heading {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1.5px solid var(--ink);
}

h1 {
  margin: var(--space-2) 0 var(--space-3);
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.lede {
  margin: 0;
  color: var(--ink-soft);
}

.section-label {
  margin: var(--space-7) 0 var(--space-3);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.14em;
}

.empty {
  color: var(--ink-muted);
}

.data-table th[scope="row"] {
  font-weight: 400;
  text-align: left;
}

.data-table .count {
  text-align: right;
  white-space: nowrap;
}

.data-table tfoot th,
.data-table tfoot td {
  border-top: 1px solid var(--ink);
  font-weight: 600;
}

.topic-group + .topic-group {
  margin-top: var(--space-6);
}

h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.mistake {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

.mistake {
  overflow-wrap: anywhere;
}
.mistake:lang(en) {
  hyphens: auto;
}
.chosen {
  white-space: pre-wrap;
}

.mistake-question {
  margin: 0;
}

.mistake-answers {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-3) 0;
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.mistake-answers div {
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: var(--space-3);
}

dt {
  color: var(--ink-muted);
}

dd {
  margin: 0;
}

.chosen {
  color: var(--danger);
}

.correct {
  color: var(--success);
}

.mistake-explanation {
  margin: 0 0 var(--space-2);
  color: var(--ink-soft);
}

.mistake a,
.bookmarks,
.note a {
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.bookmarks {
  margin: 0 0 var(--space-3);
  padding-left: var(--space-5);
}

.note {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--rule);
}

.note p {
  margin: var(--space-1) 0 0;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}

.export-text {
  margin: 0 0 var(--space-3);
  color: var(--ink-soft);
}

.export-error {
  margin: var(--space-3) 0 0;
}
@media (max-width: 640px) {
  .table-scroll > .data-table {
    width: 100%;
    table-layout: fixed;
    font-size: var(--text-xs);
  }
  .data-table th,
  .data-table td {
    min-width: 0;
    max-width: none;
    padding-inline: var(--space-1);
    overflow-wrap: anywhere;
  }
  .data-table th:first-child {
    width: 30%;
  }
}
</style>
