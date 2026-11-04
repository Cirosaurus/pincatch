/**
 * PinCatch — logika frontend.
 * Alur: tempel link -> POST /api/resolve -> daftar hasil -> detail per aset.
 * Tiga tampilan: antrean (default), rak, studio.
 * Hapus background: RMBG-1.4 (AI, di browser) atau flood-fill (Cepat).
 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);

const urlInput = $("#url-input");
const listBody = $("#list-body");
const listSummary = $("#list-summary");
const emptyState = $("#empty-state");
const viewList = $("#view-list");
const viewStudio = $("#view-studio");

const TYPE_LABEL = { image: "Gambar", gif: "GIF", video: "Video" };
const TYPE_ICON = { image: "#i-image", gif: "#i-image", video: "#i-video" };
const EXT = { image: "jpg", gif: "gif", video: "mp4" };

let bgMode = "ai";
let view = "queue";
let uidSeq = 1;
const items = new Map(); // uid -> item
let studioUid = null;

try {
  view = localStorage.getItem("pincatch-view") === "grid" ? "grid" : "queue";
} catch {}

function icon(id, cls = "ic") {
  return `<svg class="${cls}" aria-hidden="true"><use href="${id}"/></svg>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 350);
  }, 3800);
}

function slugTitle(t) {
  return (
    String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "pin"
  );
}

function proxyUrl(mediaUrl, name, inline = false) {
  const q = new URLSearchParams({ url: mediaUrl });
  if (name) q.set("name", name);
  if (inline) q.set("inline", "1");
  return `/api/media?${q.toString()}`;
}

function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  if (name) a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fmtDims(m) {
  return m.width && m.height ? `${m.width}×${m.height}` : "";
}

/* ------------------------------------------------------------ tema */

function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === "dark";
  $("#theme-btn").setAttribute("aria-label", dark ? "Pakai tema terang" : "Pakai tema gelap");
}

$("#theme-btn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  if (dark) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = "dark";
  try { localStorage.setItem("pincatch-theme", dark ? "light" : "dark"); } catch {}
  syncThemeBtn();
});
syncThemeBtn();

/* --------------------------------------------------------- input bar */

const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:pinterest\.[a-z.]+|pin\.it)\/pin\/(?:[^\/?#]*?--)?\d{5,}[^\s]*)|((?:https?:\/\/)?pin\.it\/[a-z0-9]+[^\s]*)|(^https?:\/\/i\.pinimg\.com\/[^\s]+\.(?:jpe?g|png|gif|webp|mp4)(?:\?[^\s]*)?$)|(^\d{5,}$)/i;

function parseUrls(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || "").split(/[\s\n]+/)) {
    const s = raw.trim().replace(/^["'<]+|["'>.,]+$/g, "");
    if (!s || !URL_RE.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

$("#paste-btn").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return toast("Clipboard kosong.");
    urlInput.value = (urlInput.value ? urlInput.value + "\n" : "") + text.trim();
    urlInput.focus();
  } catch {
    toast("Browser memblokir clipboard — tempel manual dengan Ctrl+V.", true);
  }
});

$("#clear-btn").addEventListener("click", () => {
  urlInput.value = "";
  urlInput.focus();
});

$("#fetch-btn").addEventListener("click", () => {
  const urls = parseUrls(urlInput.value);
  if (!urls.length) return toast("Belum ada link Pinterest yang valid.", true);
  if (urls.length > 10) toast("Maksimal 10 link sekali proses — 10 pertama dipakai.");
  resolveAll(urls.slice(0, 10));
});

urlInput.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("#fetch-btn").click();
});
// textarea tumbuh mengikuti isi
urlInput.addEventListener("input", () => {
  urlInput.style.height = "auto";
  urlInput.style.height = Math.min(urlInput.scrollHeight, 120) + "px";
});

$("#bg-mode").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  bgMode = btn.dataset.mode;
  for (const b of $("#bg-mode").children) {
    const on = b === btn;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  }
});

$("#view-mode").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  setView(btn.dataset.view);
});

