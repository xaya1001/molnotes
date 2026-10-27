import type { Unchecked } from "../shared/unchecked.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTopicIndex } from "../shared/topic-index.ts";
import { validateTopicContent } from "../shared/topic-content.ts";

function chapter(id: string, number: Unchecked, extra = {}) {
  return {
    id,
    number,
    title: `第${number}章`,
    lead: `${id} 的问题`,
    refs: [],
    ...extra,
  };
}

function topic(overrides = {}) {
  return {
    parts: [{ title: "一", chapters: ["a", "b"] }],
    chapters: [
      chapter("a", 1, {
        blocks: [
          { type: "heading", text: "节一" },
          { type: "paragraph", text: "溶解度决定吸收" },
          { type: "scene", label: "图", frames: "frames" },
        ],
      }),
      chapter("b", 2, { blocks: [{ type: "paragraph", text: "膜通透性" }] }),
    ],
    quiz: [
      {
        id: "q1",
        question: "题面不进入搜索",
        options: ["甲", "乙"],
        answer: 1,
        explanation: "因为乙",
        chapter: "a",
      },
      {
        id: "q2",
        question: "第二题",
        options: ["甲", "乙", "丙"],
        answer: 2,
        optionExplanations: ["不是甲", "不是乙", "丙的理由"],
        chapter: "b",
      },
    ],
    sources: [],
    data: { frames: [{ title: "帧", text: "揭晓段" }] },
    ...overrides,
  };
}

function checkout(_t: Unchecked, sites: Record<string, Unchecked>) {
  return Object.entries(sites).map(([slug, site]) => ({
    slug,
    title: `专题 ${slug}`,
    ...site,
  }));
}

test("chapter paths follow the default rule or the topic's chapterRoute", (t) => {
  const root = checkout(t, {
    plain: { order: 1, content: topic() },
    numbered: {
      order: 2,
      content: topic({ chapterRoute: "/chapters/{number}" }),
    },
  });
  const { chapters } = buildTopicIndex(root);
  assert.deepEqual(
    chapters.map((item) => [item.slug, item.chapters.map((c) => c.path)]),
    [
      ["plain", ["/sites/plain/a", "/sites/plain/b"]],
      [
        "numbered",
        ["/sites/numbered/chapters/1", "/sites/numbered/chapters/2"],
      ],
    ],
  );
  assert.equal(chapters[0].title, "专题 plain");
  assert.deepEqual(chapters[0].answerKey, { q1: 1, q2: 2 });
});

test("chapter text joins the lead with the blocks' prose, never quiz text", (t) => {
  const root = checkout(t, {
    plain: { order: 1, content: topic() },
  });
  const { search } = buildTopicIndex(root);
  assert.deepEqual(search, [
    {
      slug: "plain",
      chapterId: "a",
      text: "a 的问题 节一 溶解度决定吸收 帧 揭晓段",
    },
    { slug: "plain", chapterId: "b", text: "b 的问题 膜通透性" },
  ]);
  assert.ok(!JSON.stringify(search).includes("题面"));
});

test("review questions carry the explanation or the correct option's", (t) => {
  const root = checkout(t, {
    plain: { order: 1, content: topic() },
  });
  const { quiz } = buildTopicIndex(root);
  assert.deepEqual(
    quiz.map(({ id, explanation, chapter }) => [id, explanation, chapter]),
    [
      ["q1", "因为乙", "a"],
      ["q2", "丙的理由", "b"],
    ],
  );
});

test("chapterRoute must start with / and use only {id} and {number}", () => {
  for (const chapterRoute of [
    "chapters/{number}",
    "/chapters/{slug}",
    "/chapters/{number",
    "/fixed",
    5,
  ])
    assert.throws(
      () => validateTopicContent(topic({ chapterRoute })),
      /chapterRoute/,
      String(chapterRoute),
    );
  assert.throws(
    () =>
      validateTopicContent(
        topic({
          chapterRoute: "/{number}",
          chapters: [
            chapter("a", 1, { blocks: [] }),
            chapter("b", undefined, { blocks: [] }),
          ],
        }),
      ),
    /chapter b needs a number/,
  );
  validateTopicContent(topic({ chapterRoute: "/c/{id}-{number}" }));
});
