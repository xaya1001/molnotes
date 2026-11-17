import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileNotes,
  parseNote,
  noteCitations,
  noteMarkdown,
} from "../../shared/notes-index.ts";
import { validateGlossary } from "../../shared/glossary.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { chapterRoutePath, topicBasePath } from "../../shared/topic-content.ts";
import { patentRoutePaths } from "../../shared/patent-contract.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";
import { parse as yaml } from "yaml";
import { resolveCitations } from "./citations.ts";
import { readRegistry, readGlossary } from "./content-files.ts";
import { parseRequest } from "./requests.ts";
import { writerFiles } from "./writer-index.ts";

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
  const errors: string[] = [];
  const hints = new Map<string, string>();
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
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    const where = `${file}:${parsed.offset + token.map![0] + 1}`;
    for (const [i, child] of (token.children ?? []).entries()) {
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
      for (const term of glossary)
        if (!hints.has(term.term) && mentions(child.content, term.term))
          hints.set(term.term, `${where}: link [[${term.term}]]`);
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
  const routes = new Set([
    "/",
    "/notes/",
    "/review/",
    "/system/",
    "/glossary/",
    "/library/",
  ]);
  for (const path of source.files) {
    if (/^notes\/[^/]+\/(?:author\/)?[^/]+\.md$/.test(path))
      routes.add(`/${path.slice(0, -3)}`);
    if (/^notes\/[^/]+\/directory\.json$/.test(path))
      routes.add(`/${path.slice(0, -"directory.json".length)}`);
    if (!/^sites\/[^/]+\/site\.json$/.test(path)) continue;
    const slug = path.split("/")[1];
    const site = parseSiteManifest(slug, JSON.parse(await source.read(path)));
    // Route discovery reads identities; it does not compile unrelated chapters.
    const content: Omit<TopicContent, "chapters"> & {
      chapters: (TopicContent["chapters"][number] | string)[];
    } = JSON.parse(await source.read(`sites/${slug}/content.json`));
    const base = topicBasePath(site);
    routes.add(base + "/");
    for (const path of patentRoutePaths({
      ...content,
      chapters: content.chapters
        .filter((chapter) => typeof chapter !== "string")
        .map((chapter) => ({ ...chapter, blocks: chapter.blocks ?? [] })),
    }))
      routes.add(base + path);
    for (const chapter of content.chapters) {
      if (typeof chapter === "string") {
        const chapterSource = await source.read(`sites/${slug}/${chapter}`);
        const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(chapterSource);
        if (!header)
          throw new Error(`sites/${slug}/${chapter}: missing front matter`);
        const metadata = yaml(header[1]);
        routes.add(
          base +
            chapterRoutePath(content, {
              id: String(chapter)
                .replace(/^chapters\//, "")
                .replace(/\.md$/, ""),
              number: metadata.number,
              path: metadata.path,
            }),
        );
      } else routes.add(base + chapterRoutePath(content, chapter));
    }
  }
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
    await compileNotes({
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
    });
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { errors: [...new Set(errors)], hints: [...hints.values()] };
}
