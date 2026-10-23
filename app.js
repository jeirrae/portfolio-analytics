// Portfolio Analytics dashboard: loads visits from the Google Apps Script API, draws the charts,
// and lets you move visits to the Recycle Bin, restore them, or delete them forever. There is no editing.
const ENDPOINT = (window.PA_CONFIG || {}).endpoint || "";
const SECTIONS = ["Home", "Brands", "Services", "Projects", "Tools", "About Me", "Certifications", "Contact"];
const COLORS = { navy: "#010440", blue: "#034C8C", sky: "#88C1F2", orange: "#F2541B", line: "#e3e5ec", muted: "#5b6075" };

const $ = (s) => document.querySelector(s);
const state = { password: "", visits: [], bin: [], sheetUrl: "", range: "30", tab: "overview", search: "", selected: new Set(), binSelected: new Set() };
const charts = {};

const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};

/* ---------- API ---------- */

async function api(action, extra = {}) {
  if (!ENDPOINT) throw new Error("The dashboard isn't connected to your Google Sheet yet.");
  // A plain string body is sent as text/plain, which Apps Script accepts without a CORS preflight
  const res = await fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ action, password: state.password, ...extra }) });
  if (!res.ok) throw new Error("Couldn't reach your Google Sheet. Try again.");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  state.visits = data.visits || [];
  state.bin = data.bin || [];
  state.sheetUrl = data.sheetUrl || "";
  return data;
}

/* ---------- Login ---------- */

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter || $("#login-form button");
  btn.disabled = true;
  $("#login-error").textContent = "";
  state.password = $("#password").value;
  try {
    await api("list");
    session.set("pa_pw", state.password);
    showApp();
  } catch (err) {
    $("#login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function showApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  render();
}

$("#logout").addEventListener("click", () => {
  session.set("pa_pw", null);
  location.reload();
});

/* ---------- Controls ---------- */

$("#range").addEventListener("change", (e) => { state.range = e.target.value; render(); });
$("#refresh").addEventListener("click", () => run(() => api("list"), "Updated"));
$("#search").addEventListener("input", (e) => { state.search = e.target.value.toLowerCase(); renderVisits(); });

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
}));

$("#delete").addEventListener("click", () => {
  const ids = [...state.selected];
  run(() => api("delete", { ids }), `Moved ${plural(ids.length, "visit")} to the Recycle Bin`);
  state.selected.clear();
});
$("#restore").addEventListener("click", () => {
  const ids = [...state.binSelected];
  run(() => api("restore", { ids }), `Restored ${plural(ids.length, "visit")}`);
  state.binSelected.clear();
});
$("#purge").addEventListener("click", () => {
  const ids = [...state.binSelected];
  if (!confirm(`Delete ${plural(ids.length, "visit")} forever? This can't be undone.`)) return;
  run(() => api("purge", { ids }), `Deleted ${plural(ids.length, "visit")} forever`);
  state.binSelected.clear();
});

$("#export").addEventListener("click", exportCsv);

// Shares the portfolio's origin (jeirrae.github.io), so this flag is read by the portfolio tracker
const ignore = $("#ignore-me");
try { ignore.checked = localStorage.getItem("pa_ignore") === "1"; } catch {}
ignore.addEventListener("change", () => {
  try { ignore.checked ? localStorage.setItem("pa_ignore", "1") : localStorage.removeItem("pa_ignore"); } catch {}
  toast(ignore.checked ? "Your visits on this browser won't be counted" : "Your visits on this browser will be counted");
});

async function run(fn, message) {
  document.body.style.cursor = "progress";
  try { await fn(); render(); toast(message); }
  catch (err) { toast(err.message); }
  finally { document.body.style.cursor = ""; }
}

/* ---------- Helpers ---------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (sec) => {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m < 60 ? `${m}m ${String(s).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const viewedCount = (v) => SECTIONS.filter((s) => (v.sections?.[s] || 0) >= 1).length;
const countBy = (list, key) => {
  const m = new Map();
  list.forEach((v) => { const k = (typeof key === "function" ? key(v) : v[key]) || "Unknown"; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

function inRange(v) {
  if (state.range === "all") return true;
  return Date.now() - new Date(v.started).getTime() <= Number(state.range) * 864e5;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- Render ---------- */

function render() {
  const list = state.visits.filter(inRange);
  $("#visits-count").textContent = state.visits.length;
  $("#bin-count").textContent = state.bin.length;
  const sheet = $("#sheet");
  sheet.hidden = !state.sheetUrl;
  sheet.href = state.sheetUrl || "#";

  $("#kpi-unique").textContent = new Set(list.map((v) => v.visitorId)).size;
  $("#kpi-visits").textContent = list.length;
  $("#kpi-length").textContent = fmtTime(mean(list.map((v) => v.duration)));
  $("#kpi-sections").textContent = `${Math.round(mean(list.map(viewedCount)))}/${SECTIONS.length}`;

  renderCharts(list);
  renderTopSections(list);
  renderRank("#video-list", countBy(list.flatMap((v) => v.videos.map((n) => ({ n }))), "n"), "No videos played yet.");
  renderRank("#click-list", countBy(list.flatMap((v) => v.clicks.map((n) => ({ n }))), "n"), "No contact clicks yet.");
  renderVisits();
  renderBin();
}

