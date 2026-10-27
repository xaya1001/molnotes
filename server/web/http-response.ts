import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { brotliCompress, gzip, constants } from "node:zlib";
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";

/** A response body with its validator and compressed variants. */
export interface Encoded {
  bytes: Buffer;
  headers: OutgoingHttpHeaders & { ETag: string };
  br?: Buffer;
  gzip?: Buffer;
}

export function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
const compressors: Record<"br" | "gzip", (bytes: Buffer) => Promise<Buffer>> = {
  br: (bytes) =>
    promisify(brotliCompress)(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    }),
  gzip: promisify(gzip),
};
// A response body with its validator and compressed variants, built once and served many times.
export async function encoded(
  bytes: Buffer,
  headers: OutgoingHttpHeaders & { "Content-Type": string },
): Promise<Encoded> {
  const entry: Encoded = {
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
    for (const name of ["br", "gzip"] as const)
      entry[name] = await compressors[name](bytes);
  return entry;
}
export const json = (value: unknown) =>
  encoded(Buffer.from(JSON.stringify(value)), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
export function sendEncoded(
  req: IncomingMessage,
  res: ServerResponse,
  entry: Encoded,
) {
  if (req.headers["if-none-match"] === entry.headers.ETag) {
    res.writeHead(304, entry.headers);
    res.end();
    return;
  }
  const accepted = req.headers["accept-encoding"] ?? "";
  const encoding = (["br", "gzip"] as const).find(
    (name) => entry[name] && new RegExp(`\\b${name}\\b`).test(accepted),
  );
  res.writeHead(
    200,
    encoding
      ? { ...entry.headers, "Content-Encoding": encoding }
      : entry.headers,
  );
  res.end(
    req.method === "HEAD"
      ? undefined
      : ((encoding && entry[encoding]) ?? entry.bytes),
  );
}
export async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("记录超过 2 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
