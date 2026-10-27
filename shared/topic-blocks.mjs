// The block catalogue of a chapter's `blocks`: what each block type needs and
// how blocks refer to each other. A chapter is a sequence of blocks; any block
// may refer to large values in the topic's `data` by key. This is the one definition
// of the catalogue; the runtime renders exactly these types.
import { defineDataTable } from "../src/ui/data/values.ts";
import { defineMatrix } from "../src/ui/matrix/model.ts";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { defineStructureSet } from "../src/ui/structure/model.ts";
import { defineFlow, flowText } from "../src/ui/diagrams/flow.ts";
import { defineTimeline, timelineText } from "../src/ui/diagrams/model.ts";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, where) {
  assert(typeof value === "string" && value.trim(), `${where} must be text`);
}

function optionalText(value, where) {
  if (value !== undefined) text(value, where);
}

function molecule(value, where) {
  assert(
    isObject(value) &&
      typeof value.name === "string" &&
      typeof value.smiles === "string",
    `${where} needs a name and a smiles`,
  );
  // Optional atom and bond counts bound the indices a prediction accepts.
  for (const name of ["atoms", "bonds"])
    assert(
      value[name] === undefined ||
        (Number.isInteger(value[name]) && value[name] > 0),
      `${where} ${name} must be a positive count`,
    );
}

/** Every index in `list` lies below `count` when the molecule states one. */
function within(list, count, where) {
  if (count === undefined || !Array.isArray(list)) return;
  assert(
    list.every((i) => i < count),
    `${where} has an index outside the molecule's ${count}`,
  );
}

function indices(value, where) {
  assert(
    Array.isArray(value) && value.every((i) => Number.isInteger(i) && i >= 0),
    `${where} must be a list of indices`,
  );
}

function optionalIndices(value, where) {
  if (value !== undefined) indices(value, where);
}

function labels(value, where) {
  if (value === undefined) return;
  assert(
    isObject(value) &&
      Object.entries(value).every(
        ([key, label]) => /^\d+$/.test(key) && typeof label === "string",
      ),
    `${where} labels must map atom indices to text`,
  );
}

function anchor(value, where) {
  assert(
    isObject(value) &&
      ((Number.isInteger(value.atom) && value.atom >= 0) ||
        (Number.isInteger(value.bond) && value.bond >= 0)),
    `${where} must name an atom or a bond`,
  );
}

function mechanismFrames(frames, where) {
  assert(
    Array.isArray(frames) && frames.length > 0,
    `${where} needs at least one frame`,
  );
  frames.forEach((frame, index) => {
    const at = `${where} frame ${index + 1}`;
    molecule(frame, at);
    text(frame.explanation, `${at} explanation`);
    assert(Array.isArray(frame.arrows), `${at} arrows must be an array`);
    for (const arrow of frame.arrows) {
      assert(isObject(arrow), `${at} arrows must be objects`);
      anchor(arrow.from, `${at} arrow from`);
      anchor(arrow.to, `${at} arrow to`);
      assert(
        arrow.electrons === 1 || arrow.electrons === 2,
        `${at} arrow electrons must be 1 or 2`,
      );
    }
  });
}

function synthesisRoutes(routes, where) {
  assert(
    Array.isArray(routes) && routes.length > 0,
    `${where} needs at least one route`,
  );
  for (const route of routes) {
    assert(isObject(route), `${where} routes must be objects`);
    text(route.id, `${where} route id`);
    text(route.title, `${where} route ${route.id} title`);
    assert(
      Array.isArray(route.steps) && route.steps.length > 0,
      `${where} route ${route.id} needs steps`,
    );
    route.steps.forEach((step, index) => {
      const at = `${where} route ${route.id} step ${index + 1}`;
      assert(isObject(step), `${at} must be an object`);
      text(step.title, `${at} title`);
      text(step.reagents, `${at} reagents`);
      text(step.conditions, `${at} conditions`);
      text(step.explanation, `${at} explanation`);
      optionalText(step.yield, `${at} yield`);
      for (const side of ["reactants", "products"]) {
        assert(
          Array.isArray(step[side]) && step[side].length > 0,
          `${at} needs ${side}`,
        );
        for (const item of step[side]) molecule(item, `${at} ${side}`);
      }
    });
  }
}

/** A cell is text, or `{ text, href }` for a linked value such as a PubChem CID. */
const tableCell = (cell) =>
  typeof cell === "string" ||
  (isObject(cell) &&
    typeof cell.text === "string" &&
    typeof cell.href === "string");

