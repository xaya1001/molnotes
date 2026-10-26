import { inject, provide, type InjectionKey } from "vue";

/** A rendered PDF page published with a citation; `size` is in PDF points. */
export interface CitedPage {
  page: number;
  label?: string;
  size: [number, number];
  image: string;
}
interface CitedSourceBase {
  title: string;
  kind: string;
  author?: string;
  edition?: string;
}
/** Cited PDF pages, with one page either side when the file has them. */
export interface PdfCitation extends CitedSourceBase {
  type: "pdf";
  first: number;
  last: number;
  print?: string;
  /** PDF points on the first cited page. */
  rect?: number[];
  pages: CitedPage[];
}
/** An archived web page; `body` is the JSON resource holding its cleaned article HTML. */
export interface WebCitation extends CitedSourceBase {
  type: "web";
  url: string;
  downloaded: string;
  body: string;
}
/** An epub navigation entry; `body` is the JSON resource holding its cleaned HTML, `section` the cited entry inside it. */
export interface EpubCitation extends CitedSourceBase {
  type: "epub";
  chapter: string;
  section?: { key: string; title: string };
  body: string;
}
/** Publication resolves every citation href of a note or topic to one of these. */
export type Citation = PdfCitation | WebCitation | EpubCitation;

const range = (first: string | number, last: string | number) =>
  first === last ? `${first}` : `${first}–${last}`;

/** Where the citation points, for example "PDF 第 97–98 页（印刷页 97–98）"; an archived page by its title, an epub by its section or chapter. */
export function citationLabel(citation: Citation) {
  if (citation.type === "web") return citation.title;
  if (citation.type === "epub")
    return citation.section?.title ?? citation.chapter;
  const label = (page: number) =>
    citation.pages.find((item) => item.page === page)?.label;
  const first = label(citation.first),
    last = label(citation.last);
  const printed = first
    ? `（印刷页 ${last ? range(first, last) : first}）`
    : "";
  return `PDF 第 ${range(citation.first, citation.last)} 页${printed}`;
}

export interface CitationContext {
  citations: Readonly<Record<string, Citation>>;
  open(href: string): void;
}
const key: InjectionKey<CitationContext> = Symbol("citations");

/** The page's resolved citations and the viewer that opens them. */
export function provideCitations(context: CitationContext) {
  provide(key, context);
}

export function useCitations() {
  return inject(key, null);
}
