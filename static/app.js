/* AI Football Performance Analyzer — dashboard (vanilla JS SPA, no build step) */
"use strict";

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso || "—"; } };
const fmtDur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const num = (n) => Number(n).toLocaleString("en-US");

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- state (browser localStorage) ---------- */
const KEY = "fa_state_v1";
const DEFAULTS = { teams: [], players: [], mappings: {}, clusterTeams: {}, formations: [], settings: { apiBase: "", theme: "dark" } };
let S = loadState();
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
function applyTheme() { document.documentElement.dataset.theme = S.settings.theme; }
applyTheme();

/* ---------- api ---------- */
async function api(path, opts) {
  const r = await fetch(S.settings.apiBase + path, opts);
  if (!r.ok) {
    let d = ""; try { d = (await r.json()).detail; } catch { /* ignore */ }
    throw new Error(d || r.statusText);
  }
  return r.json();
}
const apiUrl = (p) => S.settings.apiBase + p;
const getMatches = () => api("/matches");
const summaryCache = {};
async function getSummary(jobId) {
  if (!summaryCache[jobId]) summaryCache[jobId] = await api(`/matches/${jobId}/players`);
  return summaryCache[jobId];
}
const statusBadge = (s) => ({
  completed: '<span class="badge ok">مكتمل</span>',
  processing: '<span class="badge warn">جاري المعالجة</span>',
  queued: '<span class="badge warn">في الانتظار</span>',
  failed: '<span class="badge bad">فشل</span>',
}[s] || `<span class="badge">${esc(s)}</span>`);

/* ---------- roster helpers ---------- */
const teamOf = (id) => S.teams.find((t) => t.id === id);
const playerOf = (id) => S.players.find((p) => p.id === id);
const playerLabel = (p) => p ? `${p.number ? "#" + p.number + " " : ""}${p.name}` : "";
function mapped(jobId, trackId) { return playerOf((S.mappings[jobId] || {})[trackId]); }
function trackLabel(jobId, trackId) {
  const p = mapped(jobId, trackId);
  return p ? playerLabel(p) : `Track #${trackId}`;
}
function matchSelect(matches, selected, id = "matchSel") {
  const done = matches.filter((m) => m.status === "completed");
  if (!done.length) return "";
  return `<label class="f">المباراة<select id="${id}">${done.map((m) =>
    `<option value="${m.job_id}" ${m.job_id === selected ? "selected" : ""}>${esc(m.filename || m.job_id.slice(0, 8))} — ${fmtDate(m.created_at)}</option>`).join("")}</select></label>`;
}
const noMatches = `<div class="card empty">لا توجد مباريات مكتملة بعد.<br><a class="btn" style="margin-top:12px" href="#/upload">ارفع مباراة</a></div>`;

/* ---------- pitch (SVG, vertical, attack = top) ---------- */
const PW = 680, PH = 1050, PM = 20;
const px = (x) => PM + x * (PW - 2 * PM);
const py = (y) => PM + y * (PH - 2 * PM);
function pitchLines() {
  const L = "stroke='rgba(255,255,255,.75)' stroke-width='3' fill='none'";
  const w = PW - 2 * PM, h = PH - 2 * PM, cx = PW / 2, cy = PH / 2;
  const box = (top) => {
    const bw = w * 0.6, bh = h * 0.16, gw = w * 0.28, gh = h * 0.055;
    const y0 = top ? PM : PH - PM - bh, g0 = top ? PM : PH - PM - gh;
    return `<rect x='${cx - bw / 2}' y='${y0}' width='${bw}' height='${bh}' ${L}/><rect x='${cx - gw / 2}' y='${g0}' width='${gw}' height='${gh}' ${L}/>`;
  };
  return `<rect x='${PM}' y='${PM}' width='${w}' height='${h}' ${L}/><line x1='${PM}' y1='${cy}' x2='${PW - PM}' y2='${cy}' ${L}/><circle cx='${cx}' cy='${cy}' r='90' ${L}/><circle cx='${cx}' cy='${cy}' r='4' fill='#fff'/>${box(true)}${box(false)}`;
}
const pitchSVG = (inner = "", id = "") =>
  `<svg ${id ? `id="${id}"` : ""} viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="stripes" width="${PW}" height="140" patternUnits="userSpaceOnUse"><rect width="${PW}" height="70" fill="#15803d"/><rect y="70" width="${PW}" height="70" fill="#16a34a"/></pattern></defs><rect width="${PW}" height="${PH}" fill="url(#stripes)" rx="14"/>${pitchLines()}${inner}</svg>`;

/* formation presets: outfield rows from defence to attack */
const PRESETS = {
  "4-4-2": [4, 4, 2], "4-3-3": [4, 3, 3], "4-2-3-1": [4, 2, 3, 1], "3-5-2": [3, 5, 2],
  "3-4-3": [3, 4, 3], "5-3-2": [5, 3, 2], "7 لاعبين (2-3-1)": [2, 3, 1], "5 لاعبين (1-2-1)": [1, 2, 1],
};
const ROW_ROLES = { 3: ["DF", "MF", "FW"], 4: ["DF", "DM", "AM", "FW"] };
function buildFormation(name) {
  const rows = PRESETS[name];
  const roles = rows.length === 4 ? ROW_ROLES[4] : rows.length === 3 ? ROW_ROLES[3] : ["DF", "FW"].slice(0, rows.length);
  const slots = [{ x: 0.5, y: 0.93, role: "GK", playerId: null }];
  const top = 0.74, bottom = 0.14;
  rows.forEach((n, ri) => {
    const y = rows.length === 1 ? 0.5 : top - ((top - bottom) * ri) / (rows.length - 1);
    const role = rows.length === 2 ? (ri === 0 ? "DF" : "FW") : roles[ri] || "MF";
    for (let i = 0; i < n; i++) slots.push({ x: (i + 1) / (n + 1), y, role, playerId: null });
  });
  return slots;
}

