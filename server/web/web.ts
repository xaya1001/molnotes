import {
  send,
  encoded,
  json,
  sendEncoded,
  body,
  type Encoded,
} from "./http-response.ts";
import { contentSnapshot } from "./content-cache.ts";
import { createServer, request as httpRequest } from "node:http";
import { pipeline } from "node:stream/promises";
import { open, readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { setting } from "../../shared/settings.ts";
import { contentType, byteRange } from "../../shared/assets.ts";
import {
  contentIndex,
  reviewIndex,
  contentCatalog,
  readTopic,
  notebookIndex,
  glossaryIndex,
  readNote,
} from "./content-query.ts";
import {
  openRecords,
  type RecordStore,
  recordContext,
  recordsReady,
  readRecord,
  writeRecord,
  allRecords,
  parseRecord,
} from "./records.ts";
import { isMainModule } from "../../shared/main-module.ts";

export function createWebServer({
  records,
  snapshot = process.env.MOLNOTES_CONTENT_SNAPSHOT || "/content/current",
  dist = resolve("dist"),
  socket = process.env.MOLNOTES_SYSTEM_SOCKET,
}: {
  records: RecordStore;
  snapshot?: string;
  dist?: string;
  socket?: string;
}) {
  const content = contentSnapshot(snapshot);
  const files = new Map<string, Promise<Encoded>>();
  return createServer(async (req, res) => {
    // The HTTP server sets both on every request it parses.
    const url = req.url!,
      method = req.method!;
    try {
      const path = decodeURIComponent(
        new URL(url, "http://localhost").pathname,
      );
      if (path.startsWith("/system/api/")) {
        if (!socket) {
          send(res, 503, { error: "系统服务暂时无法访问" });
          return;
        }
        const upstream = httpRequest(
          {
            socketPath: socket,
            path: url,
            method: req.method,
            headers: req.headers,
          },
          (response) => {
            res.writeHead(response.statusCode!, response.headers);
            response.pipe(res);
          },
        );
        upstream.on("error", () => {
          if (!res.headersSent)
            send(res, 503, { error: "系统服务暂时无法访问" });
          else res.destroy();
        });
        req.pipe(upstream);
        return;
      }
      if (path === "/healthz") {
        await content();
        recordsReady(records);
        send(res, 200, { status: "ok" });
        return;
      }
      const topicMatch = /^\/api\/topics\/([a-z0-9-]+)$/.exec(path);
      if (req.method === "GET" && topicMatch) {
        const snapshot = await content();
        const topic = await snapshot.cached(path, async () => {
          const value = readTopic(snapshot, topicMatch[1]);
          return value && json(value);
        });
        if (topic) sendEncoded(req, res, topic);
        else send(res, 404, { error: "页面不存在" });
        return;
      }
      if (
        req.method === "GET" &&
        [
          "/api/catalog",
          "/api/index",
          "/api/review",
          "/api/notes",
          "/api/glossary",
        ].includes(path)
      ) {
        const builders: Record<
          string,
          (snapshot: Awaited<ReturnType<typeof content>>) => unknown
        > = {
          "/api/catalog": contentCatalog,
          "/api/index": contentIndex,
          "/api/review": reviewIndex,
          "/api/notes": notebookIndex,
          "/api/glossary": glossaryIndex,
        };
        const snapshot = await content();
        const entry = await snapshot.cached(path, () =>
          json(builders[path](snapshot)),
        );
        sendEncoded(req, res, entry);
        return;
      }
      const noteMatch = /^\/api\/notes\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(
        path,
      );
      if (req.method === "GET" && noteMatch) {
        const snapshot = await content();
        const note = await snapshot.cached(path, async () => {
          const value = readNote(snapshot, noteMatch[1], noteMatch[2]);
          return value && json(value);
        });
        if (note) sendEncoded(req, res, note);
        else send(res, 404, { error: "页面不存在" });
        return;
      }
      if (path === "/api/records" && req.method === "GET") {
        send(res, 200, allRecords(records));
        return;
      }
      const recordMatch = /^\/api\/records\/(notes|topics\/([a-z0-9-]+))$/.exec(
        path,
      );
      if (recordMatch && ["GET", "PUT"].includes(method)) {
        const context = await recordContext(content, recordMatch[2]);
        if (!context) {
          send(res, 404, { error: "页面不存在" });
          return;
        }
        const { scope } = context;
        if (req.method === "GET") {
          const { document, revision } = readRecord(records, context);
          res.setHeader("ETag", `"${revision}"`);
          send(res, 200, document);
          return;
        }
        // A proxy may weaken the validator when it compresses the GET response.
        const expected = req.headers["if-match"]?.replace(/^W\//, "");
        if (!/^"(?:[a-f0-9]{32}|absent)"$/.test(expected ?? "")) {
          send(res, 428, { error: "请先读取记录后再保存" });
          return;
        }
        let document;
        try {
          const value = await body(req);
          document = parseRecord(context, value);
        } catch (error) {
          send(res, 400, { error: (error as Error).message });
          return;
        }
        const revision = writeRecord(
          records,
          scope,
          document,
          expected!.slice(1, -1),
        );
        if (revision === null) {
          send(res, 412, { error: "记录已在其他页面修改，请合并后重试" });
          return;
        }
        res.setHeader("ETag", `"${revision}"`);
        send(res, 200, document);
        return;
      }
      if (path.startsWith("/api/")) {
        send(res, 404, { error: "页面不存在" });
        return;
      }
      const assetMatch =
        /^\/(sites\/[^/]+|notes\/[^/]+)\/(static\/.+|assets\/.+|cited\/[a-f0-9]{64}\.[a-z]+)$/.exec(
          path,
        );
      if (assetMatch) {
        if (!["GET", "HEAD"].includes(method)) {
          res.setHeader("Allow", "GET, HEAD");
          send(res, 405, { error: "不支持的请求方法" });
          return;
        }
        const snapshot = await content();
        const asset = snapshot.asset(assetMatch[1], assetMatch[2]);
        if (!asset) {
          send(res, 404, { error: "资源不存在" });
          return;
        }
        const headers = {
          ETag: `"${asset.sha256}"`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
          "Content-Type": asset.content_type,
          "X-Content-Type-Options": "nosniff",
        };
        if (
          (req.headers["if-none-match"] ?? "")
            .split(",")
            .some(
              (value) =>
                value.trim().replace(/^W\//, "") === headers.ETag ||
                value.trim() === "*",
            )
        ) {
          res.writeHead(304, headers);
          res.end();
          return;
        }
        const { size } = asset;
        const range =
          req.method === "GET" &&
          (!req.headers["if-range"] || req.headers["if-range"] === headers.ETag)
            ? byteRange(req.headers.range, size)
            : undefined;
        if (range === null) {
          res.writeHead(416, {
            ...headers,
            "Content-Range": `bytes */${size}`,
            "Content-Length": 0,
          });
          res.end();
          return;
        }
        const length = range ? range.end - range.start + 1 : size;
        const responseHeaders = {
          ...headers,
          "Content-Length": length,
          ...(range
            ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
            : {}),
        };
        if (req.method === "HEAD") {
          res.writeHead(200, responseHeaders);
          res.end();
          return;
        }
        const handle = await open(snapshot.file(asset));
        res.writeHead(range ? 206 : 200, responseHeaders);
        await pipeline(handle.createReadStream(range ?? {}), res);
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        send(res, 405, { error: "不支持的请求方法" });
        return;
      }
      let file = resolve(dist, "." + path);
      if (!file.startsWith(resolve(dist) + sep) && file !== resolve(dist)) {
        send(res, 404, { error: "页面不存在" });
        return;
      }
      if (!extname(path)) {
        if (/^\/(sites|practice)\/[^/]+(?:\/|$)/.test(path)) {
          const [, section, slug] = path.split("/");
          const topic = (await content()).topic(slug!);
          if (
            !topic ||
            section !== (topic.site.group === "练习" ? "practice" : "sites")
          ) {
            send(res, 404, { error: "页面不存在" });
            return;
          }
          file = resolve(dist, "topic/index.html");
        } else if (/^\/(notes|showcase)(?:\/|$)/.test(path))
          file = resolve(dist, path.split("/")[1], "index.html");
        else file = resolve(file, "index.html");
      }
      let pending = files.get(file);
      if (!pending) {
        pending = (async () => {
          if (!(await stat(file)).isFile()) throw new Error();
          return encoded(await readFile(file), {
            "Content-Type":
              extname(file).toLowerCase() === ".wasm"
                ? "application/wasm"
                : contentType(file),
            "Cache-Control": file.startsWith(resolve(dist, "assets") + sep)
              ? "public, max-age=31536000, immutable"
              : "no-cache",
            "X-Content-Type-Options": "nosniff",
          });
        })();
        files.set(file, pending);
      }
      let entry;
      try {
        entry = await pending;
      } catch {
        files.delete(file);
        send(res, 404, { error: "页面不存在" });
        return;
      }
      sendEncoded(req, res, entry);
    } catch {
      if (!res.headersSent)
        send(res, 503, { error: "网站数据暂时无法读取，请重试" });
      else res.destroy();
    }
  });
}
if (isMainModule(import.meta.url)) {
  let records: RecordStore;
  try {
    records = openRecords(setting("MOLNOTES_RECORDS_FILE"));
  } catch (error) {
    console.error(`Record store: ${(error as Error).message}`);
    process.exit(1);
  }
  const server = createWebServer({ records });
  server.listen(
    Number(process.env.PORT || 8080),
    process.env.HOST || "0.0.0.0",
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      server.close(() => {
        records.close();
        process.exit(0);
      }),
    );
}