function setView(next) {
  view = next === "grid" ? "grid" : "queue";
  try { localStorage.setItem("pincatch-view", view); } catch {}
  for (const b of $("#view-mode").children) {
    const on = b.dataset.view === view;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  if (view === "grid" && studioUid) closeStudio();
  render();
}

/* ----------------------------------------------------------- resolve */

async function resolveAll(urls) {
  $("#fetch-btn").disabled = true;
  emptyState.hidden = true;

  const created = urls.map((u) => {
    const uid = uidSeq++;
    items.set(uid, {
      uid, url: u, state: "loading",
      title: "", media: [], idx: 0,
      removedBlob: null, originalShown: true,
      progress: null, error: "",
    });
    return uid;
  });
  render();

  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server menjawab ${res.status}`);

    const byInput = new Map(data.results.map((r) => [r.input, r]));
    for (let i = 0; i < created.length; i++) {
      const it = items.get(created[i]);
      const r = byInput.get(urls[i]);
      if (!it) continue;
      if (r && r.ok) {
        it.state = "ready";
        it.title = r.title;
        it.media = r.media;
      } else {
        it.state = "error";
        it.error = (r && r.error) || "Gagal memproses link ini.";
      }
    }
  } catch (e) {
    for (const uid of created) {
      const it = items.get(uid);
      if (it && it.state === "loading") {
        it.state = "error";
        it.error = e.message;
      }
    }
    toast("Gagal menghubungi server: " + e.message, true);
  } finally {
    $("#fetch-btn").disabled = false;
    render();
  }
}

/* ------------------------------------------------------------ render */

function render() {
  const list = [...items.values()];
  const inStudio = studioUid != null && items.has(studioUid);

  viewList.hidden = inStudio;
  viewStudio.hidden = !inStudio;
  if (inStudio) {
    renderStudio();
    return;
  }

  emptyState.hidden = list.length > 0;
  listSummary.hidden = list.length === 0;
  if (!list.length) {
    listBody.innerHTML = "";
    listSummary.innerHTML = "";
    return;
  }

  const ready = list.filter((i) => i.state === "ready").length;
  const failed = list.filter((i) => i.state === "error").length;
  const done = list.filter((i) => i.removedBlob).length;
  const busy = list.filter((i) => i.state === "processing").length;

  listSummary.innerHTML = `
    <span><b>${list.length}</b> link</span>
    <span class="ok"><b>${ready}</b> siap</span>
    ${busy ? `<span><b>${busy}</b> diproses</span>` : ""}
    ${failed ? `<span class="bad"><b>${failed}</b> gagal</span>` : ""}
    ${done ? `<span><b>${done}</b> tanpa background</span>` : ""}
  `;

  listBody.innerHTML = view === "grid"
    ? `<div class="grid">${list.map(renderTile).join("")}</div>`
    : renderQueue(list);
}

function currentMedia(it) {
  return it.media[it.idx] || null;
}

function previewSrc(it) {
  const m = currentMedia(it);
  if (!m) return "";
  return m.type === "video" ? "" : m.url;
}

function renderQueue(list) {
  const rows = list.map((it) => {
    const m = currentMedia(it);
    const isErr = it.state === "error";
    const isLoading = it.state === "loading";
    const isBusy = it.state === "processing";
    const thumb = m && m.type !== "video"
      ? `<img src="${esc(previewSrc(it))}" alt="" loading="lazy" decoding="async" />`
      : isErr
        ? `<span style="color:var(--danger);display:grid;place-items:center">${icon("#i-alert")}</span>`
        : m
          ? `<span style="color:var(--muted);display:grid;place-items:center">${icon("#i-video")}</span>`
          : "";

    const status = isErr
      ? `<span class="status is-err"><span class="dot"></span>Gagal</span>`
      : isLoading
        ? `<span class="status is-run"><span class="dot"></span>Memuat</span>`
        : isBusy
          ? `<span class="status is-run"><span class="dot"></span>${esc(it.progress || "Memproses")}</span>`
          : it.removedBlob
            ? `<span class="status"><span class="dot"></span>PNG siap</span>`
            : `<span class="status"><span class="dot"></span>Siap</span>`;

    const chip = m ? `<span class="chip">${icon(TYPE_ICON[m.type] || "#i-image")}${TYPE_LABEL[m.type] || "Aset"}</span>` : "";

    let acts = "";
    if (isErr) {
      acts = `<button type="button" class="btn btn-ghost" data-act="retry" data-uid="${it.uid}">${icon("#i-refresh")}Coba lagi</button>
              <button type="button" class="icon-btn" data-act="remove" data-uid="${it.uid}" aria-label="Hapus baris" title="Hapus baris">${icon("#i-trash")}</button>`;
    } else if (it.state === "ready") {
      const canRemove = m && m.type === "image" && !it.removedBlob;
      acts = `
        <button type="button" class="btn btn-ghost" data-act="studio" data-uid="${it.uid}" title="Buka detail">${icon("#i-compare")}Detail</button>
        ${canRemove ? `<button type="button" class="btn btn-ghost" data-act="nobg" data-uid="${it.uid}">${icon("#i-sparkles")}No BG</button>` : ""}
        ${it.removedBlob ? `<button type="button" class="btn btn-ghost" data-act="revert" data-uid="${it.uid}">${icon("#i-undo")}Asli</button>` : ""}
        <button type="button" class="btn ${it.removedBlob ? "btn-success" : "btn-primary"}" data-act="download" data-uid="${it.uid}">${icon("#i-download")}Unduh</button>
      `;
    } else {
      acts = `<button type="button" class="icon-btn" data-act="remove" data-uid="${it.uid}" aria-label="Batalkan" title="Batalkan">${icon("#i-x")}</button>`;
    }

    const progress = isBusy && typeof it.progressPct === "number"
      ? `<div class="row-progress"><i style="width:${Math.round(it.progressPct * 100)}%"></i></div>`
      : "";

    return `
      <div class="row" data-uid="${it.uid}">
        <span class="thumb">${thumb}</span>
        <span class="row-main">
          <p class="row-title${isErr ? " is-error" : ""}">${esc(isErr ? it.error : it.title || (isLoading ? "Mengambil data…" : ""))}</p>
          <p class="row-src">${esc(it.url)}</p>
          ${progress}
        </span>
        <span class="chip-cell">${chip}</span>
        <span class="status-cell">${status}</span>
        <span class="row-acts">${acts}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="row-list">
      <div class="row head">
        <span></span><span>Pin</span><span>Jenis</span><span>Status</span><span></span>
      </div>
      ${rows}
    </div>
  `;
}

function removedSrc(it) {
  // simpan satu object URL per item; render ulang tidak boleh bikin URL baru terus
  if (!it.removedUrl) it.removedUrl = URL.createObjectURL(it.removedBlob);
  return it.removedUrl;
}

function dropRemovedUrl(it) {
  if (it.removedUrl) {
    URL.revokeObjectURL(it.removedUrl);
    it.removedUrl = null;
  }
}

function renderTile(it) {
  const m = currentMedia(it);
  const isErr = it.state === "error";
  const isLoading = it.state === "loading";
  const isBusy = it.state === "processing";

  let shot = "";
  if (isErr) {
    shot = `<div class="tile-shot" style="display:grid;place-items:center;color:var(--danger)">${icon("#i-alert", "ic")}</div>`;
  } else if (!m) {
    shot = `<div class="tile-shot" style="display:grid;place-items:center;color:var(--faint)"><span style="font-size:12px">${isLoading ? "Memuat…" : ""}</span></div>`;
  } else {
    const showRemoved = it.removedBlob && !it.originalShown;
    const media = showRemoved
      ? `<div class="checker"></div><img src="${removedSrc(it)}" alt="" />`
      : m.type === "video"
        ? `<img src="" alt="" style="background:var(--surface-2)" />`
        : `<img src="${esc(m.url)}" alt="" loading="lazy" decoding="async" />`;

    const over = isBusy ? `
      <div class="tile-over is-busy" aria-hidden="false">
        <div class="tile-busy">
          <div class="track"><i style="width:${Math.round((it.progressPct || 0) * 100)}%"></i></div>
          <span>${esc(it.progress || "Memproses…")}</span>
        </div>
      </div>` : it.state === "ready" ? `
      <div class="tile-over">
        <button type="button" class="btn btn-primary" data-act="download" data-uid="${it.uid}">${icon("#i-download")}Unduh</button>
        <div class="split">
          <button type="button" class="btn on-dark" data-act="studio" data-uid="${it.uid}">${icon("#i-compare")}Detail</button>
          ${m.type === "image"
            ? `<button type="button" class="btn on-dark" data-act="${showRemoved ? "revert" : "nobg"}" data-uid="${it.uid}">${icon(showRemoved ? "#i-undo" : "#i-sparkles")}${showRemoved ? "Asli" : "No BG"}</button>`
            : ""}
        </div>
      </div>` : "";

    shot = `<div class="tile-shot">
      ${media}
      <span class="tile-tag">${icon(TYPE_ICON[m.type] || "#i-image")}${TYPE_LABEL[m.type] || "Aset"}</span>
      ${showRemoved ? `<span class="tile-done">${icon("#i-check")}NO BG</span>` : ""}
      ${over}
    </div>`;
  }

  return `
    <article class="tile${isBusy ? " is-busy" : ""}" data-uid="${it.uid}">
      ${shot}
      <div class="tile-cap">
        <h3>${esc(isErr ? it.error : it.title || "…")}</h3>
        <p>${esc(isErr ? it.url : [m ? fmtDims(m) : "", it.removedBlob ? "PNG transparan" : isBusy ? "memproses…" : ""].filter(Boolean).join(" · "))}</p>
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------ studio */

function openStudio(uid) {
  if (!items.has(uid)) return;
  studioUid = uid;
  viewList.hidden = true;
  viewStudio.hidden = false;
  renderStudio();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeStudio() {
  studioUid = null;
  viewStudio.hidden = true;
  viewList.hidden = false;
  viewStudio.innerHTML = "";
  render();
}

function renderStudio() {
  const it = items.get(studioUid);
  if (!it) return closeStudio();

  const m = currentMedia(it);
  const showRemoved = it.removedBlob && !it.originalShown;
  const canRemove = m && m.type === "image" && !it.removedBlob;

  let stage = "";
  if (!m) {
    stage = `<div class="stage"><span style="color:var(--muted);font-size:13px">Memuat…</span></div>`;
  } else if (it.state === "error") {
    stage = `<div class="stage"><div style="text-align:center;color:var(--danger);font-size:13px;max-width:320px">${icon("#i-alert")}<p>${esc(it.error)}</p></div></div>`;
  } else if (showRemoved) {
    stage = `
      <div class="stage">
        <div class="frame is-compare" tabindex="0" role="slider"
             aria-label="Pembanding asli dan tanpa background"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <img src="${esc(m.url)}" alt="${esc(it.title)}" />
          <div class="layer" style="clip-path:inset(0 0 0 50%)">
            <div class="checker"></div>
            <img src="${removedSrc(it)}" alt="Tanpa background" />
          </div>
          <div class="cmp-divider" style="left:50%"></div>
          <div class="cmp-knob" style="left:50%">${icon("#i-compare")}</div>
          <span class="cmp-label l">ASLI</span>
          <span class="cmp-label r">TANPA BG</span>
        </div>
      </div>`;
  } else if (m.type === "video") {
    stage = `<div class="stage"><div class="frame"><video src="${proxyUrl(m.url, null, true)}" controls playsinline preload="metadata"></video></div></div>`;
  } else {
    stage = `<div class="stage"><div class="frame"><img src="${esc(m.url)}" alt="${esc(it.title)}" /></div></div>`;
  }

  const nav = it.media.length > 1 ? `
    <button type="button" class="stage-nav prev" data-act="prev" aria-label="Aset sebelumnya">${icon("#i-left")}</button>
    <button type="button" class="stage-nav next" data-act="next" aria-label="Aset berikutnya">${icon("#i-right")}</button>
    <span class="stage-count">${it.idx + 1} / ${it.media.length}</span>
  ` : "";

  const strip = it.media.length > 1 ? `
    <div class="strip" role="group" aria-label="Pilih aset">
      ${it.media.map((mm, i) => `
        <button type="button" data-act="pick" data-idx="${i}" class="${i === it.idx ? "is-on" : ""}"
                aria-label="Aset ${i + 1}" aria-pressed="${i === it.idx}">
          ${mm.type === "video" ? `<span style="display:grid;place-items:center;height:100%;color:var(--muted)">${icon("#i-video")}</span>`
            : `<img src="${esc(mm.url)}" alt="" loading="lazy" />`}
        </button>`).join("")}
    </div>` : "";

  const progress = it.state === "processing" ? `
    <div class="side-progress">
      <div class="track"><i style="width:${Math.round((it.progressPct || 0) * 100)}%"></i></div>
      <span>${esc(it.progress || "Memproses…")}</span>
    </div>` : "";

  const error = it.state === "error" ? `<div class="side-error">${esc(it.error)}</div>` : "";

  const actions = it.state === "error"
    ? `<button type="button" class="btn btn-ghost" data-act="retry">${icon("#i-refresh")}Coba lagi</button>`
    : m ? `
      <button type="button" class="btn ${it.removedBlob ? "btn-success" : "btn-primary"}" data-act="download">
        ${icon("#i-download")}${it.removedBlob ? "Unduh PNG Transparan" : `Unduh ${TYPE_LABEL[m.type] || "Aset"}`}
      </button>
      ${canRemove ? `<button type="button" class="btn btn-ghost" data-act="nobg">${icon("#i-sparkles")}Buat PNG Tanpa Background</button>` : ""}
      ${it.removedBlob ? `
        <div class="split">
          <button type="button" class="btn btn-ghost" data-act="revert">${icon("#i-undo")}Lihat asli</button>
          <button type="button" class="btn btn-ghost" data-act="download-orig">${icon("#i-download")}Asli</button>
        </div>` : ""}
    ` : "";

  viewStudio.innerHTML = `
    <button type="button" class="studio-back" data-act="back">${icon("#i-left")}Kembali ke daftar</button>
    <div class="studio-body">
      <div style="position:relative">${stage}${nav}</div>
      <div class="side">
        <span class="kicker">Pin · ${m ? TYPE_LABEL[m.type] || "Aset" : "—"}</span>
        <h1>${esc(it.state === "error" ? "Gagal" : it.title || "…")}</h1>
        <p class="meta">${esc([m ? fmtDims(m) : "", m && m.type !== "image" ? EXT[m.type].toUpperCase() : "", it.removedBlob ? "sudah diproses" : ""].filter(Boolean).join(" · "))}</p>
        ${error}
        ${strip}
        ${progress}
        <div class="side-actions">${actions}</div>
        <div class="side-note">
          Mode hapus background: <b>${bgMode === "ai" ? "AI (RMBG-1.4)" : "Cepat (flood-fill)"}</b>.
          ${bgMode === "ai" ? "Akurat untuk ilustrasi dan foto; model ~44 MB diunduh sekali." : "Instan, cocok untuk latar polos."}
        </div>
      </div>
    </div>
  `;

  const frame = $(".frame.is-compare", viewStudio);
  if (frame) wireCompare(frame);
}

function wireCompare(frame) {
  // layer harus seukuran gambar dasar, bukan seluruh frame — kalau tidak,
  // sisi kanan meleset untuk gambar yang rasionya sempit/tinggi.
  const baseImg = frame.querySelector(":scope > img");
  const layer = frame.querySelector(".layer");
  const syncLayer = () => {
    if (!baseImg.naturalWidth) return;
    const br = baseImg.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    layer.style.left = br.left - fr.left + "px";
    layer.style.top = br.top - fr.top + "px";
    layer.style.width = br.width + "px";
    layer.style.height = br.height + "px";
    layer.style.right = "auto";
    layer.style.bottom = "auto";
  };
  if (baseImg.complete) syncLayer();
  else baseImg.addEventListener("load", syncLayer, { once: true });
  window.addEventListener("resize", syncLayer);

  const set = (pct) => {
    const p = Math.max(0, Math.min(100, pct));
    layer.style.clipPath = `inset(0 0 0 ${p}%)`;
    const br = baseImg.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const x = br.left - fr.left + br.width * (p / 100);
    const d = $(".cmp-divider", frame);
    const k = $(".cmp-knob", frame);
    d.style.left = x + "px";
    k.style.left = x + "px";
    frame.setAttribute("aria-valuenow", String(Math.round(p)));
  };
  const fromEvent = (e) => {
    const br = baseImg.getBoundingClientRect();
    set(((e.clientX - br.left) / br.width) * 100);
  };

  let dragging = false;
  frame.addEventListener("pointerdown", (e) => {
    // cegah drag bawaan <img>, kalau tidak pointermove ikut terputus
    e.preventDefault();
    dragging = true;
    frame.setPointerCapture(e.pointerId);
    frame.classList.add("is-dragging");
    fromEvent(e);
  });
  frame.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    fromEvent(e);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    frame.classList.remove("is-dragging");
    if (frame.hasPointerCapture?.(e.pointerId)) frame.releasePointerCapture(e.pointerId);
  };
  frame.addEventListener("pointerup", end);
  frame.addEventListener("pointercancel", end);
  window.addEventListener("pointerup", end);

  frame.addEventListener("keydown", (e) => {
    const now = Number(frame.getAttribute("aria-valuenow")) || 50;
    if (e.key === "ArrowLeft") { set(now - 4); e.preventDefault(); }
    if (e.key === "ArrowRight") { set(now + 4); e.preventDefault(); }
    if (e.key === "Home") { set(0); e.preventDefault(); }
    if (e.key === "End") { set(100); e.preventDefault(); }
  });

  set(50);
}

/* ------------------------------------------------------------ aksi */

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const uid = btn.dataset.uid ? Number(btn.dataset.uid) : studioUid;
  const it = uid != null ? items.get(uid) : null;

  switch (act) {
    case "back": return closeStudio();
    case "studio": return openStudio(Number(btn.dataset.uid));
    case "retry": return retryItem(it, btn);
    case "remove": return removeItem(it);
    case "download": return downloadCurrent(it);
    case "download-orig": return downloadOriginal(it);
    case "nobg": return removeBackground(it);
    case "revert":
      if (it) { it.originalShown = !it.originalShown; render(); }
      return;
    case "prev": return switchAsset(it, -1);
    case "next": return switchAsset(it, +1);
    case "pick":
      if (it) { it.idx = Number(btn.dataset.idx); render(); }
      return;
  }
});

