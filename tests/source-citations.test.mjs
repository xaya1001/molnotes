import assert from "node:assert/strict";
import { test } from "node:test";
import {
  citedSource,
  contentCitations,
  parseCitation,
  validateSourceRegistry,
} from "../scripts/source-citations.mjs";
import { validateTopicContent } from "../scripts/topic-content.mjs";

const registry = validateSourceRegistry({
  book: { file: "textbooks/book.pdf", title: "书", kind: "教材" },
  reader: { file: "textbooks/reader.epub", title: "读本", kind: "教材" },
  lesson: {
    file: "reports/sample-report/chapter-1.html",
    title: "课",
    kind: "网页",
  },
});

test("citations name pages, a printed page and a rectangle, or an epub chapter and section", () => {
  assert.deepEqual(parseCitation("src:lesson"), { id: "lesson" });
  assert.deepEqual(parseCitation("src:book#7"), {
    id: "book",
    first: 7,
    last: 7,
  });
  assert.deepEqual(
    parseCitation("src:book#429-435&print=xii&rect=0,10.5,300,400"),
    {
      id: "book",
      first: 429,
      last: 435,
      print: "xii",
      rect: [0, 10.5, 300, 400],
    },
  );
  assert.deepEqual(parseCitation("src:reader#ch=4.2"), {
    id: "reader",
    chapter: "4.2",
  });
  assert.deepEqual(parseCitation("src:reader#ch=4.2&sec=1.13"), {
    id: "reader",
    chapter: "4.2",
    section: "1.13",
  });
  for (const value of [
    "materials/textbooks/book.pdf",
    "src:Book#1",
    "src:book#0",
    "src:book#429–435",
    "src:book#5-4",
    "src:book#1-61",
    "src:book#1&rect=10,10,5,20",
    "src:book#1&rect=1,2,3",
    "src:book#1&print=",
    "src:reader#ch=",
    "src:reader#ch=0",
    "src:reader#ch=4.",
    "src:reader#ch=4.02",
    "src:reader#sec=1",
    "src:reader#ch=4&sec=",
    "src:reader#ch=4&print=2",
    "src:reader#3&sec=1",
  ])
    assert.throws(() => parseCitation(value), /invalid citation/, value);
});

test("a citation must match a registered PDF with pages, an epub with a chapter or a web page with neither", () => {
  assert.equal(citedSource(registry, "src:book#3").source.title, "书");
  assert.equal(citedSource(registry, "src:lesson").citation.first, undefined);
  assert.equal(citedSource(registry, "src:reader#ch=2").source.title, "读本");
  assert.throws(() => citedSource(registry, "src:book"), /needs pages/);
  assert.throws(() => citedSource(registry, "src:book#ch=2"), /needs pages/);
  assert.throws(() => citedSource(registry, "src:reader"), /needs a chapter/);
  assert.throws(() => citedSource(registry, "src:reader#2"), /needs a chapter/);
  assert.throws(() => citedSource(registry, "src:lesson#2"), /without pages/);
  assert.throws(
    () => citedSource(registry, "src:lesson#ch=2"),
    /without pages/,
  );
  assert.throws(
    () => citedSource(registry, "src:missing#1"),
    /not in sources.json/,
  );
});

test("the registry lists each shelf file once with its display fields", () => {
  const entry = { file: "textbooks/a.pdf", title: "A", kind: "教材" };
  for (const [value, pattern] of [
    [[], /must be an object/],
    [{ Bad: entry }, /invalid id/],
    [{ a: { ...entry, path: "x" } }, /unknown field path/],
    [{ a: { ...entry, title: " " } }, /title must be text/],
    [{ a: { ...entry, file: "/abs/a.pdf" } }, /inside materials/],
    [{ a: { ...entry, file: "textbooks/../a.pdf" } }, /inside materials/],
    [{ a: { ...entry, file: "textbooks/a.txt" } }, /\.pdf, \.epub or \.html/],
    [{ a: entry, b: { ...entry, title: "B" } }, /already registered as a/],
  ])
    assert.throws(() => validateSourceRegistry(value), pattern);
});

test("topics cite from sources, excerpts and reading items", () => {
  const content = {
    chapters: [
      {
        id: "a",
        title: "A",
        refs: [1],
        blocks: [],
        excerpts: [
          {
            id: "inline",
            source: 1,
            locator: "p",
            text: "t",
            guide: "g",
            cite: "src:book#2",
          },
        ],
        reading: [
          {
            source: 1,
            locator: "p",
            minutes: 1,
            question: "q",
            skip: "s",
            cite: "src:book#3",
          },
        ],
      },
    ],
    sources: [{ id: 1, title: "书", cite: ["src:book#1", "src:lesson"] }],
  };
  assert.deepEqual(
    contentCitations(content).map(({ href, where }) => [href, where]),
    [
      ["src:book#1", "content.json: sources[0].cite[0]"],
      ["src:lesson", "content.json: sources[0].cite[1]"],
      ["src:book#2", "content.json: chapters[0].excerpts[0].cite"],
      ["src:book#3", "content.json: chapters[0].reading[0].cite"],
    ],
  );
  validateTopicContent(content);
  assert.throws(
    () =>
      validateTopicContent({
        ...content,
        sources: [{ id: 1, title: "书", cite: ["src:book#2–3"] }],
      }),
    /sources\[0\]\.cite\[0\]: invalid citation/,
  );
  assert.throws(
    () =>
      validateTopicContent({
        ...content,
        sources: [{ id: 1, title: "书", cite: "src:book#2" }],
      }),
    /must list citations/,
  );
});
