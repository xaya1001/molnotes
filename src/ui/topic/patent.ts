import type { FigureReference } from "../../../shared/chemical-library/types.ts";
import type {
  PageRef,
  PageSource,
  PatentData,
  GradeScale,
  RecordId,
} from "../../../shared/patent-contract.ts";
export interface PatentRecords {
  pins: Record<string, RecordId[]>;
  recordNotes: Record<string, string>;
}
export function patentData(content: {
  data?: Record<string, unknown>;
}): PatentData {
  // The caller receives content only after validateTopicContent.
  return content.data ?? {};
}
export function sourceLink(ref: PageRef, source?: string) {
  return {
    path: `/sources/pages/${ref.page}`,
    query: { source: ref.source ?? source, rect: ref.rect?.join(",") },
  };
}
export function gradeText(value: unknown, scale: GradeScale) {
  if (value === undefined) return "未列";
  if (value === "") return scale.blank;
  if (value === "--") return scale.dash;
  return `${value} · ${scale.bins.find((bin) => bin.value === value)?.label ?? ""}`;
}

export function pageImage(
  source: PageSource,
  page: number,
): string | FigureReference {
  return (
    source.images?.[page - 1] ?? source.image!.replace("{page}", String(page))
  );
}