function removeItem(it) {
  if (!it) return;
  dropRemovedUrl(it);
  items.delete(it.uid);
  if (studioUid === it.uid) studioUid = null;
  render();
}

function retryItem(it) {
  if (!it) return;
  const url = it.url;
  dropRemovedUrl(it);
  items.delete(it.uid);
  if (studioUid === it.uid) { studioUid = null; }
  resolveAll([url]);
}

function switchAsset(it, dir) {
  if (!it || !it.media.length) return;
  it.idx = (it.idx + dir + it.media.length) % it.media.length;
  if (it.removedBlob && it.media[it.idx].type !== "image") {
    dropRemovedUrl(it);
    it.removedBlob = null;
    it.originalShown = true;
  }
  render();
}

function downloadCurrent(it) {
  if (!it) return;
  const m = currentMedia(it);
  if (!m) return;
  const base = `${slugTitle(it.title)}-${it.uid}`;
  if (it.removedBlob && it.media[it.idx].type === "image") {
    const name = `${base}-nobg.png`;
    triggerDownload(removedSrc(it), name);
    return;
  }
  const name = `${base}.${EXT[m.type] || "bin"}`;
  triggerDownload(proxyUrl(m.url, name), name);
}

function downloadOriginal(it) {
  if (!it) return;
  const m = currentMedia(it);
  if (!m) return;
  const name = `${slugTitle(it.title)}-${it.uid}.${EXT[m.type] || "bin"}`;
  triggerDownload(proxyUrl(m.url, name), name);
}

