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
    definitions: string,
    roots: number[],
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
export async function chemicalConnection(): Promise<ChemicalConnection> {
  if (!owner) {
    owner = new Worker(new URL("./chemical-toolkit-io.ts", import.meta.url));
    const active = owner;
    ready = new Promise<void>((resolve, reject) => {
      active.once("error", reject);
      active.once("message", (message: unknown) => {
        if (isObject(message) && message.ready === true) resolve();
        else reject(new Error("Chemical toolkit did not start"));
      });
    });
  }
  await ready;
  owner.unref();
  const { port1, port2 } = new MessageChannel();
  const flag = new SharedArrayBuffer(4);
  owner.postMessage({ port: port2, flag, client: ++clientSequence }, [port2]);
  port1.unref();
  return { port: port1, flag };
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
  function call(op: string, args: unknown[] = []): unknown {
    Atomics.store(flag, 0, 0);
    connection.port.postMessage({ op, args });
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
    readonly id: number;
    constructor(id: number) {
      this.id = id;
    }
    copy() {
      return molecule(call("copy", [this.id]));
    }
    delete() {
      call("delete", [this.id]);
    }
    is_valid() {
      return boolean(call("is_valid", [this.id]));
    }
    has_coords() {
      return number(call("has_coords", [this.id]));
    }
    get_num_atoms(heavyOnly = false) {
      return number(call("get_num_atoms", [this.id, heavyOnly]));
    }
    get_json() {
      return string(call("get_json", [this.id]));
    }
    get_smiles(details = "{}") {
      return string(call("get_smiles", [this.id, details]));
    }
    get_cxsmiles(details = "{}") {
      return string(call("get_cxsmiles", [this.id, details]));
    }
    get_smarts(details = "{}") {
      return string(call("get_smarts", [this.id, details]));
    }
    get_molblock(details = "{}") {
      return string(call("get_molblock", [this.id, details]));
    }
    get_v3Kmolblock(details = "{}") {
      return string(call("get_v3Kmolblock", [this.id, details]));
    }
    get_v2Kmolblock(details = "{}") {
      return string(call("get_v2Kmolblock", [this.id, details]));
    }
    get_svg_with_highlights(details: string) {
      return string(call("get_svg_with_highlights", [this.id, details]));
    }
    get_substruct_match(query: ChemicalMolecule, details = "{}") {
      return string(
        call("get_substruct_match", [this.id, handle(query), details]),
      );
    }
    get_substruct_matches(query: ChemicalMolecule, details = "{}") {
      return string(
        call("get_substruct_matches", [this.id, handle(query), details]),
      );
    }
    set_new_coords(useCoordGen = false) {
      return boolean(call("set_new_coords", [this.id, useCoordGen]));
    }
    normalize_depiction(canonicalize = 1, scaleFactor = -1) {
      return number(
        call("normalize_depiction", [this.id, canonicalize, scaleFactor]),
      );
    }
    straighten_depiction(minimizeRotation = false) {
      call("straighten_depiction", [this.id, minimizeRotation]);
    }
    generate_aligned_coords(reference: ChemicalMolecule, details: string) {
      return string(
        call("generate_aligned_coords", [this.id, handle(reference), details]),
      );
    }
    add_hs_in_place() {
      return boolean(call("add_hs_in_place", [this.id]));
    }
    remove_hs_in_place(details = "{}") {
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
      for (const id of this.ids) call("delete", [id]);
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
      for (const group of this.groups)
        for (const id of group) call("delete", [id]);
      this.groups.length = 0;
    }
  }
  class Reaction implements ChemicalReaction {
    readonly id: number;
    constructor(id: number) {
      this.id = id;
    }
    delete() {
      call("delete", [this.id]);
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
    condense: (mol, definitions, roots) => {
      const value = call("condense_abbreviations", [
        handle(mol),
        definitions,
        roots,
      ]);
      if (!isObject(value))
        throw new Error("Invalid native abbreviation result");
      const shown = molecule(value.molecule);
      if (!shown) throw new Error("Native abbreviation has no molecule");
      return { mol: shown, original: numbers(value.atoms) };
    },
    alignAtomMap: (mol, reference, mapping, coordgen) => {
      call("align_atom_map", [
        handle(mol),
        handle(reference),
        mapping,
        coordgen,
      ]);
    },
    get_mol: (input, details = "{}") =>
      molecule(call("get_mol", [input, details])),
    get_qmol: (input) => molecule(call("get_qmol", [input])),
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
