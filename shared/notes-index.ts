import { definePanels, panelsText, type Panels } from "./panels.ts";
import { validateFigureReference } from "./chemical-library/contract.ts";
import { isInteger } from "./json.ts";
import type { Env } from "markdown-it";
import { proseMarkdown } from "./prose-markdown.ts";
import { captionParts } from "./prose-format.ts";
import { parseDocument } from "yaml";
import katex from "katex";
import {
  abbreviatedGroups,
  validateAbbreviations,
  type MoleculeAbbreviation,
} from "./molecule-abbreviations.ts";
import { moleculeToolkit } from "./molecule-toolkit.ts";
import {
  defineEnergy,
  energyText,
  type Energy,
} from "../src/ui/diagrams/energy.ts";
import { defineFlow, flowText, type Flow } from "../src/ui/diagrams/flow.ts";
import {
  defineTimeline,
  timelineText,
  type Timeline,
} from "../src/ui/diagrams/model.ts";
import type { Citation } from "../src/ui/citations.ts";
import type { GlossaryTerm } from "./glossary.ts";

export interface NoteSection {
  id: string;
  title: string;
  level: number;
}
export interface NoteMolecules {
  id: string;
  molecules: {
    smiles: string;
    caption: string;
    abbreviations?: MoleculeAbbreviation[];
  }[];
}
export type NoteDiagram =
  | {
      id: string;
      kind: "library";
      reference: import("./chemical-library/types.ts").FigureReference;
      caption: string;
    }
  | { id: string; kind: "timeline"; timeline: Timeline; caption: string }
  | { id: string; kind: "flow"; flow: Flow; caption: string }
  | { id: string; kind: "panels"; panels: Panels; caption: string }
  | { id: string; kind: "energy"; energy: Energy; caption: string };
export interface Note {
  slug: string;
  directory: string;
  directoryTitle: string;
  path: string;
  title: string;
  summary: string;
  date: string;
  /** The last file commit's day, when later than date. */
  updated?: string;
  order: number;
  html: string;
  text: string;
  sections: NoteSection[];
  molecules: NoteMolecules[];
  /** Absent until the note is published again. */
  diagrams?: NoteDiagram[];
  /** Resolved citations by href (absent until the note is published again). */
  citations?: Record<string, Citation>;
  /** Practice chapter generated from the chapter's note association. */
  practice?: { href: string; title: string; label: string; count: number };
}
export interface NoteDirectory {
  slug: string;
  title: string;
  intro: string;
  html: string;
  summary: string;
  order: number;
  path: string;
  citations?: Record<string, Citation>;
}
type NoteOutput =
  "html" | "text" | "sections" | "molecules" | "diagrams" | "citations";
export type NoteDraft = Omit<Note, NoteOutput> &
  Partial<Pick<Note, NoteOutput>> & {
    body?: string;
    offset?: number;
    file?: string;
    author?: boolean;
  };
type DirectoryDraft = Omit<NoteDirectory, "html" | "summary"> &
  Partial<Pick<NoteDirectory, "html" | "summary">>;

export interface NotesIndex {
  directories: NoteDirectory[];
  notes: Note[];
  terms: Record<string, GlossaryTerm>;
}

export interface NotebookIndex {
  directories: Omit<NoteDirectory, "html" | "citations" | "intro">[];
  notes: Omit<
    Note,
    "html" | "text" | "sections" | "molecules" | "diagrams" | "citations"
  >[];
}

export interface NotesSearchIndex {
  directories: Pick<NoteDirectory, "title" | "summary" | "path">[];
  notes: Pick<Note, "path" | "title" | "directoryTitle" | "summary" | "text">[];
}

/** What compile() hands markdown-it, which passes it back to every rule. */
type NoteEnv = {
  file: string;
  line: number;
  offset: number;
  directory: string;
  path: string;
  molecules: NoteMolecules[];
  diagrams: NoteDiagram[];
  text: string[];
  citations: Record<string, Citation>;
  cited: Set<string>;
  citeOpen?: boolean;
};
const noteEnv = (env: Env | undefined) => env as NoteEnv;

// Fences drawn as figures: the YAML inside is the block's value plus a caption.
const diagramKinds: Record<
  string,
  {
    render: (value: unknown) => {
      model: Timeline | Flow | Energy;
      words: string[];
    };
  }