function chart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = COLORS.muted;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.maintainAspectRatio = false;

const barOpts = (horizontal, tick) => ({
  indexAxis: horizontal ? "y" : "x",
  scales: {
    x: { grid: { display: horizontal, color: COLORS.line }, ticks: horizontal && tick ? { callback: tick } : { precision: 0 }, beginAtZero: true },
    y: { grid: { display: !horizontal, color: COLORS.line }, ticks: !horizontal && tick ? { callback: tick } : { precision: 0 }, beginAtZero: true },
  },
  plugins: { tooltip: { callbacks: tick ? { label: (c) => tick(c.raw) } : {} } },
});
// Only the single top value is orange, even when there is a tie
const highlight = (values) => { const top = values.indexOf(Math.max(...values)); return values.map((v, i) => (i === top && v > 0 ? COLORS.orange : COLORS.blue)); };

function renderCharts(list) {
  // Visits per day across the selected range
  const days = state.range === "all"
    ? Math.max(1, Math.ceil((Date.now() - Math.min(Date.now(), ...list.map((v) => new Date(v.started).getTime()))) / 864e5) + 1)
    : Number(state.range);
  const labels = [], counts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    counts.push(list.filter((v) => new Date(v.started).toDateString() === d.toDateString()).length);
  }
  chart("chart-time", {
    type: "line",
    data: { labels, datasets: [{ data: counts, borderColor: COLORS.blue, backgroundColor: "rgba(136,193,242,.3)", fill: true, cubicInterpolationMode: "monotone", pointRadius: 3, pointBackgroundColor: COLORS.orange }] },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: COLORS.line } }, x: { grid: { display: false } } } },
  });

  const avg = SECTIONS.map((s) => mean(list.map((v) => v.sections?.[s] || 0)));
  chart("chart-section-time", {
    type: "bar",
    data: { labels: SECTIONS, datasets: [{ data: avg, backgroundColor: highlight(avg), borderRadius: 8 }] },
    options: barOpts(false, fmtTime),
  });

  const pct = SECTIONS.map((s) => (list.length ? (list.filter((v) => (v.sections?.[s] || 0) >= 1).length / list.length) * 100 : 0));
  chart("chart-section-pct", {
    type: "bar",
    data: { labels: SECTIONS, datasets: [{ data: pct, backgroundColor: COLORS.blue, borderRadius: 8 }] },
    options: { ...barOpts(false, (v) => `${Math.round(v)}%`), scales: { ...barOpts(false, (v) => `${Math.round(v)}%`).scales, y: { max: 100, beginAtZero: true, ticks: { callback: (v) => `${v}%` }, grid: { color: COLORS.line } } } },
  });

  const countries = countBy(list, "country").slice(0, 10);
  chart("chart-country", {
    type: "bar",
    data: { labels: countries.map((c) => c[0]), datasets: [{ data: countries.map((c) => c[1]), backgroundColor: highlight(countries.map((c) => c[1])), borderRadius: 6 }] },
    options: barOpts(true),
  });

  const devices = ["Mobile", "Tablet", "Desktop"].map((d) => list.filter((v) => v.device === d).length);
  chart("chart-device", {
    type: "doughnut",
    data: { labels: ["Mobile", "Tablet", "Desktop"], datasets: [{ data: devices, backgroundColor: [COLORS.orange, COLORS.sky, COLORS.blue], borderWidth: 0 }] },
    options: { cutout: "62%", plugins: { legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } } },
  });
  $("#os-list").innerHTML = countBy(list, (v) => `${v.os || "Other"} · ${v.browser || "Other"}`).slice(0, 6)
    .map(([k, n]) => `<li>${esc(k)} <b>${n}</b></li>`).join("");

  const sources = countBy(list, "source").slice(0, 10);
  chart("chart-source", {
    type: "bar",
    data: { labels: sources.map((c) => c[0]), datasets: [{ data: sources.map((c) => c[1]), backgroundColor: highlight(sources.map((c) => c[1])), borderRadius: 6 }] },
    options: barOpts(true),
  });
}

