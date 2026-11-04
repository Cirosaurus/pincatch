/**
 * GET /api/health -> cek hidup
 */

"use strict";

const { MAX_BATCH } = require("../lib/core");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, service: "pincatch", maxBatch: MAX_BATCH, ts: new Date().toISOString() });
};
