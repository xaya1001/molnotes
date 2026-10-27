#!/usr/bin/env node
// Reads a topic's prose from the content workspace and
// reports the habits the writing rules in toolbox/recipes/topic-authoring.md
// §5 ask authors to avoid: hedge clauses, template openers, filler
// phrases and over-long sentences. Advisory; it prints counts and the
// worst sentences so an author can fix them before publication. Quiz and
// prediction explanations say why an option is wrong, so they are left
// out of the hedge count.
//
//   node scripts/prose-check.mjs <slug>        # one topic with examples
//   node scripts/prose-check.mjs              # density table for every topic

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSiteCatalog } from "../shared/site-catalog.mjs";
import { setting } from "../shared/settings.mjs";

const root = () => setting("MOLNOTES_CONTENT_DIR");
const chinese = /[一-鿿]/;
const rules = [
  {
    name: "免责式转折（不是…而是 / 不能把…画等号 / 不等于 / 并不）",
    pattern:
      /不是[^。，；]{0,15}(?:而是|，)|并不|不能把|不等于|不足以|不要把|误[写当作]|画等号|不代表|不意味着|不保证|不承诺|并非|这不是|不是同一|不只是|不必然/g,
    budget: 1.2,
  },
  {
    name: "套话开头（你在有机合成里 / 做反应时你）",
    pattern: /你在(?:有机)?合成|做反应时|在有机合成里|你熟悉的/g,
    budget: 0.3,
  },
  {
    name: "空话（值得注意 / 换句话说 / 总之 / 本质上 / 可以说）",
    pattern:
      /值得注意|需要注意的是|换句话说|换言之|综上所述|总而言之|总的来说|本质上|可以说[，,]|关键在于|也就是说|简单[来地]说|一个重要|重要的是|扮演.{0,6}角色/g,
    budget: 0,
  },
  {
    name: "名词化动词（进行 / 实现 / 具有 / 存在）",
    pattern:
      /进行[一了]?(?:分析|比较|判断|讨论|研究|优化|设计|验证|评估|处理)|具有(?:较|一定|更)|存在(?:差异|问题|风险)/g,
    budget: 0.3,
  },
];
const longSentence = 70;
const explanationKeys = new Set(["explanation", "optionExplanations"]);
// Citation pointers and file names are references, not sentences.
const referenceKeys = new Set(["locator", "file", "url", "doi"]);

export function strings(value, out, key = "") {
  if (typeof value === "string") {
    if (referenceKeys.has(key)) return out;
    if (value.length > 20 && chinese.test(value))
      out.push({ text: value, explanation: explanationKeys.has(key) });
  } else if (Array.isArray(value))
    value.forEach((item) => strings(item, out, key));
  else if (value && typeof value === "object")
    Object.entries(value).forEach(([k, item]) =>
      strings(item, out, explanationKeys.has(key) ? key : k),
    );
  return out;
}
/** Every prose string of a topic, flagged when it is a quiz or prediction explanation. */
export function prose(slug) {
  const out = [];
  strings(
    JSON.parse(
      readFileSync(join(root(), "sites", slug, "content.json"), "utf8"),
    ),
    out,
  );
  return out;
}
export function report(slug) {
  const all = prose(slug);
  const texts = all
    .filter((item) => !item.explanation)
    .map((item) => item.text);
  const chars = texts.reduce((n, t) => n + t.length, 0);
  const hits = rules.map((rule) => {
    const examples = [];
    let count = 0;
    for (const text of texts)
      for (const match of text.matchAll(rule.pattern)) {
        count += 1;
        if (examples.length < 3)
          examples.push(
            text.slice(Math.max(0, match.index - 30), match.index + 50),
          );
      }
    return {
      rule,
      count,
      per1k: (1000 * count) / Math.max(chars, 1),
      examples,
    };
  });
  const long = [];
  for (const text of new Set(all.map((item) => item.text)))
    for (const sentence of text.split(/(?<=[。！？])/))
      if (sentence.replace(/[，、；：（）()]/g, "").length > longSentence)
        long.push(sentence.trim());
  return { slug, chars, hits, long };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const slugs = process.argv.slice(2);
  if (slugs.length) {
    for (const slug of slugs) {
      const result = report(slug);
      console.log(`${slug} · 正文 ${result.chars} 字（练习解释另计）`);
      for (const hit of result.hits) {
        const flag = hit.per1k > hit.rule.budget ? "✗" : "✓";
        console.log(
          `  ${flag} ${hit.rule.name}：${hit.count} 处（${hit.per1k.toFixed(1)} / 千字，上限 ${hit.rule.budget}）`,
        );
        if (hit.per1k > hit.rule.budget)
          for (const example of hit.examples) console.log(`      …${example}…`);
      }
      console.log(
        `  长句（去标点超过 ${longSentence} 字）：${result.long.length} 句`,
      );
      for (const sentence of result.long.slice(0, 3))
        console.log(`      ${sentence.slice(0, 90)}…`);
    }
  } else {
    console.log("专题\t正文字数\t免责式转折/千字\t套话开头\t空话\t长句");
    for (const site of readSiteCatalog(root())) {
      const r = report(site.slug);
      console.log(
        [
          site.slug,
          r.chars,
          r.hits[0].per1k.toFixed(1),
          r.hits[1].count,
          r.hits[2].count,
          r.long.length,
        ].join("\t"),
      );
    }
  }
}
