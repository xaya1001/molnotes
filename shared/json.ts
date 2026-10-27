// Type guards for walking parsed JSON. Each narrows to exactly what its check
// proves, so a validator reads the fields it has checked with their types.

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

export function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}
