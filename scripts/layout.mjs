// Finds 2D coordinates that draw a structure cleanly and prints the SMILES
// with a CXSMILES coordinate block to paste into a `smiles` field.
//
//   npm run molecule:layout -- '<smiles>' [--like '<cxsmiles>'] [--offline]
//
// Candidates start from RDKit's and CoordGen's layouts, PubChem's 2D drawing
// (unless --offline) and, with --like, a structure that already has the
// wanted skeleton layout; each is polished and the cleanest is printed last.
import { moleculeToolkit } from "./molecule-toolkit.mjs";
import {
  coordinatesFrom,
  layoutCandidates,
  layoutProblems,
} from "./molecule-layout.mjs";

const usage =
  "Usage: npm run molecule:layout -- '<smiles>' [--like '<cxsmiles>'] [--offline]";
const args = process.argv.slice(2);
let smiles;
let template;
let offline = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--like") template = args[++i];
  else if (args[i] === "--offline") offline = true;
  else if (smiles === undefined && !args[i].startsWith("--")) smiles = args[i];
  else smiles = null;
}
if (!smiles || (args.includes("--like") && !template)) {
  console.error(usage);
  process.exit(1);
}

/** PubChem's 2D record for the structure, or for its skeleton without stereo marks. */
async function pubchem(text) {
  const base = text.split(/\s+\|/)[0];
  for (const query of [base, base.replace(/@+/g, "").replace(/[/\\]/g, "")]) {
    const response = await fetch(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/SDF?record_type=2d",
      { method: "POST", body: new URLSearchParams({ smiles: query }) },
    ).catch(() => null);
    const body = response?.ok ? await response.text() : "";
    if (body.includes("M  END"))
      return body.slice(0, body.indexOf("M  END") + 6);
  }
  return null;
}

const toolkit = await moleculeToolkit();
const now = layoutProblems(toolkit, smiles);
console.log(
  now.length ? `当前画法：${now.join("，")}` : "当前画法没有发现问题。",
);
const starts = {};
if (!offline) {
  const record = await pubchem(smiles);
  starts.pubchem = record && coordinatesFrom(toolkit, smiles, record);
  if (!starts.pubchem) console.log("PubChem 没有可对应的二维结构，跳过。");
}
const candidates = layoutCandidates(toolkit, smiles, { starts, template });
for (const c of [...candidates].reverse())
  console.log(
    `\n${c.name}：${c.problems.length ? c.problems.join("，") : "无重叠"}，键交叉 ${c.crossings} 处\n${c.smiles}`,
  );
const [best] = candidates;
console.log(`\n推荐 ${best.name}。写入后用 content:preview 看图。`);
