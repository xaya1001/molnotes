import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseNote,
  noteCitations,
  noteMarkdown,
} from "../../shared/notes-index.ts";
import { validateGlossary } from "../../shared/glossary.ts";
import { resolveCitations } from "./citations.ts";
import { readRegistry, readGlossary } from "./content-files.ts";
import { parseRequest } from "./requests.ts";
import { writerFiles, writerRoutes } from "./writer-context.ts";
import { compileUnit } from "./compile-unit.ts";

const normalized = (text: string) => text.replace(/\s/g, "").toLowerCase();
const markdown = noteMarkdown();
function mentions(text: string, term: string) {
  const literal = term.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
  return new RegExp(
    `${/^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9_])" : ""}${literal}${/[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9_])" : ""}`,
  ).test(text);
}

export async function checkNote(
  root: string,
  file: string,
  additionsFile?: string,
) {
  if (!/^notes\/[a-z0-9-]+\/[a-z0-9-]+\.md$/.test(file))
    throw new Error("check: expected notes/<directory>/<note>.md");
  const parsed = parseNote(await readFile(join(root, file), "utf8"), file);
  const source = await writerFiles(root);
  const glossary = await readGlossary(root);
  const hintTerms = glossary.filter((term) =>
    /\p{Script=Han}/u.test(term.term),
  );
  const errors: string[] = [];
  const hints = new Map<string, string>();
  const seen = new Set<string>();
  const additions = additionsFile
    ? validateGlossary(
        JSON.parse(await readFile(additionsFile, "utf8")),
        additionsFile,
      )
    : [];
  const terms = Object.fromEntries(glossary.map((term) => [term.term, term]));
  const candidates = additions.map((term) => ({
    ...term,
    where: additionsFile!,
  }));
  // Terms are authored as [[name]] and as Chinese (English) first definitions.
  const tokens = markdown.parse(parsed.body, { file });
  let tableRowLine = 0;
  for (const token of tokens) {
    if (token.type === "tr_open") tableRowLine = token.map![0];
    if (token.type !== "inline") continue;
    const where = `${file}:${parsed.offset + (token.map?.[0] ?? tableRowLine) + 1}`;
    for (const [i, child] of (token.children ?? []).entries()) {
      if (child.type === "note_term") seen.add(child.content);
      if (child.type === "note_term" && !terms[child.content])
        candidates.push({
          term: child.content,
          full:
            /^[（(]([^（）()]+)[）)]/.exec(
              token.children?.[i + 1]?.content ?? "",
            )?.[1] ?? "",
          definition: "",
          confusion: "",
          where,
        });
      if (child.type !== "text") continue;
      for (const match of child.content.matchAll(
        /([^\s，。；：、（）()]+)[（(]([A-Za-z][^（）()]*?)[）)]/g,
      ))
        if (!terms[match[1]])
          candidates.push({
            term: match[1],
            full: match[2],
            definition: "",
            confusion: "",
            where,
          });
      for (const term of hintTerms)
        if (!seen.has(term.term) && mentions(child.content, term.term)) {
          hints.set(term.term, `${where}: link [[${term.term}]]`);
          seen.add(term.term);
        }
    }
  }
  for (const candidate of candidates) {
    const existing = glossary.find(
      (term) =>
        normalized(term.term) === normalized(candidate.term) ||
        (candidate.full &&
          normalized(term.full) === normalized(candidate.full)),
    );
    if (existing)
      errors.push(
        `${candidate.where}: ${candidate.term} duplicates ${existing.term} (${existing.full}); use [[${existing.term}]]`,
      );
  }
  for (const term of additions) if (!terms[term.term]) terms[term.term] = term;
  const routes = await writerRoutes(source);
  const [, dir, name] = file.split("/");
  try {
    const [resolved] = await resolveCitations(
      (await readRegistry(root)) ?? {},
      [
        {
          scope: `notes/${dir}`,
          occurrences: noteCitations(parsed.body, file, parsed.offset),
        },
      ],
    );
    // Check asset names without loading unrelated content or compiling a site.
    const assets = new Set<string>();
    for (const path of source.files)
      if (path.startsWith(`notes/${dir}/assets/`))
        assets.add(path.slice(`notes/${dir}/`.length));
    for (const asset of resolved.assets) assets.add(asset.path);
    await compileUnit({
      kind: "notes",
      root,
      input: {
        directories: [],
        notes: [
          {
            ...parsed,
            file,
            directory: dir,
            directoryTitle: dir,
            slug: name.slice(0, -3),
            path: `/${file.slice(0, -3)}`,
          },
        ],
        terms,
        routes,
        assetExists: (_dir, path) => assets.has(path),
        citations: { [dir]: resolved.citations },
        renderRequest: async (source, file, line) => {
          await parseRequest(source, file, line);
          return "";
        },
      },
    });
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { errors: [...new Set(errors)], hints: [...hints.values()] };
}