/* ------------------------------------------------- hapus background */

// RMBG-1.4 (~44 MB, sekali unduh lalu di-cache browser). isnet di @imgly
// menghapus badan karakter ilustrasi — model ini jauh lebih akurat.
let rmbgPromise = null;

function ensureRmbg(onProgress) {
  if (!rmbgPromise) {
    rmbgPromise = (async () => {
      const tf = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5");
      const model = await tf.AutoModel.from_pretrained("briaai/RMBG-1.4", {
        dtype: "q8",
        progress_callback: onProgress,
      });
      const processor = await tf.AutoProcessor.from_pretrained("briaai/RMBG-1.4");
      return { tf, model, processor };
    })().catch((e) => {
      rmbgPromise = null;
      throw e;
    });
  }
  return rmbgPromise;
}

async function fetchMediaBlob(url) {
  const r = await fetch(proxyUrl(url, null, true));
  if (!r.ok) throw new Error("Gagal mengambil berkas gambar dari server.");
  return await r.blob();
}

/** Mask 0..1 dari RMBG -> alpha PNG ukuran asli. */
async function aiRemove(blob, onProgress) {
  const { tf, model, processor } = await ensureRmbg(onProgress);
  const img = await tf.RawImage.fromBlob(blob);
  const { pixel_values } = await processor(img);
  const mask = (await model({ input: pixel_values })).output;

  const MW = mask.dims[3], MH = mask.dims[2];
  const md = mask.data;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < md.length; i++) {
    const v = md[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;

  const mcv = document.createElement("canvas");
  mcv.width = MW;
  mcv.height = MH;
  const mctx = mcv.getContext("2d");
  const mimg = mctx.createImageData(MW, MH);
  for (let i = 0; i < MW * MH; i++) {
    const o = i * 4;
    mimg.data[o] = mimg.data[o + 1] = mimg.data[o + 2] = 255;
    mimg.data[o + 3] = Math.round(((md[i] - mn) / range) * 255);
  }
  mctx.putImageData(mimg, 0, 0);

  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);

  const sc = document.createElement("canvas");
  sc.width = bmp.width;
  sc.height = bmp.height;
  const sctx = sc.getContext("2d");
  sctx.drawImage(mcv, 0, 0, bmp.width, bmp.height);
  const alpha = sctx.getImageData(0, 0, bmp.width, bmp.height).data;

  // Mask dari model sudah punya tepi lembut sendiri. guidedAlpha di sini
  // justru merusak: ia penghalus, jadi bintik alpha rendah di latar ikut
  // disebar jadi kabut (haze 7,1% -> 18,8%). Buang ekor alpha rendah saja.
  for (let i = 0; i < bmp.width * bmp.height; i++) {
    const a = alpha[i * 4 + 3];
    imgData.data[i * 4 + 3] = a < 26 ? 0 : a;
  }

  // Warna latar masih "menembus" di piksel tepi yang setengah transparan —
  // ini yang bikin hasil terlihat kotor. Defringe membuang komponen warna latar.
  defringe(imgData.data, bmp.width, bmp.height);
  ctx.putImageData(imgData, 0, 0);
  return await new Promise((r) => c.toBlob(r, "image/png"));
}

