import { createHash } from "node:crypto";
import { extname } from "node:path";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const types = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdb": "chemical/x-pdb",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".css": "text/css",
  ".js": "text/javascript",
  ".html": "text/html",
  ".woff2": "font/woff2",
};
export const contentType = (path) =>
  types[extname(path).toLowerCase()] ?? "application/octet-stream";
/** Invalid or multiple ranges are ignored; a valid but empty selection is unsatisfiable. */
export function byteRange(header, size) {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return undefined;
  let start, end;
  if (!match[1]) {
    const count = Number(match[2]);
    start = Math.max(0, size - count);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? null : { start, end };
}