/* ---------- heatmap / frame view (canvas) ---------- */
function heatColor(t) { // 0..1 -> rgba
  const stops = [[0, [30, 64, 175, 0]], [0.2, [37, 99, 235, 0.5]], [0.5, [250, 204, 21, 0.75]], [1, [239, 68, 68, 0.95]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (t - a) / (b - a);
      const c = ca.map((v, j) => v + (cb[j] - v) * k);
      return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${c[3].toFixed(2)})`;
    }
  }
  return "rgba(239,68,68,.95)";
}
function frameCanvas(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
}
function drawFrameBg(ctx, w, h) {
  ctx.fillStyle = "#0e2a1a"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((w * i) / 8, 0); ctx.lineTo((w * i) / 8, h); ctx.stroke(); }
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); ctx.stroke(); }
}
function drawHeat(canvas, heat) {
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  drawFrameBg(ctx, w, h);
  const gy = heat.length, gx = heat[0].length;
  const max = Math.max(1, ...heat.flat());
  const cw = w / gx, ch = h / gy;
  ctx.filter = "blur(8px)";
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    const v = heat[y][x]; if (!v) continue;
    ctx.fillStyle = heatColor(Math.sqrt(v / max));
    ctx.fillRect(x * cw - cw / 2, y * ch - ch / 2, cw * 2, ch * 2);
  }
  ctx.filter = "none";
}
function drawPath(canvas, path) {
  const ctx = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  drawFrameBg(ctx, w, h);
  ctx.lineWidth = 2; ctx.lineJoin = "round";
  for (let i = 1; i < path.length; i++) {
    ctx.strokeStyle = `hsl(${140 - (i / path.length) * 140},85%,60%)`;
    ctx.beginPath(); ctx.moveTo(path[i - 1][1] * w, path[i - 1][2] * h); ctx.lineTo(path[i][1] * w, path[i][2] * h); ctx.stroke();
  }
  if (path.length) { const e = path[path.length - 1]; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(e[1] * w, e[2] * h, 5, 0, 7); ctx.fill(); }
}

/* ---------- tiny SVG bar chart ---------- */
function barChart(items, unit = "") {
  if (!items.length) return '<div class="empty">لا توجد بيانات</div>';
  const max = Math.max(...items.map((i) => i.value), 1), rowH = 30, w = 560;
  const rows = items.map((it, i) => {
    const bw = Math.max(2, (it.value / max) * (w - 190));
    return `<g transform="translate(0,${i * rowH})"><text x="${w}" y="19" text-anchor="end" fill="currentColor" font-size="13">${esc(it.label)}</text><rect x="${w - 120 - bw}" y="6" width="${bw}" height="16" rx="5" fill="#22c55e"/><text x="${w - 128 - bw}" y="19" text-anchor="end" fill="currentColor" font-size="12" opacity=".7">${it.value}${unit}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${items.length * rowH}" style="width:100%;height:auto;color:var(--text)">${rows}</svg>`;
}

/* =====================================================================
   PAGES
   ===================================================================== */
const FEATURES = [
  ["رفع فيديو الماتش", "ok"], ["اكتشاف اللاعبين (YOLO)", "ok"], ["التتبع (بايت تراك)", "ok"],
  ["فيديو عليه IDs", "ok"], ["JSON للاعبين", "ok"], ["ربط الـ IDs بأسماء يدويًا", "ok"],
  ["Heatmap (إطار الفيديو + ملعب بالمتر)", "ok"], ["تقسيم الفرق بلون التيشيرت", "beta"],
  ["التعرف التلقائي على الأسماء (من رقم التيشيرت)", "beta"], ["التعرف على أرقام التيشيرتات (OCR اختياري)", "beta"],
  ["حساب السرعة والمسافة (بعد معايرة الملعب)", "ok"], ["اكتشاف الكرة", "beta"],
  ["تحليل التمريرات والتسديدات والاستحواذ", "beta"], ["تقييم مطابقة الأداء للخطة", "beta"],
];

async function Home(v) {
  v.innerHTML = '<div class="empty">جاري التحميل…</div>';
  let matches = []; try { matches = await getMatches(); } catch (e) { v.innerHTML = `<div class="note">تعذر الاتصال بالسيرفر: ${esc(e.message)}</div>`; return; }
  const done = matches.filter((m) => m.status === "completed");
  const tracked = done.reduce((a, m) => a + (m.result?.unique_tracked_players || 0), 0);
  const hours = done.reduce((a, m) => a + (m.result?.duration_seconds || 0), 0);
  let chart = '<div class="empty">ارفع مباراة لتظهر الإحصائيات هنا.</div>', last = done[0];
  if (last) {
    try {
      const s = await getSummary(last.job_id);
      chart = barChart(s.players.slice(0, 8).map((p) => ({ label: trackLabel(last.job_id, p.track_id), value: p.seconds_visible })), "ث");
    } catch { /* ignore */ }
  }
  v.innerHTML = `
  <div class="grid g4">
    <div class="card kpi"><div class="v green">${matches.length}</div><div class="l">إجمالي المباريات</div></div>
    <div class="card kpi"><div class="v blue">${done.length}</div><div class="l">مباريات مكتملة</div></div>
    <div class="card kpi"><div class="v amber">${tracked}</div><div class="l">Track IDs مكتشفة</div></div>
    <div class="card kpi"><div class="v">${fmtDur(hours)}</div><div class="l">إجمالي مدة الفيديو</div></div>
    <div class="card kpi"><div class="v">${S.players.length}</div><div class="l">لاعبين مسجلين · ${S.teams.length} فريق</div></div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h2>أكثر الـ Tracks ظهورًا ${last ? `<span class="muted small">— ${esc(last.filename || "")}</span>` : ""}</h2>${chart}</div>
    <div class="card"><h2>حالة الميزات</h2>${FEATURES.map(([n, s]) => `<div class="feature-row"><span>${n}</span>${s === "ok" ? '<span class="badge ok">موجودة</span>' : '<span class="badge warn">تجريبية</span>'}</div>`).join("")}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="row c"><h2 style="margin:0">آخر المباريات</h2><div class="spacer"></div><a class="btn" href="#/upload">+ رفع مباراة</a></div>
    ${matches.length ? `<div class="table-wrap"><table><tr><th>الملف</th><th>التاريخ</th><th>الحالة</th><th></th></tr>${matches.slice(0, 5).map((m) => `<tr><td>${esc(m.filename || m.job_id.slice(0, 8))}</td><td>${fmtDate(m.created_at)}</td><td>${statusBadge(m.status)}</td><td>${m.status === "completed" ? `<a class="btn sm sec" href="#/performance?job=${m.job_id}">الأداء</a>` : ""}</td></tr>`).join("")}</table></div>` : '<div class="empty">لا توجد مباريات.</div>'}
  </div>`;
}

/* ---- Upload ---- */
let pollTimer = null;
async function Upload(v) {
  v.innerHTML = `
  <div class="card">
    <div class="drop" id="drop"><div class="big">🎬</div><b>اسحب فيديو المباراة هنا أو اضغط للاختيار</b><div class="muted small">MP4 · AVI · MOV · MKV — يفضّل كاميرا ثابتة ومرتفعة تظهر أكبر جزء من الملعب</div></div>
    <input type="file" id="file" accept=".mp4,.avi,.mov,.mkv,video/*" hidden>
    <div id="upState" style="margin-top:16px"></div>
  </div>
  <div class="note info" style="margin-top:16px">المعالجة تتم على جهازك بالكامل. أول مرة بيتحمّل موديل YOLO تلقائيًا. على CPU الفيديو الطويل ممكن ياخد وقت — الأفضل تجرّب بمقطع قصير (30–60 ثانية) الأول.</div>`;
  const drop = $("#drop"), file = $("#file");
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); };
  file.onchange = () => file.files[0] && send(file.files[0]);

  function send(f) {
    const st = $("#upState");
    st.innerHTML = `<div class="row c"><b>${esc(f.name)}</b><span class="muted small">${(f.size / 1048576).toFixed(1)} MB</span></div><div class="bar" style="margin:8px 0"><i id="pb"></i></div><div id="pm" class="muted small">جاري الرفع…</div>`;
    const fd = new FormData(); fd.append("video", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/matches/upload"));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { $("#pb").style.width = (e.loaded / e.total) * 30 + "%"; $("#pm").textContent = `جاري الرفع… ${Math.round((e.loaded / e.total) * 100)}%`; } };
    xhr.onerror = () => { st.innerHTML = '<div class="note">فشل الاتصال بالسيرفر.</div>'; };
    xhr.onload = () => {
      let d = {}; try { d = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status !== 202) { st.innerHTML = `<div class="note">${esc(d.detail || "فشل الرفع")}</div>`; return; }
      track(d.job_id);
    };
    xhr.send(fd);
  }
  function track(jobId) {
    clearInterval(pollTimer);
    const tick = async () => {
      let j; try { j = await api(`/matches/${jobId}`); } catch { return; }
      if (!$("#pb")) { clearInterval(pollTimer); return; }
      $("#pb").style.width = 30 + j.progress * 0.7 + "%";
      $("#pm").innerHTML = `${statusBadge(j.status)} ${esc(j.message)} — ${j.progress}%`;
      if (j.status === "completed") {
        clearInterval(pollTimer);
        $("#upState").insertAdjacentHTML("beforeend", `<div class="row" style="margin-top:12px"><a class="btn" href="#/performance?job=${jobId}">عرض الأداء</a><a class="btn sec" href="${apiUrl(`/matches/${jobId}/video`)}" target="_blank">الفيديو المعلّم</a><a class="btn sec" href="#/players?job=${jobId}">ربط اللاعبين</a></div>`);
        toast("اكتملت المعالجة ✅");
      } else if (j.status === "failed") {
        clearInterval(pollTimer);
        $("#upState").insertAdjacentHTML("beforeend", `<div class="note" style="margin-top:12px">${esc(j.error || "خطأ غير معروف")}</div>`);
      }
    };
    tick(); pollTimer = setInterval(tick, 1500);
  }
}

