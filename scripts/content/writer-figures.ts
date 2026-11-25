import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isObject } from "../../shared/json.ts";
import { noteFigureBlocks } from "../../shared/notes-index.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import type {
  Diagnostic,
  Library,
  LibraryFigureRender,
} from "../../shared/chemical-library/types.ts";
import { diagnosticLine } from "../figure-draw.ts";
import {
  libraryEntryFolders,
  libraryUsage,
  readChemicalLibraryEntries,
} from "./chemical-library.ts";
import { compileUnit } from "./compile-unit.ts";
import { prepareFigureViews } from "./figure-build.ts";
import { figureLibrarySubset, figureProofReferences } from "./figure-proofs.ts";

const exec = promisify(execFile);
type Page = string | { unit: string; chapter?: string };

function pageViews(library: Library, value: unknown, path: string) {
  const { references } = libraryUsage(library, [{ value, path, title: path }]);
  const subset = figureLibrarySubset(
    library,
    references.map(({ ref }) => ref),
  );
  return { subset, views: figureProofReferences(subset, references) };
}

async function baselinePage(root: string, page: Page, library: Library) {
  if (typeof page === "string")
    return noteFigureBlocks(await readFile(join(root, page), "utf8"), page);
  const { unit, chapter } = page;
  const authored: unknown = JSON.parse(
    await readFile(join(root, unit, "content.json"), "utf8"),
  );
  if (
    chapter &&
    isObject(authored) &&
    Array.isArray(authored.chapters) &&
    !authored.chapters.some(
      (entry: unknown) =>
        entry === chapter || (isObject(entry) && entry.id === chapter),
    )
  )
    return [];
  const site = parseSiteManifest(
    unit.split("/")[1],
    JSON.parse(await readFile(join(root, unit, "site.json"), "utf8")),
  );
  const common = { root, unit, authored, group: site.group, library };
  if (chapter) {
    const compiled = await compileUnit({ ...common, kind: "chapter", chapter });
    return [compiled.chapter, ...compiled.references];
  }
  const compiled = await compileUnit({ ...common, kind: "site" });
  return [compiled.content, ...compiled.references];
}

async function baselineDiagnostics(
  root: string,
  revision: string,
  page: Page,
  path: string,
  currentKeys: Set<string>,
): Promise<Record<string, LibraryFigureRender>> {
  const main = typeof page === "string" ? page : `${page.unit}/content.json`;
  const paths = [
    main,
    ...Object.values(libraryEntryFolders).map((dir) => `library/${dir}`),
  ];
  if (typeof page !== "string") {
    paths.push(`${page.unit}/site.json`);
    if (!page.chapter || page.chapter.startsWith("chapters/"))
      paths.push(`${page.unit}/${page.chapter ?? "chapters"}`);
  }
  const base = (
    await exec(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
      { cwd: root },
    )
  ).stdout.trim();
  if (!currentKeys.size) return {};
  const { stdout } = await exec(
    "git",
    ["ls-tree", "--name-only", "-z", base, "--", ...paths],
    { cwd: root },
  );
  const tracked = stdout.split("\0").filter(Boolean);
  if (!tracked.includes(main)) return {};
  const temporary = await mkdtemp(join(tmpdir(), "figure-check-"));
  try {
    const archive = join(temporary, "base.tar");
    await exec(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archive}`,
        base,
        "--",
        ...tracked,
      ],
      { cwd: root },
    );
    await exec("tar", ["-xf", archive, "-C", temporary]);
    const { entries } = await readChemicalLibraryEntries(temporary);
    const value = await baselinePage(temporary, page, entries);
    const { subset, views } = pageViews(entries, value, path);
    return (
      await prepareFigureViews(
        subset,
        views.filter((view) => currentKeys.has(figureViewKey(view))),
        temporary,
      )
    ).renders;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const diagnosticKey = ({ code, object, field, elements }: Diagnostic) =>
  JSON.stringify([code, object, field, [...elements].sort()]);

export async function checkPageFigures(
  root: string,
  base: string,
  page: Page,
  path: string,
  library: Library,
  value: unknown,
) {
  const { subset, views } = pageViews(library, value, path);
  const baseline = await baselineDiagnostics(
    root,
    base,
    page,
    path,
    new Set(views.map(figureViewKey)),
  );
  const { renders } = await prepareFigureViews(subset, views, root);
  const issues: string[] = [];
  for (const view of views) {
    const key = figureViewKey(view);
    const existing = (baseline[key]?.diagnostics ?? []).map(diagnosticKey);
    const local =
      view.numbers || view.focus
        ? ` [${JSON.stringify({ numbers: view.numbers, focus: view.focus })}]`
        : "";
    const location = `${path}: ${view.ref}${view.frame || view.variant ? "" : " [default]"}${local}`;
    for (const diagnostic of renders[key].diagnostics) {
      const index = existing.indexOf(diagnosticKey(diagnostic));
      if (index >= 0) existing.splice(index, 1);
      else issues.push(diagnosticLine(location, view, diagnostic));
    }
  }
  if (issues.length)
    throw new Error(
      [
        ...issues,
        "Follow .agents/skills/chemical-figures/SKILL.md: edit the saved source, recompile the affected entry, and rerun the page check.",
      ].join("\n"),
    );
}
