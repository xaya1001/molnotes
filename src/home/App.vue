<script setup lang="ts">
import { catalogSite, topicBase } from "../ui/catalog";
import { notebook, topics } from "../ui/content-data";
import { readPosition } from "../ui/reading-position";
import {
  directories,
  PageHeading,
  readNotesRecords,
  readSiteRecords,
  RecordStateNotice,
  SiteBar,
  sites,
} from "@ui";

/** "接着学": the note to resume, reading progress per notebook, its practice and the review queue. */
const reading = readNotesRecords();
const { topics: records, storageError } = readSiteRecords(topics);
const recordsBySlug = new Map(records.map((item) => [item.slug, item]));

const notesIn = (path: string) =>
  notebook.notes.filter((note) => note.path.startsWith(path));
const notebooks = directories
  .map((directory) => ({ ...directory, notes: notesIn(directory.path) }))
  .filter((directory) => directory.notes.length);

const recentlyOpened = notebook.notes
  .filter((note) => reading[note.path]?.opened)
  .sort((a, b) => reading[b.path].opened - reading[a.path].opened);
const [recentNote] = recentlyOpened;
const otherRecent = recentlyOpened.slice(1, 4);
const recent = recentNote && {
  note: recentNote,
  position: readPosition(recentNote.path),
  next: (() => {
    const siblings = notesIn(recentNote.path.replace(/[^/]+$/, ""));
    return siblings[siblings.findIndex((n) => n.path === recentNote.path) + 1];
  })(),
};

function practice(slug: string) {
  const topic = topics.find((item) => item.slug === slug)!;
  const item = recordsBySlug.get(slug)!;
  return {
    slug,
    title: sites.find((site) => site.slug === slug)!.title,
    state: item.state,
    complete: item.complete.length,
    chapters: topic.chapters.length,
    mistakes: item.mistakes.length,
  };
}

const count = (key: "mistakes" | "bookmarks") =>
  records.reduce((sum, item) => sum + item[key].length, 0);
const review = { mistakes: count("mistakes"), bookmarks: count("bookmarks") };
const recorded =
  Object.keys(reading).length || records.some((item) => item.state !== "none");
</script>

<template>
  <SiteBar />
  <main class="home page-reading">
    <PageHeading eyebrow="Continue" title="接着学" />
    <p v-if="storageError" class="callout callout--caution" role="alert">
      {{ storageError }}
    </p>

    <section v-if="recent" class="resume" aria-labelledby="resume-label">
      <p id="resume-label" class="resume-label">上次读到</p>
      <h2 class="resume-title">
        <a :href="recent.note.path">{{ recent.note.title }}</a>
      </h2>
      <p class="resume-meta">
        {{ recent.note.directoryTitle
        }}<template v-if="recent.position.scroll && recent.position.section">
          · 读到“{{ recent.position.section }}”</template
        >
      </p>
      <div class="resume-actions">
        <a class="button button--primary" :href="recent.note.path">接着读</a>
        <a v-if="recent.next" class="resume-next" :href="recent.next.path"
          >下一篇 · {{ recent.next.title }}</a
        >
      </div>
    </section>

    <section v-else aria-labelledby="start-title">
      <h2 id="start-title" class="section-label">从第一篇开始</h2>
      <ul class="start-list">
        <li v-for="notebook in notebooks" :key="notebook.slug">
          <span class="start-notebook">{{ notebook.title }}</span>
          <a :href="notebook.notes[0].path">{{ notebook.notes[0].title }}</a>
          <p>{{ notebook.notes[0].summary }}</p>
        </li>
      </ul>
    </section>

    <section v-if="otherRecent.length" aria-labelledby="recent-title">
      <h2 id="recent-title" class="section-label">最近打开</h2>
      <ul class="recent-list">
        <li v-for="note in otherRecent" :key="note.path">
          <a :href="note.path">{{ note.title }}</a>
          <span>{{ note.directoryTitle }}</span>
        </li>
      </ul>
    </section>

    <section v-if="recorded" aria-labelledby="progress-title">
      <h2 id="progress-title" class="section-label">笔记与练习</h2>
      <ul class="progress-list">
        <li v-for="notebook in notebooks" :key="notebook.slug">
          <div class="progress-row">
            <a :href="notebook.path">{{ notebook.title }}</a>
            <span
              >已读
              {{ notebook.notes.filter((n) => reading[n.path]?.read).length }}
              / {{ notebook.notes.length }} 篇</span
            >
          </div>
          <p
            v-for="item in notebook.practice.map(practice)"
            :key="item.slug"
            class="progress-practice"
          >
            <a :href="topicBase(catalogSite(item.slug))">{{ item.title }}</a>
            <RecordStateNotice
              v-if="item.state === 'outdated' || item.state === 'unreadable'"
              :slug="item.slug"
              :state="item.state"
            />
            <span v-else
              >完成 {{ item.complete }} / {{ item.chapters }} 章 · 错题
              {{ item.mistakes }}</span
            >
          </p>
        </li>
      </ul>
    </section>

    <a class="review-entry" href="/review/">
      <span class="review-entry-title">复习</span>
      <span>错题 {{ review.mistakes }} · 书签 {{ review.bookmarks }}</span>
    </a>
    <footer class="home-footer">
      <a href="/showcase/">工具箱示例</a>
      <a href="/system/">系统信息</a>
    </footer>
  </main>
