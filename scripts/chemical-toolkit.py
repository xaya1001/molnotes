"""Build-time RDKit service. One JSON request and response per line."""

import json
from pathlib import Path
import sys

from rdkit import Chem, RDLogger, rdBase
from rdkit.Chem import AllChem, rdAbbreviations, rdDepictor, rdFMCS
from rdkit.Chem.Draw import rdMolDraw2D

RDLogger.DisableLog("rdApp.warning")
FONT = Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf")
objects = {}
next_handle = 0


def store(mol):
    global next_handle
    if mol is None:
        return None
    next_handle += 1
    objects[next_handle] = mol
    return next_handle


def details(args, index=0):
    return json.loads(args[index]) if len(args) > index and args[index] else {}


def parse_molecule(text, options):
    if text.lstrip().startswith("{"):
        mols = Chem.JSONToMols(text)
        if not mols:
            return None
        mol = mols[0]
        mol.UpdatePropertyCache(strict=False)
        Chem.FastFindRings(mol)
        return mol
    if "M  END" in text:
        return Chem.MolFromMolBlock(text, sanitize=options.get("sanitize", True), removeHs=options.get("removeHs", True))
    params = Chem.SmilesParserParams()
    params.removeHs = options.get("removeHs", True)
    params.sanitize = options.get("sanitize", True)
    return Chem.MolFromSmiles(text, params)


def match_json(mol, query, atoms):
    return {"atoms": list(atoms), "bonds": [mol.GetBondBetweenAtoms(atoms[b.GetBeginAtomIdx()], atoms[b.GetEndAtomIdx()]).GetIdx() for b in query.GetBonds()]}


def svg(mol, options):
    copy = Chem.Mol(mol)
    if not copy.GetNumConformers():
        rdDepictor.Compute2DCoords(copy, canonOrient=True)
    if options.get("useMolBlockWedging"):
        Chem.ReapplyMolBlockWedging(copy)
    copy = rdMolDraw2D.PrepareMolForDrawing(copy, addChiralHs=options.get("addChiralHs", True), wedgeBonds=options.get("wedgeBonds", True))
    drawing = rdMolDraw2D.MolDraw2DSVG(options.get("width", -1), options.get("height", -1), noFreetype=options.get("noFreetype", False))
    style = drawing.drawOptions()
    rdMolDraw2D.UpdateMolDrawOptionsFromJSON(style, json.dumps({k: v for k, v in options.items() if k not in ("atomLabels", "fontFile")}))
    style.useBWAtomPalette()
    style.fontFile = str(FONT)
    style.prepareMolsBeforeDrawing = False
    style.clearBackground = False
    for index, label in options.get("atomLabels", {}).items():
        style.atomLabels[int(index)] = label
    drawing.DrawMolecule(copy, highlightAtoms=options.get("atoms", []), highlightBonds=options.get("bonds", []))
    drawing.FinishDrawing()
    return drawing.GetDrawingText()


def mcs(molecules, options):
    return rdFMCS.FindMCS(molecules, timeout=options.get("Timeout", 1), ringMatchesRingOnly=options.get("RingMatchesRingOnly", False), completeRingsOnly=options.get("CompleteRingsOnly", False), matchValences=options.get("MatchValences", False), bondCompare={"Any": rdFMCS.BondCompare.CompareAny, "OrderExact": rdFMCS.BondCompare.CompareOrderExact}.get(options.get("BondCompare"), rdFMCS.BondCompare.CompareOrder))


