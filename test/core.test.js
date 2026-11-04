/**
 * Tes untuk logika inti di lib/core.js — parsing link, nama file, dan
 * pemilihan media. Jalankan: node --test test/
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { pinIdFromUrl, sanitizeName, parsePinData, rateLimited, clientIp } = require("../lib/core.js");

test("pinIdFromUrl: format lama dan slug baru", () => {
  assert.equal(pinIdFromUrl("https://www.pinterest.com/pin/123456789/"), "123456789");
  assert.equal(pinIdFromUrl("https://id.pinterest.com/pin/judul-panjang--987654321/"), "987654321");
  assert.equal(pinIdFromUrl("pinterest.co.uk/pin/55555"), "55555");
});

test("pinIdFromUrl: bukan pin", () => {
  assert.equal(pinIdFromUrl("https://www.pinterest.com/"), null);
  assert.equal(pinIdFromUrl("https://example.com/pin/123456789/"), null);
  assert.equal(pinIdFromUrl(""), null);
});

test("sanitizeName: buang karakter berbahaya untuk header", () => {
  const name = sanitizeName('a/b\\c:d*e?f"g<h>i|j\r\nk', "jpg", "image/jpeg");
  assert.ok(!/[\r\n"\\/:*?<>|]/.test(name), `nama masih berbahaya: ${name}`);
  assert.match(name, /\.jpg$/);
});

test("sanitizeName: ekstensi dari content-type kalau nama tanpa ekstensi", () => {
  assert.equal(sanitizeName("foto", null, "image/png"), "foto.png");
  assert.equal(sanitizeName("", null, "video/mp4"), "pincatch.mp4");
});

test("sanitizeName: nama kosong total tetap punya nama", () => {
  assert.equal(sanitizeName("///", null, "application/octet-stream"), "pincatch.bin");
});

test("parsePinData: gambar tunggal", () => {
  const r = parsePinData({ id: "1", title: "Kucing", images: { orig: { url: "https://i.pinimg.com/a.jpg", width: 10, height: 20 } } });
  assert.equal(r.title, "Kucing");
  assert.equal(r.media.length, 1);
  assert.equal(r.media[0].type, "image");
  assert.equal(r.media[0].width, 10);
});

test("parsePinData: GIF dikenali", () => {
  const r = parsePinData({ id: "2", images: { orig: { url: "https://i.pinimg.com/a.gif" } } });
  assert.equal(r.media[0].type, "gif");
});

test("parsePinData: video dipilih yang paling lebar", () => {
  const r = parsePinData({
    id: "3",
    videos: { video_list: {
      a: { url: "https://v.pinimg.com/small.mp4", width: 320 },
      b: { url: "https://v.pinimg.com/big.mp4", width: 1080 },
      c: { url: "https://v.pinimg.com/hls.m3u8", width: 4000 },
    } },
  });
  assert.equal(r.media[0].type, "video");
  assert.equal(r.media[0].url, "https://v.pinimg.com/big.mp4");
});

test("parsePinData: carousel multi-gambar", () => {
  const r = parsePinData({
    id: "4",
    carousel_data: { carousel_slots: [
      { images: { orig: { url: "https://i.pinimg.com/1.jpg" } } },
      { images: { orig: { url: "https://i.pinimg.com/2.jpg" } } },
    ] },
  });
  assert.equal(r.media.length, 2);
});

test("parsePinData: tanpa media tidak melempar", () => {
  const r = parsePinData({ id: "5" });
  assert.deepEqual(r.media, []);
  assert.equal(r.title, "Pin 5");
});

test("parsePinData: tidak lagi mengirim field preview", () => {
  const r = parsePinData({ id: "6", images: { orig: { url: "https://i.pinimg.com/a.jpg" } } });
  assert.equal("preview" in r, false);
});

test("rateLimited: blokir setelah 40 permintaan", () => {
  const ip = "test-" + Math.random();
  for (let i = 0; i < 40; i++) assert.equal(rateLimited(ip), false, `ke-${i + 1}`);
  assert.equal(rateLimited(ip), true);
});

test("clientIp: X-Forwarded-For diabaikan tanpa TRUST_PROXY", () => {
  const prev = process.env.TRUST_PROXY;
  const prevVercel = process.env.VERCEL;
  delete process.env.TRUST_PROXY;
  delete process.env.VERCEL;
  const req = { headers: { "x-forwarded-for": "9.9.9.9" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(clientIp(req), "127.0.0.1");
  if (prev !== undefined) process.env.TRUST_PROXY = prev;
  if (prevVercel !== undefined) process.env.VERCEL = prevVercel;
});

test("clientIp: X-Forwarded-For dipakai kalau TRUST_PROXY aktif", () => {
  process.env.TRUST_PROXY = "1";
  const req = { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(clientIp(req), "9.9.9.9");
  delete process.env.TRUST_PROXY;
});

test("clientIp: di Vercel selalu di belakang proxy", () => {
  process.env.VERCEL = "1";
  const req = { headers: { "x-forwarded-for": "8.8.8.8" }, socket: { remoteAddress: "10.0.0.1" } };
  assert.equal(clientIp(req), "8.8.8.8");
  delete process.env.VERCEL;
});
