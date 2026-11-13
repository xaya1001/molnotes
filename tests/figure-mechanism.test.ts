import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFigure } from "../scripts/figure-scene.ts";
import type { Mechanism } from "../shared/chemical-library/types.ts";

test("mechanism frames retain participant identity and electron events", async () => {
  const result = await compileFigure({
    kind: "mechanism",
    category: "resonance",
    frames: [
      {
        id: "event",
        compounds: {
          donor: { smiles: "[OH-:1]", label: "Donor" },
          acceptor: { smiles: "[CH2:1]=[O:2]", label: "Acceptor" },
        },
        arrows: [
          {
            id: "attack",
            from: "lp(donor:1)",
            to: "between(donor:1,acceptor:1)",
          },
        ],
        labels: [
          { id: "polar", at: "acceptor:2", kind: "partialCharge", text: "δ−" },
        ],
        partialBonds: [{ from: "donor:1", to: "acceptor:1" }],
        focus: { primary: ["attack"] },
      },
    ],
  });
  const entry = result.entries[result.reference.ref] as Mechanism;
  assert.equal(entry.category, "resonance");
  const scene = entry.frames[0].scene;
  assert.deepEqual(
    scene.molecules.map((m) => m.id),
    ["donor", "acceptor"],
  );
  assert.equal(scene.arrows?.[0].from.kind, "lonePair");
  assert.deepEqual(scene.arrows?.[0].to, {
    kind: "formingBond",
    atoms: [
      { molecule: "donor", atom: "a1" },
      { molecule: "acceptor", atom: "a1" },
    ],
  });
  assert.deepEqual(
    scene.partialBonds?.[0].atoms,
    scene.arrows?.[0].to.kind === "formingBond" ? scene.arrows[0].to.atoms : [],
  );
  assert.equal(
    scene.labels?.find((l) => l.id === "polar")?.at.molecule,
    "acceptor",
  );
  assert.deepEqual(scene.focus?.primary?.arrows, ["attack"]);
  assert.ok(scene.captions?.some((c) => c.text.includes("Donor")));
});

test("mechanism steps and qualified maps retain their roles across frames", async () => {
  const result = await compileFigure({
    kind: "mechanism",
    category: "examples",
    frames: [
      {
        id: "before",
        compounds: { input: { smiles: "[CH3:1][OH:2]", label: "Input" } },
      },
      {
        id: "after",
        compounds: {
          reactant: {
            smiles: "[CH3:1][OH:2]",
            label: "Input",
            arrows: [{ id: "cleavage", from: "bond(1,2)", to: "atom(2)" }],
            focus: { primary: ["cleavage"] },
          },
          product: { smiles: "[CH2:1]=[O:2]", label: "Output" },
        },
        steps: [
          { from: "reactant", to: "product", above: "[O]", arrow: "forward" },
        ],
        map: { "input:1": "product:1", "input:2": "product:2" },
      },
    ],
  });
  const entry = result.entries[result.reference.ref] as Mechanism;
  assert.equal(entry.category, "examples");
  const scene = entry.frames[1].scene;
  const reactant = scene.molecules.find((m) => m.id === "reactant")!;
  const product = scene.molecules.find((m) => m.id === "product")!;
  assert.ok(reactant.at.x < product.at.x);
  assert.deepEqual(scene.reactionArrows?.[0].above, ["[O]"]);
  assert.equal(scene.reactionArrows?.[0].kind, "forward");
  assert.deepEqual(scene.focus?.primary?.arrows, ["reactant/cleavage"]);
  assert.deepEqual(
    entry.maps?.map((m) => [m.from.molecule, m.to.molecule]),
    [
      ["input", "product"],
      ["input", "product"],
    ],
  );
});