> = {
  energy: {
    render(value) {
      const model = defineEnergy(value);
      return { model, words: energyText(model) };
    },
  },
  timeline: {
    render(value) {
      const model = defineTimeline(value);
      return { model, words: timelineText(model) };
    },
  },
  flow: {
    render(value) {
      const model = defineFlow(value);
      return { model, words: flowText(model) };
    },
  },
};

function fail(file: string, line: number, message: string): never {
  throw new Error(`${file}:${line}: ${message}`);
}
let toolkit: Awaited<ReturnType<typeof moleculeToolkit>> | undefined;
function fields(
  value: unknown,
  required: string[],
  file: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(file, 1, "Expected a mapping");
  for (const key of required)
    if (!(key in value)) fail(file, 1, `Missing ${key}`);
  for (const key of Object.keys(value))
    if (!required.includes(key)) fail(file, 1, `Unknown field ${key}`);
}
function date(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parseNote(source: string, file: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) fail(file, 1, "Missing YAML front matter");
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length)
    fail(
      file,
      (doc.errors[0].linePos?.[0]?.line ?? 1) + 1,
      doc.errors[0].message,
    );
  const metadata: unknown = doc.toJS();
  fields(metadata, ["title", "summary", "date", "order"], file);
  for (const key of ["title", "summary"])
    if (typeof metadata[key] !== "string" || !metadata[key].trim())
      fail(file, 1, `Invalid ${key}`);
  if (!isInteger(metadata.order)) fail(file, 1, "order must be an integer");
  if (!date(metadata.date)) fail(file, 1, "Invalid date: expected YYYY-MM-DD");
  return {
    ...(metadata as {
      title: string;
      summary: string;
      date: string;
      order: number;
    }),
    body: source.slice(match[0].length),
    offset: match[0].split("\n").length - 1,
  };
}

/** The note dialect adds tables, terms and formulas to prose Markdown. */
export function noteMarkdown() {
  const md = proseMarkdown().enable("table");
  // A display formula is a block delimited by $$ on its own lines.
  md.block.ruler.before(
    "fence",
    "note-display-math",
    (state, start, end, silent) => {
      if (
        state.src.slice(state.bMarks[start], state.eMarks[start]).trim() !==
        "$$"
      )
        return false;
      let last = start + 1;
      while (
        last < end &&
        state.src.slice(state.bMarks[last], state.eMarks[last]).trim() !== "$$"
      )
        last++;
      if (last === end)
        fail(noteEnv(state.env).file, start + 1, "Unclosed display formula");
      if (silent) return true;
      const token = state.push("note_display_math", "", 0);
      token.content = state.getLines(start + 1, last, 0, false);
      token.map = [start, last + 1];
      state.line = last + 1;
      return true;
    },
  );
  return md;
}

// This parser only extracts tokens. Renderers with compilation-specific state use their own instance.
const citationMarkdown = noteMarkdown();

/** The citations (`[text](src:...)`) of a note body with the line of each. */
export function noteCitations(body: string, file: string, offset = 0) {
  const found: { href: string; where: string }[] = [];
  for (const token of citationMarkdown.parse(body, { file }))
    for (const child of token.children ?? [])
      if (
        child.type === "link_open" &&
        String(child.attrGet("href")).startsWith("src:")
      )
        found.push({
          href: String(child.attrGet("href")),
          where: `${file}:${(token.map?.[0] ?? 0) + 1 + offset}`,
        });
  return found;
}

/**
 * Compile a complete catalog supplied by the database publication transaction;
 * `citations` holds each directory's resolved citations by href.
 */
