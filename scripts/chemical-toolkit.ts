import type { AbbreviatedGroup } from "../shared/molecule-abbreviations.ts";
import {
  Worker,
  MessageChannel,
  receiveMessageOnPort,
  type MessagePort,
  workerData,
} from "node:worker_threads";
import { isObject } from "../shared/json.ts";
import type {
  ChemicalMolecule,
  ChemicalMolList,
  ChemicalProducts,
  ChemicalReaction,
  ChemicalToolkit,
} from "../shared/chemical-toolkit.ts";

export interface PythonToolkit extends ChemicalToolkit {
  fontFile(): string;
  constrain(
    mol: ChemicalMolecule,
    positions: [number, number, number][],
  ): [number, number][];
  condense(
    mol: ChemicalMolecule,
    groups: readonly AbbreviatedGroup[],
  ): { mol: ChemicalMolecule; original: number[] };
  alignAtomMap(
    mol: ChemicalMolecule,
    reference: ChemicalMolecule,
    mapping: [number, number][],
    coordgen: boolean,
  ): void;
}
export interface ChemicalConnection {
  port: MessagePort;
  flag: SharedArrayBuffer;
}
let owner: Worker | undefined;
let clientSequence = 0;
let ready: Promise<void> | undefined;
function spawnChemicalWorker() {
  const worker = new Worker(
    new URL("./chemical-toolkit-io.ts", import.meta.url),
  );
  const started = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (message: unknown) => {
      if (isObject(message) && message.ready === true) resolve();
      else reject(new Error("Chemical toolkit did not start"));
    });
  });
  return { worker, started };
}
function attachClient(worker: Worker): ChemicalConnection {
  const { port1, port2 } = new MessageChannel();
  const flag = new SharedArrayBuffer(4);
  worker.postMessage({ port: port2, flag, client: ++clientSequence }, [port2]);
  port1.unref();
  return { port: port1, flag };
}
export async function chemicalConnection(): Promise<ChemicalConnection> {
  if (!owner) {
    const spawned = spawnChemicalWorker();
    owner = spawned.worker;
    ready = spawned.started;
  }
  await ready;
  owner.unref();
  return attachClient(owner);
}
export async function dedicatedChemicalConnection(): Promise<{
  connection: ChemicalConnection;
  close(): Promise<void>;
}> {
  const { worker, started } = spawnChemicalWorker();
  await started;
  worker.unref();
  return {
    connection: attachClient(worker),
    async close() {
      await worker.terminate();
    },
  };
}
process.once("beforeExit", async () => {
  if (owner) await owner.terminate();
});
function string(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Expected chemical toolkit text");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected chemical toolkit number");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Expected chemical toolkit boolean");
  return value;
}
function numbers(value: unknown): number[] {
  if (!Array.isArray(value))
    throw new Error("Expected chemical toolkit handles");
  return value.map(number);
}
export async function loadPythonToolkit(): Promise<PythonToolkit> {
  const connection: ChemicalConnection =
    workerData?.chemical ?? (await chemicalConnection());
  const toolkit = pythonToolkit(connection);
  if (toolkit.version() !== "2026.09.1")
    throw new Error("Chemical figures require RDKit 2026.09.1");
  return toolkit;
}
export function pythonToolkit(connection: ChemicalConnection): PythonToolkit {
  const flag = new Int32Array(connection.flag);
  const pendingDeletes: number[] = [];
  function call(op: string, args: unknown[] = []): unknown {
    const del = pendingDeletes.length ? pendingDeletes.splice(0) : undefined;
    Atomics.store(flag, 0, 0);
    connection.port.postMessage(del ? { op, args, del } : { op, args });
    Atomics.wait(flag, 0, 0);
    let response = receiveMessageOnPort(connection.port);
    while (!response) {
      Atomics.wait(flag, 0, 1, 1);
      response = receiveMessageOnPort(connection.port);
    }
    const value: unknown = response.message;
    if (!isObject(value) || typeof value.ok !== "boolean")
      throw new Error("Invalid chemical toolkit reply");
    if (!value.ok) throw new Error(string(value.error));
    return value.value;
  }
  interface CachedMol {
    key: string;
    id: number;
    pinned: number;
    evicted: boolean;
    hasCoords?: number;
    numAtoms?: [number | undefined, number | undefined];
    json?: string;
    smiles?: Map<string, string>;
    cxsmiles?: Map<string, string>;
    smarts?: string;
    molblock?: Map<string, string>;
    v3k?: Map<string, string>;
    v2k?: Map<string, string>;
    svg?: Map<string, string>;
    substructMatch?: Map<string, string>;
    substructMatches?: Map<string, string>;
  }
  const molCache = new Map<string, CachedMol>();
  const qmolCache = new Map<string, CachedMol>();
  function cacheGet(
    cache: Map<string, CachedMol>,
    key: string,
    op: "get_mol" | "get_qmol",
    args: unknown[],
    limit: number,
  ): Molecule | null {
    const existing = cache.get(key);
    if (existing) {
      cache.delete(key);
      cache.set(key, existing);
      existing.pinned++;
      return new Molecule(existing.id, existing);
    }
    const raw = call(op, args);
    if (raw === null) return null;
    const entry: CachedMol = {
      key,
      id: number(raw),
      pinned: 1,
      evicted: false,
    };
    cache.set(key, entry);
    if (cache.size > limit) {
      const oldest = cache.keys().next().value!;
      const dropped = cache.get(oldest)!;
      cache.delete(oldest);
      dropped.evicted = true;
      if (dropped.pinned === 0) pendingDeletes.push(dropped.id);
    }
    return new Molecule(entry.id, entry);
  }
  const handle = (mol: ChemicalMolecule): number => {
    if (!(mol instanceof Molecule))
      throw new Error("Expected a Python molecule handle");
    return mol.id;
  };
  const handles = (mols: ChemicalMolList) => {
    if (!(mols instanceof MolList))
      throw new Error("Expected a Python molecule list");
    return mols.ids;
  };
  const molecule = (value: unknown) =>
    value === null ? null : new Molecule(number(value));
  class Molecule implements ChemicalMolecule {
    id: number;
    cached?: CachedMol;
    private deleted = false;
    constructor(id: number, cached?: CachedMol) {
      this.id = id;
      this.cached = cached;
    }
    private releaseCache() {
      if (!this.cached) return;
      this.cached.pinned--;
      if (this.cached.pinned === 0 && this.cached.evicted)
        pendingDeletes.push(this.cached.id);
      this.cached = undefined;
    }
    detach() {
      if (!this.cached) return;
      const fresh = number(call("copy", [this.id]));
      this.releaseCache();
      this.id = fresh;
    }
    copy() {
      if (this.cached) {
        this.cached.pinned++;
        return new Molecule(this.id, this.cached);
      }
      return molecule(call("copy", [this.id]));
    }
    delete() {
      if (this.deleted) return;
      this.deleted = true;
      if (this.cached) this.releaseCache();
      else pendingDeletes.push(this.id);
    }
    is_valid() {
      return true;
    }
    has_coords() {
      if (this.cached) {
        this.cached.hasCoords ??= number(call("has_coords", [this.id]));
        return this.cached.hasCoords;
      }
      return number(call("has_coords", [this.id]));
    }
    get_num_atoms(heavyOnly = false) {
      if (this.cached) {
        const idx = heavyOnly ? 1 : 0;
        this.cached.numAtoms ??= [undefined, undefined];
        this.cached.numAtoms[idx] ??= number(
          call("get_num_atoms", [this.id, heavyOnly]),
        );
        return this.cached.numAtoms[idx]!;
      }
      return number(call("get_num_atoms", [this.id, heavyOnly]));
    }
    get_json() {
      if (this.cached) {
        this.cached.json ??= string(call("get_json", [this.id]));
        return this.cached.json;
      }
      return string(call("get_json", [this.id]));
    }
    get_smiles(details = "{}") {
      if (this.cached) {
        this.cached.smiles ??= new Map();
        let value = this.cached.smiles.get(details);
        if (value === undefined) {
          value = string(call("get_smiles", [this.id, details]));
          this.cached.smiles.set(details, value);
        }
        return value;
      }
      return string(call("get_smiles", [this.id, details]));
    }
    get_cxsmiles(details = "{}") {
      if (this.cached) {
        this.cached.cxsmiles ??= new Map();
        let value = this.cached.cxsmiles.get(details);
        if (value === undefined) {
          value = string(call("get_cxsmiles", [this.id, details]));
          this.cached.cxsmiles.set(details, value);
        }
        return value;
      }
      return string(call("get_cxsmiles", [this.id, details]));
    }
    get_smarts(details = "{}") {
      if (this.cached && details === "{}") {
        this.cached.smarts ??= string(call("get_smarts", [this.id, details]));
        return this.cached.smarts;
      }
      return string(call("get_smarts", [this.id, details]));
    }
    get_molblock(details = "{}") {
      if (this.cached) {
        this.cached.molblock ??= new Map();
        let value = this.cached.molblock.get(details);
        if (value === undefined) {
          value = string(call("get_molblock", [this.id, details]));
          this.cached.molblock.set(details, value);
        }
        return value;
      }
      return string(call("get_molblock", [this.id, details]));
    }
    get_v3Kmolblock(details = "{}") {
      if (this.cached) {
        this.cached.v3k ??= new Map();
        let value = this.cached.v3k.get(details);
        if (value === undefined) {
          value = string(call("get_v3Kmolblock", [this.id, details]));
          this.cached.v3k.set(details, value);
        }
        return value;
      }
      return string(call("get_v3Kmolblock", [this.id, details]));
    }
    get_v2Kmolblock(details = "{}") {
      if (this.cached) {
        this.cached.v2k ??= new Map();
        let value = this.cached.v2k.get(details);
        if (value === undefined) {
          value = string(call("get_v2Kmolblock", [this.id, details]));
          this.cached.v2k.set(details, value);
        }
        return value;
      }
      return string(call("get_v2Kmolblock", [this.id, details]));
    }
    get_svg_with_highlights(details: string) {
      if (this.cached) {
        this.cached.svg ??= new Map();
        let value = this.cached.svg.get(details);
        if (value === undefined) {
          value = string(call("get_svg_with_highlights", [this.id, details]));
          this.cached.svg.set(details, value);
        }
        return value;
      }
      return string(call("get_svg_with_highlights", [this.id, details]));
    }
    get_substruct_match(query: ChemicalMolecule, details = "{}") {
      if (this.cached && query instanceof Molecule && query.cached) {
        const key = `${query.cached.key}\0${details}`;
        this.cached.substructMatch ??= new Map();
        let value = this.cached.substructMatch.get(key);
        if (value === undefined) {
          value = string(
            call("get_substruct_match", [this.id, handle(query), details]),
          );
          this.cached.substructMatch.set(key, value);
        }
        return value;
      }
      return string(
        call("get_substruct_match", [this.id, handle(query), details]),
      );
    }
    get_substruct_matches(query: ChemicalMolecule, details = "{}") {
      if (this.cached && query instanceof Molecule && query.cached) {
        const key = `${query.cached.key}\0${details}`;
        this.cached.substructMatches ??= new Map();
        let value = this.cached.substructMatches.get(key);
        if (value === undefined) {
          value = string(
            call("get_substruct_matches", [this.id, handle(query), details]),
          );
          this.cached.substructMatches.set(key, value);
        }
        return value;
      }
      return string(
        call("get_substruct_matches", [this.id, handle(query), details]),
      );
    }
    set_new_coords(useCoordGen = false) {
      this.detach();
      return boolean(call("set_new_coords", [this.id, useCoordGen]));
    }
    normalize_depiction(canonicalize = 1, scaleFactor = -1) {
      this.detach();
      return number(
        call("normalize_depiction", [this.id, canonicalize, scaleFactor]),
      );
    }
    straighten_depiction(minimizeRotation = false) {
      this.detach();
      call("straighten_depiction", [this.id, minimizeRotation]);
    }
    generate_aligned_coords(reference: ChemicalMolecule, details: string) {
      this.detach();
      return string(
        call("generate_aligned_coords", [this.id, handle(reference), details]),
      );
    }
    add_hs_in_place() {
      this.detach();
      return boolean(call("add_hs_in_place", [this.id]));
    }
    remove_hs_in_place(details = "{}") {
      this.detach();
      return boolean(call("remove_hs_in_place", [this.id, details]));
    }
  }
  class MolList implements ChemicalMolList {
    readonly ids: number[];
    constructor(ids: number[] = []) {
      this.ids = ids;
    }
    append(mol: ChemicalMolecule) {
      this.ids.push(number(call("copy", [handle(mol)])));
      return this.ids.length;
    }
    at(index: number) {
      return this.ids[index] === undefined
        ? null
        : molecule(call("copy", [this.ids[index]]));
    }
    size() {
      return this.ids.length;
    }
    delete() {
      pendingDeletes.push(...this.ids);
      this.ids.length = 0;
    }
  }
  class Products implements ChemicalProducts {
    readonly groups: number[][];
    constructor(groups: number[][]) {
      this.groups = groups;
    }
    size() {
      return this.groups.length;
    }
    get(index: number) {
      return this.groups[index]
        ? new MolList(
            this.groups[index].map((id) => number(call("copy", [id]))),
          )
        : undefined;
    }
    delete() {
      for (const group of this.groups) pendingDeletes.push(...group);
      this.groups.length = 0;
    }
  }
  class Reaction implements ChemicalReaction {
    readonly id: number;
    constructor(id: number) {
      this.id = id;
    }
    delete() {
      pendingDeletes.push(this.id);
    }
    run_reactants(reactants: ChemicalMolList, maxProducts: number) {
      const value = call("run_reactants", [
        this.id,
        handles(reactants),
        maxProducts,
      ]);
      if (!Array.isArray(value)) throw new Error("Invalid reaction products");
      return new Products(value.map(numbers));
    }
  }
  return {
    constrain: (mol, positions) => {
      const value = call("constrain_coordinates", [handle(mol), positions]);
      if (!Array.isArray(value))
        throw new Error("Invalid constrained coordinates");
      return value.map((row): [number, number] => {
        const values = numbers(row);
        if (values.length !== 2) throw new Error("Invalid constrained point");
        return [values[0], values[1]];
      });
    },
    condense: (mol, groups) => {
      const value = call("condense_abbreviations", [handle(mol), groups]);
      if (!isObject(value))
        throw new Error("Invalid native abbreviation result");
      const shown = molecule(value.molecule);
      if (!shown) throw new Error("Native abbreviation has no molecule");
      return { mol: shown, original: numbers(value.atoms) };
    },
    alignAtomMap: (mol, reference, mapping, coordgen) => {
      if (mol instanceof Molecule) mol.detach();
      call("align_atom_map", [
        handle(mol),
        handle(reference),
        mapping,
        coordgen,
      ]);
    },
    get_mol: (input, details = "{}") =>
      cacheGet(
        molCache,
        `m\0${details}\0${input}`,
        "get_mol",
        [input, details],
        1024,
      ),
    get_qmol: (input) =>
      cacheGet(qmolCache, `q\0${input}`, "get_qmol", [input], 512),
    get_rxn: (input) => {
      const id = call("get_rxn", [input]);
      return id === null ? null : new Reaction(number(id));
    },
    MolList,
    get_mcs_as_smarts: (mols, details = "{}") =>
      string(call("get_mcs_as_smarts", [handles(mols), details])),
    get_mcs_as_json: (mols, details = "{}") =>
      string(call("get_mcs_as_json", [handles(mols), details])),
    version: () => string(call("version")),
    fontFile: () => string(call("font_file")),
  };
}