function tableRows(rows, columns, where) {
  assert(
    Array.isArray(rows) && rows.length > 0,
    `${where} needs at least one row`,
  );
  rows.forEach((row, index) => {
    assert(
      Array.isArray(row) &&
        row.length === columns.length &&
        row.every(tableCell),
      `${where} row ${index + 1} needs one text or { text, href } cell per column`,
    );
  });
}

function points(value, where) {
  assert(
    Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (point) =>
          isObject(point) &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y),
      ),
    `${where} points must be { x, y } numbers`,
  );
}

/** An optional choice submitted together with a structure pick (`options` + `optionAnswer`). */
function choiceWithStructure(prediction, where) {
  if (prediction.options !== undefined) {
    assert(
      Array.isArray(prediction.options) && prediction.options.length >= 2,
      `${where} options need at least two entries`,
    );
    assert(
      Number.isInteger(prediction.optionAnswer) &&
        prediction.optionAnswer >= 0 &&
        prediction.optionAnswer < prediction.options.length,
      `${where} optionAnswer is out of range`,
    );
  } else
    assert(
      prediction.optionAnswer === undefined,
      `${where} optionAnswer needs options`,
    );
}

/** Runs one of the `define…` checks of a shared data component and names the block in its error. */
function defined(define, input, where) {
  try {
    return define(input);
  } catch (error) {
    throw new Error(
      `${where}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Checks one `prediction` block: one of the kinds the shared ChapterPrediction
 * runs. Returns the excerpt ids the prediction shows with its result.
 */
export function validatePrediction(prediction, where) {
  assert(isObject(prediction), `${where} must be an object`);
  const kind = prediction.kind ?? "choice";
  text(kind, `${where} kind`);
  text(prediction.question, `${where} question`);
  text(prediction.explanation, `${where} explanation`);
  optionalText(prediction.source, `${where} source`);
  optionalText(prediction.context, `${where} context`);
  if (kind === "choice") {
    const { options, answer } = prediction;
    assert(
      Array.isArray(options) && options.length >= 2,
      `${where} needs at least two options`,
    );
    assert(
      Number.isInteger(answer) && answer >= 0 && answer < options.length,
      `${where} answer is out of range`,
    );
    assert(
      prediction.alsoCorrect === undefined ||
        (Array.isArray(prediction.alsoCorrect) &&
          prediction.alsoCorrect.every(
            (i) => Number.isInteger(i) && i >= 0 && i < options.length,
          )),
      `${where} alsoCorrect must list option indices`,
    );
  } else if (kind === "atoms" || kind === "bonds") {
    molecule(prediction.molecule, `${where} molecule`);
    indices(prediction.answer, `${where} answer`);
    assert(
      prediction.answer.length > 0,
      `${where} answer must list the right ${kind}`,
    );
    within(prediction.answer, prediction.molecule[kind], `${where} answer`);
    labels(prediction.labels, where);
    // How many picks the reader submits and how they are graded: by default
    // one pick that must be in `answer`; with a range, `exact` wants the set
    // of answers and `subset` accepts any picks that all lie in `answer`.
    const min = prediction.minSelections ?? 1;
    const max = prediction.maxSelections ?? min;
    assert(
      Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min,
      `${where} minSelections / maxSelections must be integers with 1 <= min <= max`,
    );
    assert(
      prediction.match === undefined ||
        prediction.match === "exact" ||
        prediction.match === "subset",
      `${where} match must be "exact" or "subset"`,
    );
  } else if (kind === "atom-set") {
    // Several atoms per molecule; the reader's set must match each one.
    assert(
      Array.isArray(prediction.molecules) && prediction.molecules.length > 0,
      `${where} needs molecules with their answer sets`,
    );
    prediction.molecules.forEach((item, index) => {
      const at = `${where} molecule ${index + 1}`;
      molecule(item, at);
      indices(item.answer, `${at} answer`);
      assert(item.answer.length > 0, `${at} answer must list atoms`);
      within(item.answer, item.atoms, `${at} answer`);
    });
    labels(prediction.labels, where);
    assert(
      prediction.gradeAtoms === undefined ||
        typeof prediction.gradeAtoms === "boolean",
      `${where} gradeAtoms must be a boolean`,
    );
    choiceWithStructure(prediction, where);
  } else if (kind === "design") {
    // Atoms and a choice in one submission: every group of atoms must be
    // represented and no stray atom picked; the choice must match `answer`.
    molecule(prediction.molecule, `${where} molecule`);
    assert(
      Array.isArray(prediction.groups) &&
        prediction.groups.length > 0 &&
        prediction.groups.every(
          (group) =>
            Array.isArray(group) &&
            group.length > 0 &&
            group.every((i) => Number.isInteger(i) && i >= 0),
        ),
      `${where} groups must be non-empty lists of atom indices`,
    );
    within(
      prediction.groups.flat(),
      prediction.molecule.atoms,
      `${where} groups`,
    );
    assert(
      Array.isArray(prediction.options) && prediction.options.length >= 2,
      `${where} needs at least two options`,
    );
    assert(
      Number.isInteger(prediction.answer) &&
        prediction.answer >= 0 &&
        prediction.answer < prediction.options.length,
      `${where} answer is out of range`,
    );
    optionalText(prediction.atomExplanation, `${where} atomExplanation`);
    labels(prediction.labels, where);
  } else if (kind === "ranking") {
    // The reader ranks every option; only the first place is graded.
    assert(
      Array.isArray(prediction.options) && prediction.options.length >= 2,
      `${where} needs at least two options`,
    );
    assert(
      Number.isInteger(prediction.answer) &&
        prediction.answer >= 0 &&
        prediction.answer < prediction.options.length,
      `${where} answer is out of range`,
    );
  } else if (kind === "image-points") {
    // One point picked on a picture, optionally with a choice.
    const { image, points: pts, answer } = prediction;
    assert(isObject(image), `${where} image must be { src, alt }`);
    text(image.src, `${where} image src`);
    text(image.alt, `${where} image alt`);
    assert(
      Array.isArray(pts) && pts.length >= 2,
      `${where} needs at least two points`,
    );
    const ids = new Set();
    pts.forEach((point, i) => {
      const at = `${where} point ${i + 1}`;
      assert(isObject(point), `${at} must be an object`);
      text(point.id, `${at} id`);
      text(point.label, `${at} label`);
      assert(!ids.has(point.id), `${at} repeats id ${point.id}`);
      ids.add(point.id);
      for (const axis of ["x", "y"])
        assert(
          Number.isFinite(point[axis]) &&
            point[axis] >= 0 &&
            point[axis] <= 100,
          `${at} ${axis} must be a percentage`,
        );
    });
    assert(
      Array.isArray(answer) &&
        answer.length > 0 &&
        answer.every((id) => ids.has(id)),
      `${where} answer must list point ids`,
    );
    choiceWithStructure(prediction, where);
  } else if (kind === "number") {
    // The reader types an estimate; `answer` ± `tolerance` grades it, and
    // `readout` hands the estimate to a lab model whose result shows with it.
    const { input, answer, tolerance, readout } = prediction;
    assert(isObject(input), `${where} input must describe the number field`);
    text(input.label, `${where} input label`);
    optionalText(input.unit, `${where} input unit`);
    for (const name of ["min", "max", "step"])
      assert(
        input[name] === undefined || Number.isFinite(input[name]),
        `${where} input ${name} must be a number`,
      );
    assert(
      answer === undefined || Number.isFinite(answer),
      `${where} answer must be a number`,
    );
    assert(
      tolerance === undefined || (answer !== undefined && tolerance >= 0),
      `${where} tolerance needs an answer and must not be negative`,
    );
    if (readout !== undefined) {
      assert(isObject(readout), `${where} readout must be { model, input }`);
      const model = labModels[readout.model];
      assert(
        model,
        `${where} readout model ${readout.model} is not in the catalogue`,
      );
      assert(
        defined(() => modelInputs(model), undefined, `${where} readout`).some(
          (item) => item.id === readout.input && item.kind === "number",
        ),
        `${where} readout input ${readout.input} is not a number input of ${readout.model}`,
      );
    }
  } else if (kind === "arrows") {
    // One curved arrow: the reader picks its source atom, then its target.
    molecule(prediction.molecule, `${where} molecule`);
    const { answer } = prediction;
    assert(
      isObject(answer) &&
        Number.isInteger(answer.from) &&
        Number.isInteger(answer.to) &&
        answer.from >= 0 &&
        answer.to >= 0 &&
        answer.from !== answer.to,
      `${where} answer must be { from, to } atom indices`,
    );
    labels(prediction.labels, where);
    choiceWithStructure(prediction, where);
  } else {
    throw new Error(`${where} kind ${kind} is not in the catalogue`);
  }
  if (kind !== "atom-set" && prediction.molecules !== undefined) {
    assert(
      Array.isArray(prediction.molecules),
      `${where} molecules must be an array`,
    );
    for (const item of prediction.molecules)
      molecule(item, `${where} molecules`);
  }
  optionalText(prediction.excerpt, `${where} excerpt`);
  assert(
    prediction.reset === undefined || typeof prediction.reset === "boolean",
    `${where} reset must be a boolean`,
  );
  if (prediction.evidence !== undefined) {
    assert(
      Array.isArray(prediction.evidence),
      `${where} evidence must be an array`,
    );
    prediction.evidence.forEach((id) => text(id, `${where} evidence`));
  }
  return [
    ...(prediction.excerpt === undefined ? [] : [prediction.excerpt]),
    ...(prediction.evidence ?? []),
  ];
}

/**
 * The predictions of a chapter with the ids their records are kept under: the
 * chapter id unless a block names its own. A `matrix` block is a prediction
 * too, answered once every required cell is; a `quiz` block with an id is
 * answered once every question is.
 */
export function chapterPredictions(chapter, data) {
  const found = [];
  for (const block of chapter.blocks) {
    if (!isObject(block)) continue;
    if (block.type === "prediction")
      found.push({ id: block.id ?? chapter.id, prediction: block });
    if (block.type === "quiz" && block.id !== undefined)
      found.push({
        id: block.id,
        prediction: {
          kind: "quiz",
          questions: block.questions,
          diagnostic: block.diagnostic === true,
        },
      });
    if (block.type === "matrix")
      found.push({
        id: block.id ?? chapter.id,
        prediction: {
          kind: "matrix",
          model: defineMatrix(resolveData(block.matrix, data, "matrix")),
        },
      });
  }
  return found;
}

/** The prose of a chapter's blocks, for the search index; `data` resolves scene frames kept there. */
export function blockSearchText(blocks, data) {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "callout":
        return [block.text];
      case "list":
        return block.items;
      case "table":
        return [
          block.caption,
          ...block.columns,
          ...resolveData(block.rows, data, "table rows")
            .flat()
            .map((cell) => (typeof cell === "string" ? cell : cell.text)),
        ];
      case "tabs":
        return block.items.flatMap((item) => [
          item.label,
          ...blockSearchText(item.blocks, data),
        ]);
      case "molecule":
        return [block.name];
      case "molecules":
        return resolveData(block.items, data, "molecules").map((m) => m.name);
      case "formula":
        return block.caption === undefined ? [] : [block.caption];
      case "figure":
        return [block.caption];
      case "scene":
        return resolveData(block.frames, data, "scene frames").flatMap(
          (frame) => [frame.title, frame.text],
        );
      case "lab":
        return [block.title, block.intro];
      case "data-table":
        return [block.title];
      case "spectrum":
        return [block.caption];
      case "matrix":
        return [block.heading, block.caption];
      case "timeline":
        return [
          ...(block.caption ? [block.caption] : []),
          ...timelineText(
            defineTimeline(resolveData(block.timeline, data, "timeline")),
          ),
        ];
      case "flow":
        return [
          ...(block.caption ? [block.caption] : []),
          ...flowText(defineFlow(resolveData(block.flow, data, "flow"))),
        ];
      default:
        return [];
    }
  });
}

/** Resolves a field that may name an entry of the topic's `data` instead of holding the value. */
export function resolveData(value, data, where) {
  if (typeof value !== "string") return value;
  assert(
    isObject(data) && value in data,
    `${where} refers to unknown data ${value}`,
  );
  return data[value];
}

/** Allowed fields for each block type; shared identity fields apply to every block. */
const blockFields = {
  "source-pages": ["source"],
  "synthesis-network": ["network"],
  "record-collection": ["collection"],
  claims: ["set"],
  "sar-cases": ["cases", "collection"],
  heading: "text level".split(" "),
  paragraph: "text".split(" "),
  callout: "text tone link".split(" "),
  list: "items ordered".split(" "),
  formula: "tex caption".split(" "),
  molecule:
    "name smiles atoms bonds highlightAtoms highlightBonds labels caption IUPACName anchorAtoms canonical checked cid source stereo".split(
      " ",
    ),
  properties: "name smiles atoms bonds".split(" "),
  "molecule-compare": "items left right highlightLabel".split(" "),
  molecules: "items caption".split(" "),
  substituents: "site variants".split(" "),
  route: "routes".split(" "),
  mechanism: "title frames".split(" "),
  table: "caption columns rows note rowHeader".split(" "),
  spectrum: "molecule peaks caption assignAfter".split(" "),
  "data-table":
    "table title label noun idLabel missing defaultX defaultY".split(" "),
  "structure-lab": "set ids".split(" "),
  excerpt: "excerpt".split(" "),
  figure: "src alt caption".split(" "),
  chart: "points xLabel yLabel xDomain yDomain caption".split(" "),
  timeline: "timeline caption".split(" "),
  flow: "flow caption".split(" "),
  "path-picker": "title".split(" "),
  "diagnostic-summary": "title".split(" "),
  scene: "label title frames".split(" "),
  problem: "lang label source task prompt parts answer evidence".split(" "),
  prediction:
    "kind question source context explanation molecules excerpt reset options answer alsoCorrect optionExplanations molecule labels minSelections maxSelections match optionAnswer gradeAtoms groups atomExplanation image points input tolerance readout activity chapter data evidence inputExcerpt mode quizId refs result sourceContext title".split(
      " ",
    ),
  matrix:
    "matrix question label caption rowHeader heading instruction quoteLang".split(
      " ",
    ),
  lab: "model label title intro defaults data reveal presets reset".split(" "),
  tabs: "label items default".split(" "),
  quiz: "questions diagnostic".split(" "),
  reading: "scope title".split(" "),
};

const tones = ["note", "caution", "evidence"];

/**
 * Checks a chapter's blocks against the catalogue and returns what the rest
 * of the content check needs: the excerpt ids and quiz ids the blocks refer
 * to. `data` is the topic's `data`; `predictionIds` collects the ids every
 * prediction's records are kept under, across the topic.
 */
export function validateBlocks(
  chapter,
  data,
  where,
  found,
  external = new Set(),
) {
  const { blocks } = chapter;
  assert(Array.isArray(blocks), `${where} blocks must be an array`);
  // Spectrum assignments can depend on earlier predictions or external chapter records.
  const availablePredictions = new Set(external);
  const ids = new Set();
  const registerPrediction = (block, here) => {
    const id = block.id ?? chapter.id;
    assert(
      !found.predictionIds.has(id),
      `${here} repeats prediction id ${id}; give each prediction of a chapter its own id`,
    );
    found.predictionIds.add(id);
    availablePredictions.add(id);
  };
  blocks.forEach((block, index) => {
    const at = `${where} block ${index + 1}`;
    assert(isObject(block), `${at} must be an object`);
    text(block.type, `${at} type`);
    const here = `${at} (${block.type})`;
    assert(
      Object.hasOwn(blockFields, block.type),
      `${here} is not a block type`,
    );
    const allowed = new Set(["type", "id", ...blockFields[block.type]]);
    for (const key of Object.keys(block))
      assert(allowed.has(key), `${here} unknown field ${key}`);
    if (block.id !== undefined) {
      text(block.id, `${here} id`);
      assert(!ids.has(block.id), `${here} repeats id ${block.id}`);
      ids.add(block.id);
    }
    if (block.type === "prediction" && block.optionExplanations !== undefined) {
      assert(
        Array.isArray(block.options) &&
          Array.isArray(block.optionExplanations) &&
          block.optionExplanations.length === block.options.length,
        `${here} optionExplanations must match options`,
      );
      block.optionExplanations.forEach((value) =>
        text(value, `${here} option explanation`),
      );
    }
    const field = (name, check) =>
      check(
        resolveData(block[name], data, `${here} ${name}`),
        `${here} ${name}`,
      );
    switch (block.type) {
      case "synthesis-network":
      case "source-pages":
      case "record-collection":
      case "claims":
      case "sar-cases":
        for (const name of blockFields[block.type])
          text(block[name], `${here} ${name}`);
        break;
      case "heading":
        text(block.text, `${here} text`);
        assert(
          block.level === undefined || block.level === 2 || block.level === 3,
          `${here} level must be 2 or 3`,
        );
        break;
      case "paragraph":
        text(block.text, `${here} text`);
        break;
      case "callout":
        text(block.text, `${here} text`);
        assert(
          block.tone === undefined || tones.includes(block.tone),
          `${here} tone must be one of ${tones.join(", ")}`,
        );
        if (block.link !== undefined) {
          assert(isObject(block.link), `${here} link must be { to, text }`);
          text(block.link.to, `${here} link to`);
          text(block.link.text, `${here} link text`);
        }
        break;
      case "list":
        assert(
          Array.isArray(block.items) &&
            block.items.length > 0 &&
            block.items.every((item) => typeof item === "string" && item),
          `${here} items must be a list of text`,
        );
        break;
      case "formula":
        text(block.tex, `${here} tex`);
        optionalText(block.caption, `${here} caption`);
        break;
      case "molecule":
        molecule(block, here);
        optionalIndices(block.highlightAtoms, `${here} highlightAtoms`);
        optionalIndices(block.highlightBonds, `${here} highlightBonds`);
        labels(block.labels, here);
        optionalText(block.caption, `${here} caption`);
        break;
      case "molecule-compare":
        field("items", (items, w) => {
          assert(
            Array.isArray(items) && items.length >= 2,
            `${w} needs at least two molecules`,
          );
          items.forEach((item, i) => {
            molecule(item, `${w} item ${i + 1}`);
            optionalIndices(
              item.highlightAtoms,
              `${w} item ${i + 1} highlightAtoms`,
            );
            optionalText(item.caption, `${w} item ${i + 1} caption`);
          });
          for (const side of ["left", "right"])
            assert(
              block[side] === undefined ||
                items.some((item) => item.name === block[side]),
              `${here} ${side} must name one of the items`,
            );
        });
        optionalText(block.highlightLabel, `${here} highlightLabel`);
        break;
      case "molecules":
        field("items", (items, w) => {
          assert(
            Array.isArray(items) && items.length > 0,
            `${w} needs at least one molecule`,
          );
          for (const item of items) molecule(item, w);
        });
        optionalText(block.caption, `${here} caption`);
        break;
      case "properties":
        molecule(block, here);
        break;
      case "substituents":
        text(block.site, `${here} site`);
        field("variants", (variants, w) => {
          assert(
            Array.isArray(variants) && variants.length > 0,
            `${w} needs at least one variant`,
          );
          for (const item of variants) molecule(item, w);
        });
        break;
      case "route":
        field("routes", synthesisRoutes);
        break;
      case "mechanism":
        optionalText(block.title, `${here} title`);
        field("frames", mechanismFrames);
        break;
      case "table":
        text(block.caption, `${here} caption`);
        assert(
          Array.isArray(block.columns) &&
            block.columns.length > 0 &&
            block.columns.every((column) => typeof column === "string"),
          `${here} columns must be a list of text`,
        );
        field("rows", (rows, w) => tableRows(rows, block.columns, w));
        optionalText(block.note, `${here} note`);
        assert(
          block.rowHeader === undefined || typeof block.rowHeader === "boolean",
          `${here} rowHeader must be a boolean`,
        );
        break;
      case "spectrum":
        // Peaks of one molecule; the assignment and highlight wait for `assignAfter`.
        molecule(block.molecule, `${here} molecule`);
        optionalText(block.caption, `${here} caption`);
        field("peaks", (peaks, w) => {
          assert(
            Array.isArray(peaks) && peaks.length > 0,
            `${w} needs at least one peak`,
          );
          const seen = new Set();
          peaks.forEach((peak, i) => {
            const at = `${w} peak ${i + 1}`;
            assert(isObject(peak), `${at} must be an object`);
            text(peak.id, `${at} id`);
            assert(!seen.has(peak.id), `${at} repeats id ${peak.id}`);
            seen.add(peak.id);
            assert(Number.isFinite(peak.ppm), `${at} ppm must be a number`);
            assert(
              Number.isInteger(peak.hydrogens) && peak.hydrogens > 0,
              `${at} hydrogens must be a positive integer`,
            );
            text(peak.multiplicity, `${at} multiplicity`);
            optionalText(peak.j, `${at} j`);
            indices(peak.atoms, `${at} atoms`);
            text(peak.assignment, `${at} assignment`);
          });
        });
        if (block.assignAfter !== undefined)
          assert(
            Array.isArray(block.assignAfter) &&
              block.assignAfter.length > 0 &&
              block.assignAfter.every((id) => availablePredictions.has(id)),
            `${here} assignAfter must list predictions earlier in the chapter`,
          );
        break;
      case "data-table":
        text(block.title, `${here} title`);
        text(block.label, `${here} label`);
        for (const name of [
          "noun",
          "idLabel",
          "missing",
          "defaultX",
          "defaultY",
        ])
          optionalText(block[name], `${here} ${name}`);
        field("table", (table, w) => defined(defineDataTable, table, w));
        break;
      case "structure-lab":
        field("set", (set, w) => {
          const defined_ = defined(defineStructureSet, set, w);
          if (block.ids !== undefined) {
            assert(
              Array.isArray(block.ids) && block.ids.length > 0,
              `${here} ids must list entries`,
            );
            for (const id of block.ids) defined_.entryById(id);
          }
        });
        break;
      case "excerpt":
        text(block.excerpt, `${here} excerpt`);
        found.excerpts.push([block.excerpt, here]);
        break;
      case "figure":
        text(block.src, `${here} src`);
        text(block.alt, `${here} alt`);
        text(block.caption, `${here} caption`);
        break;
      case "timeline":
        field("timeline", (value, w) => defined(defineTimeline, value, w));
        optionalText(block.caption, `${here} caption`);
        break;
      case "flow":
        field("flow", (value, w) => defined(defineFlow, value, w));
        optionalText(block.caption, `${here} caption`);
        break;
      case "chart":
        field("points", points);
        text(block.xLabel, `${here} xLabel`);
        text(block.yLabel, `${here} yLabel`);
        optionalText(block.caption, `${here} caption`);
        for (const name of ["xDomain", "yDomain"])
          assert(
            block[name] === undefined ||
              (Array.isArray(block[name]) &&
                block[name].length === 2 &&
                block[name].every(Number.isFinite) &&
                block[name][0] < block[name][1]),
            `${here} ${name} must be [min, max]`,
          );
        break;
      case "diagnostic-summary":
        optionalText(block.title, `${here} title`);
        break;
      case "path-picker":
        optionalText(block.title, `${here} title`);
        found.pathPicker = true;
        break;
      case "tabs": {
        // Each item holds static blocks only; what they refer to is checked too.
        text(block.label, `${here} label`);
        assert(
          Array.isArray(block.items) && block.items.length >= 2,
          `${here} needs at least two items`,
        );
        const itemIds = new Set();
        block.items.forEach((item, i) => {
          const at = `${here} item ${i + 1}`;
          assert(isObject(item), `${at} must be an object`);
          text(item.id, `${at} id`);
          assert(!itemIds.has(item.id), `${at} repeats id ${item.id}`);
          itemIds.add(item.id);
          text(item.label, `${at} label`);
          const inner = validateStaticBlocks(
            item.blocks,
            data,
            at,
            availablePredictions,
          );
          found.excerpts.push(...inner.excerpts);
          found.quiz.push(...inner.quiz);
        });
        assert(
          block.default === undefined || itemIds.has(block.default),
          `${here} default must reference an item id`,
        );
        break;
      }
      case "scene":
        text(block.label, `${here} label`);
        optionalText(block.title, `${here} title`);
        field("frames", (frames, w) => {
          assert(
            Array.isArray(frames) && frames.length > 0,
            `${w} needs at least one frame`,
          );
          frames.forEach((frame, i) => {
            assert(isObject(frame), `${w} frame ${i + 1} must be an object`);
            text(frame.title, `${w} frame ${i + 1} title`);
            text(frame.text, `${w} frame ${i + 1} text`);
            if (frame.image !== undefined) {
              assert(
                isObject(frame.image),
                `${w} frame ${i + 1} image must be { src, alt }`,
              );
              text(frame.image.src, `${w} frame ${i + 1} image src`);
              text(frame.image.alt, `${w} frame ${i + 1} image alt`);
            }
          });
        });
        break;
      case "problem": {
        text(block.id, `${here} id`);
        assert(
          ["en", "zh"].includes(block.lang),
          `${here} lang must be en or zh`,
        );
        const paragraphs = (value, name) => {
          if (Array.isArray(value)) {
            assert(value.length > 0, `${here} ${name} must not be empty`);
            value.forEach((part) => text(part, `${here} ${name}`));
          } else text(value, `${here} ${name}`);
        };
        assert(
          block.prompt !== undefined || block.parts !== undefined,
          `${here} needs prompt or parts`,
        );
        if (block.prompt !== undefined) paragraphs(block.prompt, "prompt");
        for (const name of ["label", "source", "task"])
          optionalText(block[name], `${here} ${name}`);
        if (block.parts !== undefined) {
          assert(
            Array.isArray(block.parts) && block.parts.length > 0,
            `${here} parts must be nonempty`,
          );
          block.parts.forEach((part) => text(part, `${here} part`));
        }
        assert(isObject(block.answer), `${here} answer must be an object`);
        for (const key of Object.keys(block.answer))
          assert(
            ["text", "origin", "basis"].includes(key),
            `${here} answer unknown field ${key}`,
          );
        paragraphs(block.answer.text, "answer.text");
        assert(
          ["book", "ai"].includes(block.answer.origin),
          `${here} answer.origin must be book or ai`,
        );
        text(block.answer.basis, `${here} answer.basis`);
        if (block.evidence !== undefined) {
          assert(
            Array.isArray(block.evidence),
            `${here} evidence must be an array`,
          );
          block.evidence.forEach((id) => {
            text(id, `${here} evidence`);
            found.excerpts.push([id, here]);
          });
        }
        registerPrediction(block, here);
        break;
      }
      case "prediction": {
        for (const id of validatePrediction(block, here))
          found.excerpts.push([id, here]);
        registerPrediction(block, here);
        break;
      }
      case "matrix": {
        for (const name of ["question", "label", "caption", "rowHeader"])
          text(block[name], `${here} ${name}`);
        for (const name of ["heading", "instruction", "quoteLang"])
          optionalText(block[name], `${here} ${name}`);
        field("matrix", (matrix, w) => defined(defineMatrix, matrix, w));
        registerPrediction(block, here);
        break;
      }
      case "lab": {
        text(block.label, `${here} label`);
        optionalText(block.title, `${here} title`);
        optionalText(block.intro, `${here} intro`);
        const modelData = resolveData(block.data, data, `${here} data`);
        assert(
          block.reset === undefined || typeof block.reset === "boolean",
          `${here} reset must be a boolean`,
        );
        if (block.reveal !== undefined) {
          assert(isObject(block.reveal), `${here} reveal must be { label }`);
          text(block.reveal.label, `${here} reveal label`);
        }
        const model = labModels[block.model];
        assert(model, `${here} model ${block.model} is not in the catalogue`);
        const inputs = defined(
          () => modelInputs(model, modelData),
          undefined,
          here,
        );
        const inRange = (values, what) => {
          assert(isObject(values), `${here} ${what} must be an object`);
          for (const [id, value] of Object.entries(values)) {
            const input = inputs.find((item) => item.id === id);
            assert(input, `${here} ${what} names unknown input ${id}`);
            assert(
              input.kind === "select"
                ? input.options.some((option) => option.value === value)
                : typeof value === "number" &&
                    value >= input.min &&
                    value <= input.max,
              `${here} ${what} value for ${id} is outside the input's range`,
            );
          }
        };
        if (block.defaults !== undefined) inRange(block.defaults, "defaults");
        if (block.presets !== undefined) {
          assert(
            Array.isArray(block.presets) && block.presets.length > 0,
            `${here} presets must be a list`,
          );
          block.presets.forEach((preset, i) => {
            assert(
              isObject(preset),
              `${here} preset ${i + 1} must be an object`,
            );
            text(preset.label, `${here} preset ${i + 1} label`);
            inRange(preset.values, `preset ${i + 1} values`);
          });
        }
        break;
      }
      case "quiz":
        assert(
          Array.isArray(block.questions) &&
            block.questions.length > 0 &&
            block.questions.every((id) => typeof id === "string"),
          `${here} questions must list quiz ids`,
        );
        assert(
          block.diagnostic === undefined ||
            typeof block.diagnostic === "boolean",
          `${here} diagnostic must be a boolean`,
        );
        // A quiz block with an id is recorded as answered once every
        // question has an answer.
        if (block.id !== undefined) registerPrediction(block, here);
        for (const id of block.questions) found.quiz.push([id, here]);
        break;
      case "reading":
        assert(
          block.scope === "topic" || block.scope === "chapter",
          `${here} scope must be "topic" or "chapter"`,
        );
        optionalText(block.title, `${here} title`);
        break;
      default:
        throw new Error(`${here} is not a block type`);
    }
  });
}

const staticOnly = new Set([
  "problem",
  "prediction",
  "matrix",
  "quiz",
  "reading",
]);

/** Checks the blocks of a page that has no predictions of its own (the sources page intro); spectrum assignments may reference `predictionIds`. */
export function validateStaticBlocks(blocks, data, where, predictionIds) {
  const found = {
    excerpts: [],
    quiz: [],
    predictionIds: new Set(),
    pathPicker: false,
  };
  validateBlocks({ id: where, blocks }, data, where, found, predictionIds);
  for (const block of blocks)
    assert(
      !staticOnly.has(block.type),
      `${where} cannot hold a ${block.type} block`,
    );
  return found;
}
