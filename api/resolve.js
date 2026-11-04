/**
 * POST /api/resolve
 * Body: { url } atau { urls: [...] }
 * -> metadata pin (gambar/gif/video)
 */

"use strict";

const { MAX_BATCH, resolvePin, rateLimited, clientIp } = require("../lib/core");

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body terlalu besar"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Gunakan POST" });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.status(429).json({ error: "Terlalu banyak permintaan, tunggu sebentar." });
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    res.status(400).json({ error: "Body bukan JSON valid" });
    return;
  }

  const urls = Array.isArray(body.urls) ? body.urls : [body.url];
  const clean = urls.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, MAX_BATCH);
  if (!clean.length) {
    res.status(400).json({ error: "Tidak ada URL" });
    return;
  }

  const results = await Promise.all(
    clean.map(async (raw) => {
      try {
        const pin = await resolvePin(raw);
        return { ok: true, input: raw, ...pin };
      } catch (e) {
        return { ok: false, input: raw, error: e.message || "Gagal memproses" };
      }
    })
  );

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ results });
};