/**
 * Defringe: piksel setengah transparan masih membawa warna latar yang
 * "menembus" (contamination). Ambil warna dari piksel tetangga yang solid,
 * jadi tepi memakai warna subjek, bukan warna latar.
 * Ini yang dilakukan remove.bg dan disebut "edge color correction".
 */
function defringe(data, W, H) {
  const N = W * H;
  const orig = new Uint8ClampedArray(data);
  const R = 3; // radius pencarian tetangga solid

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = orig[i * 4 + 3];
      // hanya piksel tepi: transparan sebagian, bukan solid, bukan kosong
      if (a === 0 || a === 255) continue;

      let sr = 0, sg = 0, sb = 0, sw = 0;
      const y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
      const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R);
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const j = ny * W + nx;
          if (orig[j * 4 + 3] < 200) continue; // hanya tetangga yang solid
          const d = Math.abs(nx - x) + Math.abs(ny - y);
          const w = 1 / (1 + d);
          sr += orig[j * 4] * w;
          sg += orig[j * 4 + 1] * w;
          sb += orig[j * 4 + 2] * w;
          sw += w;
        }
      }
      if (sw === 0) continue;

      // campur warna subjek dengan warna asli sesuai seberapa solid piksel ini
      const t = a / 255;
      data[i * 4] = sr / sw * t + orig[i * 4] * (1 - t);
      data[i * 4 + 1] = sg / sw * t + orig[i * 4 + 1] * (1 - t);
      data[i * 4 + 2] = sb / sw * t + orig[i * 4 + 2] * (1 - t);
    }
  }
}

