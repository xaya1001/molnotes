import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { noteMarkdown } from "../../shared/notes-index.ts";

export async function proseTerms(root: string): Promise<string[]> {
  return JSON.parse(await readFile(join(root, "prose-terms.json"), "utf8"));
}

export function lintProse(body: string, file: string, terms: string[]) {
  const errors: string[] = [];
  const tokens = noteMarkdown().parse(body, { file });
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "text") {
        for (const term of terms)
          if (child.content.includes(term))
            errors.push(`${file}: forbidden prose term: ${term}`);
        if (/第\s*[0-9０-９一二三四五六七八九十百]+\s*篇/.test(child.content))
          errors.push(`${file}: chapter announcement in prose`);
      }
      if (child.type === "code_inline" && /\{[^{}]+\}/.test(child.content))
        errors.push(`${file}: chemical name marked as code`);
    }
  }
  return errors;
}
