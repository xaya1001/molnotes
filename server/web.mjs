import { send, encoded, json, sendEncoded, body } from "./http-response.mjs";
import { contentCache } from "./content-cache.mjs";
import { createServer, request as httpRequest } from "node:http";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import {
  openDatabase,
  migrate,
  databaseUrl,
  databaseError,
} from "./database.mjs";
import { assetStore, cachedAsset, contentType, byteRange } from "./assets.mjs";
import {
  contentIndex,
  reviewIndex,
  contentCatalog,
  readTopic,
  notebookIndex,
  glossaryIndex,
  readNote,
} from "./content-query.mjs";
import {
  recordContext,
  readRecord,
  writeRecord,
  allRecords,
  parseRecord,
} from "./records.mjs";
import { isMainModule } from "./main-module.mjs";

export function createWebServer({
  pool,
  store,
  dist = resolve("dist"),
  cache = process.env.MOLNOTES_ASSET_CACHE || "/tmp/molnotes-assets",
  socket = process.env.MOLNOTES_SYSTEM_SOCKET,
}) {
  const content = contentCache(pool);
  const files = new Map();
  return createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (path.startsWith("/system/api/")) {
        if (!socket) {
          send(res, 503, { error: "系统服务暂时无法访问" });
          return;
        }
        const upstream = httpRequest(
          {
            socketPath: socket,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
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
        await pool.query("SELECT 1");
        send(res, 200, { status: "ok" });
        return;
      }
      const topicMatch = /^\/api\/topics\/([a-z0-9-]+)$/.exec(path);
      if (req.method === "GET" && topicMatch) {
        const topic = await content(path, async (client) => {
          const value = await readTopic(client, topicMatch[1]);
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
        const builders = {
          "/api/catalog": contentCatalog,
          "/api/index": contentIndex,
          "/api/review": reviewIndex,
          "/api/notes": notebookIndex,
          "/api/glossary": glossaryIndex,
        };
        const entry = await content(path, async (client) =>
          json(await builders[path](client)),
        );
        sendEncoded(req, res, entry);
        return;
      }
      const noteMatch = /^\/api\/notes\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(
        path,
      );
      if (req.method === "GET" && noteMatch) {
        const note = await content(path, async (client) => {
          const value = await readNote(client, noteMatch[1], noteMatch[2]);
          return value && json(value);
        });
        if (note) sendEncoded(req, res, note);
        else send(res, 404, { error: "页面不存在" });
        return;
      }
      if (path === "/api/records" && req.method === "GET") {
        send(res, 200, await allRecords(pool));
        return;
      }
      const recordMatch = /^\/api\/records\/(notes|topics\/([a-z0-9-]+))$/.exec(
        path,
      );
      if (recordMatch && ["GET", "PUT"].includes(req.method)) {
        const context = await recordContext(pool, recordMatch[2]);
        if (!context) {
          send(res, 404, { error: "页面不存在" });
          return;
        }
        const { scope } = context;
        if (req.method === "GET") {
          const { document, revision } = await readRecord(pool, context);
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
          send(res, 400, { error: error.message });
          return;
        }
        const revision = await writeRecord(
          pool,
          scope,
          document,
          expected.slice(1, -1),
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
        if (!["GET", "HEAD"].includes(req.method)) {
          res.setHeader("Allow", "GET, HEAD");
          send(res, 405, { error: "不支持的请求方法" });
          return;
        }
        const asset = (
          await pool.query(
            "SELECT * FROM assets WHERE scope=$1 AND path=$2",
            assetMatch.slice(1),
          )
        ).rows[0];
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
        const size = Number(asset.size);
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
        const file = await cachedAsset(store, cache, asset);
        if (res.destroyed) return;
        res.writeHead(range ? 206 : 200, responseHeaders);
        await pipeline(createReadStream(file, range ?? {}), res);
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
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
          const topic = (
            await pool.query(
              "SELECT site->>'group' AS topic_group FROM topics WHERE slug=$1",
              [slug],
            )
          ).rows[0];
          if (
            !topic ||
            section !== (topic.topic_group === "练习" ? "practice" : "sites")
          ) {
            send(res, 404, { error: "页面不存在" });
            return;
          }
          file = resolve(dist, "topic/index.html");
        } else if (/^\/(notes|showcase)(?:\/|$)/.test(path))
          file = resolve(dist, path.split("/")[1], "index.html");
        else file = resolve(file, "index.html");
      }
      let entry = files.get(file);
      if (!entry) {
        entry = (async () => {
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
        files.set(file, entry);
      }
      try {
        entry = await entry;
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
  const url = databaseUrl();
  const pool = openDatabase(url);
  try {
    await migrate(pool);
    const server = createWebServer({ pool, store: await assetStore() });
    server.listen(
      Number(process.env.PORT || 8080),
      process.env.HOST || "0.0.0.0",
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () =>
        server.close(async () => {
          await pool.end();
          process.exit(0);
        }),
      );
  } catch (error) {
    console.error(databaseError(error, url).message);
    await pool.end();
    process.exitCode = 1;
  }
}
