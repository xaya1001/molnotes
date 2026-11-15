import MarkdownIt from "markdown-it";
import { isNode, LineCounter, parseDocument } from "yaml";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "../../shared/json.ts";
import { parseNote } from "../../shared/notes-index.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { validateFigureInput } from "../figure-input.ts";
import { expandFigureSmiles } from "../figure-scene.ts";
import type {
  ResourceRequest,
  RequestIssue,
  RequestDisplay,
} from "../../shared/content-preview.ts";
import { chartDisplay, figureDisplay, figureMeta } from "./request-display.ts";

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
  const errors: Error[] = [];
  function smiles(value: string, path: string) {
    try {
      const mol = toolkit.get_mol(expandFigureSmiles(value));
      try {
        if (!mol?.is_valid() || !mol.get_num_atoms())
          throw new Error("无法解析 SMILES");
      } finally {
        mol?.delete();
      }
    } catch (error) {
      errors.push(new Error(`${path}: ${(error as Error).message}`));
    }
  }
  function visit(value: unknown, path: string) {
    if (Array.isArray(value))
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
    else if (isObject(value))
      for (const [key, item] of Object.entries(value)) {
        const where = `${path}.${key}`;
        if (
          (key === "smiles" ||
            key === "core" ||
            (value.type === "repeat" && (key === "unit" || key === "end")) ||
            path.endsWith(".compounds")) &&
          typeof item === "string"
        )
          smiles(item, where);
        else visit(item, where);
      }
  }
  visit(input, "figure");
  if (errors.length)
    throw new AggregateError(errors, "Invalid figure structures");
}

/** The single registry for request fields, validation and completion skills. */
export const requestKinds: Record<
  string,
  {
    fields: Record<string, Check>;
    skill: string;
    display: RequestDisplay;
    meta?: (value: Record<string, unknown>) => string;
    summarize?: (value: Record<string, unknown>) => Partial<RequestDisplay>;
  }
> = {
  image: {
    fields: { file, caption: text, prompt: text },
    skill: "note-figures",
    display: {
      label: "生图",
      icon: "M2 3h12v10H2z M2 11l3-3 3 3 2-2 4 4 M10 6h.01",
      filename: true,
    },
    summarize: (value) => ({
      meta: String(value.file),
      prompt: String(value.prompt),
    }),
  },
  figure: {
    fields: { caption: text, figure },
    skill: "chemical-figures",
    meta: (value) => figureMeta(value.figure),
    display: {
      label: "化学图",
      icon: "M8 1.75l5.4 3.12v6.26L8 14.25l-5.4-3.12V4.87z",
      yaml: true,
    },
    summarize: (value) => figureDisplay(value.figure),
  },
  chart: {
    fields: {
      file,
      caption: text,
      data: supplied,
      axes: supplied,
      point: text,
    },
    skill: "note-figures",
    display: {
      label: "数据图",
      icon: "M2 14h12M4 12V7M8 12V3.5M12 12V9",
      filename: true,
    },
    summarize: (value) => ({
      meta: String(value.file),
      chart: chartDisplay(value.data, value.axes, value.point),
    }),
  },
};
/** Validation retains source nodes so the preview can point at real Markdown lines. */
export async function inspectRequest(
  source: string,
  file: string,
  line: number,
) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  const errors: RequestIssue[] = [];
  function issue(path: string, message: string) {
    const parts = path
      .split(/[.\[\]]/)
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
    let node = document.getIn(parts, true);
    while (!isNode(node) && parts.length) {
      parts.pop();
      node = document.getIn(parts, true);
    }
    errors.push({
      path,
      line:
        line +
        (isNode(node) && node.range
          ? lineCounter.linePos(node.range[0]).line
          : 1),
      message,
    });
  }
  let value: Record<string, unknown> = {};
  if (document.errors.length) {
    const error = document.errors[0];
    errors.push({
      path: "",
      line: line + (error.linePos?.[0]?.line ?? 1),
      message: error.message,
    });
    const caption = document.get("caption");
    const kind = document.get("kind");
    value = { kind, caption };
  } else {
    const parsed: unknown = document.toJS();
    if (isObject(parsed)) value = parsed;
    else issue("", "expected a YAML mapping");
  }
  const kind = typeof value.kind === "string" ? value.kind : "";
  const entry = Object.hasOwn(requestKinds, kind)
    ? requestKinds[kind]
    : undefined;
  if (!document.errors.length) {
    if (!entry) issue("kind", `unknown request kind ${String(value.kind)}`);
    else {
      for (const key of Object.keys(value))
        if (key !== "kind" && !Object.hasOwn(entry.fields, key))
          issue(key, "unknown field");
      for (const [key, check] of Object.entries(entry.fields)) {
        if (!Object.hasOwn(value, key)) {
          issue(key, `缺少字段 ${key}`);
          continue;
        }
        try {
          await check(value[key]);
        } catch (error) {
          for (const problem of error instanceof AggregateError
            ? error.errors
            : [error]) {
            const message = (problem as Error).message;
            const match = /^(figure(?:[.\[\]\w-]*)): (.*)$/s.exec(message);
            const path = match?.[1] ?? key;
            issue(
              path,
              match?.[2] === "required"
                ? `缺少字段 ${path
                    .split(/[.\[\]]/)
                    .filter(Boolean)
                    .at(-1)}`
                : (match?.[2] ?? message),
            );
          }
        }
      }
    }
  }
  const { kind: _kind, caption, ...fields } = value;
  const request: ResourceRequest = {
    file,
    line,
    kind,
    caption: typeof caption === "string" ? caption : "",
    fields,
    skill: entry?.skill ?? "",
  };
  const display: RequestDisplay = {
    ...(entry?.display ?? {
      label: kind || "request",
      icon: "M8 2v7M8 12h.01",
    }),
    meta:
      entry?.meta?.(value) ??
      (entry?.display.filename && typeof value.file === "string"
        ? value.file
        : undefined),
    ...(!errors.length ? entry?.summarize?.(value) : {}),
  };
  return {
    ...request,
    source,
    display,
    errors: errors.sort((a, b) => a.line - b.line),
  };
}

/** Strict entry for todo and publication; preview consumes the same diagnostics. */
export async function parseRequest(source: string, file: string, line: number) {
  const inspected = await inspectRequest(source, file, line);
  if (inspected.errors.length)
    throw new Error(
      inspected.errors
        .map(
          (error) =>
            `${file}:${error.line}: request: ${error.path}: ${error.message}`,
        )
        .join("\n"),
    );
  const {
    source: _source,
    display: _display,
    errors: _errors,
    ...request
  } = inspected;
  return request;
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
