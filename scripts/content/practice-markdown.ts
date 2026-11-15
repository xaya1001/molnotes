import MarkdownIt from "markdown-it";
import { LineCounter, parseDocument } from "yaml";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "../../shared/json.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { atomMaps, graphOf } from "../../shared/chemical-library/chemistry.ts";
import {
  validateBlocks,
  type BlockReferences,
} from "../../shared/topic-blocks.ts";
import type { TopicBlock } from "../../src/ui/topic/blocks.ts";

const markdown = new MarkdownIt("commonmark", { html: false });
const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}
function yaml(source: string, file: string, line: number) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { uniqueKeys: true, lineCounter });
  if (doc.errors.length) {
    const error = doc.errors[0];
    fail(
      `${file}:${line + (error.linePos?.[0]?.line ?? 1) - 1}`,
      error.message,
    );
  }
  const value: unknown = doc.toJS();
  if (!isObject(value)) fail(`${file}:${line}`, "Expected a YAML mapping");
  return value;
}

async function mappedMolecule(value: unknown, where: string) {
  if (!isObject(value) || typeof value.smiles !== "string")
    fail(where, "molecule needs smiles");
  const toolkit = await moleculeToolkit();
  const mol = toolkit.get_mol(value.smiles);
  if (!mol?.is_valid()) {
    mol?.delete();
    fail(where, "Invalid SMILES");
  }
  try {
    const maps = atomMaps(mol);
    const indices = new Map<number, number>();
    maps.forEach((map, index) => {
      if (!map) return;
      if (indices.has(map)) fail(where, `Duplicate atom mapping number ${map}`);
      indices.set(map, index);
    });
    const atom = (map: unknown) => {
      if (typeof map !== "number" || !indices.has(map))
        fail(where, `Unknown atom mapping number ${String(map)}`);
      return indices.get(map)!;
    };
    const atoms = (answer: unknown) => {
      if (!Array.isArray(answer))
        fail(where, "answer must list atom mapping numbers");
      return answer.map(atom);
    };
    const labels = (value: unknown) => {
      if (value === undefined) return {};
      if (!isObject(value))
        fail(where, "labels must map atom mapping numbers to labels");
      return {
        labels: Object.fromEntries(
          Object.entries(value).map(([map, label]) => [
            atom(Number(map)),
            label,
          ]),
        ),
      };
    };
    return {
      atom,
      atoms,
      labels,
      bonds: graphOf(mol).bonds,
      molecule: { ...value, smiles: value.smiles.replace(/:\d+(?=\])/g, "") },
    };
  } finally {
    mol.delete();
  }
}

async function question(value: Record<string, unknown>, where: string) {
  const { type, ...fields } = value;
  if (type === "problem") return { ...fields, type: "problem" };
  if (
    !["choice", "atoms", "bonds", "atom-set", "ranking", "number"].includes(
      String(type),
    )
  )
    fail(where, `Unknown question type ${String(type)}`);
  const block: Record<string, unknown> = {
    ...fields,
    type: "prediction",
    kind: type,
  };
  if (type === "choice" && !Array.isArray(block.optionExplanations))
    fail(where, "choice needs optionExplanations");
  if (type === "atoms" || type === "bonds") {
    const mapped = await mappedMolecule(block.molecule, where);
    block.molecule = mapped.molecule;
    if (type === "atoms") block.answer = mapped.atoms(block.answer);
    else {
      if (!Array.isArray(block.answer))
        fail(where, "answer must list bond endpoint pairs");
      block.answer = block.answer.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2)
          fail(where, "Each bond answer needs two atom mapping numbers");
        const a = mapped.atom(pair[0]),
          b = mapped.atom(pair[1]);
        const index = mapped.bonds.findIndex(
          ({ atoms: [x, y] }) => (a === x && b === y) || (a === y && b === x),
        );
        if (index < 0)
          fail(where, `No bond between mapping numbers ${pair.join(", ")}`);
        return index;
      });
    }
    Object.assign(block, mapped.labels(block.labels));
  }
  if (type === "atom-set") {
    if (!Array.isArray(block.molecules))
      fail(where, "atom-set needs molecules");
    // Labels use a single mapping namespace shared by all structures.
    const labels = block.labels;
    const convertedLabels: Record<string, unknown> = {};
    block.molecules = await Promise.all(
      block.molecules.map(async (molecule) => {
        const mapped = await mappedMolecule(molecule, where);
        if (!isObject(molecule)) fail(where, "Expected a molecule");
        Object.assign(convertedLabels, mapped.labels(labels).labels);
        return { ...mapped.molecule, answer: mapped.atoms(molecule.answer) };
      }),
    );
    if (labels !== undefined) block.labels = convertedLabels;
  }
  return block;
}

