import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";

export function send(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
const compressors = {
  br: (bytes) =>
    promisify(brotliCompress)(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    }),
  gzip: promisify(gzip),
};
// A response body with its validator and compressed variants, built once and served many times.
export async function encoded(bytes, headers) {
  const entry = {
    bytes,
    headers: {
      ...headers,
      ETag: `W/"${createHash("sha256").update(bytes).digest("base64url")}"`,
      Vary: "Accept-Encoding",
    },
  };
  if (
    bytes.length >= 1024 &&
    /^(text\/|application\/json|image\/svg)/.test(headers["Content-Type"])
  )
    for (const [name, compress] of Object.entries(compressors))
      entry[name] = await compress(bytes);
  return entry;
}
export const json = (value) =>
  encoded(Buffer.from(JSON.stringify(value)), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
export function sendEncoded(req, res, entry) {
  if (req.headers["if-none-match"] === entry.headers.ETag) {
    res.writeHead(304, entry.headers);
    res.end();
    return;
  }
  const accepted = req.headers["accept-encoding"] ?? "";
  const encoding = Object.keys(compressors).find(
    (name) => entry[name] && new RegExp(`\\b${name}\\b`).test(accepted),
  );
  res.writeHead(
    200,
    encoding
      ? { ...entry.headers, "Content-Encoding": encoding }
      : entry.headers,
  );
  res.end(req.method === "HEAD" ? undefined : (entry[encoding] ?? entry.bytes));
}
export async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("记录超过 2 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