/* ---- History ---- */
async function History(v) {
  async function draw() {
    let ms; try { ms = await getMatches(); } catch (e) { v.innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
    if (!$("#histBody")) v.innerHTML = '<div class="card"><div class="row c"><h2 style="margin:0">سجل المباريات</h2><div class="spacer"></div><a class="btn" href="#/upload">+ رفع مباراة</a></div><div id="histBody"></div></div>';
    $("#histBody").innerHTML = ms.length ? `<div class="table-wrap"><table><tr><th>الملف</th><th>التاريخ</th><th>الحالة</th><th>المدة</th><th>Tracks</th><th></th></tr>${ms.map((m) => `<tr>
      <td>${esc(m.filename || m.job_id.slice(0, 8))}</td><td>${fmtDate(m.created_at)}</td>
      <td>${statusBadge(m.status)}${m.status === "processing" ? ` ${m.progress}%` : ""}</td>
      <td>${m.result ? fmtDur(m.result.duration_seconds) : "—"}</td><td>${m.result ? m.result.unique_tracked_players : "—"}</td>
      <td class="row">${m.status === "completed" ? `<a class="btn sm" href="#/performance?job=${m.job_id}">الأداء</a><a class="btn sm sec" href="${apiUrl(`/matches/${m.job_id}/video`)}" target="_blank">فيديو</a><a class="btn sm sec" href="${apiUrl(`/matches/${m.job_id}/result`)}" download>JSON</a><a class="btn sm sec" href="#/reports?job=${m.job_id}">تقرير</a>` : ""}
      ${m.status !== "processing" && m.status !== "queued" ? `<button class="btn sm danger" data-del="${m.job_id}">حذف</button>` : ""}</td></tr>`).join("")}</table></div>` : '<div class="empty">لا توجد مباريات بعد.</div>';
    $$("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("حذف المباراة وكل ملفاتها؟")) return;
      try { await api(`/matches/${b.dataset.del}`, { method: "DELETE" }); delete summaryCache[b.dataset.del]; toast("تم الحذف"); draw(); } catch (e) { toast(e.message); }
    });
    clearInterval(pollTimer);
    if (ms.some((m) => m.status === "processing" || m.status === "queued")) pollTimer = setTimeout(() => $("#histBody") && draw(), 2500);
  }
  draw();
}

