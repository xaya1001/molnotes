import { isObject, type RecordFields } from "../../contracts/records.ts";
import { patentData, type PatentRecords } from "./patent.ts";
export function patentRecordFields(content: {
  data?: Record<string, unknown>;
}): RecordFields<PatentRecords> {
  const collections = patentData(content).collections ?? {};
  const notes = new Set(
    Object.entries(collections).flatMap(([key, collection]) =>
      collection.records.map((record) => `${key}/${record.id}`),
    ),
  );
  return {
    pins: {
      empty: () => ({}),
      parse(value) {
        if (value === undefined) return {};
        if (!isObject(value)) throw new Error("比较记录格式错误");
        const result: PatentRecords["pins"] = {};
        for (const [key, ids] of Object.entries(value)) {
          const collection = Object.hasOwn(collections, key)
            ? collections[key]
            : undefined;
          if (
            !collection?.pins ||
            !Array.isArray(ids) ||
            ids.length > collection.pins.max ||
            new Set(ids).size !== ids.length ||
            !ids.every((id) =>
              collection.records.some((record) => record.id === id),
            )
          )
            throw new Error("比较编号或数量无效");
          result[key] = [...ids];
        }
        return result;
      },
    },
    recordNotes: {
      empty: () => ({}),
      parse(value) {
        if (value === undefined) return {};
        if (!isObject(value)) throw new Error("记录笔记格式错误");
        const result: PatentRecords["recordNotes"] = {};
        for (const [key, note] of Object.entries(value)) {
          if (
            !notes.has(key) ||
            typeof note !== "string" ||
            note.length > 30000
          )
            throw new Error("记录笔记编号或长度无效");
          result[key] = note;
        }
        return result;
      },
    },
  };
}
