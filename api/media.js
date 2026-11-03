/**
 * GET /api/media?url=...&name=...&inline=1
 * Proxy unduh media dari CDN Pinterest.
 */

"use strict";

const { fetchWithUA, ALLOWED_HOST_RE, sanitizeName, rateLimited } = require("../lib/core");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Gunakan GET" });
    return;
  }

  const ip = (
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "?"
  );

  if (rateLimited(ip)) {
    res.status(429).json({ error: "Terlalu banyak permintaan." });
    return;
  }

  const target = req.query.url;
  if (!target) {
    res.status(400).json({ error: "Parameter url wajib" });
    return;
  }

  let u;
  try {
    u = new URL(target);
  } catch {
    res.status(400).json({ error: "URL tidak valid" });
    return;
  }

  if (u.protocol !== "https:" || !ALLOWED_HOST_RE.test(u.hostname)) {
    res.status(400).json({ error: "Hanya media dari CDN Pinterest yang diizinkan" });
    return;
  }

  const inline = req.query.inline === "1";
  const headers = { Referer: "https://www.pinterest.com/" };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetchWithUA(u.toString(), {
    redirect: "follow",
    timeout: 60_000,
    headers,
  }).catch(() => null);

  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    res.status(502).json({ error: "Gagal mengambil media dari CDN Pinterest" });
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const name = sanitizeName(req.query.name, null, contentType);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`);

  for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  res.status(upstream.status);

  if (!upstream.body) {
    res.end();
    return;
  }

  // alirkan body upstream langsung ke response
  const { Readable } = require("stream");
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.pipe(res);
  nodeStream.on("error", () => {
    try { res.end(); } catch { /* ignore */ }
  });
};
