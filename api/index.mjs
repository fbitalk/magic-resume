// Vercel Serverless 适配层：把 TanStack Start 的 fetch 入口包成 (req,res) handler
import serverEntry from "../dist/server/server.js";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MOVED_HOSTS = new Set(["introduce.hqstar.cn"]);
let movedCache = null;

function movedHtml() {
  if (movedCache) return movedCache;
  const candidates = [join(here, "../public/moved.html"), join(process.cwd(), "public/moved.html")];
  for (const p of candidates) {
    try { movedCache = readFileSync(p, "utf8"); return movedCache; } catch {}
  }
  movedCache = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>站点已迁移</title></head><body><h1>本站已迁移</h1></body></html>";
  return movedCache;
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders || {})) {
    if (typeof value === "undefined") continue;
    if (Array.isArray(value)) { for (const item of value) headers.append(key, item); }
    else { headers.set(key, String(value)); }
  }
  return headers;
}

function originalPath(req) {
  const h = req.headers["x-vercel-original-path"] || req.headers["x-original-url"] || req.headers["x-forwarded-uri"];
  let url = req.url || "/";
  if (url.startsWith("/api/index")) {
    url = url.slice("/api/index".length) || "/";
    if (!url.startsWith("/")) url = "/" + url;
  }
  if (typeof h === "string" && h.startsWith("/")) return h;
  return url;
}

export default async function handler(req, res) {
  try {
    const hostHeader = String(req.headers.host || "localhost");
    const hostname = hostHeader.split(":")[0].toLowerCase();
    const method = (req.method || "GET").toUpperCase();

    if (MOVED_HOSTS.has(hostname)) {
      const body = movedHtml();
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.end(method === "HEAD" ? undefined : body);
      return;
    }

    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const url = new URL(originalPath(req), proto + "://" + hostHeader);
    const init = { method, headers: toHeaders(req.headers) };
    if (method !== "GET" && method !== "HEAD") {
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
    if (method === "HEAD" || !response.body) { res.end(); return; }
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error("SSR handler error:", error);
    if (!res.headersSent) { res.statusCode = 500; res.setHeader("Content-Type", "text/plain; charset=utf-8"); }
    res.end("Internal Server Error");
  }
}
