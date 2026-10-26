"""Render a checked SMILES string as an SVG teaching asset."""

import argparse
from pathlib import Path

from rdkit import Chem
from rdkit.Chem.Draw import rdMolDraw2D


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smiles", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width", type=int, default=420)
    parser.add_argument("--height", type=int, default=280)
    args = parser.parse_args()

    if args.width <= 0 or args.height <= 0:
        parser.error("width and height must be positive")
    molecule = Chem.MolFromSmiles(args.smiles)
    if molecule is None:
        parser.error("SMILES could not be parsed")

    drawer = rdMolDraw2D.MolDraw2DSVG(args.width, args.height)
    rdMolDraw2D.PrepareAndDrawMolecule(drawer, molecule)
    drawer.FinishDrawing()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(drawer.GetDrawingText(), encoding="utf-8")
    print(f"Canonical SMILES: {Chem.MolToSmiles(molecule)}")
    print(f"SVG: {args.output}")


if __name__ == "__main__":
    main()
