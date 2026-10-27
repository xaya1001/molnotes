import type { Unchecked } from "./unchecked.ts";
import type { PatentBlock } from "../src/ui/topic/blocks.ts";
import { validateResearchData } from "./patent-research.ts";
// Structural and referential validation shared by publishing and the browser.
const object = (v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const ok = (test: unknown, at: string) => {
  if (!test) throw new Error(at);
};
const text = (v: unknown, at: string) =>
  ok(typeof v === "string" && v.trim(), `${at}: expected text`);
const key = (v: unknown) =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]+$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const id = (v: Unchecked) => (Number.isSafeInteger(v) && v > 0) || key(v);
const list = (v: Unchecked, at: string): Unchecked[] => {
  ok(Array.isArray(v), `${at}: expected array`);
  return v;
};
const entries = (v: Unchecked, at: string): [string, Unchecked][] => {
  ok(object(v), `${at}: expected object`);
  return Object.entries<Unchecked>(v);
};
const unique = (v: unknown[], at: string) =>
  ok(new Set(v.map(String)).size === v.length, `${at}: duplicate id`);
const asset = (v: Unchecked, at?: string) =>
  ok(
    typeof v === "string" &&
      /^\/sites\/[a-z0-9-]+\/static\/[\w/{}.\-]+$/.test(v) &&
      !v.includes(".."),
    `${at}: expected static resource path`,
  );
