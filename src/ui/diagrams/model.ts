// Pure data layer of the timeline figure and the checks shared with the flow
// figure (flow.ts). Notes write the same shapes as YAML inside a ```timeline
// fence, topics as a block's `timeline` value; `defineTimeline` rejects a
// malformed declaration when content is published and returns the drawing
// model. Nothing here imports the UI.

/** "YYYY", "YYYY-MM" or "YYYY-MM-DD"; YAML may give a bare year as a number. */
export type DateInput = string | number;

/** The shape of an event's point; a legend explains what each one means. */
export type TimelineMark = "dot" | "diamond" | "square" | "ring";
const marks: TimelineMark[] = ["dot", "diamond", "square", "ring"];

export interface TimelineEventInput {
  date?: DateInput;
  /** An event the sources do not date, placed between two dates. */
  between?: [DateInput, DateInput];
  /** Date text shown instead of the formatted date; "" shows none. */
  show?: string;
  text: string;
  accent?: boolean;
  mark?: TimelineMark;
}
export interface TimelineSpanInput {
  from: DateInput;
  to: DateInput;
  text: string;
  accent?: boolean;
}
export interface TimelineLaneInput {
  label: string;
  events?: TimelineEventInput[];
  spans?: TimelineSpanInput[];
}
export interface TimelineInput {
  /**
   * A proportional axis from/to with a tick every `every` years, or `even`
   * spacing in order. `ticks` is "none", "month" or the years to mark.
   */
  axis?: {
    from?: DateInput;
    to?: DateInput;
    every?: number;
    even?: boolean;
    ticks?: "none" | "month" | number[];
  };
  lanes?: TimelineLaneInput[];
  events?: TimelineEventInput[];
  spans?: TimelineSpanInput[];
  /** A vertical line across every lane, with text above it and optionally below. */
  markers?: {
    date: DateInput;
    text?: string;
    below?: string;
    accent?: boolean;
  }[];
  /** A bracket under the axis. */
  brackets?: TimelineSpanInput[];
  /** One line under the figure: what each mark (or accented mark) stands for. */
  legend?: {
    mark?: TimelineMark | TimelineMark[];
    accent?: boolean;
    text: string;
  }[];
}

export interface TimelineEvent {
  /** Position on the axis in fractional years (or the order index when `even`). */
  at: number;
  /** Shown date text; empty for none. */
  show: string;
  text: string;
  accent: boolean;
  /** Dated only as lying between two dates. */
  undated: boolean;
  mark: TimelineMark;
}
export interface TimelineSpan {
  from: number;
  to: number;
  show: string;
  text: string;
  accent: boolean;
}
export interface TimelineLane {
  label: string;
  events: TimelineEvent[];
  spans: TimelineSpan[];
}
export interface TimelineMarker {
  at: number;
  show: string;
  text: string;
  below: string;
  accent: boolean;
}
export interface Timeline {
  from: number;
  to: number;
  /** Tick positions with their text; none when `even` or `ticks: none`. */
  ticks: { at: number; text: string }[];
  even: boolean;
  lanes: TimelineLane[];
  markers: TimelineMarker[];
  brackets: TimelineSpan[];
  legend: { marks: TimelineMark[]; accent: boolean; text: string }[];
}

const datePattern = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

