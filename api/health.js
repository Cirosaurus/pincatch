/**
 * GET /api/health -> cek hidup
 */

"use strict";

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, service: "pincatch", ts: new Date().toISOString() });
};
