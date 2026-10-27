/**
 * Parsed JSON that a content validator walks field by field. Every read is
 * checked at runtime before the value is used, so the walk is typed loosely
 * rather than narrowing each nested access.
 */
export type Unchecked = any;