export function fail(message: string): never {
  throw new Error(message);
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function only(value: unknown, keys: string[], where: string) {
  if (!isObject(value)) fail(`${where} must be an object`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${where} unknown field ${key}`);
  return value;
}
export function text(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${where} must be text`);
  return value;
}
export function flag(value: unknown, where: string): boolean {
  if (value !== undefined && typeof value !== "boolean")
    fail(`${where} must be true or false`);
  return value === true;
}
export function list(value: unknown, where: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${where} must be a list`);
  return value;
}
function mark(value: unknown, where: string): TimelineMark {
  if (value === undefined) return "dot";
  if (!marks.includes(value as TimelineMark))
    fail(`${where} must be one of ${marks.join(", ")}`);
  return value as TimelineMark;
}

/** Fractional years of the first day of a month (1-based). */
function monthAt(year: number, month: number) {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((month - 1) % 12) + 1;
  const start = Date.UTC(y, 0, 1);
  return y + (Date.UTC(y, m - 1, 1) - start) / (Date.UTC(y + 1, 0, 1) - start);
}

/**
 * A date as fractional years with its default display text, and the same
 * text without the year for an axis that stays within one year.
 */
export function parseDate(
  value: unknown,
  where: string,
): { at: number; show: string; short: string } {
  const raw = typeof value === "number" ? String(value) : value;
  const match = typeof raw === "string" ? datePattern.exec(raw) : null;
  if (!match) fail(`${where} must be a date YYYY, YYYY-MM or YYYY-MM-DD`);
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  if (match[2] && !(month >= 1 && month <= 12))
    fail(`${where} has no month ${match[2]}`);
  if (match[3]) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) fail(`${where} has no day ${raw}`);
  }
  const days = match[3]
    ? (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 864e5
    : match[2]
      ? (Date.UTC(year, month - 1, 1) - Date.UTC(year, 0, 1)) / 864e5
      : 0;
  const length = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
  const short = match[3]
    ? `${month} 月 ${day} 日`
    : match[2]
      ? `${month} 月`
      : String(year);
  return {
    at: year + days / length,
    show: match[2] ? `${year} 年 ${short}` : short,
    short,
  };
}

function shown(show: unknown, fallback: string, where: string) {
  if (show === undefined) return fallback;
  if (typeof show !== "string") fail(`${where} show must be text`);
  return show;
}

// Events whose date text is the default, with that text without the year.
const shortDates = new WeakMap<TimelineEvent, string>();

function event(value: unknown, where: string): TimelineEvent {
  const input = only(
    value,
    ["date", "between", "show", "text", "accent", "mark"],
    where,
  );
  const accent = flag(input.accent, `${where} accent`);
  const body = text(input.text, `${where} text`);
  const shape = mark(input.mark, `${where} mark`);
  if ((input.date === undefined) === (input.between === undefined))
    fail(`${where} needs either date or between`);
  if (input.date !== undefined) {
    const date = parseDate(input.date, `${where} date`);
    const result = {
      at: date.at,
      show: shown(input.show, date.show, where),
      text: body,
      accent,
      undated: false,
      mark: shape,
    };
    if (input.show === undefined) shortDates.set(result, date.short);
    return result;
  }
  if (!Array.isArray(input.between) || input.between.length !== 2)
    fail(`${where} between must list two dates`);
  const [a, b] = input.between.map((d, i) =>
    parseDate(d, `${where} between ${i + 1}`),
  );
  if (!(a.at < b.at)) fail(`${where} between must run forward in time`);
  return {
    at: (a.at + b.at) / 2,
    show: shown(input.show, "", where),
    text: body,
    accent,
    undated: true,
    mark: shape,
  };
}

function span(value: unknown, where: string): TimelineSpan {
  const input = only(value, ["from", "to", "text", "accent"], where);
  const from = parseDate(input.from, `${where} from`);
  const to = parseDate(input.to, `${where} to`);
  if (!(from.at < to.at)) fail(`${where} must run forward in time`);
  return {
    from: from.at,
    to: to.at,
    show: `${from.show}–${to.show}`,
    text: text(input.text, `${where} text`),
    accent: flag(input.accent, `${where} accent`),
  };
}

/** Tick spacing in years giving at most eight ticks. */
function tickStep(range: number) {
  return (
    [1, 2, 5, 10, 20, 25, 50, 100].find((step) => range / step <= 8) ?? 200
  );
}

/** A tick on the first of every month; January reads as its year. */
function monthTicks(from: number, to: number): Timeline["ticks"] {
  const ticks: Timeline["ticks"] = [];
  const year = Math.floor(from);
  for (let m = 1; monthAt(year, m) <= to + 1e-9; m++) {
    const at = monthAt(year, m);
    if (at < from - 1e-9) continue;
    const month = ((m - 1) % 12) + 1;
    ticks.push({
      at,
      text: month === 1 ? `${Math.floor(at + 1e-9)} 年` : `${month} 月`,
    });
  }
  return ticks;
}

export function defineTimeline(value: unknown): Timeline {
  const input = only(
    value,
    ["axis", "lanes", "events", "spans", "markers", "brackets", "legend"],
    "timeline",
  );
  const laneInputs: unknown[] =
    input.lanes === undefined ? [] : list(input.lanes, "timeline lanes");
  if (
    input.lanes !== undefined &&
    (input.events !== undefined || input.spans !== undefined)
  )
    fail("timeline puts events and spans either in lanes or at the top level");
  const lanes: TimelineLane[] = (
    laneInputs.length
      ? laneInputs
      : [{ label: "", events: input.events, spans: input.spans }]
  ).map((lane, i) => {
    const where = `timeline lane ${i + 1}`;
    const item = only(lane, ["label", "events", "spans"], where);
    return {
      label: laneInputs.length ? text(item.label, `${where} label`) : "",
      events: list(item.events, `${where} events`).map((e, j) =>
        event(e, `${where} event ${j + 1}`),
      ),
      spans: list(item.spans, `${where} spans`).map((s, j) =>
        span(s, `${where} span ${j + 1}`),
      ),
    };
  });
  if (input.lanes !== undefined && !laneInputs.length)
    fail("timeline lanes must not be empty");
  if (!lanes.some((lane) => lane.events.length))
    fail("timeline needs at least one event");
  const markers = list(input.markers, "timeline markers").map((m, i) => {
    const where = `timeline marker ${i + 1}`;
    const item = only(m, ["date", "text", "below", "accent"], where);
    const date = parseDate(item.date, `${where} date`);
    return {
      at: date.at,
      show: date.show,
      text: item.text === undefined ? "" : text(item.text, `${where} text`),
      below: item.below === undefined ? "" : text(item.below, `${where} below`),
      accent: flag(item.accent, `${where} accent`),
    };
  });
  const brackets = list(input.brackets, "timeline brackets").map((b, i) =>
    span(b, `timeline bracket ${i + 1}`),
  );
  const legend = list(input.legend, "timeline legend").map((l, i) => {
    const where = `timeline legend ${i + 1}`;
    const item = only(l, ["mark", "accent", "text"], where);
    const shapes = Array.isArray(item.mark) ? item.mark : [item.mark];
    if (!shapes.length) fail(`${where} mark must not be empty`);
    return {
      marks: shapes.map((s) => mark(s, `${where} mark`)),
      accent: flag(item.accent, `${where} accent`),
      text: text(item.text, `${where} text`),
    };
  });
  const axis =
    input.axis === undefined
      ? {}
      : only(
          input.axis,
          ["from", "to", "every", "even", "ticks"],
          "timeline axis",
        );
  const even = flag(axis.even, "timeline axis even");
  if (even) {
    if (
      axis.from !== undefined ||
      axis.to !== undefined ||
      axis.every !== undefined ||
      axis.ticks !== undefined
    )
      fail("timeline axis even takes no from, to, every or ticks");
    if (
      lanes.length > 1 ||
      lanes[0].spans.length ||
      markers.length ||
      brackets.length
    )
      fail("timeline axis even draws one lane of events only");
    const events = [...lanes[0].events].sort((a, b) => a.at - b.at);
    return {
      from: 0,
      to: Math.max(events.length - 1, 1),
      ticks: [],
      even,
      lanes: [{ ...lanes[0], events: events.map((e, i) => ({ ...e, at: i })) }],
      markers,
      brackets,
      legend,
    };
  }
  const positions = [
    ...lanes.flatMap((lane) => [
      ...lane.events.map((e) => e.at),
      ...lane.spans.flatMap((s) => [s.from, s.to]),
    ]),
    ...markers.map((m) => m.at),
    ...brackets.flatMap((b) => [b.from, b.to]),
  ];
  const [first, last] = [Math.min(...positions), Math.max(...positions)];
  // Dates within one year get an axis from the first month to the end of the last.
  const withinYear = Math.floor(first) === Math.floor(last) && first < last;
  const firstMonth = (at: number) => {
    let month = 12;
    while (monthAt(Math.floor(at), month) > at + 1e-9) month--;
    return month;
  };
  const from =
    axis.from !== undefined
      ? parseDate(axis.from, "timeline axis from").at
      : withinYear
        ? monthAt(Math.floor(first), firstMonth(first))
        : Math.floor(first);
  const to =
    axis.to !== undefined
      ? parseDate(axis.to, "timeline axis to").at
      : withinYear
        ? monthAt(Math.floor(last), firstMonth(last) + 1)
        : Math.max(Math.ceil(last), from + 1);
  if (!(from < to)) fail("timeline axis must run forward in time");
  for (const at of positions)
    if (at < from || at > to) fail("timeline has a date outside its axis");
  if (
    axis.every !== undefined &&
    !(
      typeof axis.every === "number" &&
      Number.isInteger(axis.every) &&
      axis.every > 0
    )
  )
    fail("timeline axis every must be a whole number of years");
  if (axis.every !== undefined && axis.ticks !== undefined)
    fail("timeline axis takes either every or ticks");
  let ticks: Timeline["ticks"] = [];
  if (Array.isArray(axis.ticks)) {
    for (const year of axis.ticks) {
      if (!(typeof year === "number" && Number.isInteger(year)))
        fail("timeline axis ticks must list whole years");
      if (year < from || year > to)
        fail(`timeline axis tick ${year} is outside the axis`);
      ticks.push({ at: year, text: String(year) });
    }
  } else if (
    axis.ticks === "month" ||
    (axis.ticks === undefined && axis.every === undefined && to - from < 1)
  ) {
    ticks = monthTicks(from, to);
  } else if (axis.ticks === undefined) {
    const step = (axis.every as number | undefined) ?? tickStep(to - from);
    for (let year = Math.ceil(from / step) * step; year <= to; year += step)
      ticks.push({ at: year, text: String(year) });
  } else if (axis.ticks !== "none")
    fail('timeline axis ticks must be "none", "month" or a list of years');
  // On a monthly axis within one calendar year the caption gives the year;
  // dates need only month and day.
  const monthly = ticks.some((t) => t.text.endsWith(" 月"));
  if (monthly && Math.floor(from) === Math.floor(to - 1e-9))
    for (const lane of lanes)
      lane.events = lane.events.map((e) =>
        shortDates.has(e) ? { ...e, show: shortDates.get(e)! } : e,
      );
  return { from, to, ticks, even, lanes, markers, brackets, legend };
}

/** The words a reader can search for in a timeline. */
export function timelineText(timeline: Timeline): string[] {
  return [
    ...timeline.lanes.flatMap((lane) => [
      lane.label,
      ...lane.events.flatMap((e) => [e.show, e.text]),
      ...lane.spans.map((s) => s.text),
    ]),
    ...timeline.markers.flatMap((m) => [m.text, m.below]),
    ...timeline.brackets.map((b) => b.text),
    ...timeline.legend.map((l) => l.text),
  ].filter(Boolean);
}

// Closing punctuation stays with the phrase before it, opening punctuation
// with the phrase after it, so a line never starts with "，" or ends with "（".
const closing = /[，。；：、！？）」』”’,.;:!?)\]]/;
const opening = /[（「『“‘(\[]/;

/**
 * A label's lines split into phrases that a figure keeps whole: Chinese has
 * no spaces and a dictionary splits drug names letter by letter, so lines
 * break only after punctuation, at a space beside a Latin word ("批准 Enovid")
 * or where the author wrote "\n"; a space after a number ("4 年", "90 nM")
 * holds, as does a "," or "." inside one ("88,000", "26.8%").
 */
export function phrases(text: string): string[][] {
  return text.split("\n").map((line) => {
    const parts: string[] = [];
    let current = "";
    const chars = [...line];
    chars.forEach((char, i) => {
      if (opening.test(char) && current.trim()) {
        parts.push(current);
        current = "";
      }
      current += char;
      // A number keeps its unit: "90 nM" holds.
      const latinBeside =
        char === " " &&
        !/\d/.test(chars[i - 1] ?? "") &&
        (/[A-Za-z]{2,}$/.test(chars.slice(0, i).join("")) ||
          /^[A-Za-z]{2,}/.test(chars.slice(i + 1).join("")));
      // "88,000" and "26.8%" are one number, not a clause end.
      const inNumber = /[,.]/.test(char) && /\d/.test(chars[i + 1] ?? "");
      if ((closing.test(char) && !inNumber) || latinBeside) {
        parts.push(current);
        current = "";
      }
    });
    if (current) parts.push(current);
    return parts;
  });
}