/**
 * Guided filter (He et al. 2010) — penghalus edge-aware, bukan penajam.
 * Dipakai mode Cepat untuk menghilangkan gerigi alpha biner dari flood-fill.
 * Jangan dipakai di jalur AI: mask model sudah bertepi lembut, dan filter ini
 * justru menyebarkan bintik alpha rendah di latar jadi kabut.
 * Semua array satu kanal; box filter lewat integral image supaya O(n).
 */
function guidedAlpha(rgba, alphaRgba, W, H) {
  const N = W * H;
  const I = new Float32Array(N);
  const P = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    I[i] = (0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]) / 255;
    P[i] = alphaRgba[o + 3] / 255;
  }

  const r = Math.max(4, Math.round(Math.min(W, H) / 200));
  const eps = 1e-4;

  const box = (src) => {
    const integral = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += src[y * W + x];
        integral[(y + 1) * (W + 1) + (x + 1)] = integral[y * (W + 1) + (x + 1)] + row;
      }
    }
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
      for (let x = 0; x < W; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
        const area = (y1 - y0 + 1) * (x1 - x0 + 1);
        out[y * W + x] = (
          integral[(y1 + 1) * (W + 1) + (x1 + 1)]
          - integral[y0 * (W + 1) + (x1 + 1)]
          - integral[(y1 + 1) * (W + 1) + x0]
          + integral[y0 * (W + 1) + x0]
        ) / area;
      }
    }
    return out;
  };

  const meanI = box(I);
  const meanP = box(P);
  const II = new Float32Array(N);
  const IP = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    II[i] = I[i] * I[i];
    IP[i] = I[i] * P[i];
  }
  const meanII = box(II);
  const meanIP = box(IP);

  const a = new Float32Array(N);
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const varI = meanII[i] - meanI[i] * meanI[i];
    const covIP = meanIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = box(a);
  const meanB = box(b);

  const out = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    const q = meanA[i] * I[i] + meanB[i];
    out[i] = Math.round((q < 0 ? 0 : q > 1 ? 1 : q) * 255);
  }
  return out;
}