def invoke(op, args):
    if op == "version":
        if not FONT.is_file():
            raise ValueError("Liberation Sans TTF is required for chemical figures")
        return rdBase.rdkitVersion
    if op == "font_file":
        return str(FONT)
    if op == "get_mol":
        return store(parse_molecule(args[0], details(args, 1)))
    if op == "get_qmol":
        return store(Chem.MolFromSmarts(args[0]))
    if op == "get_rxn":
        return store(AllChem.ReactionFromSmarts(args[0]))
    if op in ("get_mcs_as_json", "get_mcs_as_smarts"):
        result = mcs([objects[h] for h in args[0]], details(args, 1))
        if op == "get_mcs_as_smarts":
            return result.smartsString
        return json.dumps({"smarts": result.smartsString, "numAtoms": result.numAtoms, "numBonds": result.numBonds, "canceled": result.canceled})
    if op == "prefer_coordgen":
        rdDepictor.SetPreferCoordGen(args[0])
        return None
    handle, *rest = args
    if op == "delete":
        del objects[handle]
        return None
    mol = objects[handle]
    if op == "copy":
        return store(Chem.Mol(mol))
    if op == "is_valid":
        return True
    if op == "has_coords":
        return 2 if mol.GetNumConformers() else 0
    if op == "get_num_atoms":
        return mol.GetNumHeavyAtoms() if rest and rest[0] else mol.GetNumAtoms()
    if op == "get_num_bonds":
        return mol.GetNumBonds()
    if op == "get_json":
        return Chem.MolToJSON(mol)
    if op in ("get_smiles", "get_cxsmiles"):
        options = details(rest)
        params = Chem.SmilesWriteParams()
        params.canonical = options.get("canonical", True)
        params.doIsomericSmiles = options.get("isomericSmiles", True)
        return Chem.MolToCXSmiles(mol, params) if op == "get_cxsmiles" else Chem.MolToSmiles(mol, params)
    if op == "get_smarts":
        return Chem.MolToSmarts(mol)
    if op in ("get_molblock", "get_v3Kmolblock", "get_v2Kmolblock"):
        return Chem.MolToMolBlock(mol, forceV3000=op == "get_v3Kmolblock")
    if op in ("get_substruct_match", "get_substruct_matches"):
        query = objects[rest[0]]
        options = details(rest, 1)
        params = Chem.SubstructMatchParameters()
        params.useChirality = options.get("useChirality", False)
        params.uniquify = options.get("uniquify", True)
        params.maxMatches = options.get("maxMatches", 1000)
        matches = mol.GetSubstructMatches(query, params)
        values = [match_json(mol, query, atoms) for atoms in matches]
        return json.dumps(values if op == "get_substruct_matches" else values[0] if values else {})
    if op == "set_new_coords":
        rdDepictor.SetPreferCoordGen(bool(rest and rest[0]))
        rdDepictor.Compute2DCoords(mol, canonOrient=True)
        return True
    if op == "normalize_depiction":
        if not mol.GetNumConformers():
            return -1
        return rdDepictor.NormalizeDepiction(mol, canonicalize=rest[0] if rest else 1, scaleFactor=rest[1] if len(rest) > 1 else -1)
    if op == "straighten_depiction":
        rdDepictor.StraightenDepiction(mol, minimizeRotation=rest[0] if rest else False)
        return None
    if op == "generate_aligned_coords":
        reference = objects[rest[0]]
        options = details(rest, 1)
        query = Chem.MolFromSmarts(options["referenceSmarts"]) if options.get("referenceSmarts") else reference
        before = reference.GetSubstructMatch(query)
        after = mol.GetSubstructMatch(query)
        atom_map = list(zip(before, after))
        if not atom_map:
            if not options.get("acceptFailure", False):
                raise ValueError("Alignment core is absent")
            rdDepictor.Compute2DCoords(mol, canonOrient=True)
            return "{}"
        params = rdDepictor.ConstrainedDepictionParams()
        params.alignOnly = options.get("alignOnly", False)
        params.acceptFailure = options.get("acceptFailure", False)
        params.forceRDKit = not options.get("useCoordGen", False)
        rdDepictor.GenerateDepictionMatching2DStructure(mol, reference, atomMap=atom_map, params=params)
        return json.dumps({"atoms": list(after)})
    if op == "get_frags":
        mappings = []
        fragments = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=False, fragsMolAtomMapping=mappings)
        return {"molecules": [store(fragment) for fragment in fragments], "mappings": json.dumps({"fragsMolAtomMapping": mappings})}
    if op == "add_hs_in_place":
        objects[handle] = Chem.AddHs(mol, addCoords=True)
        return True
    if op == "remove_hs_in_place":
        params = Chem.RemoveHsParameters()
        params.removeIsotopes = True
        objects[handle] = Chem.RemoveHs(mol, params)
        return True
    if op == "get_svg_with_highlights":
        return svg(mol, details(rest))
    if op == "run_reactants":
        products = mol.RunReactants(tuple(objects[h] for h in rest[0]), maxProducts=rest[1])
        return [[store(product) for product in group] for group in products]
    if op == "condense_abbreviations":
        definitions = rdAbbreviations.ParseAbbreviations(rest[0])
        labelled = rdAbbreviations.LabelMolAbbreviations(mol, definitions, maxCoverage=1)
        groups = list(Chem.GetMolSubstanceGroups(labelled))
        allowed = set(rest[1])
        if all(list(group.GetAtoms())[0] in allowed for group in groups):
            shown = rdAbbreviations.CondenseMolAbbreviations(mol, definitions, maxCoverage=1)
        else:
            selected = [(list(group.GetAtoms()), list(group.GetBonds()), group.GetProp("LABEL")) for group in groups if list(group.GetAtoms())[0] in allowed]
            Chem.ClearMolSubstanceGroups(labelled)
            for atoms, bonds, label in selected:
                group = Chem.CreateMolSubstanceGroup(labelled, "SUP")
                group.SetAtoms(atoms)
                group.SetBonds(bonds)
                group.SetProp("LABEL", label)
            shown = rdAbbreviations.CondenseAbbreviationSubstanceGroups(labelled)
        mapping = list(shown.GetPropsAsDict(includePrivate=True, includeComputed=False)["_origAtomMapping"]) if shown.HasProp("_origAtomMapping") else list(range(mol.GetNumAtoms()))
        return {"molecule": store(shown), "atoms": mapping}
    if op == "align_atom_map":
        reference = objects[rest[0]]
        params = rdDepictor.ConstrainedDepictionParams()
        params.alignOnly = False
        params.forceRDKit = not rest[2]
        rdDepictor.GenerateDepictionMatching2DStructure(mol, reference, atomMap=[tuple(p) for p in rest[1]], params=params)
        return True
    raise ValueError(f"Unknown chemical toolkit operation: {op}")


for line in sys.stdin:
    request = json.loads(line)
    try:
        response = {"id": request["id"], "ok": True, "value": invoke(request["op"], request["args"])}
    except Exception as error:
        response = {"id": request["id"], "ok": False, "error": str(error)}
    print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)