function renderTopSections(list) {
  const ranked = SECTIONS.map((s) => [s, mean(list.map((v) => v.sections?.[s] || 0))]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  $("#top-sections").innerHTML = ranked.map(([s, t], i) =>
    `<div class="top-section"><span>#${i + 1}</span><strong>${esc(s)}</strong><span>${fmtTime(t)} average</span></div>`).join("");
}

function renderRank(sel, rows, emptyText) {
  const max = rows[0]?.[1] || 1;
  $(sel).innerHTML = rows.length
    ? rows.map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}</b><span class="bar"><i style="width:${(n / max) * 100}%"></i></span></li>`).join("")
    : `<li class="none">${emptyText}</li>`;
}

function renderVisits() {
  const rows = state.visits.filter(inRange).filter((v) => !state.search ||
    [v.country, v.city, v.device, v.os, v.browser, v.source, v.referrer].join(" ").toLowerCase().includes(state.search))
    .sort((a, b) => new Date(b.started) - new Date(a.started));
  [...state.selected].forEach((id) => { if (!state.visits.some((v) => v.id === id)) state.selected.delete(id); });

  $("#visits-body").innerHTML = rows.map((v) => `
    <tr class="${state.selected.has(v.id) ? "selected" : ""}">
      <td><input type="checkbox" data-id="${esc(v.id)}" ${state.selected.has(v.id) ? "checked" : ""} aria-label="Select visit"></td>
      <td>${esc(fmtDate(v.started))}</td>
      <td>${esc(v.country || "Unknown")}<small>${esc(v.city)}</small></td>
      <td>${esc(v.device)}<small>${esc(v.os)} · ${esc(v.browser)}</small></td>
      <td><span class="tag">${esc(v.source)}</span></td>
      <td>${fmtTime(v.duration)}</td>
      <td>${viewedCount(v)}/${SECTIONS.length}</td>
      <td>${v.videos.map((n) => `<span class="tag">${esc(n)}</span>`).join("") || "—"}</td>
      <td>${v.clicks.map((n) => `<span class="tag orange">${esc(n)}</span>`).join("") || "—"}</td>
    </tr>`).join("");
  $("#visits-empty").hidden = rows.length > 0;
  wireChecks("#visits-body", "#select-all", state.selected, "#delete", rows);
}

function renderBin() {
  const rows = [...state.bin].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  [...state.binSelected].forEach((id) => { if (!state.bin.some((v) => v.id === id)) state.binSelected.delete(id); });
  $("#bin-body").innerHTML = rows.map((v) => `
    <tr class="${state.binSelected.has(v.id) ? "selected" : ""}">
      <td><input type="checkbox" data-id="${esc(v.id)}" ${state.binSelected.has(v.id) ? "checked" : ""} aria-label="Select deleted visit"></td>
      <td>${esc(fmtDate(v.deletedAt))}</td>
      <td>${esc(fmtDate(v.started))}</td>
      <td>${esc(v.country || "Unknown")}<small>${esc(v.city)}</small></td>
      <td>${esc(v.device)}<small>${esc(v.os)} · ${esc(v.browser)}</small></td>
      <td><span class="tag">${esc(v.source)}</span></td>
      <td>${fmtTime(v.duration)}</td>
    </tr>`).join("");
  $("#bin-empty").hidden = rows.length > 0;
  wireChecks("#bin-body", "#bin-select-all", state.binSelected, ["#restore", "#purge"], rows);
}

function wireChecks(bodySel, allSel, set, buttons, rows) {
  const btns = [].concat(buttons).map((b) => $(b));
  const sync = () => {
    btns.forEach((b) => { b.disabled = set.size === 0; });
    const all = $(allSel);
    all.checked = rows.length > 0 && rows.every((r) => set.has(r.id));
    all.indeterminate = set.size > 0 && !all.checked;
  };
  $(bodySel).querySelectorAll("input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? set.add(cb.dataset.id) : set.delete(cb.dataset.id);
    cb.closest("tr").classList.toggle("selected", cb.checked);
    sync();
  }));
  $(allSel).onchange = (e) => {
    rows.forEach((r) => (e.target.checked ? set.add(r.id) : set.delete(r.id)));
    bodySel === "#visits-body" ? renderVisits() : renderBin();
  };
  sync();
}

/* ---------- CSV export ---------- */

function exportCsv() {
  const inBin = state.tab === "bin";
  const rows = inBin ? state.bin : state.visits.filter(inRange);
  const head = ["Visit ID", "Visitor ID", "Started", "Last seen", "Visit length (s)", "Country", "City", "Device", "OS", "Browser", "Screen",
    "Source", "Referrer", "Landing URL", "Sections viewed", ...SECTIONS.map((s) => `${s} (s)`), "Videos played", "Contact clicks"]
    .concat(inBin ? ["Deleted at"] : []);
  // Values starting with = + - @ are prefixed so spreadsheet apps don't treat them as formulas
  const cell = (x) => { let s = String(x ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head, ...rows.map((v) => [v.id, v.visitorId, v.started, v.lastSeen, v.duration, v.country, v.city, v.device, v.os, v.browser, v.screen,
    v.source, v.referrer, v.landing, viewedCount(v), ...SECTIONS.map((s) => v.sections?.[s] || 0), v.videos.join("; "), v.clicks.join("; ")]
    .concat(inBin ? [v.deletedAt] : []))].map((r) => r.map(cell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio-${inBin ? "recycle-bin" : "visits"}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${plural(rows.length, "row")}`);
}

/* ---------- Start ---------- */

(async () => {
  const saved = session.get("pa_pw");
  if (!saved) return;
  state.password = saved;
  try { await api("list"); showApp(); } catch { session.set("pa_pw", null); }
})();