export async function compileNotes({
  directories,
  notes,
  terms,
  routes,
  assetExists,
  citations = {},
  renderRequest,
}: {
  directories: DirectoryDraft[];
  notes: NoteDraft[];
  terms: Record<string, GlossaryTerm>;
  routes: Set<string>;
  assetExists: (directory: string, href: string) => boolean;
  citations?: Record<string, Record<string, Citation>>;
  renderRequest?: (
    source: string,
    file: string,
    line: number,
  ) => Promise<string>;
}) {
  const md = noteMarkdown();
  const esc = md.utils.escapeHtml;
  md.renderer.rules.note_term = (tokens, i, _options, rawEnv) => {
    const env = noteEnv(rawEnv);
    const name = tokens[i].content;
    if (!Object.hasOwn(terms, name))
      fail(env.file, env.line, `Unknown term ${name}`);
    return `<button type="button" class="term" data-term="${esc(name)}" aria-label="术语：${esc(name)}">${esc(name)}</button>`;
  };
  // Prettier escapes "_" as "\_" inside emphasis; in an inline formula it is
  // always a subscript.
  md.renderer.rules.note_math = (tokens, i) =>
    katex.renderToString(tokens[i].content.replaceAll("\\_", "_"), {
      throwOnError: true,
    });
  const validatedSmiles = new Set();
  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, i, options, rawEnv, self) => {
    const env = noteEnv(rawEnv);
    const token = tokens[i];
    const kind = token.info.trim();
    if (Object.hasOwn(diagramKinds, kind)) {
      const document = parseDocument(token.content);
      if (document.errors.length)
        fail(env.file, env.line, `${kind}: ${document.errors[0].message}`);
      const value = document.toJS();
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(env.file, env.line, `${kind} must be a mapping`);
      const { caption, ...input } = value;
      if (caption !== undefined && (typeof caption !== "string" || !caption))
        fail(env.file, env.line, `${kind} caption must be text`);
      let rendered;
      try {
        rendered = diagramKinds[kind].render(input);
      } catch (error) {
        fail(
          env.file,
          env.line,
          error instanceof Error ? error.message : String(error),
        );
      }
      const id = `note-diagram-${env.diagrams.length}`;
      env.diagrams.push(
        kind === "timeline"
          ? {
              id,
              kind,
              timeline: rendered.model as Timeline,
              caption: caption ?? "",
            }
          : kind === "energy"
            ? {
                id,
                kind,
                energy: rendered.model as Energy,
                caption: caption ?? "",
              }
            : {
                id,
                kind: "flow",
                flow: rendered.model as Flow,
                caption: caption ?? "",
              },
      );
      env.text.push(caption ?? "", ...rendered.words);
      return `<div id="${id}" class="note-diagram"></div>`;
    }
    if (kind === "panels") {
      const parsed = parseDocument(token.content);
      if (parsed.errors.length)
        fail(env.file, env.line, parsed.errors[0].message);
      try {
        const panels = definePanels(parsed.toJS());
        const id = `note-diagram-${env.diagrams.length}`;
        env.diagrams.push({
          id,
          kind: "panels",
          panels,
          caption: panels.caption ?? "",
        });
        env.text.push(...panelsText(panels));
        return `<div id="${id}" class="note-diagram"></div>`;
      } catch (error) {
        fail(
          env.file,
          env.line,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (kind === "figure-ref") {
      const parsed = parseDocument(token.content);
      if (parsed.errors.length)
        fail(env.file, env.line, parsed.errors[0].message);
      const reference: unknown = parsed.toJS();
      validateFigureReference(reference, env.file);
      const id = `note-diagram-${env.diagrams.length}`;
      env.diagrams.push({
        id,
        kind: "library",
        reference,
        caption: reference.caption ?? "",
      });
      env.text.push(reference.caption ?? "");
      const tag = reference.presentation === "note" ? "p" : "div";
      return `<${tag} id="${id}" class="note-diagram"></${tag}>`;
    }
    if (kind !== "molecule")
      return originalFence!(tokens, i, options, env, self);
    const molecules: NoteMolecules["molecules"] = [];
    for (const [n, line] of token.content.trim().split("\n").entries()) {
      const match = /^(smiles|caption|abbreviations):\s*(.+)$/.exec(line);
      if (!match)
        fail(env.file, env.line + n + 1, "Expected smiles: / caption: pair");
      if (match[1] === "smiles") {
        if (molecules.length && !molecules[molecules.length - 1].caption)
          fail(env.file, env.line + n, "Missing caption");
        if (!validatedSmiles.has(match[2])) {
          let mol;
          try {
            mol = toolkit?.get_mol(match[2]);
            if (!mol || !mol.is_valid()) throw new Error();
            validatedSmiles.add(match[2]);
          } catch {
            fail(env.file, env.line + n + 1, `Invalid SMILES ${match[2]}`);
          } finally {
            mol?.delete();
          }
        }
        molecules.push({ smiles: match[2], caption: "" });
      } else if (match[1] === "abbreviations") {
        const current = molecules.at(-1);
        if (!current || current.caption || current.abbreviations)
          fail(
            env.file,
            env.line + n + 1,
            "abbreviations must follow smiles, before caption",
          );
        const selections = match[2].split(",").map((entry) => {
          const indexed = /^(.*?)@(\d+)$/.exec(entry.trim());
          return indexed
            ? { name: indexed[1], atom: Number(indexed[2]) }
            : entry.trim();
        });
        const where = `${env.file}:${env.line + n + 1}`;
        validateAbbreviations(selections, where);
        const mol = toolkit!.get_mol(current.smiles)!;
        try {
          abbreviatedGroups(toolkit!, mol, selections, where);
        } finally {
          mol.delete();
        }
        current.abbreviations = selections;
      } else {
        if (!molecules.length || molecules[molecules.length - 1].caption)
          fail(env.file, env.line + n + 1, "caption must follow smiles");
        molecules[molecules.length - 1].caption = match[2];
      }
    }
    if (!molecules.length || !molecules[molecules.length - 1].caption)
      fail(env.file, env.line, "Missing caption");
    const id = `note-molecule-${env.molecules.length}`;
    env.molecules.push({ id, molecules });
    return `<div id="${id}" class="note-molecules"></div>`;
  };
  function link(href: string, env: NoteEnv, image = false) {
    if (image) {
      if (!/^assets\/[A-Za-z0-9_.-]+$/.test(href))
        fail(env.file, env.line, "Images must use assets/<file>");
      if (!assetExists(env.directory, href))
        fail(env.file, env.line, `Missing image ${href}`);
      return `/notes/${env.directory}/${href}`;
    }
    if (/^(https?:|mailto:)/.test(href)) return href;
    if (/^[a-z]+:/i.test(href) || href.startsWith("//"))
      fail(env.file, env.line, `Unsupported link ${href}`);
    const url = new URL(href, `https://notes.local${env.path}`);
    if (!routes.has(decodeURI(url.pathname)))
      fail(env.file, env.line, `Unknown internal link ${href}`);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  md.renderer.rules.link_open = (tokens, i, options, rawEnv, self) => {
    const env = noteEnv(rawEnv);
    const href = String(tokens[i].attrGet("href"));
    if (href.startsWith("src:")) {
      if (!Object.hasOwn(env.citations, href))
        fail(env.file, env.line, `Unresolved citation ${href}`);
      env.cited.add(href);
      env.citeOpen = true;
      return `<button type="button" class="cite" data-cite="${esc(href)}">`;
    }
    tokens[i].attrSet("href", link(href, env));
    return self.renderToken(tokens, i, options);
  };
  md.renderer.rules.link_close = (tokens, i, options, rawEnv, self) => {
    const env = noteEnv(rawEnv);
    if (!env.citeOpen) return self.renderToken(tokens, i, options);
    env.citeOpen = false;
    return "</button>";
  };
  md.renderer.rules.image = (tokens, i, _options, env) => {
    const token = tokens[i];
    const src = link(String(token.attrGet("src")), noteEnv(env), true);
    const parts = captionParts(token.content);
    const alt = esc(parts.join(""));
    const image = `<button type="button" class="note-image" data-image="${esc(src)}" aria-label="放大图片：${alt}"><img src="${esc(src)}" alt="${alt}"></button>`;
    // The description doubles as the visible caption.
    const caption = parts
      .map((part, i) => (i % 2 ? `<em>${esc(part)}</em>` : esc(part)))
      .join("");
    return token.content
      ? `${image}<span class="note-caption">${caption}</span>`
      : image;
  };
  md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
  md.renderer.rules.table_close = () => "</table></div>";
  md.renderer.rules.note_display_math = (tokens, i) =>
    `<div class="table-scroll">${katex.renderToString(tokens[i].content, { displayMode: true, throwOnError: true })}</div>`;
  md.renderer.rules.note_callout_open = (tokens, i) =>
    `<aside class="callout note-callout${tokens[i].meta?.kind === "易错" ? " callout--caution" : ""}" role="note">`;
  md.renderer.rules.note_callout_close = () => "</aside>";
  md.renderer.rules.note_callout_title = (tokens, i, options, env, self) =>
    `<p class="callout-title"><span class="callout-kind">${tokens[i].meta?.kind}</span>${self.renderInline(tokens[i].children ?? [], options, env)}</p>`;
  async function compile(body: string, start: Omit<NoteEnv, "line" | "text">) {
    const env: NoteEnv = { ...start, line: 0, text: [] };
    const tokens = md.parse(body, env);
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== "blockquote_open") continue;
      const title = tokens[i + 2];
      const marker =
        title?.type === "inline" &&
        /^\[!([^\]]+)\](?:[ \t]*(.*))$/.exec(title.content.split("\n")[0]);
      if (!marker) continue;
      const line = (open.map?.[0] ?? 0) + 1 + env.offset;
      if (!["要点", "易错"].includes(marker[1]))
        fail(env.file, line, "提示块只有 [!要点] 和 [!易错] 两种");
      let depth = 1,
        end = i;
      while (++end < tokens.length) {
        const token = tokens[end];
        if (token.type === "blockquote_open") {
          depth++;
          if (/^\[!/.test(tokens[end + 2]?.content ?? ""))
            fail(env.file, line, "提示块不允许嵌套提示块、标题、图或表格");
        }
        if (token.type === "blockquote_close" && --depth === 0) break;
        if (
          token.type === "heading_open" ||
          token.type === "table_open" ||
          token.children?.some((c) => c.type === "image") ||
          (token.type === "fence" &&
            [
              ...Object.keys(diagramKinds),
              "molecule",
              "figure-ref",
              "panels",
              "request",
            ].includes(token.info.trim()))
        )
          fail(env.file, line, "提示块不允许嵌套提示块、标题、图或表格");
      }
      open.type = "note_callout_open";
      open.meta = { kind: marker[1] };
      tokens[end].type = "note_callout_close";
      tokens[i + 1].hidden = true;
      // The first line is the title; a following soft break begins the body.
      const newline = title.content.indexOf("\n");
      const heading = marker[2] ?? "";
      const rest = newline < 0 ? "" : title.content.slice(newline + 1);
      title.type = "note_callout_title";
      title.meta = { kind: marker[1] };
      title.content = heading;
      title.children = md.parseInline(heading, env)[0].children;
      if (!rest) tokens[i + 3].hidden = true;
      else {
        const bodyTokens = md.parse(rest, env);
        tokens.splice(i + 3, 0, ...bodyTokens.slice(0, -1));
      }
    }

    if (
      tokens.some(
        (token) => token.type === "fence" && token.info.trim() === "molecule",
      )
    )
      toolkit ??= await moleculeToolkit();
    const sections: NoteSection[] = [];
    let html = "",
      sourceOpen = false;
    const text = env.text;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      env.line = (token.map?.[0] ?? 0) + 1 + env.offset;
      if (token.type === "fence" && token.info.trim() === "request") {
        if (!renderRequest)
          fail(env.file, env.line, "Unresolved resource request");
        html += await renderRequest(token.content, env.file, env.line);
        continue;
      }
      if (token.type === "heading_open") {
        if (token.tag === "h1")
          fail(env.file, env.line, "Body headings must start at ##");
        const title = tokens[i + 1].content;
        if (sourceOpen && token.tag === "h2") {
          html += "</details>";
          sourceOpen = false;
        }
        const id = `section-${sections.length + 1}`;
        token.attrSet("id", id);
        if (["h2", "h3"].includes(token.tag))
          sections.push({ id, title, level: Number(token.tag.slice(1)) });
        if (token.tag === "h2" && title === "资料来源") {
          html += `<details class="note-sources"><summary id="${id}">资料来源</summary>`;
          sourceOpen = true;
          i += 2;
          text.push(title);
          continue;
        }
      }
      if (token.type === "inline" || token.type === "note_callout_title")
        text.push(
          (token.children ?? [])
            .filter((c) =>
              [
                "text",
                "code_inline",
                "note_term",
                "note_math",
                "image",
              ].includes(c.type),
            )
            .map((c) => c.content)
            .join(""),
        );
      html += md.renderer.render([token], md.options, env);
    }
    if (sourceOpen) html += "</details>";
    return {
      html,
      sections,
      text: text.join(" "),
      molecules: env.molecules,
      diagrams: env.diagrams,
      citations: Object.fromEntries(
        [...env.cited].map((href) => [href, env.citations[href]]),
      ),
    };
  }
  for (const directory of directories) {
    const rendered = await compile(directory.intro, {
      file: `notes/${directory.slug}/directory.json`,
      offset: 0,
      directory: directory.slug,
      path: directory.path,
      molecules: [],
      diagrams: [],
      citations: citations[directory.slug] ?? {},
      cited: new Set(),
    });
    directory.html = rendered.html;
    directory.citations = rendered.citations;
    directory.summary =
      md.parse(directory.intro, {}).find((t) => t.type === "inline")?.content ??
      "";
  }
  for (const note of notes) {
    Object.assign(
      note,
      await compile(note.body!, {
        ...note,
        offset: note.offset!,
        file: note.file!,
        molecules: [],
        diagrams: [],
        citations: citations[note.directory] ?? {},
        cited: new Set(),
      }),
    );
    delete note.body;
    delete note.offset;
    delete note.file;
  }
  return {
    directories: directories as NoteDirectory[],
    notes: notes as (Note & { author?: boolean })[],
    terms,
  };
}
