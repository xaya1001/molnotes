export function mergeRecords<T>(base: T, local: T, remote: T): T;
export function recordSync<T>(
  endpoint: string,
  validate?: (document: T) => void,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): {
  load(): Promise<T>;
  stage(document: T): void;
  readonly pending: boolean;
  readonly conflicted: boolean;
  save(local: T, resolve?: boolean, current?: () => T): Promise<T>;
};