</template>

<style scoped>
.page-heading {
  border-bottom: 1.5px solid var(--ink);
}

.home {
  padding: var(--space-7) var(--gutter) var(--space-6);
  font-variant-numeric: tabular-nums;
}

.section-label {
  margin: var(--space-7) 0 var(--space-3);
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.14em;
}

.resume {
  padding: var(--space-5) var(--space-5) var(--space-6);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface);
}

.resume-label {
  margin: 0;
  color: var(--ink-muted);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
  letter-spacing: 0.14em;
}

.resume-title {
  margin: var(--space-2) 0 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  line-height: var(--leading-tight);
}

.resume-title a {
  color: var(--ink);
  text-decoration: none;
}

.resume-title a:hover {
  color: var(--accent);
}

.resume-meta {
  margin: var(--space-2) 0 0;
  color: var(--ink-soft);
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.resume-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  margin-top: var(--space-5);
  font: 500 var(--text-sm) / 1.5 var(--font-sans);
}

.recent-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.recent-list li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  padding-block: var(--space-2);
  font: var(--text-sm) / var(--leading-body) var(--font-sans);
}
.recent-list span {
  color: var(--ink-muted);
}

.start-list,
.progress-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.start-list li,
.progress-list li {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--rule);
}

.start-list li {
  display: grid;
  gap: var(--space-1);
}

.start-notebook {
  color: var(--ink-muted);
  font: 500 var(--text-sm) / 1.5 var(--font-sans);
}

.start-list a {
  font: 600 var(--text-lg) / var(--leading-tight) var(--font-serif);
  text-decoration: none;
}

.start-list p {
  margin: 0;
  color: var(--ink-soft);
}

.progress-row,
.progress-practice {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
}

.progress-row a {
  color: var(--ink);
  font: 600 var(--text-lg) / var(--leading-tight) var(--font-serif);
  text-decoration: none;
}

.progress-row a:hover {
  color: var(--accent);
}

.progress-row span,
.progress-practice {
  color: var(--ink-muted);
  font: var(--text-sm) / 1.6 var(--font-sans);
}

.progress-practice {
  margin: var(--space-2) 0 0;
}

.progress-practice a {
  font-weight: 500;
}

.review-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
  margin-top: var(--space-7);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  color: var(--ink-muted);
  font: var(--text-sm) / 1.6 var(--font-sans);
  text-decoration: none;
}

.review-entry:hover {
  border-color: var(--accent);
}

.home-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-5);
  margin-top: var(--space-7);
  font: var(--text-sm) / 1.5 var(--font-sans);
}

.home-footer a {
  color: var(--ink-muted);
}

.home-footer a:hover {
  color: var(--accent);
}

.review-entry-title {
  color: var(--ink);
  font: 600 var(--text-lg) / var(--leading-tight) var(--font-serif);
}
</style>