async function removeBackground(it) {
  if (!it) return;
  const m = currentMedia(it);
  if (!m || m.type !== "image" || it.state === "processing") return;

  it.state = "processing";
  it.progress = "Menyiapkan…";
  it.progressPct = 0.05;
  render();

  try {
    let blob;
    if (bgMode === "ai") {
      const input = await fetchMediaBlob(m.url);
      blob = await aiRemove(input, (p) => {
        if (p.status === "progress" && p.total) {
          it.progress = `Mengunduh model ${Math.round(p.progress)}% (sekali saja)`;
          it.progressPct = p.progress / 100;
          render();
        } else if (p.status === "done") {
          it.progress = "Memproses gambar…";
          it.progressPct = 0.9;
          render();
        }
      });
    } else {
      it.progress = "Memproses (mode cepat)…";
      it.progressPct = 0.5;
      render();
      const input = await fetchMediaBlob(m.url);
      blob = await quickRemove(input);
    }

    if (!blob || blob.size < 200) throw new Error("Hasil kosong — coba mode AI.");

    it.removedBlob = blob;
    it.originalShown = false;
    it.state = "ready";
    it.progress = null;
    it.progressPct = null;
    render();

    triggerDownload(removedSrc(it), `${slugTitle(it.title)}-${it.uid}-nobg.png`);
    toast("PNG transparan siap — berkas juga otomatis terunduh.");
  } catch (e) {
    it.state = "ready";
    it.progress = null;
    it.progressPct = null;
    render();
    toast("Gagal menghapus background: " + e.message, true);
  }
}