/** Compile one chapter into the existing topic block contract. */
export async function compilePracticeChapter(
  source: string,
  file: string,
  ids = new Map<string, string>(),
) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) fail(`${file}:1`, "Missing YAML front matter");
  const metadata = yaml(match[1], file, 2);
  const id = file.split("/").at(-1)!.slice(0, -3);
  for (const key of Object.keys(metadata))
    if (
      ![
        "title",
        "note",
        "number",
        "short",
        "minutes",
        "lead",
        "refs",
        "path",
        "excerpts",
        "reading",
        "layout",
        "terms",
      ].includes(key)
    )
      fail(`${file}:2`, `Unknown chapter field ${key}`);
  if (
    typeof metadata.note !== "string" ||
    !new RegExp(`^notes/${slug}/${slug}$`).test(metadata.note)
  )
    fail(`${file}:2`, "note must name notes/<dir>/<slug>");
  const offset = match[0].split("\n").length - 1;
  const tokens = markdown.parse(source.slice(match[0].length), {});
  const blocks: TopicBlock[] = [];
  function add(block: unknown, where: string) {
    const chapter = { id, blocks: [block] };
    validateBlocks(chapter, undefined, where, {
      excerpts: [],
      quiz: [],
      predictionIds: new Set(),
      pathPicker: false,
    });
    blocks.push(...chapter.blocks);
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const line = offset + (token.map?.[0] ?? 0) + 1;
    const where = `${file}:${line}`;
    if (token.type === "fence") {
      const kind = token.info.trim();
      if (kind !== "question") fail(where, `Unknown fence ${kind}`);
      const value = yaml(token.content, file, line + 1);
      if (typeof value.id !== "string" || !value.id.trim())
        fail(where, "question needs a stable id");
      if (ids.has(value.id))
        fail(
          where,
          `Duplicate question id ${value.id}; first used at ${ids.get(value.id)}`,
        );
      ids.set(value.id, where);
      add(await question(value, where), where);
    } else if (token.type === "heading_open") {
      if (!["h2", "h3"].includes(token.tag))
        fail(where, "Use ## or ### for chapter headings");
      add(
        {
          type: "heading",
          level: Number(token.tag[1]),
          text: tokens[++i].content,
        },
        where,
      );
      i++;
    } else if (token.type === "paragraph_open") {
      add({ type: "paragraph", text: tokens[++i].content }, where);
      i++;
    } else if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      const items: string[] = [];
      const close = token.type.replace("_open", "_close");
      while (++i < tokens.length && tokens[i].type !== close) {
        const item = tokens[i];
        if (item.type === "inline") items.push(item.content);
        else if (
          ![
            "list_item_open",
            "list_item_close",
            "paragraph_open",
            "paragraph_close",
          ].includes(item.type)
        )
          fail(
            `${file}:${offset + (item.map?.[0] ?? 0) + 1}`,
            "Use a flat list of paragraphs",
          );
      }
      add(
        { type: "list", items, ordered: token.type === "ordered_list_open" },
        where,
      );
    } else fail(where, `Unsupported Markdown block ${token.type}`);
  }
  return { ...metadata, id, blocks };
}

/** Markdown paths occupy their normal position in content.json's chapters array. */
export async function readPracticeChapters(
  root: string,
  unit: string,
  authored: unknown,
  group: string,
) {
  if (
    !isObject(authored) ||
    !Array.isArray(authored.chapters) ||
    !authored.chapters.some((entry) => typeof entry === "string")
  )
    return;
  const ids = new Map<string, string>();
  for (const questions of [authored.quiz, authored.placement])
    if (Array.isArray(questions))
      for (const question of questions)
        if (isObject(question) && typeof question.id === "string")
          ids.set(question.id, `${unit}/content.json:1`);
  for (const chapter of authored.chapters) {
    if (!isObject(chapter)) continue;
    // Existing JSON chapters keep their implicit prediction ids.
    if (typeof chapter.id !== "string" || !Array.isArray(chapter.blocks))
      continue;
    const blocks = { id: chapter.id, blocks: chapter.blocks };
    const found: BlockReferences = {
      excerpts: [],
      quiz: [],
      predictionIds: new Set(),
      pathPicker: false,
    };
    validateBlocks(
      blocks,
      isObject(authored.data) ? authored.data : undefined,
      `${unit}/content.json`,
      found,
    );
    for (const id of found.predictionIds)
      if (typeof id === "string") ids.set(id, `${unit}/content.json:1`);
  }
  const chapters: unknown[] = [];
  for (const entry of authored.chapters) {
    if (typeof entry !== "string") {
      chapters.push(entry);
      continue;
    }
    if (group !== "练习")
      fail(
        `${unit}/content.json:1`,
        "Markdown chapters require the practice group",
      );
    if (!new RegExp(`^chapters/${slug}\\.md$`).test(entry))
      fail(`${unit}/content.json:1`, "Expected chapters/<id>.md");
    const file = `${unit}/${entry}`;
    chapters.push(
      await compilePracticeChapter(
        await readFile(join(root, file), "utf8"),
        file,
        ids,
      ),
    );
  }
  authored.chapters = chapters;
}
