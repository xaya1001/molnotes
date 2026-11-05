import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256 } from "../../shared/assets.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { graphSignature } from "../../shared/chemical-library/chemistry.ts";
import type { Library } from "../../shared/chemical-library/types.ts";

/** Read-only migration candidates. Source locations remain distinct until reviewed. */
export async function libraryInventory(root: string, library: Library) {
  const toolkit = await moleculeToolkit();
  const compounds: {
    location: string;
    smiles: string;
    graph: string | null;
    candidates: string[];
    proposed: string;
    error?: string;
  }[] = [];
  const images: {
    location: string;
    sha256: string;
    candidates: string[];
    proposed: string;
  }[] = [];
  const ids = new Map<string, string>();
  const proposed = (kind: string, identity: string) => {
    const key = kind + identity;
    let id = ids.get(key);
    if (!id) {
      id = `${kind}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      ids.set(key, id);
    }
    return id;
  };
  function molecule(smiles: string, location: string) {
    const parsed = toolkit.get_mol(smiles);
    let graph: string | null = null,
      error: string | undefined;
    if (!parsed) error = "Invalid molecular graph";
    else
      try {
        graph = graphSignature(toolkit, parsed);
      } finally {
        parsed.delete();
      }
    const candidates = Object.values(library)
      .filter((e) => e.kind === "compound" && e.graph === graph)
      .map((e) => e.id);
    compounds.push({
      location,
      smiles,
      graph,
      candidates,
      proposed:
        candidates.length === 1
          ? candidates[0]
          : proposed("cmp", graph ?? location),
      ...(error ? { error } : {}),
    });
  }
  function json(value: unknown, location: string) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => json(v, `${location}/${i}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      const pointer = `${location}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (/smiles$/i.test(key) && typeof v === "string" && v.trim())
        molecule(v, pointer);
      else json(v, pointer);
    }
  }
  async function visit(relative: string) {
    const entries = await readdir(join(root, relative), {
      withFileTypes: true,
    }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`${path}: symbolic links are not content`);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const bytes = await readFile(join(root, path));
      if (
        entry.name.endsWith(".json") &&
        (!path.startsWith("sites/") ||
          /^sites\/[^/]+\/(content\.json|static\/.*\.json)$/.test(path))
      )
        json(JSON.parse(bytes.toString()), path);
      else if (entry.name.endsWith(".md")) {
        const lines = bytes.toString().split("\n");
        let molecular = false;
        for (const [i, line] of lines.entries()) {
          if (/^```molecule\s*$/.test(line)) {
            molecular = true;
            continue;
          }
          if (/^```/.test(line)) {
            molecular = false;
            continue;
          }
          const match = molecular && /^smiles:\s*(.+)/.exec(line);
          if (match) molecule(match[1], `${path}:${i + 1}`);
        }
      } else if (/\.(png|jpe?g|webp|svg|gif)$/i.test(entry.name)) {
        const hash = sha256(bytes);
        const candidates = Object.values(library)
          .filter((e) => e.kind === "image" && e.asset.startsWith(hash + "."))
          .map((e) => e.id);
        images.push({
          location: path,
          sha256: hash,
          candidates,
          proposed:
            candidates.length === 1 ? candidates[0] : proposed("img", hash),
        });
      }
    }
  }
  await visit("sites");
  await visit("notes");
  return { mode: "dry-run", compounds, images };
}
