/**
 * PinCatch - modul bersama (logika inti, tanpa http server).
 * Dipakai oleh api/resolve.js dan api/media.js di Vercel.
 */

"use strict";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_BATCH = 10;
const FETCH_TIMEOUT = 25_000;

function fetchWithUA(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || FETCH_TIMEOUT);
  return fetch(url, {
    method: opts.method || "GET",
    redirect: opts.redirect || "follow",
    signal: ctrl.signal,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      ...(opts.headers || {}),
    },
  }).finally(() => clearTimeout(t));
}

/* --------------------------------------------------- Pinterest URL/parser */

function pinIdFromUrl(raw) {
  const m =
    raw.match(/pinterest\.[a-z.]+\/pin\/(?:[^/?#]*?--)?(\d{5,})/i) ||
    raw.match(/\/pin\/(?:[^/?#]*?--)?(\d{5,})/i);
  return m ? m[1] : null;
}

async function resolvePinId(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("URL kosong");

  if (/^\d{5,}$/.test(s)) return s;

  if (/pin\.it\//i.test(s)) {
    let target = s;
    for (let i = 0; i < 4; i++) {
      const r = await fetchWithUA(target, { method: "HEAD", redirect: "manual" }).catch(() => null);
      if (!r) break;
      const loc = r.headers.get("location");
      if (loc && r.status >= 300 && r.status < 400) {
        target = new URL(loc, target).toString();
        continue;
      }
      break;
    }
    const id = pinIdFromUrl(target) || pinIdFromUrl(s);
    if (!id) throw new Error("Short link tidak merujuk ke pin yang valid");
    return id;
  }

  const id = pinIdFromUrl(s);
  if (!id) throw new Error("Format URL tidak dikenali. Tempel link seperti pinterest.com/pin/… atau pin.it/…");
  return id;
}

/* --------------------------------------------- URL media Pinterest langsung */

const ALLOWED_HOST_RE = /(^|\.)pinimg\.com$/i;

function directMediaFromUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !ALLOWED_HOST_RE.test(u.hostname)) return null;
  const isVideo = /\.mp4$/i.test(u.pathname);
  const isImage = /\.(jpe?g|png|gif|webp)$/i.test(u.pathname);
  if (!isVideo && !isImage) return null;
  const file = decodeURIComponent(u.pathname.split("/").pop() || "");
  const base = file.replace(/\.[^.]+$/, "");
  const pretty = /^[0-9a-f]{20,}$/i.test(base) ? "Gambar Pinterest" : base.replace(/[-_]+/g, " ");
  return {
    id: file || "media",
    title: pretty || "Media Pinterest",
    preview: isVideo ? null : u.toString(),
    media: [{
      type: isVideo ? "video" : /\.gif$/i.test(u.pathname) ? "gif" : "image",
      url: u.toString(),
      width: null,
      height: null,
    }],
  };
}

function bestVideo(videoList) {
  const list = Object.values(videoList || {}).filter(
    (v) => v && v.url && /mp4(\?|$)/i.test(v.url)
  );
  list.sort((a, b) => (b.width || 0) - (a.width || 0));
  return list[0] || null;
}

function imageMedia(im) {
  if (!im || !im.url) return null;
  const isGif = /\.gif(\?|$)/i.test(im.url);
  return {
    type: isGif ? "gif" : "image",
    url: im.url,
    width: im.width || null,
    height: im.height || null,
  };
}

function parsePinData(d) {
  const media = [];

  const pages = d.story_pin_data?.pages;
  if (Array.isArray(pages) && pages.length) {
    for (const pg of pages) {
      const v =
        bestVideo(pg.videos?.video_list) ||
        bestVideo(pg.video_list) ||
        bestVideo(pg.blocks?.find((b) => b.video)?.video?.video_list);
      if (v) {
        media.push({ type: "video", url: v.url, width: v.width || null, height: v.height || null });
        continue;
      }
      const im = imageMedia(pg.images?.orig) || imageMedia(pg.images?.["736x"]) ||
        imageMedia(pg.blocks?.find((b) => b.image)?.image?.images?.orig);
      if (im) media.push(im);
    }
  }

  if (!media.length) {
    const v = bestVideo(d.videos?.video_list);
    if (v) media.push({ type: "video", url: v.url, width: v.width || null, height: v.height || null });
  }

  if (!media.length && Array.isArray(d.carousel_data?.carousel_slots)) {
    for (const slot of d.carousel_data.carousel_slots) {
      const im = imageMedia(slot.images?.orig) || imageMedia(slot.images?.["736x"]);
      if (im) media.push(im);
    }
  }

  if (!media.length) {
    const im =
      imageMedia(d.images?.orig) ||
      imageMedia(d.images?.["1200x"]) ||
      imageMedia(d.images?.["736x"]) ||
      imageMedia(d.images?.["474x"]);
    if (im) media.push(im);
  }

  const preview =
    d.images?.["474x"]?.url ||
    d.images?.orig?.url ||
    (media[0] && media[0].type !== "video" ? media[0].url : null) ||
    null;

  const title =
    (d.grid_title || d.title || d.seo_title || "").toString().trim() ||
    (d.description || "").toString().trim().slice(0, 90) ||
    `Pin ${d.id}`;

  return { id: d.id, title, preview, media };
}

async function resolvePin(inputUrl) {
  const direct = directMediaFromUrl(inputUrl);
  if (direct) return direct;

  const id = await resolvePinId(inputUrl);
  const data = encodeURIComponent(
    JSON.stringify({
      options: {
        id,
        field_set_key: "auth_web_main_pin",
        noCache: true,
        fetch_visual_search_objects: false,
      },
      context: {},
    })
  );
  const url =
    `https://in.pinterest.com/resource/PinResource/get/?source_url=` +
    encodeURIComponent(`/pin/${id}/`) +
    `&data=${data}`;

  const r = await fetchWithUA(url, {
    headers: { "x-pinterest-pws-handler": "www/pin/[id].js" },
  });

  if (r.status === 404) throw new Error("Pin tidak ditemukan atau privat");
  if (!r.ok) throw new Error(`Pinterest menjawab ${r.status}. Coba lagi sebentar.`);

  const j = await r.json();
  const d = j?.resource_response?.data;
  if (!d || !d.id) throw new Error("Balasan Pinterest tidak dikenali");

  const parsed = parsePinData(d);
  if (!parsed.media.length) throw new Error("Tidak ada media yang bisa diambil dari pin ini");
  return parsed;
}

/* --------------------------------------------------------- media proxying */

function sanitizeName(name, fallbackExt, contentType) {
  let base = String(name || "")
    .replace(/[\\/:*?"<>|\r\n]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^[-.]+|[-.]+$/g, "");
  let ext = (base.match(/\.([A-Za-z0-9]{2,4})$/) || [])[1];
  if (!ext) {
    const ctExt = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
    }[(contentType || "").split(";")[0]];
    ext = ctExt || fallbackExt || "bin";
  } else {
    base = base.replace(/\.[A-Za-z0-9]{2,4}$/, "");
  }
  return `${base || "pincatch"}.${ext}`;
}

/* ------------------------------------------------------------ rate limit */

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  rec.count++;
  if (hits.size > 5000) hits.clear();
  return rec.count > 40;
}

module.exports = {
  MAX_BATCH,
  fetchWithUA,
  resolvePin,
  ALLOWED_HOST_RE,
  sanitizeName,
  rateLimited,
};
