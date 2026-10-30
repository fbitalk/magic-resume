// Vercel Serverless 适配层
// 把 TanStack Start 的 build 产物（dist/server/server.js 的 fetch 入口）
// 包装成 Vercel Node Function 的 (req, res) handler。
import serverEntry from "../dist/server/server.js";
import { Readable } from "node:stream";

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (typeof value === "undefined") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

// 经过 rewrite 后 req.url 可能变成 /api/index，这里尽量还原原始路径
function originalPath(req) {
  const headerPath =
    req.headers["x-vercel-original-path"] ||
    req.headers["x-original-url"] ||
    req.headers["x-forwarded-uri"];
  let url = req.url || "/";
  if (url.startsWith("/api/index")) {
    url = url.slice("/api/index".length) || "/";
    if (!url.startsWith("/")) url = "/" + url;
  }
  if (typeof headerPath === "string" && headerPath.startsWith("/")) return headerPath;
  return url;
}

export default async function handler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const url = new URL(originalPath(req), proto + "://" + host);
    const method = (req.method || "GET").toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";

    const init = { method, headers: toHeaders(req.headers) };
    if (hasBody) {
      init.body = Readable.toWeb(req);
      init.duplex = "half";
    }

    const response = await serverEntry.fetch(new Request(url, init));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        const prev = res.getHeader("set-cookie");
        res.setHeader("set-cookie", prev ? [...(Array.isArray(prev) ? prev : [prev]), value] : value);
      } else {
        res.setHeader(key, value);
      }
    });

    if (method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error("SSR handler error:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
}
