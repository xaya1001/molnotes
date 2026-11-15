import MarkdownIt from "markdown-it";
import { parseDocument } from "yaml";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "../../shared/json.ts";
import { parseNote } from "../../shared/notes-index.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { validateFigureInput } from "../figure-input.ts";
import { expandFigureSmiles } from "../figure-scene.ts";

type Check = (value: unknown) => void | Promise<void>;
const text: Check = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("expected nonempty text");
};
const file: Check = (value) => {
  text(value);
  if (!/^[A-Za-z0-9_.-]+$/.test(String(value)))
    throw new Error("expected an asset filename");
};
const supplied: Check = (value) => {
  if (value === null || (typeof value === "string" && !value.trim()))
    throw new Error("expected a value");
};
async function figure(value: unknown) {
  const { input } = validateFigureInput(value);
  const toolkit = await moleculeToolkit();
  function smiles(value: string) {
    const mol = toolkit.get_mol(expandFigureSmiles(value));
    try {
      if (!mol?.is_valid() || !mol.get_num_atoms())
        throw new Error("invalid SMILES");
    } finally {
      mol?.delete();
    }
  }
  function visit(value: unknown, parent = "") {
    if (Array.isArray(value)) value.forEach((v) => visit(v));
    else if (isObject(value))
      for (const [key, item] of Object.entries(value)) {
        if ((key === "smiles" || key === "core") && typeof item === "string")
          smiles(item);
        else if (parent === "compounds" && typeof item === "string")
          smiles(item);
        else visit(item, key);
      }
  }
  visit(input);
}

/** The single registry for request fields, validation and completion skills. */
export const requestKinds: Record<
  string,
  { fields: Record<string, Check>; skill: string }
> = {
  image: {
    fields: { file, caption: text, prompt: text },
    skill: "note-figures",
  },
  figure: { fields: { caption: text, figure }, skill: "chemical-figures" },
  chart: {
    fields: {
      file,
      caption: text,
      data: supplied,
      axes: supplied,
      point: text,
    },
    skill: "note-figures",
  },
};
export interface ResourceRequest {
  file: string;
  line: number;
  kind: string;
  caption: string;
  skill: string;
  fields: Record<string, unknown>;
}

/** Parse one fence body; line names its opening fence in the Markdown source. */
export async function parseRequest(source: string, file: string, line: number) {
  try {
    const document = parseDocument(source);
    if (document.errors.length) throw document.errors[0];
    const value: unknown = document.toJS();
    if (!isObject(value)) throw new Error("expected a YAML mapping");
    const kind = value.kind;
    if (typeof kind !== "string" || !Object.hasOwn(requestKinds, kind))
      throw new Error(`unknown request kind ${String(kind)}`);
    const entry = requestKinds[kind];
    for (const key of Object.keys(value))
      if (key !== "kind" && !Object.hasOwn(entry.fields, key))
        throw new Error(`unknown field ${key}`);
    for (const [key, check] of Object.entries(entry.fields)) {
      if (!Object.hasOwn(value, key)) throw new Error(`missing ${key}`);
      try {
        await check(value[key]);
      } catch (error) {
        throw new Error(`${key}: ${(error as Error).message}`);
      }
    }
    const { kind: _kind, caption, ...fields } = value;
    return {
      file,
      line,
      kind,
      caption: String(caption),
      skill: entry.skill,
      fields,
    };
  } catch (error) {
    throw new Error(`${file}:${line}: request: ${(error as Error).message}`);
  }
}

const markdown = new MarkdownIt("commonmark");
/** Shared by Markdown units; front matter offsets belong to the caller. */
export async function markdownRequests(body: string, file: string, offset = 0) {
  const requests: ResourceRequest[] = [];
  for (const token of markdown.parse(body, {}))
    if (token.type === "fence" && token.info.trim() === "request")
      requests.push(
        await parseRequest(token.content, file, offset + token.map![0] + 1),
      );
  return requests;
}

/** Notes and their author material participate; prompts and JSON do not. */
export async function contentRequests(root: string, unit?: string) {
  if (unit && /^sites\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(unit)) return [];
  if (
    unit &&
    !/^notes\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:author\/)?[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(
      unit,
    )
  )
    throw new Error(`${unit}: expected notes/<dir>[/[author/]<slug>]`);
  const requests: ResourceRequest[] = [];
  async function scan(path: string, author = false) {
    for (const entry of (
      await readdir(join(root, path), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${path}/${entry.name}`;
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const { body, offset } = parseNote(
          await readFile(join(root, file), "utf8"),
          file,
        );
        requests.push(...(await markdownRequests(body, file, offset)));
      } else if (!author && entry.isDirectory() && entry.name === "author")
        await scan(file, true);
    }
  }
  if (unit?.split("/")[2]) {
    const file = `${unit}.md`;
    const { body, offset } = parseNote(
      await readFile(join(root, file), "utf8"),
      file,
    );
    requests.push(...(await markdownRequests(body, file, offset)));
  } else if (unit) await scan(unit);
  else {
    let directories;
    try {
      directories = await readdir(join(root, "notes"), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return requests;
      throw error;
    }
    for (const dir of directories.sort((a, b) => a.name.localeCompare(b.name)))
      if (dir.isDirectory()) await scan(`notes/${dir.name}`);
  }
  return requests;
}

export async function rejectContentRequests(root: string) {
  const requests = await contentRequests(root);
  if (requests.length)
    throw new Error(
      requests
        .map(
          (r) =>
            `${r.file}:${r.line}: unresolved ${r.kind} request: ${r.caption} (${r.skill})`,
        )
        .join("\n"),
    );
}
