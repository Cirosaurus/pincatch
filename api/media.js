/**
 * GET /api/media?url=...&name=...&inline=1
 * Proxy unduh media dari CDN Pinterest.
 */

"use strict";

const { fetchWithUA, ALLOWED_HOST_RE, sanitizeName, rateLimited, clientIp, FETCH_TIMEOUT } = require("../lib/core");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Gunakan GET" });
    return;
  }

  if (rateLimited(clientIp(req))) {
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

  // Batas waktu per-jeda: video besar boleh lama asal data terus mengalir.
  // Abort saja tidak cukup — body yang macet harus dihancurkan langsung.
  let stall;
  let nodeStream = null;
  const stop = () => {
    clearTimeout(stall);
    nodeStream?.destroy();
    res.destroy();
  };
  const kick = () => {
    clearTimeout(stall);
    stall = setTimeout(stop, FETCH_TIMEOUT);
  };
  kick();

  const ctrl = new AbortController();
  const upstream = await fetchWithUA(u.toString(), {
    redirect: "follow",
    signal: ctrl.signal,
    headers,
  }).catch(() => null);

  if (!upstream || (!upstream.ok && upstream.status !== 206)) {
    clearTimeout(stall);
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
    clearTimeout(stall);
    res.end();
    return;
  }

  // alirkan body upstream langsung ke response
  const { Readable } = require("stream");
  nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on("error", () => res.destroy());
  nodeStream.on("end", () => clearTimeout(stall));
  res.on("close", () => {
    clearTimeout(stall);
    nodeStream.destroy();
    upstream.body?.cancel?.().catch(() => {});
  });
  nodeStream.pipe(res);
  nodeStream.on("data", kick); // setelah pipe, supaya tidak ada data yang terlewat
};
