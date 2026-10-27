#!/usr/bin/env node
// Authoring checks in addition to the authoritative content build validation.
import type { TopicContent } from "../../src/ui/topic/content.ts";
import type { BodyRef } from "../../src/ui/topic/patent.ts";
import fs from "node:fs/promises";
import path from "node:path";
const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: node preflight.ts sites/<slug>");
const root = path.resolve(directory);
// The topic's content.json as written; the content build validates it, these checks only read it.
const content: TopicContent = JSON.parse(
  await fs.readFile(path.join(root, "content.json"), "utf8"),
);
const errors: string[] = [];
const counts: Record<string, { records: number; withSmiles: number }> = {};
for (const [id, collection] of Object.entries(
  content.data?.collections ?? {},
)) {
  let withSmiles = 0;
  const structureFields = collection.fields.filter(
    (field) => field.kind === "smiles",
  );
  for (const record of collection.records) {
    for (const field of structureFields) {
      if (record[field.key]) withSmiles++;
      else if (
        !record.notes?.some(
          (note) => note.field === field.key && note.text?.trim(),
        )
      )
        errors.push(`${id}/${record.id}: blank ${field.key} needs a reason`);
    }
    for (const field of collection.fields.filter(
      (field) => field.kind === "body",
    )) {
      const body = record[field.key] as BodyRef | undefined;
      if (!body) continue;
      const prefix = `/sites/${path.basename(root)}/static/`;
      if (!body.url?.startsWith(prefix)) {
        errors.push(`${id}/${record.id}: body URL is outside this unit`);
        continue;
      }
      const file = path.resolve(root, "static", body.url.slice(prefix.length));
      if (!file.startsWith(path.join(root, "static") + path.sep)) {
        errors.push(`${id}/${record.id}: body path escapes static`);
        continue;
      }
      try {
        const text = JSON.parse(await fs.readFile(file, "utf8"));
        if (typeof text[body.key] !== "string")
          errors.push(`${id}/${record.id}: missing body key ${body.key}`);
      } catch (error) {
        errors.push(`${id}/${record.id}: ${(error as Error).message}`);
      }
    }
  }
  counts[id] = { records: collection.records.length, withSmiles };
}
for (const [id, source] of Object.entries(content.data?.sources ?? {})) {
  for (let page = 1; page <= source.pages; page++) {
    const prefix = `/sites/${path.basename(root)}/static/`;
    const url = source.image.replace("{page}", String(page));
    const file = path.resolve(root, "static", url.slice(prefix.length));
    if (
      !url.startsWith(prefix) ||
      !file.startsWith(path.join(root, "static") + path.sep)
    ) {
      errors.push(
        `${id}: page image must stay inside this unit's static directory`,
      );
      break;
    }
    try {
      await fs.access(file);
    } catch {
      errors.push(`${id}: missing page ${page}`);
    }
  }
}
console.log(JSON.stringify({ counts, errors }, null, 2));
if (errors.length) process.exitCode = 1;
