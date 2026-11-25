import type {
  Conformation,
  Diagnostic,
  Library,
  LibraryEntry,
  Participant,
  Scene,
} from "../shared/chemical-library/types.ts";

const textTokenPattern =
  /\\.|\^\{[^}]*\}|\^(?:\w+(?:,\w+)*|[+\-–−‡])|_\{[^}]*\}|_\w|([CNOSP])([1-9]\d*)/gu;

const homonuclearFormulas = new Set(["O2", "O3", "S8", "P4"]);
const homonuclearLocantCue = /^(?:\s*位|[–—=/](?=[CNOSP]))/u;
const chargeSuffix = /^[+−\-⁺⁻^]/u;
const nitrogenGasPrefix = /[-–−+]\s*$/u;
const nitrogenLocantAfter =
  /^(?:\s*(?:位|路径|进攻|取代|芳基化|甲基化|烷基化|质子化|成键|孤对|负电荷|正电荷)|[–—=/:：]|-(?=[A-Za-z\p{Script=Han}]))/u;
const nitrogenLocantBefore =
  /(?:N\\?[13]|C\\?[1-9]\d*)\s*[、，,与和及/–—-]\s*$/u;

/** Find unescaped atom locants (such as C2, C2/C4, N1) that chemicalTextRuns would subscript. */
export function unescapedLocants(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    const content = part.startsWith("**")
      ? part.slice(2, -2)
      : part.startsWith("*")
        ? part.slice(1, -1)
        : part;
    for (const match of content.matchAll(textTokenPattern)) {
      const element = match[1];
      const digits = match[2];
      if (!element || !digits) continue;
      const start = match.index;
      const end = start + element.length + digits.length;
      const before = start > 0 ? content[start - 1] : "";
      const after = end < content.length ? content[end] : "";
      if (/[A-Za-z0-9\\^_]/.test(before) || /[A-Za-z0-9(]/.test(after))
        continue;
      const token = element + digits;
      const prev = content.slice(0, start);
      const next = content.slice(end);
      if (element === "C" && /^\s*对称/u.test(next)) continue;
      if (homonuclearFormulas.has(token) && !homonuclearLocantCue.test(next))
        continue;
      if ((token === "N2" || token === "N3") && chargeSuffix.test(next))
        continue;
      if (
        token === "N2" &&
        (nitrogenGasPrefix.test(prev) ||
          (!nitrogenLocantAfter.test(next) && !nitrogenLocantBefore.test(prev)))
      )
        continue;
      if (!seen.has(token)) {
        seen.add(token);
        found.push(token);
      }
    }
  }
  return found;
}

function escapeLocantExample(token: string) {
  return `${token[0]}\\${token.slice(1)}`;
}

function conformationSlotText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "t" in value) {
    const text = (value as { t?: unknown }).t;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function checkConformationText(
  entry: Conformation,
  visit: (field: string, text?: string) => void,
) {
  for (const [key, value] of Object.entries(entry.atoms ?? {}))
    visit(`atoms.${key}`, conformationSlotText(value));
  for (const [key, value] of Object.entries(entry.subs ?? {}))
    visit(`subs.${key}`, conformationSlotText(value));
  for (const [i, value] of (entry.front ?? []).entries())
    visit(`front[${i}]`, conformationSlotText(value));
  for (const [i, value] of (entry.back ?? []).entries())
    visit(`back[${i}]`, conformationSlotText(value));
  visit("top", conformationSlotText(entry.top));
  visit("bottom", conformationSlotText(entry.bottom));
  for (const [i, row] of (entry.rows ?? []).entries()) {
    for (const [j, value] of row.entries())
      visit(`rows[${i}][${j}]`, conformationSlotText(value));
  }
}

function checkSceneText(
  prefix: string,
  scene: Scene | undefined,
  visit: (field: string, text?: string) => void,
) {
  if (!scene) return;
  for (const arrow of scene.reactionArrows ?? []) {
    for (const [i, line] of (arrow.above ?? []).entries())
      visit(`${prefix}.arrow(${arrow.id}).above[${i}]`, line);
    for (const [i, line] of (arrow.below ?? []).entries())
      visit(`${prefix}.arrow(${arrow.id}).below[${i}]`, line);
  }
  for (const [i, caption] of (scene.captions ?? []).entries())
    visit(`${prefix}.captions[${i}]`, caption.text);
  for (const label of scene.labels ?? [])
    if (label.kind === "text")
      visit(`${prefix}.label(${label.id})`, label.text);
}

function checkParticipants(
  prefix: string,
  participants: Participant[],
  visit: (field: string, text?: string) => void,
) {
  for (const participant of participants) {
    visit(`${prefix}participant(${participant.id}).number`, participant.number);
    visit(`${prefix}participant(${participant.id}).yield`, participant.yield);
    visit(`${prefix}participant(${participant.id}).ratio`, participant.ratio);
  }
}

function entryLocantDiagnostics(
  entry: LibraryEntry,
  entries: Library,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visit = (field: string, text?: string) => {
    if (!text) return;
    const locants = unescapedLocants(text);
    if (!locants.length) return;
    const examples = locants.slice(0, 2).map(escapeLocantExample).join(", ");
    diagnostics.push({
      code: "UNESCAPED_LOCANT",
      severity: "error",
      object: entry.id,
      field,
      elements: locants,
      message: `Unescaped locant ${locants.join(", ")} in ${field} renders as subscript; escape the first digit with a backslash (e.g. ${examples}) per chemical-figures skill`,
    });
  };
  visit("footnote", entry.footnote);
  if (entry.kind === "reaction") {
    for (const [i, line] of entry.reagents.entries())
      visit(`reagents[${i}]`, line);
    for (const [i, line] of entry.conditions.entries())
      visit(`conditions[${i}]`, line);
    checkParticipants("", [...entry.reactants, ...entry.products], visit);
    checkSceneText("scene", entry.scene, visit);
  } else if (entry.kind === "route") {
    for (const step of entry.steps) {
      for (const [i, line] of (step.reagents ?? []).entries())
        visit(`step(${step.id}).reagents[${i}]`, line);
      for (const [i, line] of (step.conditions ?? []).entries())
        visit(`step(${step.id}).conditions[${i}]`, line);
      const reaction = entries[step.reaction];
      if (reaction?.kind === "reaction") {
        checkParticipants(
          `step(${step.id}).`,
          [...reaction.reactants, ...reaction.products],
          visit,
        );
        checkSceneText(`step(${step.id}).scene`, reaction.scene, visit);
      }
    }
  } else if (entry.kind === "mechanism") {
    for (const frame of entry.frames) {
      visit(`frame(${frame.id}).title`, frame.title);
      for (const [i, line] of (frame.above ?? []).entries())
        visit(`frame(${frame.id}).above[${i}]`, line);
      for (const [i, line] of (frame.below ?? []).entries())
        visit(`frame(${frame.id}).below[${i}]`, line);
      checkSceneText(`frame(${frame.id}).scene`, frame.scene, visit);
    }
  } else if (entry.kind === "conformation") {
    checkConformationText(entry, visit);
  }
  return diagnostics;
}

/** Report unescaped atom locants in figure text fields formatted by chemicalTextRuns. */
export function figureLocantDiagnostics(entries: Library): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of Object.values(entries)) {
    if (
      entry.kind === "reaction" &&
      entry.owner &&
      entries[entry.owner]?.kind === "route"
    )
      continue;
    diagnostics.push(...entryLocantDiagnostics(entry, entries));
  }
  return diagnostics;
}