export function patentBlocks(input: unknown): PatentBlock[] {
  const content: Unchecked = input;
  const walk = (blocks: Unchecked[] | undefined): Unchecked[] =>
    (blocks ?? []).flatMap((block) => [
      block,
      ...(block.type === "tabs"
        ? block.items.flatMap((item: Unchecked) => walk(item.blocks))
        : []),
    ]);
  return (content.chapters ?? [])
    .flatMap((c: Unchecked) => walk(c.blocks))
    .filter((b: Unchecked) =>
      [
        "source-pages",
        "record-collection",
        "claims",
        "sar-cases",
        "synthesis-network",
      ].includes(b.type),
    );
}
export function validatePatentData(input: unknown, where: string): void {
  const content: Unchecked = input;
  const blocks = patentBlocks(content);
  if (!blocks.length) return;
  const data = content.data ?? {};
  const sources = data.sources ?? {},
    collections = data.collections ?? {},
    sets = data.claims ?? {},
    cases = data.sarCases ?? {};
  for (const [kind, value] of Object.entries<Unchecked>({
    sources,
    collections,
    claims: sets,
    sarCases: cases,
    synthesis: data.synthesis ?? {},
  })) {
    for (const [name] of entries(value, `${where} data.${kind}`))
      ok(key(name), `${where}: invalid ${kind} key`);
  }
  for (const b of blocks) {
    const [map, name] =
      b.type === "source-pages"
        ? [sources, b.source]
        : b.type === "record-collection"
          ? [collections, b.collection]
          : b.type === "claims"
            ? [sets, b.set]
            : b.type === "synthesis-network"
              ? [data.synthesis ?? {}, b.network]
              : [cases, b.cases];
    ok(Object.hasOwn(map, name), `${where}: unknown ${b.type} ${name}`);
    if (b.type === "sar-cases")
      ok(
        Object.hasOwn(collections, b.collection),
        `${where}: unknown collection ${b.collection}`,
      );
  }
  const defaultSource = blocks.find((b) => b.type === "source-pages")?.source;
  const ref = (v: Unchecked, source?: string, at?: string) => {
    ok(object(v), `${at}: expected page reference`);
    const src = sources[v.source ?? source ?? defaultSource];
    ok(
      src && Number.isInteger(v.page) && v.page >= 1 && v.page <= src.pages,
      `${at}: unknown source or page outside pages`,
    );
    if (v.end !== undefined)
      ok(
        Number.isInteger(v.end) && v.end >= v.page && v.end <= src.pages,
        `${at}: invalid end page`,
      );
    if (v.rect !== undefined)
      ok(
        Array.isArray(v.rect) &&
          v.rect.length === 4 &&
          v.rect.every(Number.isFinite) &&
          v.rect[0] >= 0 &&
          v.rect[1] >= 0 &&
          v.rect[2] >= v.rect[0] &&
          v.rect[3] >= v.rect[1] &&
          v.rect[2] <= src.size[0] &&
          v.rect[3] <= src.size[1],
        `${at}: invalid rectangle`,
      );
    if (v.asset !== undefined) asset(v.asset, at);
  };
  for (const [name, s] of entries(sources, where)) {
    text(s.title, name);
    ok(
      Array.isArray(s.size) &&
        s.size.length === 2 &&
        s.size.every((n: Unchecked) => Number.isFinite(n) && n > 0),
      `${name}: size must contain positive width and height in PDF points`,
    );
    ok(Number.isInteger(s.pages) && s.pages > 0, `${name}: invalid pages`);
    asset(s.image, name);
    ok(s.image.includes("{page}"), `${name}: image needs {page}`);
    asset(s.text, name);
    for (const [p, n] of entries(s.paragraphs, name))
      ok(
        /^\d+$/.test(p) && Number.isInteger(n) && n >= 1 && n <= s.pages,
        `${name}: invalid paragraph page`,
      );
  }
  const claimIds = Object.values<Unchecked>(sets).flatMap((s) =>
    list(s.claims, where).map((c) => c.id),
  );
  unique(claimIds, `${where}: claims`);
  const targetIds = (name: Unchecked) =>
    name === "claims"
      ? claimIds
      : collections[name]?.records.map((r: Unchecked) => r.id);
  const refs = (values: Unchecked, name: Unchecked, at: Unchecked) => {
    const ids = targetIds(name);
    ok(
      ids && list(values, at).every((v) => ids.includes(v)),
      `${at}: unknown reference in ${name}`,
    );
  };
  const routes = [];
  for (const [name, c] of entries(collections, where)) {
    text(c.title, name);
    ok(
      typeof c.route === "string" &&
        /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(c.route),
      `${name}: invalid route`,
    );
    routes.push(c.route);
    list(c.fields, name);
    unique(
      c.fields.map((f: Unchecked) => f.key),
      name,
    );
    entries(c.scales ?? {}, name);
    for (const [k, s] of Object.entries<Unchecked>(c.scales ?? {})) {
      text(s.blank, k);
      text(s.dash, k);
      list(s.bins, k);
      unique(
        s.bins.map((b: Unchecked) => b.value),
        k,
      );
      for (const b of s.bins) {
        text(b.value, k);
        text(b.label, k);
        ok(
          ![
            "",
            "--",
            "missing",
            "reported",
            "blank",
            "dash",
            "unlisted",
          ].includes(b.value),
          `${k}: reserved grade`,
        );
      }
    }
    if (c.pins !== undefined)
      ok(
        object(c.pins) && Number.isInteger(c.pins.max) && c.pins.max > 0,
        `${name}: invalid pins.max`,
      );
    if (c.export !== undefined)
      ok(typeof c.export === "boolean", `${name}: invalid export`);
    for (const f of c.fields) {
      ok(
        key(f.key) && !["id", "source", "refs", "notes"].includes(f.key),
        `${name}: invalid field key`,
      );
      text(f.label, name);
      ok(
        [
          "text",
          "number",
          "grade",
          "tags",
          "smiles",
          "ref",
          "link",
          "body",
          "measurement",
          "assignments",
        ].includes(f.kind),
        `${name}: invalid field kind`,
      );
      if (f.kind === "grade") ok(c.scales?.[f.scale], `${name}: unknown scale`);
      if (f.ref) ref(f.ref, undefined, name);
      for (const flag of ["filter", "sort"])
        if (f[flag] !== undefined)
          ok(typeof f[flag] === "boolean", `${name}: invalid ${flag}`);
    }
    list(c.records, name);
    unique(
      c.records.map((r: Unchecked) => r.id),
      name,
    );
    for (const r of c.records) {
      const at = `${where}: ${name}/${r.id}`;
      ok(id(r.id), `${at}: invalid id`);
      ok(Object.hasOwn(sources, r.source), `${at}: unknown source`);
      for (const f of c.fields) {
        const v = r[f.key];
        if (v === undefined) continue;
        if (["text", "smiles", "link"].includes(f.kind))
          ok(typeof v === "string", `${at}.${f.key}: expected string`);
        if (f.kind === "link")
          ok(
            v.startsWith("/") && !v.startsWith("//"),
            `${at}: expected internal link`,
          );
        if (f.kind === "number")
          ok(Number.isFinite(v), `${at}: expected number`);
        if (f.kind === "tags")
          ok(
            Array.isArray(v) && v.every((t) => typeof t === "string"),
            `${at}: expected tags`,
          );
        if (f.kind === "grade")
          ok(
            v === "" ||
              v === "--" ||
              c.scales[f.scale].bins.some((b: Unchecked) => b.value === v),
            `${at}: unknown grade`,
          );
        if (f.kind === "ref") ref(v, r.source, at);
        if (f.kind === "body") {
          ok(object(v), `${at}: expected body`);
          asset(v.url, at);
          text(v.key, at);
        }
      }
      for (const [target, values] of entries(r.refs ?? {}, at))
        refs(values, target, at);
      for (const n of list(r.notes ?? [], at)) {
        text(n.text, at);
        if (n.field)
          ok(
            c.fields.some((f: Unchecked) => f.key === n.field),
            `${at}: unknown note field`,
          );
        if (n.ref) ref(n.ref, r.source, at);
      }
    }
  }
  validateResearchData(data, ref, where);
  unique(routes, where);
  for (const [name, set] of entries(sets, where)) {
    ok(Object.hasOwn(sources, set.source), `${name}: unknown source`);
    for (const c of set.claims) {
      const at = `${where}: claim ${c.id}`;
      ok(Number.isSafeInteger(c.id) && c.id > 0, `${at}: invalid id`);
      for (const k of ["title", "group", "text"]) text(c[k], at);
      refs(c.refs, "claims", at);
      refs(c.children, "claims", at);
      refs(c.examples, "examples", at);
      for (const segment of list(c.segments, at)) {
        ref(segment, set.source, at);
        asset(segment.asset, at);
      }
      if (c.scope) {
        text(c.scope.smarts, at);
        text(c.scope.note, at);
      }
    }
  }
  const allCases = [];
  for (const b of blocks.filter((b) => b.type === "sar-cases"))
    for (const c of list(cases[b.cases], where)) {
      allCases.push(c.id);
      ok(key(c.id), `${where}: invalid case id`);
      for (const k of ["title", "area", "change", "finding", "limit"])
        text(c[k], where);
      refs(c.ids, b.collection, where);
      refs(c.claims, "claims", where);
    }
  unique(allCases, `${where}: SAR cases`);
}
/** Concrete routes also used by publication's internal-link checker. */
export function patentRoutePaths(input: unknown): string[] {
  const content: Unchecked = input;
  const data = content.data ?? {},
    paths = new Set<string>();
  for (const b of patentBlocks(content)) {
    if (b.type === "source-pages") {
      paths.add("/search");
      for (
        let n = 1;
        n <=
        Math.max(...Object.values<Unchecked>(data.sources).map((s) => s.pages));
        n++
      )
        paths.add(`/sources/pages/${n}`);
    }
    if (b.type === "record-collection") {
      const c = data.collections[b.collection];
      paths.add(`/${c.route}`);
      paths.add(`/${c.route}/compare`);
      for (const r of c.records) paths.add(`/${c.route}/${r.id}`);
    }
    if (b.type === "synthesis-network") paths.add(`/synthesis/${b.network}`);
    if (b.type === "claims") {
      paths.add("/claims");
      paths.add("/claims/compare");
      for (const c of data.claims[b.set].claims) paths.add(`/claims/${c.id}`);
    }
    if (b.type === "sar-cases") {
      paths.add("/sar");
      for (const c of data.sarCases[b.cases]) paths.add(`/sar/${c.id}`);
    }
  }
  return [...paths];
}
