#!/usr/bin/env node
// Advisory reports for long sentences and formulas that can be plain text.
//   node scripts/prose-check.ts <slug>                 # one topic
//   node scripts/prose-check.ts notes/<dir>[/<note>.md] # notes
//   node scripts/prose-check.ts                        # all topics and notes

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { parseNote } from "../shared/notes-index.ts";
import { readSiteCatalog } from "../shared/site-catalog.ts";
import { setting } from "../shared/settings.ts";

const root = () => setting("MOLNOTES_CONTENT_DIR");
const chinese = /[一-鿿]/;
const longSentence = 70;
// Citation pointers and file names are references, not prose.
const referenceKeys = new Set(["locator", "file", "url", "doi", "cite"]);

export function strings(value: unknown, out: string[], key = ""): string[] {
  if (typeof value === "string") {
    if (!referenceKeys.has(key) && value.trim()) out.push(value);
  } else if (Array.isArray(value))
    value.forEach((item) => strings(item, out, key));
  else if (value && typeof value === "object")
    Object.entries(value).forEach(([k, item]) => strings(item, out, k));
  return out;
}

const markdown = new MarkdownIt("commonmark").enable("table");
// Preserve inline formulas before Markdown interprets their subscripts or escapes.
markdown.inline.ruler.before("escape", "prose-math", (state, silent) => {
  const match = /^\$([^$\n]+)\$(?!\$)/.exec(state.src.slice(state.pos));
  if (!match || state.src[state.pos - 1] === "$") return false;
  if (!silent) state.push("text", "", 0).content = match[0];
  state.pos += match[0].length;
  return true;
});

/** Reader text, without front matter, code, resource YAML or link destinations. */
function noteProse(file: string) {
  const { title, summary, body } = parseNote(readFileSync(file, "utf8"), file);
  const out = [title, summary];
  for (const token of markdown.parse(body, {})) {
    if (token.type !== "inline") continue;
    out.push(
      (token.children ?? [])
        .map((child) => {
          if (child.type === "text" || child.type === "image")
            return child.content;
          if (child.type === "softbreak" || child.type === "hardbreak")
            return "\n";
          return "";
        })
        .join(""),
    );
  }
  return out;
}

export function prose(unit: string, contentRoot = root()): string[] {
  if (unit.startsWith("notes/")) {
    const path = join(contentRoot, unit);
    if (unit.endsWith(".md")) return noteProse(path);
    return readdirSync(path)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .flatMap((name) => noteProse(join(path, name)));
  }
  const topic = unit.startsWith("sites/") ? unit : `sites/${unit}`;
  return strings(
    JSON.parse(readFileSync(join(contentRoot, topic, "content.json"), "utf8")),
    [],
  );
}

function plainFormula(formula: string) {
  const text = formula.replace(/\\(?:text|mathrm|textrm|mathbf|mathit)\b/g, "");
  return !/[=<>≈≤≥∝]|\\(?:frac|sum|int|prod|log|ln|exp|sqrt|lim|begin)\b/.test(
    text,
  );
}

export function analyze(texts: string[]) {
  const long: string[] = [];
  const formulas: string[] = [];
  for (const text of new Set(texts)) {
    for (const match of text.matchAll(/(?<![\\$])\$([^$\n]+)\$(?!\$)/g))
      if (plainFormula(match[1])) formulas.push(match[0]);
    for (const sentence of text.split(/(?<=[。！？])|\n/))
      if (
        chinese.test(sentence) &&
        sentence.replace(/[\p{P}\s]/gu, "").length > longSentence
      )
        long.push(sentence.trim());
  }
  return { long, formulas };
}

export function report(unit: string, contentRoot = root()) {
  const texts = prose(unit, contentRoot);
  return {
    unit,
    chars: texts.reduce((n, text) => n + text.length, 0),
    ...analyze(texts),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const units = process.argv.slice(2);
  if (units.length) {
    for (const unit of units) {
      const result = report(unit);
      console.log(`${unit} · 文字 ${result.chars} 字`);
      console.log(
        `  长句（去标点超过 ${longSentence} 字）：${result.long.length} 句`,
      );
      for (const sentence of result.long.slice(0, 3))
        console.log(`      ${sentence.slice(0, 90)}…`);
      console.log(`  伪公式：${result.formulas.length} 处`);
      for (const formula of result.formulas.slice(0, 3))
        console.log(`      ${formula}`);
    }
  } else {
    const contentRoot = root();
    const notesRoot = join(contentRoot, "notes");
    const notes = existsSync(notesRoot)
      ? readdirSync(notesRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `notes/${entry.name}`)
          .sort()
      : [];
    console.log("单元\t文字字数\t长句\t伪公式");
    for (const unit of [
      ...readSiteCatalog(contentRoot).map((site) => `sites/${site.slug}`),
      ...notes,
    ]) {
      const result = report(unit, contentRoot);
      console.log(
        [unit, result.chars, result.long.length, result.formulas.length].join(
          "\t",
        ),
      );
    }
  }
}