/* ---- Team Management ---- */
async function Teams(v) {
  function draw() {
    v.innerHTML = `
    <div class="grid g2">
      <div class="card"><h2>الفرق</h2>
        <form id="teamForm" class="row"><label class="f">اسم الفريق<input name="name" required></label><label class="f">اللون<input type="color" name="color" value="#22c55e"></label><button class="btn">إضافة</button></form>
        <div style="margin-top:14px">${S.teams.length ? S.teams.map((t) => `<div class="feature-row"><span><span class="swatch" style="background:${t.color}"></span> ${esc(t.name)} <span class="muted small">(${S.players.filter((p) => p.teamId === t.id).length} لاعب)</span></span><button class="btn sm danger" data-delteam="${t.id}">حذف</button></div>`).join("") : '<div class="empty">لا توجد فرق.</div>'}</div></div>
      <div class="card"><h2>إضافة لاعب</h2>
        <form id="plForm" class="row">
          <label class="f">الاسم<input name="name" required></label>
          <label class="f">الرقم<input name="number" type="number" min="0" max="99" style="width:80px"></label>
          <label class="f">المركز<select name="pos">${["GK", "DF", "DM", "MF", "AM", "FW"].map((p) => `<option>${p}</option>`).join("")}</select></label>
          <label class="f">الفريق<select name="teamId">${S.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("") || '<option value="">— أضف فريقًا أولًا —</option>'}</select></label>
          <button class="btn" ${S.teams.length ? "" : "disabled"}>إضافة</button>
        </form></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>قائمة اللاعبين</h2>
      ${S.players.length ? `<div class="table-wrap"><table><tr><th>#</th><th>الاسم</th><th>المركز</th><th>الفريق</th><th></th></tr>${[...S.players].sort((a, b) => (a.number || 99) - (b.number || 99)).map((p) => `<tr><td>${p.number ?? "—"}</td><td>${esc(p.name)}</td><td>${esc(p.pos)}</td><td>${teamOf(p.teamId) ? `<span class="swatch" style="background:${teamOf(p.teamId).color}"></span> ${esc(teamOf(p.teamId).name)}` : "—"}</td><td><button class="btn sm danger" data-delpl="${p.id}">حذف</button></td></tr>`).join("")}</table></div>` : '<div class="empty">لا يوجد لاعبين.</div>'}
    </div>
    <div class="note info" style="margin-top:16px">بيانات الفرق واللاعبين محفوظة في متصفحك (localStorage). خد نسخة احتياطية من صفحة الإعدادات.</div>`;
    $("#teamForm").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); S.teams.push({ id: uid(), name: f.get("name").trim(), color: f.get("color") }); save(); draw(); };
    $("#plForm").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); S.players.push({ id: uid(), name: f.get("name").trim(), number: f.get("number") ? +f.get("number") : null, pos: f.get("pos"), teamId: f.get("teamId") }); save(); draw(); };
    $$("[data-delteam]").forEach((b) => b.onclick = () => { if (!confirm("حذف الفريق ولاعبيه؟")) return; const id = b.dataset.delteam; const gone = S.players.filter((p) => p.teamId === id).map((p) => p.id); S.players = S.players.filter((p) => p.teamId !== id); S.teams = S.teams.filter((t) => t.id !== id); cleanMaps(gone); save(); draw(); });
    $$("[data-delpl]").forEach((b) => b.onclick = () => { S.players = S.players.filter((p) => p.id !== b.dataset.delpl); cleanMaps([b.dataset.delpl]); save(); draw(); });
  }
  draw();
}
function cleanMaps(playerIds) {
  for (const j of Object.values(S.mappings)) for (const t of Object.keys(j)) if (playerIds.includes(j[t])) delete j[t];
}

/* ---- shared analysis helpers ---- */
const analysisCache = {};
async function getAnalysis(job, force) {
  if (force || !analysisCache[job]) analysisCache[job] = await api(`/matches/${job}/analysis`);
  return analysisCache[job];
}
const clusterTeamName = (job, label) => teamOf((S.clusterTeams[job] || {})[label])?.name || `الفريق ${label == 0 ? "أ" : "ب"}`;
const swatch = (rgb) => `<span class="swatch" style="background:rgb(${rgb.join(",")})"></span>`;
const teamChip = (an, job, tid) => {
  const l = an?.teams?.labels?.[tid];
  return l === undefined ? "—" : `${swatch(an.teams.colors[l])} ${esc(clusterTeamName(job, l))}`;
};
const kmh = (v) => (v == null ? "—" : v.toFixed(1));

/* horizontal pitch on canvas (metres) */
function drawPitchCanvas(c, L, W) {
  const ctx = c.getContext("2d"), w = c.width, h = c.height, sx = w / L, sy = h / W, k = Math.min(1, L / 105);
  ctx.fillStyle = "#15803d"; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 10; i++) { if (i % 2) { ctx.fillStyle = "rgba(0,0,0,.07)"; ctx.fillRect((w * i) / 10, 0, w / 10, h); } }
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 9.15 * k * sx, 9.15 * k * sy, 0, 0, 7); ctx.stroke();
  const pb = (x0, dir) => {
    const d = 16.5 * k, pw = 40.3 * k, gd = 5.5 * k, gw = 18.32 * k;
    ctx.strokeRect(dir > 0 ? x0 : x0 - d * sx, h / 2 - (pw / 2) * sy, d * sx, pw * sy);
    ctx.strokeRect(dir > 0 ? x0 : x0 - gd * sx, h / 2 - (gw / 2) * sy, gd * sx, gw * sy);
  };
  pb(2, 1); pb(w - 2, -1);
}
function drawPitchHeat(c, heat, L, W) {
  drawPitchCanvas(c, L, W);
  const ctx = c.getContext("2d"), gy = heat.length, gx = heat[0].length, cw = c.width / gx, ch = c.height / gy;
  const max = Math.max(1, ...heat.flat());
  ctx.filter = "blur(10px)";
  for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
    if (!heat[y][x]) continue;
    ctx.fillStyle = heatColor(Math.sqrt(heat[y][x] / max));
    ctx.fillRect(x * cw - cw / 2, y * ch - ch / 2, cw * 2, ch * 2);
  }
  ctx.filter = "none";
}

/* ---- pitch calibration panel ---- */
async function mountCalib(box, job, onSaved) {
  let cal = null; try { cal = await api(`/matches/${job}/calibration`); } catch { /* not calibrated */ }
  const presets = { 5: [40, 20], 7: [60, 40], 11: [105, 68] };
  let pts = cal ? cal.points.map((p) => [...p]) : [];
  const L0 = cal?.length ?? 105, W0 = cal?.width ?? 68;
  const names = ["١ بعيد-يسار", "٢ بعيد-يمين", "٣ قريب-يمين", "٤ قريب-يسار"];
  box.innerHTML = `
    <div class="row">
      <label class="f">حجم الملعب<select id="cPre"><option value="">مخصص</option><option value="5">5 لاعبين (40×20)</option><option value="7">7 لاعبين (60×40)</option><option value="11" ${L0 === 105 ? "selected" : ""}>11 لاعب (105×68)</option></select></label>
      <label class="f">الطول (م)<input id="cL" type="number" value="${L0}" style="width:90px"></label>
      <label class="f">العرض (م)<input id="cW" type="number" value="${W0}" style="width:90px"></label>
      <button class="btn sec" id="cReset">مسح النقاط</button><button class="btn" id="cSave">حفظ المعايرة</button>
      ${cal ? '<button class="btn danger" id="cDel">إلغاء المعايرة</button>' : ""}
    </div>
    <p class="muted small">اضغط على أركان الملعب الأربعة بالترتيب كما تظهر في الصورة: <b>${names.join(" ← ")}</b>. لازم الملعب يكون طوله أفقي في الصورة والأركان ظاهرة. كل ما كانت النقط أدق، كانت الأمتار والسرعة أدق.</p>
    <div id="cMsg" class="small"></div>
    <canvas id="cCv" style="width:100%;cursor:crosshair"></canvas>`;
  const cv = $("#cCv", box), ctx = cv.getContext("2d"), img = new Image();
  const paint = () => {
    ctx.drawImage(img, 0, 0); const r = Math.max(6, cv.width / 140);
    ctx.lineWidth = r / 2.5; ctx.strokeStyle = "#22c55e"; ctx.fillStyle = "#22c55e"; ctx.font = `${r * 2.4}px sans-serif`;
    if (pts.length > 1) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (pts.length === 4) ctx.closePath(); ctx.stroke(); }
    pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(i + 1, p[0] + r * 1.3, p[1] - r * 1.3); ctx.fillStyle = "#22c55e"; });
  };
  img.onload = () => { cv.width = img.naturalWidth; cv.height = img.naturalHeight; paint(); };
  img.onerror = () => { $("#cMsg", box).innerHTML = '<div class="note">تعذر تحميل أول فريم من الفيديو.</div>'; };
  img.src = apiUrl(`/matches/${job}/frame`) + `?t=${Date.now()}`;
  cv.onclick = (e) => {
    if (pts.length >= 4) return;
    const r = cv.getBoundingClientRect();
    pts.push([((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]); paint();
  };
  $("#cReset", box).onclick = () => { pts = []; paint(); };
  $("#cPre", box).onchange = (e) => { const p = presets[e.target.value]; if (p) { $("#cL", box).value = p[0]; $("#cW", box).value = p[1]; } };
  const del = $("#cDel", box);
  if (del) del.onclick = async () => { await api(`/matches/${job}/calibration`, { method: "DELETE" }); delete analysisCache[job]; toast("تم إلغاء المعايرة"); onSaved(); };
  $("#cSave", box).onclick = async () => {
    if (pts.length !== 4) { toast("حدد 4 نقاط"); return; }
    try {
      await api(`/matches/${job}/calibration`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pts, length: +$("#cL", box).value, width: +$("#cW", box).value }) });
      delete analysisCache[job]; toast("تم حفظ المعايرة ✅"); onSaved();
    } catch (e) { $("#cMsg", box).innerHTML = `<div class="note">${esc(e.message)}</div>`; }
  };
}

/* ---- Players (roster + automatic suggestions + manual mapping) ---- */
async function Players(v, q) {
  let matches = []; try { matches = await getMatches(); } catch { /* ignore */ }
  const done = matches.filter((m) => m.status === "completed");
  let job = q.job && done.find((m) => m.job_id === q.job) ? q.job : done[0]?.job_id;
  const minSec = 3;

  async function draw() {
    let tracks = [], an = null, jersey = {};
    if (job) {
      try { tracks = (await getSummary(job)).players.filter((p) => p.seconds_visible >= minSec); } catch { /* ignore */ }
      try { an = await getAnalysis(job); } catch { /* ignore */ }
      try { jersey = await api(`/matches/${job}/jerseys`); } catch { /* not read yet */ }
    }
    const counts = {}; for (const m of Object.values(S.mappings)) for (const pid of Object.values(m)) counts[pid] = (counts[pid] || 0) + 1;
    const ct = S.clusterTeams[job] || {};
    v.innerHTML = `
    <div class="card"><h2>اللاعبون المسجلون</h2>
      ${S.players.length ? `<div class="table-wrap"><table><tr><th>#</th><th>الاسم</th><th>المركز</th><th>الفريق</th><th>مباريات مربوطة</th></tr>${S.players.map((p) => `<tr><td>${p.number ?? "—"}</td><td>${esc(p.name)}</td><td>${esc(p.pos)}</td><td>${esc(teamOf(p.teamId)?.name || "—")}</td><td>${counts[p.id] || 0}</td></tr>`).join("")}</table></div>` : '<div class="empty">سجّل لاعبين من صفحة <a href="#/teams">إدارة الفريق</a> أولًا.</div>'}
    </div>
    <div class="card" style="margin-top:16px"><div class="row c"><h2 style="margin:0">ربط Tracks بلاعبين</h2><div class="spacer"></div>${matchSelect(matches, job)}</div>
      ${!job ? noMatches : `
      <div class="row" style="margin:12px 0">
        ${an?.teams ? [0, 1].map((l) => `<label class="f">${swatch(an.teams.colors[l])} فريق اللون ده هو<select data-cl="${l}"><option value="">— غير محدد —</option>${S.teams.map((t) => `<option value="${t.id}" ${ct[l] === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`).join("") : '<span class="note">لا يوجد تقسيم تلقائي للفرق (فيديو قديم أو لاعبين قليلين).</span>'}
        <button class="btn sec" id="ocrBtn">🔢 قراءة أرقام التيشيرتات (OCR)</button>
        <button class="btn" id="applyBtn" ${Object.keys(jersey).length ? "" : "disabled"}>تطبيق الاقتراحات التلقائية</button>
      </div>
      <div id="ocrMsg" class="small muted"></div>
      <p class="muted small">الفرق بتتقسم تلقائيًا من لون التيشيرت. القراءة التلقائية للأرقام تجريبية (محتاجة <code>pip install easyocr</code> وبتنجح مع اللاعبين القريبين فقط)، والاقتراحات بتتطابق مع أرقام اللاعبين المسجلين — راجعها قبل الاعتماد عليها.</p>
      ${tracks.length ? `<div class="table-wrap"><table><tr><th>Track</th><th>الفريق</th><th>ظهور</th><th>رقم مقروء</th><th>اللاعب</th></tr>${tracks.map((t) => { const j = jersey[t.track_id]; return `<tr><td>#${t.track_id}</td><td>${teamChip(an, job, t.track_id)}</td><td>${fmtDur(t.seconds_visible)}</td><td>${j ? `<b>${j.number}</b> <span class="muted small">(${Math.round(j.share * 100)}%)</span>` : "—"}</td><td><select data-track="${t.track_id}"><option value="">— غير محدد —</option>${S.players.map((p) => `<option value="${p.id}" ${(S.mappings[job] || {})[t.track_id] === p.id ? "selected" : ""}>${esc(playerLabel(p))}</option>`).join("")}</select></td></tr>`; }).join("")}</table></div>` : '<div class="empty">لا توجد Tracks.</div>'}`}
    </div>`;
    const ms = $("#matchSel"); if (ms) ms.onchange = () => { job = ms.value; draw(); };
    $$("[data-track]").forEach((s) => s.onchange = () => {
      S.mappings[job] = S.mappings[job] || {};
      if (s.value) S.mappings[job][s.dataset.track] = s.value; else delete S.mappings[job][s.dataset.track];
      save(); toast("تم الحفظ");
    });
    $$("[data-cl]").forEach((s) => s.onchange = () => { S.clusterTeams[job] = S.clusterTeams[job] || {}; S.clusterTeams[job][s.dataset.cl] = s.value || undefined; save(); draw(); });
    const ob = $("#ocrBtn");
    if (ob) ob.onclick = async () => {
      ob.disabled = true; $("#ocrMsg").textContent = "جاري قراءة الأرقام… ممكن ياخد من 1 لـ 5 دقايق على CPU.";
      try { jersey = await api(`/matches/${job}/jerseys`, { method: "POST" }); toast(`تمت قراءة ${Object.keys(jersey).length} رقم`); draw(); }
      catch (e) { $("#ocrMsg").innerHTML = `<div class="note">${esc(e.message)}</div>`; ob.disabled = false; }
    };
    const ab = $("#applyBtn");
    if (ab) ab.onclick = () => {
      let n = 0; S.mappings[job] = S.mappings[job] || {};
      for (const [tid, j] of Object.entries(jersey)) {
        if (S.mappings[job][tid] || j.share < 0.5) continue;
        const label = an?.teams?.labels?.[tid], wantTeam = label !== undefined ? ct[label] : null;
        let c = S.players.filter((p) => p.number === j.number && (!wantTeam || p.teamId === wantTeam));
        if (c.length === 1) { S.mappings[job][tid] = c[0].id; n++; }
      }
      save(); toast(n ? `تم ربط ${n} لاعب تلقائيًا` : "لا توجد اقتراحات مؤكدة"); draw();
    };
  }
  draw();
}

/* ---- Player Performance ---- */
async function Performance(v, q) {
  let matches = []; try { matches = await getMatches(); } catch (e) { v.innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  const done = matches.filter((m) => m.status === "completed");
  if (!done.length) { v.innerHTML = noMatches; return; }
  let job = done.find((m) => m.job_id === q.job)?.job_id || done[0].job_id, track = q.track ? +q.track : null, calOpen = false;

  async function draw() {
    const s = await getSummary(job); let an = null;
    try { an = await getAnalysis(job); } catch { /* ignore */ }
    const list = [...s.players].filter((p) => p.seconds_visible >= 1);
    if (!list.find((p) => p.track_id === track)) track = list[0]?.track_id ?? null;
    const p = list.find((x) => x.track_id === track);
    const pl = p && mapped(job, p.track_id);
    const M = an?.metrics?.[track], EV = an?.events?.per_player?.[track];
    v.innerHTML = `
    <div class="card"><div class="row">${matchSelect(matches, job)}
      <label class="f">اللاعب / Track<select id="trSel">${list.map((x) => `<option value="${x.track_id}" ${x.track_id === track ? "selected" : ""}>${esc(trackLabel(job, x.track_id))} — ${fmtDur(x.seconds_visible)}</option>`).join("")}</select></label>
      <button class="btn sec" id="calToggle">📐 ${an?.calibrated ? "تعديل معايرة الملعب" : "معايرة الملعب (لحساب المسافة والسرعة)"}</button></div>
      <div id="calBox" style="margin-top:14px;${calOpen ? "" : "display:none"}"></div></div>
    ${!p ? '<div class="card empty" style="margin-top:16px">لا توجد Tracks.</div>' : `
    <div class="card" style="margin-top:16px"><h3 style="margin:0">${pl ? esc(playerLabel(pl)) + ` <span class="muted small">(${esc(teamOf(pl.teamId)?.name || "")} · ${esc(pl.pos)})</span>` : `Track #${p.track_id} <span class="muted small">— غير مربوط بلاعب. اربطه من صفحة اللاعبين</span>`} <span style="margin-inline-start:10px">${teamChip(an, job, p.track_id)}</span></h3></div>
    <div class="grid g4" style="margin-top:16px">
      <div class="card kpi"><div class="v green">${fmtDur(p.seconds_visible)}</div><div class="l">زمن الظهور في الفيديو</div></div>
      <div class="card kpi"><div class="v blue" dir="ltr">${fmtDur(p.first_seen_seconds)} – ${fmtDur(p.last_seen_seconds)}</div><div class="l">أول / آخر ظهور</div></div>
      <div class="card kpi"><div class="v">${Math.round((p.seconds_visible / s.duration_seconds) * 100)}%</div><div class="l">نسبة الحضور من مدة الفيديو</div></div>
      <div class="card kpi"><div class="v amber">${(p.avg_confidence * 100).toFixed(0)}%</div><div class="l">متوسط ثقة الاكتشاف</div></div>
    </div>
    ${M ? `<div class="grid g4" style="margin-top:16px">
      <div class="card kpi"><div class="v green">${num(Math.round(M.distance_m))} م</div><div class="l">المسافة المقطوعة (أثناء الظهور)</div></div>
      <div class="card kpi"><div class="v blue">${kmh(M.avg_speed_kmh)} كم/س</div><div class="l">متوسط السرعة</div></div>
      <div class="card kpi"><div class="v amber">${kmh(M.max_speed_kmh)} كم/س</div><div class="l">أعلى سرعة</div></div>
      <div class="card kpi"><div class="v">${M.sprints}</div><div class="l">سبرنتات (+25 كم/س لثانية فأكثر)</div></div>
      ${EV ? `<div class="card kpi"><div class="v">${EV.touches}</div><div class="l">استحواذات/لمسات</div></div><div class="card kpi"><div class="v">${EV.passes} / ${EV.received}</div><div class="l">تمريرات / استلام</div></div><div class="card kpi"><div class="v">${EV.lost}</div><div class="l">كرات ضايعة</div></div>` : ""}
    </div>` : `<div class="note" style="margin-top:16px">المسافة والسرعة والـ Heatmap بالمتر محتاجة <b>معايرة الملعب</b> — اضغط الزر فوق وحدد الأركان الأربعة (دقيقة واحدة لكل فيديو).</div>`}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Heatmap ${M ? "(على الملعب بالمتر)" : "(على إطار الفيديو)"}</h3><div id="heatBox"></div></div>
      <div class="card"><h3>مسار الحركة (أخضر ← أحمر)</h3><div id="pathBox"></div></div>
    </div>
    <p class="muted small">الأرقام تقديرية: أخطاء الكاميرا والـ bounding box بتأثر على المسافة والسرعة، واللاعب بيتحسب بس وهو ظاهر في الإطار.</p>`}`;
    const ms = $("#matchSel"); if (ms) ms.onchange = () => { job = ms.value; track = null; calOpen = false; draw(); };
    const ts = $("#trSel"); if (ts) ts.onchange = () => { track = +ts.value; draw(); };
    $("#calToggle").onclick = () => { calOpen = !calOpen; const b = $("#calBox"); b.style.display = calOpen ? "" : "none"; if (calOpen && !b.dataset.ready) { b.dataset.ready = 1; mountCalib(b, job, () => { calOpen = false; draw(); }); } };
    if (calOpen) { const b = $("#calBox"); b.dataset.ready = 1; mountCalib(b, job, () => { calOpen = false; draw(); }); }
    if (p) {
      const a = frameCanvas(640, 360), b = frameCanvas(640, 360);
      if (M) { a.width = 700; a.height = Math.round((700 * an.pitch.width) / an.pitch.length); drawPitchHeat(a, M.heat, an.pitch.length, an.pitch.width); }
      else drawHeat(a, p.heat);
      if (M) {
        b.width = a.width; b.height = a.height; drawPitchCanvas(b, an.pitch.length, an.pitch.width);
        const ctx = b.getContext("2d"), sx = b.width / an.pitch.length, sy = b.height / an.pitch.width; ctx.lineWidth = 2.5;
        for (let i = 1; i < M.path.length; i++) { ctx.strokeStyle = `hsl(${140 - (i / M.path.length) * 140},85%,60%)`; ctx.beginPath(); ctx.moveTo(M.path[i - 1][1] * sx, M.path[i - 1][2] * sy); ctx.lineTo(M.path[i][1] * sx, M.path[i][2] * sy); ctx.stroke(); }
      } else drawPath(b, p.path);
      $("#heatBox").appendChild(a); $("#pathBox").appendChild(b);
    }
  }
  draw();
}

/* ---- Tactical Builder ---- */
async function Builder(v) {
  let cur = { id: uid(), name: "تشكيلة جديدة", preset: "4-4-2", slots: buildFormation("4-4-2") };
  function draw() {
    const teamPlayers = S.players;
    v.innerHTML = `
    <div class="split">
      <div class="card"><div class="pitch-wrap" id="pitchBox"></div><p class="muted small" style="text-align:center">اسحب اللاعبين لتغيير مراكزهم · الهجوم لأعلى</p></div>
      <div>
        <div class="card"><div class="row">
          <label class="f">النظام<select id="preset">${Object.keys(PRESETS).map((k) => `<option ${k === cur.preset ? "selected" : ""}>${k}</option>`).join("")}</select></label>
          <label class="f">اسم التشكيلة<input id="fname" value="${esc(cur.name)}"></label>
          <button class="btn" id="saveF">حفظ</button>
        </div>
        ${S.formations.length ? `<div class="row c" style="margin-top:12px"><label class="f">تشكيلات محفوظة<select id="saved"><option value="">— اختر —</option>${S.formations.map((f) => `<option value="${f.id}">${esc(f.name)} (${esc(f.preset)})</option>`).join("")}</select></label><button class="btn sm danger" id="delF">حذف المحدد</button></div>` : ""}</div>
        <div class="card" style="margin-top:16px"><h3>تعيين اللاعبين</h3>
          ${teamPlayers.length ? `<div class="table-wrap"><table><tr><th>المركز</th><th>اللاعب</th></tr>${cur.slots.map((sl, i) => `<tr><td>${sl.role} <span class="muted small">${i + 1}</span></td><td><select data-slot="${i}"><option value="">—</option>${teamPlayers.map((p) => `<option value="${p.id}" ${sl.playerId === p.id ? "selected" : ""}>${esc(playerLabel(p))} (${esc(p.pos)})</option>`).join("")}</select></td></tr>`).join("")}</table></div>` : '<div class="empty">أضف لاعبين من <a href="#/teams">إدارة الفريق</a> لتعيينهم في المراكز.</div>'}
        </div>
      </div>
    </div>`;
    renderPitch();
    $("#preset").onchange = (e) => { cur.preset = e.target.value; cur.slots = buildFormation(cur.preset); draw(); };
    $("#fname").oninput = (e) => { cur.name = e.target.value; };
    $("#saveF").onclick = () => {
      const i = S.formations.findIndex((f) => f.id === cur.id);
      const copy = structuredClone(cur); if (i >= 0) S.formations[i] = copy; else S.formations.push(copy);
      save(); toast("تم حفظ التشكيلة"); draw();
    };
    const sv = $("#saved"); if (sv) sv.onchange = () => { const f = S.formations.find((x) => x.id === sv.value); if (f) { cur = structuredClone(f); draw(); } };
    const dl = $("#delF"); if (dl) dl.onclick = () => { const id = $("#saved").value; if (!id) return; S.formations = S.formations.filter((f) => f.id !== id); save(); toast("تم الحذف"); draw(); };
    $$("[data-slot]").forEach((s) => s.onchange = () => { cur.slots[+s.dataset.slot].playerId = s.value || null; renderPitch(); });
  }
  function renderPitch() {
    const inner = cur.slots.map((sl, i) => {
      const p = playerOf(sl.playerId), t = p && teamOf(p.teamId);
      const fill = t?.color || (sl.role === "GK" ? "#f59e0b" : "#38bdf8");
      const label = p ? (p.number ?? p.name[0]) : sl.role;
      return `<g class="slot" data-i="${i}" transform="translate(${px(sl.x)},${py(sl.y)})"><circle r="28" fill="${fill}" stroke="#fff" stroke-width="3"/><text text-anchor="middle" y="6" fill="#04210f" font-weight="800" font-size="20">${esc(label)}</text>${p ? `<text text-anchor="middle" y="52" fill="#fff" font-size="17" font-weight="700" stroke="rgba(0,0,0,.5)" stroke-width="3" paint-order="stroke">${esc(p.name.split(" ")[0])}</text>` : ""}</g>`;
    }).join("");
    const box = $("#pitchBox"); box.innerHTML = pitchSVG(inner, "pitch");
    const svg = $("#pitch");
    let drag = null;
    svg.onpointerdown = (e) => { const g = e.target.closest(".slot"); if (!g) return; drag = g; svg.setPointerCapture(e.pointerId); };
    svg.onpointermove = (e) => {
      if (!drag) return;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const c = pt.matrixTransform(svg.getScreenCTM().inverse());
      const sl = cur.slots[+drag.dataset.i];
      sl.x = Math.min(1, Math.max(0, (c.x - PM) / (PW - 2 * PM)));
      sl.y = Math.min(1, Math.max(0, (c.y - PM) / (PH - 2 * PM)));
      drag.setAttribute("transform", `translate(${px(sl.x)},${py(sl.y)})`);
    };
    svg.onpointerup = () => { drag = null; };
  }
  draw();
}

/* ---- Tactical Analysis ---- */
async function Analysis(v, q) {
  let matches = []; try { matches = await getMatches(); } catch (e) { v.innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  const done = matches.filter((m) => m.status === "completed");
  if (!done.length) { v.innerHTML = noMatches; return; }
  let job = done.find((m) => m.job_id === q.job)?.job_id || done[0].job_id, fid = S.formations[0]?.id || "", fitTeam = 0, fitRes = null, calOpen = false;

  async function draw() {
    const s = await getSummary(job); let an;
    try { an = await getAnalysis(job); } catch (e) { v.innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
    const tl = (l) => `${swatch(an.teams.colors[l])} ${esc(clusterTeamName(job, l))}`;
    const E = an.events, M = an.metrics;
    const poss = E?.possession;
    v.innerHTML = `
    <div class="card"><div class="row">${matchSelect(matches, job)}<button class="btn sec" id="calToggle">📐 ${an.calibrated ? "تعديل معايرة الملعب" : "معايرة الملعب"}</button></div>
      <div id="calBox" style="margin-top:14px;${calOpen ? "" : "display:none"}"></div></div>
    ${an.warnings.map((w) => `<div class="note" style="margin-top:12px">${esc(w)}</div>`).join("")}
    ${!an.calibrated ? `<div class="note info" style="margin-top:12px">عشان تظهر الأمتار والاستحواذ والتمريرات والتسديدات وتقييم التشكيلة، لازم <b>معايرة الملعب</b> الأول (دقيقة واحدة): اضغط الزر فوق وحدد أركان الملعب الأربعة.</div>` : `
    <div class="grid g4" style="margin-top:16px">
      <div class="card kpi"><div class="v green">${Object.values(M).filter((m) => m.seconds_valid >= 5).length}</div><div class="l">Tracks بقياسات (+5 ث)</div></div>
      <div class="card kpi"><div class="v blue">${E.passes.length}</div><div class="l">تمريرات مكتشفة</div></div>
      <div class="card kpi"><div class="v amber">${E.shots.length}</div><div class="l">تسديدات مكتشفة</div></div>
      <div class="card kpi"><div class="v">${E.ball_coverage_pct}%</div><div class="l">نسبة إطارات ظهرت فيها الكرة</div></div>
    </div>
    ${E.warning ? `<div class="note" style="margin-top:12px">${esc(E.warning)}</div>` : ""}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>شكل الفريقين (متوسط المراكز بالمتر)</h3><div id="shapeBox"></div></div>
      <div class="card"><h3>الاستحواذ والأحداث</h3>
        ${poss && an.teams ? `<div style="margin-bottom:10px">${[0, 1].map((l) => `<div class="row c" style="margin:6px 0"><span style="width:110px">${tl(l)}</span><div class="bar" style="flex:1"><i style="width:${poss[l] || 0}%"></i></div><b>${poss[l] ?? 0}%</b></div>`).join("")}</div>` : '<div class="muted small">الاستحواذ غير متاح (الكرة أو تقسيم الفرق ناقص).</div>'}
        ${an.teams ? `<div class="table-wrap"><table><tr><th>الفريق</th><th>تمريرات</th><th>كرات ضايعة</th><th>تسديدات</th></tr>${[0, 1].map((l) => `<tr><td>${tl(l)}</td><td>${E.passes.filter((e) => e.team === l).length}</td><td>${E.turnovers.filter((e) => e.team === l).length}</td><td>${E.shots.filter((e) => e.team === l).length}</td></tr>`).join("")}</table></div>` : ""}
        ${E.shots.length ? `<h3 style="margin-top:14px">التسديدات</h3>${E.shots.map((sh) => `<div class="feature-row"><span>${fmtDur(sh.time)} — ${sh.player != null ? esc(trackLabel(job, sh.player)) : "غير معروف"}</span><span class="muted">${sh.speed_kmh} كم/س</span></div>`).join("")}` : ""}
        <p class="muted small">الأحداث بتتحسب بالاعتماد على قرب الكرة من اللاعب (أقل من 2م) واتجاه وسرعة الكرة — دقتها بتعتمد بشدة على جودة اكتشاف الكرة.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>تقييم مطابقة الأداء للخطة (تجريبي)</h3>
      ${S.formations.length && an.teams ? `<div class="row">
        <label class="f">الفريق<select id="fitTeam">${[0, 1].map((l) => `<option value="${l}" ${l === fitTeam ? "selected" : ""}>${esc(clusterTeamName(job, l))}</option>`).join("")}</select></label>
        <label class="f">التشكيلة<select id="fSel">${S.formations.map((x) => `<option value="${x.id}" ${x.id === fid ? "selected" : ""}>${esc(x.name)} (${esc(x.preset)})</option>`).join("")}</select></label>
        <button class="btn" id="fitBtn">احسب</button></div>` : '<div class="muted">محتاج تشكيلة محفوظة من <a href="#/builder">Tactical Builder</a> + معايرة + تقسيم فرق.</div>'}
      <div id="fitOut" style="margin-top:12px"></div></div>
    <div class="note" style="margin-top:16px">التقييم بيقارن <b>شكل</b> توزيع اللاعبين (متوسط مراكزهم) بمراكز التشكيلة بعد إزالة إزاحة الفريق كله، وبيحدد اتجاه الهجوم تلقائيًا. ده قياس <b>الالتزام بالمراكز</b>، مش حكم على كفاءة اللاعب أو مناسبته للمركز (ده محتاج بيانات أكتر). الحارس بيتجاهل لو مش ظاهر.</div>`}`;
    const ms = $("#matchSel"); if (ms) ms.onchange = () => { job = ms.value; fitRes = null; calOpen = false; draw(); };
    const mount = () => { const b = $("#calBox"); b.dataset.ready = 1; mountCalib(b, job, () => { calOpen = false; draw(); }); };
    $("#calToggle").onclick = () => { calOpen = !calOpen; const b = $("#calBox"); b.style.display = calOpen ? "" : "none"; if (calOpen && !b.dataset.ready) mount(); };
    if (calOpen) mount();
    if (!an.calibrated) return;

    const c = document.createElement("canvas"); c.width = 700; c.height = Math.round((700 * an.pitch.width) / an.pitch.length);
    drawPitchCanvas(c, an.pitch.length, an.pitch.width);
    const ctx = c.getContext("2d"), sx = c.width / an.pitch.length, sy = c.height / an.pitch.width;
    Object.entries(M).filter(([, m]) => m.seconds_valid >= 5).forEach(([tid, m]) => {
      const l = an.teams?.labels?.[tid], pl = mapped(job, tid);
      ctx.fillStyle = l !== undefined ? `rgb(${an.teams.colors[l].join(",")})` : "#94a3b8"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.avg_x * sx, m.avg_y * sy, 11, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(pl?.number ?? tid, m.avg_x * sx, m.avg_y * sy - 16);
    });
    $("#shapeBox").appendChild(c);
    const ft = $("#fitTeam"), fs = $("#fSel");
    if (ft) { ft.onchange = () => { fitTeam = +ft.value; }; fs.onchange = () => { fid = fs.value; }; }
    const fb = $("#fitBtn");
    if (fb) fb.onclick = async () => {
      const f = S.formations.find((x) => x.id === fid); if (!f) return;
      try {
        fitRes = await api(`/matches/${job}/fit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: fitTeam, attack: "auto", slots: f.slots.map((sl) => ({ x: sl.x, y: sl.y, role: sl.role })) }) });
        $("#fitOut").innerHTML = `<div class="grid g4"><div class="card kpi"><div class="v green">${fitRes.team_score}</div><div class="l">متوسط التطابق (من 100)</div></div><div class="card kpi"><div class="v blue">${fitRes.attack_used === "right" ? "→ يمين" : "← يسار"}</div><div class="l">اتجاه الهجوم المُقدَّر</div></div></div>
        <div class="table-wrap" style="margin-top:10px"><table><tr><th>المركز في الخطة</th><th>اللاعب / Track</th><th>الانحراف (م)</th><th>التطابق</th></tr>${fitRes.players.map((p) => `<tr><td>${esc(p.role)}</td><td>${esc(trackLabel(job, p.track_id))}</td><td>${p.distance_m}</td><td><div class="bar" style="width:120px;display:inline-block"><i style="width:${p.score}%"></i></div> ${p.score}</td></tr>`).join("")}</table></div>`;
      } catch (e) { $("#fitOut").innerHTML = `<div class="note">${esc(e.message)}</div>`; }
    };
  }
  draw();
}

/* ---- Reports ---- */
async function Reports(v, q) {
  let matches = []; try { matches = await getMatches(); } catch (e) { v.innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  const done = matches.filter((m) => m.status === "completed");
  if (!done.length) { v.innerHTML = noMatches; return; }
  let job = done.find((m) => m.job_id === q.job)?.job_id || done[0].job_id;
  async function draw() {
    const m = done.find((x) => x.job_id === job), s = await getSummary(job);
    let an = null; try { an = await getAnalysis(job); } catch { /* ignore */ }
    const MM = an?.metrics || {};
    const list = s.players.filter((p) => p.seconds_visible >= 3);
    v.innerHTML = `
    <div class="card no-print"><div class="row">${matchSelect(matches, job)}<button class="btn" id="printBtn">🖨️ طباعة / حفظ PDF</button><button class="btn sec" id="csvBtn">⬇️ CSV</button></div></div>
    <div class="report" style="margin-top:16px">
      <h2 style="margin-top:0">تقرير المباراة — ${esc(m.filename || "")}</h2>
      <p>${fmtDate(m.created_at)} · المدة ${fmtDur(s.duration_seconds)} · ${s.players.length} Track</p>
      <h3>ملخص الظهور</h3>
      <table><tr><th>اللاعب / Track</th><th>الفريق</th><th>زمن الظهور</th><th>أول ظهور</th><th>آخر ظهور</th><th>الثقة</th>${an?.calibrated ? "<th>المسافة (م)</th><th>أعلى سرعة (كم/س)</th>" : ""}</tr>
      ${list.map((p) => { const pl = mapped(job, p.track_id); return `<tr><td>${esc(trackLabel(job, p.track_id))}</td><td>${esc((pl && teamOf(pl.teamId)?.name) || "—")}</td><td>${fmtDur(p.seconds_visible)}</td><td>${fmtDur(p.first_seen_seconds)}</td><td>${fmtDur(p.last_seen_seconds)}</td><td>${(p.avg_confidence * 100).toFixed(0)}%</td>${an?.calibrated ? `<td>${MM[p.track_id] ? Math.round(MM[p.track_id].distance_m) : "—"}</td><td>${MM[p.track_id] ? MM[p.track_id].max_speed_kmh : "—"}</td>` : ""}</tr>`; }).join("")}</table>
      <p style="color:#666;font-size:12px;margin-top:20px">ملاحظة: الـ Tracks تشمل أي شخص مكتشف (لاعبين وحكّام). المسافة والسرعة تظهر فقط بعد معايرة الملعب، وكلها أرقام تقديرية.</p>
    </div>`;
    $("#matchSel").onchange = (e) => { job = e.target.value; draw(); };
    $("#printBtn").onclick = () => window.print();
    $("#csvBtn").onclick = () => {
      const rows = [["track_id", "player", "team", "seconds_visible", "first_seen_s", "last_seen_s", "avg_confidence", "distance_m", "avg_speed_kmh", "max_speed_kmh", "sprints"]]
        .concat(s.players.map((p) => { const pl = mapped(job, p.track_id), x = MM[p.track_id] || {}; return [p.track_id, pl ? playerLabel(pl) : "", (pl && teamOf(pl.teamId)?.name) || "", p.seconds_visible, p.first_seen_seconds, p.last_seen_seconds, p.avg_confidence, x.distance_m ?? "", x.avg_speed_kmh ?? "", x.max_speed_kmh ?? "", x.sprints ?? ""]; }));
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `report_${job.slice(0, 8)}.csv`; a.click();
    };
  }
  draw();
}

/* ---- Settings ---- */
async function Settings(v) {
  v.innerHTML = `
  <div class="grid g2">
    <div class="card"><h2>الاتصال</h2>
      <label class="f">عنوان السيرفر (اتركه فارغًا لو الواجهة على نفس السيرفر)<input id="apiBase" value="${esc(S.settings.apiBase)}" placeholder="http://127.0.0.1:8000" style="width:100%"></label>
      <div class="row" style="margin-top:12px"><button class="btn" id="saveSet">حفظ</button><button class="btn sec" id="testSet">اختبار الاتصال</button></div><div id="testOut" class="small muted" style="margin-top:8px"></div></div>
    <div class="card"><h2>المظهر</h2><div class="row"><button class="btn sec" data-theme="dark">داكن</button><button class="btn sec" data-theme="light">فاتح</button></div></div>
    <div class="card"><h2>نسخة احتياطية</h2><p class="muted small">الفرق واللاعبون والتشكيلات وربط الـ Tracks محفوظة في المتصفح.</p>
      <div class="row"><button class="btn" id="exp">تصدير</button><button class="btn sec" id="imp">استيراد</button><input type="file" id="impFile" accept=".json" hidden></div></div>
    <div class="card"><h2>منطقة الخطر</h2><button class="btn danger" id="reset">مسح بيانات الفرق واللاعبين من المتصفح</button><p class="muted small">لا يحذف المباريات من السيرفر (احذفها من سجل المباريات).</p></div>
  </div>`;
  $("#saveSet").onclick = () => { S.settings.apiBase = $("#apiBase").value.trim().replace(/\/$/, ""); save(); toast("تم الحفظ"); health(); };
  $("#testSet").onclick = async () => { try { const d = await api("/api/health"); $("#testOut").textContent = "✅ متصل: " + d.project; } catch (e) { $("#testOut").textContent = "❌ " + e.message; } };
  $$("[data-theme]").forEach((b) => b.onclick = () => { S.settings.theme = b.dataset.theme; save(); applyTheme(); });
  $("#exp").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: "application/json" })); a.download = "football_analyzer_backup.json"; a.click(); };
  $("#imp").onclick = () => $("#impFile").click();
  $("#impFile").onchange = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); S = { ...DEFAULTS, ...d, settings: { ...DEFAULTS.settings, ...(d.settings || {}) } }; save(); applyTheme(); toast("تم الاستيراد"); Settings(v); } catch { toast("ملف غير صالح"); } };
  $("#reset").onclick = () => { if (confirm("مسح كل بيانات الفرق واللاعبين والتشكيلات؟")) { const st = S.settings; S = { ...structuredClone(DEFAULTS), settings: st }; save(); toast("تم المسح"); } };
}

/* =====================================================================
   ROUTER
   ===================================================================== */
const ROUTES = {
  home: ["🏠", "لوحة التحكم", Home], upload: ["⬆️", "رفع مباراة", Upload], history: ["🗂️", "سجل المباريات", History],
  players: ["👥", "اللاعبون", Players], performance: ["📈", "أداء اللاعب", Performance],
  builder: ["🧩", "Tactical Builder", Builder], analysis: ["🧠", "التحليل التكتيكي", Analysis],
  reports: ["📄", "التقارير", Reports], teams: ["🏟️", "إدارة الفريق", Teams], settings: ["⚙️", "الإعدادات", Settings],
};
function route() {
  clearInterval(pollTimer); clearTimeout(pollTimer);
  const [path, qs] = (location.hash || "#/home").slice(2).split("?");
  const key = ROUTES[path] ? path : "home";
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  $("#nav").innerHTML = Object.entries(ROUTES).map(([k, [i, t]]) => `<a href="#/${k}" class="${k === key ? "active" : ""}"><span>${i}</span>${t}</a>`).join("");
  $("#pageTitle").textContent = ROUTES[key][1];
  $("#sidebar").classList.remove("open");
  ROUTES[key][2]($("#view"), q);
}
async function health() {
  const b = $("#healthBox");
  try { await api("/api/health"); b.innerHTML = '<span class="dot ok"></span>السيرفر متصل · v0.3'; }
  catch { b.innerHTML = '<span class="dot bad"></span>السيرفر غير متصل'; }
}
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
$("#themeBtn").onclick = () => { S.settings.theme = S.settings.theme === "dark" ? "light" : "dark"; save(); applyTheme(); };
window.addEventListener("hashchange", route);
route(); health();