/**
 * Mode cepat: flood-fill dari tepi gambar. Cocok untuk latar polos
 * (putih/satu warna) — khas aset PNG dari Pinterest yang latar belakangnya "masih ada".
 */
async function quickRemove(blob) {
  const bmp = await createImageBitmap(blob);
  const MAX = 1800;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const px = imgData.data;

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h); // indeks piksel
  const refR = new Uint8Array(w * h);
  const refG = new Uint8Array(w * h);
  const refB = new Uint8Array(w * h);

  let head = 0, tail = 0;
  const push = (i, r, g, b) => {
    if (visited[i]) return;
    visited[i] = 1;
    queue[tail] = i;
    refR[tail] = r; refG[tail] = g; refB[tail] = b;
    tail++;
  };

  // seed: semua piksel tepi, masing-masing dengan warnanya sendiri
  for (let x = 0; x < w; x++) {
    push(x, px[x * 4], px[x * 4 + 1], px[x * 4 + 2]);
    const b2 = (x + (h - 1) * w);
    push(b2, px[b2 * 4], px[b2 * 4 + 1], px[b2 * 4 + 2]);
  }
  for (let y = 0; y < h; y++) {
    const l = y * w, r = y * w + w - 1;
    push(l, px[l * 4], px[l * 4 + 1], px[l * 4 + 2]);
    push(r, px[r * 4], px[r * 4 + 1], px[r * 4 + 2]);
  }

  const TOL = 34 * 34 * 3; // ambang jarak warna (jumlah kuadrat per kanal)
  while (head < tail) {
    const i = queue[head];
    const rr = refR[head], gg = refG[head], bb = refB[head];
    head++;

    const o = i * 4;
    const dr = px[o] - rr, dg = px[o + 1] - gg, db = px[o + 2] - bb;
    if (dr * dr + dg * dg + db * db > TOL) continue;

    px[o + 3] = 0; // transparan

    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1, rr, gg, bb);
    if (x < w - 1) push(i + 1, rr, gg, bb);
    if (y > 0) push(i - w, rr, gg, bb);
    if (y < h - 1) push(i + w, rr, gg, bb);
  }

  ctx.putImageData(imgData, 0, 0);

  // Flood-fill menghasilkan alpha biner, jadi tepinya bergerigi. Di sini guided
  // filter memang berguna: ia menghaluskan gerigi itu mengikuti garis nyata di
  // gambar. defringe membuang warna latar yang menembus tepi.
  const smooth = guidedAlpha(imgData.data, imgData.data, w, h);
  for (let i = 0; i < w * h; i++) {
    imgData.data[i * 4 + 3] = smooth[i];
  }
  defringe(imgData.data, w, h);
  ctx.putImageData(imgData, 0, 0);

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* ---------------------------------------------------------------- init */

// pulihkan tampilan yang terakhir dipakai
for (const b of $("#view-mode").children) {
  const on = b.dataset.view === view;
  b.classList.toggle("is-on", on);
  b.setAttribute("aria-pressed", String(on));
}
render();
