"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const fmt = (n, d = 2) => (n == null || n === "" ? "–" : Number(n).toFixed(d));
const signed = (n, d = 2) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);
const ordinal = n => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
const store = {
  get(k) { try { return localStorage.getItem("gbgh." + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("gbgh." + k, v); } catch { /* private mode */ } },
};

let DATA, TEAMS, BY_RID, WEEKS, N;
const state = {
  team: null, week: null,
  standingsSort: { key: "place", dir: 1 },
  pos: "QB", mode: "season", pWeek: "all", owner: "all", q: "", limit: 100,
  playerSort: { key: "fpts", dir: -1 },
};

/* ---------- theme ---------- */
function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", mode);
  $("#theme").textContent = "Theme: " + mode;
  store.set("theme", mode);
}
$("#theme").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  const cur = store.get("theme") || "auto";
  applyTheme(order[(order.indexOf(cur) + 1) % 3]);
  renderTrend();
});
applyTheme(store.get("theme") || "auto");

/* ---------- tooltip ---------- */
const tip = $("#tip");
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
  const top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
  tip.style.left = left + window.scrollX + "px";
  tip.style.top = top + window.scrollY + "px";
}
const hideTip = () => { tip.style.display = "none"; };

/* ---------- routing ---------- */
function route() {
  const view = (location.hash || "#overview").slice(1);
  const valid = ["overview", "heatmap", "weekly", "players"].includes(view) ? view : "overview";
  document.querySelectorAll("section.view").forEach(s => s.classList.toggle("active", s.id === "view-" + valid));
  document.querySelectorAll("nav.tabs a").forEach(a => {
    if (a.dataset.view === valid) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  hideTip();
  if (valid === "overview") renderTrend();
}
window.addEventListener("hashchange", route);

/* ---------- team picker ---------- */
function setTeam(rid) {
  state.team = rid;
  store.set("team", rid);
  $("#team-pick").value = rid;
  renderStandings(); renderTrend(); renderHeat(); renderWeekly();
}

/* ---------- overview ---------- */
function allGames() {
  const out = [];
  for (const t of TEAMS) for (const [wk, g] of Object.entries(t.games)) out.push({ t, wk: +wk, ...g });
  return out;
}

function renderTiles() {
  const games = allGames();
  const leader = TEAMS[0];
  const pfLeader = [...TEAMS].sort((a, b) => b.pf - a.pf)[0];
  const best = games.reduce((a, b) => (b.pts > a.pts ? b : a));
  const wins = games.filter(g => g.result === "Win");
  const close = wins.reduce((a, b) => (b.pts - b.oppPts < a.pts - a.oppPts ? b : a));
  const lucky = [...TEAMS].sort((a, b) => (b.w - b.expW) - (a.w - a.expW));
  const tile = (label, value, detail) => el("div", { class: "card tile" },
    el("div", { class: "label" }, label), el("div", { class: "value" }, value), el("div", { class: "detail" }, detail));
  $("#tiles").replaceChildren(
    tile("First place", leader.handle, `${leader.w}-${leader.l} · ${fmt(leader.pf)} points for`),
    tile("Most points for", fmt(pfLeader.pf), `${pfLeader.handle} · ${fmt(pfLeader.pfAvg)} per week`),
    tile("Best single week", fmt(best.pts), `${best.t.handle} · Week ${best.wk}`),
    tile("Closest game", fmt(close.pts - close.oppPts), `${close.t.handle} over ${BY_RID[close.opp].handle} · Week ${close.wk}`),
    tile("Luckiest / unluckiest", `${signed(lucky[0].w - lucky[0].expW, 1)} / ${signed(lucky[N - 1].w - lucky[N - 1].expW, 1)}`,
      `wins vs expected: ${lucky[0].handle} / ${lucky[N - 1].handle}`),
  );
}

const STANDING_COLS = [
  { key: "place", label: "#", get: t => t.place },
  { key: "team", label: "Team", l: true, get: t => t.handle.toLowerCase(), render: t => teamCell(t) },
  { key: "w", label: "W-L", get: t => t.w + t.t / 2, render: t => `${t.w}-${t.l}${t.t ? "-" + t.t : ""}` },
  { key: "pf", label: "PF", get: t => t.pf, render: t => fmt(t.pf) },
  { key: "pfAvg", label: "PF/G", get: t => t.pfAvg, render: t => fmt(t.pfAvg) },
  { key: "pa", label: "PA", get: t => t.pa, render: t => fmt(t.pa) },
  { key: "paAvg", label: "PA/G", get: t => t.paAvg, render: t => fmt(t.paAvg) },
  { key: "ap", label: "All-play", get: t => t.apW / Math.max(t.apW + t.apL, 1), render: t => `${t.apW}-${t.apL}` },
  { key: "expW", label: "Exp. W", get: t => t.expW, render: t => fmt(t.expW, 1) },
  { key: "vsExp", label: "W vs exp.", get: t => t.w - t.expW, render: t => diffBar(t.w - t.expW, 4) },
  { key: "luck", label: "Luck", get: t => t.luck, render: t => el("span", { class: t.luck > 0 ? "pos" : t.luck < 0 ? "neg" : "" }, signed(t.luck, 0)) },
  { key: "topHalf", label: "Top-half wks", get: t => t.topHalf },
];

function teamCell(t) {
  return el("div", { class: "team-cell" }, el("div", { class: "h" }, t.handle), el("div", { class: "n" }, t.name));
}

function diffBar(v, max) {
  const w = Math.min(Math.abs(v) / max, 1) * 30;
  const bar = el("span", { style: `width:${w}px;${v >= 0 ? "left:30px" : `left:${30 - w}px`};background:var(${v >= 0 ? "--div-pos" : "--div-neg"})` });
  return el("div", { class: "bar-cell" }, el("span", { class: v > 0 ? "pos" : v < 0 ? "neg" : "" }, signed(v, 1)),
    el("div", { class: "mini-bar", "aria-hidden": "true" }, bar));
}

function sortableTable(table, cols, rows, sort, onSort, rowAttrs = () => ({})) {
  const head = el("tr", {}, cols.map(c => {
    const active = sort.key === c.key;
    return el("th", {
      class: (c.l ? "l " : "") + (c.sortable === false ? "" : "sortable"), scope: "col",
      "aria-sort": active ? (sort.dir > 0 ? "ascending" : "descending") : null,
      tabindex: c.sortable === false ? null : 0,
      onclick: c.sortable === false ? null : () => onSort(c.key),
      onkeydown: e => { if (e.key === "Enter") onSort(c.key); },
    }, c.label);
  }));
  const col = cols.find(c => c.key === sort.key) || cols[0];
  const sorted = [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null) return 1; if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
  });
  const body = sorted.map(r => el("tr", rowAttrs(r), cols.map(c => {
    const v = c.render ? c.render(r) : c.get(r);
    return el("td", { class: c.l ? "l" : "" }, v == null ? "–" : v);
  })));
  table.replaceChildren(el("thead", {}, head), el("tbody", {}, body));
  return sorted;
}

function renderStandings() {
  const s = state.standingsSort;
  sortableTable($("#standings"), STANDING_COLS, TEAMS, s, key => {
    s.dir = s.key === key ? -s.dir : (["place", "team", "pa", "paAvg"].includes(key) ? 1 : -1);
    s.key = key;
    renderStandings();
  }, t => ({ class: t.rid === state.team ? "me" : null }));
}

/* ---------- trend chart ---------- */
function niceTicks(lo, hi, count = 5) {
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
  const ticks = [];
  const top = Math.ceil(hi / step) * step;
  for (let v = Math.floor(lo / step) * step; v <= top + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function renderTrend() {
  const box = $("#trend");
  if (!box.offsetParent || box.clientWidth < 120) return; // hidden or not laid out yet; ResizeObserver retries
  const W = box.clientWidth, H = Math.max(240, Math.min(340, W * 0.45));
  const m = { l: 40, r: 16, t: 12, b: 28 };
  const pts = TEAMS.flatMap(t => WEEKS.map(w => t.games[w]?.pts).filter(v => v != null));
  const ticks = niceTicks(Math.min(...pts), Math.max(...pts));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const x = i => WEEKS.length === 1 ? (m.l + W - m.r) / 2 : m.l + (i / (WEEKS.length - 1)) * (W - m.l - m.r);
  const y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const avg = WEEKS.map(w => TEAMS.reduce((s, t) => s + (t.games[w]?.pts || 0), 0) / N);
  const path = vals => vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).map((p, i) => (i ? "L" : "M") + p).join("");
  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img",
    "aria-label": "Points scored each week by every team; the highlighted team is drawn in blue. A table view is available below." });
  for (const v of ticks) {
    svg.append(s("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--grid)", "stroke-width": 1 }));
    const tx = s("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    tx.textContent = v; svg.append(tx);
  }
  WEEKS.forEach((w, i) => {
    const tx = s("text", { x: x(i), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" });
    tx.textContent = "Wk " + w; svg.append(tx);
  });
  const others = TEAMS.filter(t => t.rid !== state.team);
  for (const t of others) {
    const d = path(WEEKS.map(w => t.games[w]?.pts));
    svg.append(s("path", { d, fill: "none", stroke: "var(--other-line)", "stroke-width": 1.5, "stroke-linejoin": "round" }));
    const hit = s("path", { d, fill: "none", stroke: "transparent", "stroke-width": 12, style: "cursor:pointer" });
    hit.addEventListener("click", () => setTeam(t.rid));
    svg.append(hit);
  }
  svg.append(s("path", { d: path(avg), fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
  const me = BY_RID[state.team];
  if (me) {
    const vals = WEEKS.map(w => me.games[w]?.pts);
    svg.append(s("path", { d: path(vals), fill: "none", stroke: "var(--series-1)", "stroke-width": 2.5, "stroke-linejoin": "round" }));
    vals.forEach((v, i) => v != null && svg.append(s("circle", { cx: x(i), cy: y(v), r: 4, fill: "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 })));
    const last = vals.length - 1;
    if (vals[last] != null) {
      const lab = s("text", { x: Math.min(x(last), W - m.r) - 6, y: y(vals[last]) - 10, "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: "var(--ink)" });
      lab.textContent = me.handle; svg.append(lab);
    }
  }
  const cross = s("line", { y1: m.t, y2: H - m.b, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
  svg.append(cross);
  const overlay = s("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
  const onMove = e => {
    const r = svg.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const i = WEEKS.length === 1 ? 0 : Math.round(((px - m.l) / (W - m.l - m.r)) * (WEEKS.length - 1));
    const idx = Math.max(0, Math.min(WEEKS.length - 1, i)), wk = WEEKS[idx];
    cross.setAttribute("x1", x(idx)); cross.setAttribute("x2", x(idx)); cross.setAttribute("visibility", "visible");
    const wkGames = TEAMS.map(t => ({ t, g: t.games[wk] })).filter(o => o.g).sort((a, b) => b.g.pts - a.g.pts);
    const row = (a, b) => `<div class="r"><span>${a}</span><span>${b}</span></div>`;
    let html = `<div class="t">Week ${wk}</div>`;
    if (me && me.games[wk]) html += row(`<b>${me.handle}</b>`, `<b>${fmt(me.games[wk].pts)}</b> (${ordinal(me.games[wk].rank)})`);
    html += row("League average", fmt(avg[idx]));
    html += row(`High · ${wkGames[0].t.handle}`, fmt(wkGames[0].g.pts));
    html += row(`Low · ${wkGames.at(-1).t.handle}`, fmt(wkGames.at(-1).g.pts));
    showTip(html, e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
  };
  overlay.addEventListener("mousemove", onMove);
  overlay.addEventListener("touchstart", onMove, { passive: true });
  overlay.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); });
  svg.insertBefore(overlay, svg.querySelector("path"));
  box.replaceChildren(svg);

  $("#trend-legend").replaceChildren(
    el("span", {}, el("i", { style: "border-color:var(--series-1);border-top-width:3px" }), me ? me.handle : "Highlighted team"),
    el("span", {}, el("i", { style: "border-color:var(--ink-2);border-top-style:dashed" }), "League average"),
    el("span", {}, el("i", { style: "border-color:var(--other-line)" }), "Other teams (click a line to highlight it)"),
  );

  const tbl = el("table");
  tbl.append(el("thead", {}, el("tr", {}, el("th", { class: "l" }, "Team"), WEEKS.map(w => el("th", {}, "Wk " + w)), el("th", {}, "Avg"))));
  tbl.append(el("tbody", {}, TEAMS.map(t => el("tr", { class: t.rid === state.team ? "me" : null },
    el("td", { class: "l" }, t.handle), WEEKS.map(w => el("td", {}, fmt(t.games[w]?.pts))), el("td", {}, fmt(t.pfAvg))))));
  $("#trend-table").replaceChildren(tbl);
}
$("#trend-table-toggle").addEventListener("click", e => {
  const t = $("#trend-table");
  t.hidden = !t.hidden;
  e.target.textContent = t.hidden ? "Show as table" : "Hide table";
});

/* ---------- heat map ---------- */
function heatColor(rank) {
  const t = (rank - 1) / (N - 1);
  const amt = Math.round(Math.abs(t - 0.5) * 2 * 100);
  const pole = t < 0.5 ? "--div-pos" : "--div-neg";
  return { bg: `color-mix(in oklab, var(${pole}) ${amt}%, var(--div-mid))`, strong: amt >= 55 };
}

function renderHeat() {
  const weeks = Array.from({ length: DATA.league.regWeeks }, (_, i) => i + 1);
  const head = el("tr", {}, el("th", { class: "l", scope: "col" }, "Team"), weeks.map(w => el("th", { scope: "col" }, "Wk " + w)),
    el("th", { scope: "col" }, "Avg rank"), el("th", { scope: "col" }, "Luck"));
  const rows = TEAMS.map(t => {
    const played = Object.values(t.games);
    const avgRank = played.reduce((s, g) => s + g.rank, 0) / Math.max(played.length, 1);
    return el("tr", { class: t.rid === state.team ? "me" : null },
      el("td", { class: "l" }, teamCell(t)),
      weeks.map(w => {
        const g = t.games[w];
        if (!g) return el("td", { class: "cell empty" }, "·");
        const c = heatColor(g.rank);
        const glyph = g.luck ? (g.luck.startsWith("WIN") ? "▲" : "▼") : null;
        const td = el("td", {
          class: "cell", tabindex: 0,
          style: `background:${c.bg};color:${c.strong ? "#fff" : "var(--ink)"}`,
          "aria-label": `Week ${w}: ${ordinal(g.rank)} in scoring, ${fmt(g.pts)} points, ${g.result} vs ${BY_RID[g.opp].handle}`,
        }, String(g.rank), glyph ? el("span", { class: "g", "aria-hidden": "true" }, glyph) : null);
        const html = `<div class="t">${t.handle} · Week ${w}</div>
          <div class="r"><span>Score</span><span>${fmt(g.pts)} (${ordinal(g.rank)})</span></div>
          <div class="r"><span>${g.result} vs ${BY_RID[g.opp].handle}</span><span>${fmt(g.oppPts)} (${ordinal(g.oppRank)})</span></div>
          ${g.luck ? `<div class="r"><span>${g.luck.startsWith("WIN") ? "Lucky win" : "Unlucky loss"}</span><span>${g.luck.startsWith("WIN") ? "+1" : "−1"}</span></div>` : ""}`;
        td.addEventListener("mouseenter", e => showTip(html, e.clientX, e.clientY));
        td.addEventListener("mousemove", e => showTip(html, e.clientX, e.clientY));
        td.addEventListener("mouseleave", hideTip);
        td.addEventListener("focus", () => { const r = td.getBoundingClientRect(); showTip(html, r.right, r.top); });
        td.addEventListener("blur", hideTip);
        return td;
      }),
      el("td", {}, fmt(avgRank, 1)),
      el("td", { class: t.luck > 0 ? "pos" : t.luck < 0 ? "neg" : "" }, signed(t.luck, 0)));
  });
  $("#heat").replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
}

/* ---------- weekly results ---------- */
function renderWeekly() {
  const wk = state.week;
  $("#week-chips").replaceChildren(...WEEKS.map(w => el("button", {
    type: "button", "aria-pressed": String(w === wk), onclick: () => { state.week = w; renderWeekly(); },
  }, "Week " + w)));
  const seen = new Set(), pairs = [];
  for (const t of TEAMS) {
    const g = t.games[wk];
    if (!g || seen.has(t.rid)) continue;
    seen.add(t.rid); seen.add(g.opp);
    const o = BY_RID[g.opp];
    const [a, b] = g.pts >= o.games[wk].pts ? [t, o] : [o, t];
    pairs.push({ a, b, ga: a.games[wk], gb: b.games[wk] });
  }
  pairs.sort((x, y) => (y.ga.pts + y.gb.pts) - (x.ga.pts + x.gb.pts));
  const side = (t, g, win) => el("div", { class: "side" + (win ? "" : " loser") },
    el("div", { class: "team-cell" }, el("div", { class: "h" }, t.handle, el("span", { class: "badge" + (win ? " w" : "") }, win ? "W" : "L")), el("div", { class: "n" }, t.name)),
    el("div", { class: "score" }, fmt(g.pts)));
  $("#matchups").replaceChildren(...pairs.map(p => el("div", { class: "card matchup" + ([p.a.rid, p.b.rid].includes(state.team) ? " me" : "") },
    side(p.a, p.ga, p.ga.pts > p.gb.pts || p.ga.result === "Tie"), side(p.b, p.gb, p.ga.result === "Tie"),
    el("div", { class: "meta" }, `Margin ${fmt(p.ga.pts - p.gb.pts)} · scoring ranks ${ordinal(p.ga.rank)} and ${ordinal(p.gb.rank)}`))));

  const scores = TEAMS.map(t => ({ t, g: t.games[wk] })).filter(o => o.g).sort((a, b) => b.g.pts - a.g.pts);
  const closest = pairs.reduce((a, b) => (b.ga.pts - b.gb.pts < a.ga.pts - a.gb.pts ? b : a));
  const avg = scores.reduce((s, o) => s + o.g.pts, 0) / scores.length;
  const tile = (label, value, detail) => el("div", { class: "card tile" },
    el("div", { class: "label" }, label), el("div", { class: "value" }, value), el("div", { class: "detail" }, detail));
  $("#week-tiles").replaceChildren(
    tile("High score", fmt(scores[0].g.pts), scores[0].t.handle),
    tile("Low score", fmt(scores.at(-1).g.pts), scores.at(-1).t.handle),
    tile("Closest game", fmt(closest.ga.pts - closest.gb.pts), `${closest.a.handle} over ${closest.b.handle}`),
    tile("League average", fmt(avg), `${scores.length} teams`),
  );
}

/* ---------- players ---------- */
function renderPlayerControls() {
  $("#pos-seg").replaceChildren(...Object.keys(DATA.players).map(p => el("button", {
    type: "button", "aria-pressed": String(p === state.pos),
    onclick: () => { state.pos = p; state.limit = 100; state.playerSort = { key: "fpts", dir: -1 }; renderPlayerControls(); renderPlayers(); },
  }, p)));
  document.querySelectorAll("#mode-seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  const wp = $("#week-pick");
  wp.hidden = state.mode !== "weekly";
  wp.replaceChildren(el("option", { value: "all" }, "All weeks"), ...WEEKS.map(w => el("option", { value: w }, "Week " + w)));
  wp.value = state.pWeek;
  const op = $("#owner-pick");
  op.hidden = state.mode !== "season";
  op.replaceChildren(el("option", { value: "all" }, "All players"), el("option", { value: "FA" }, "Free agents only"),
    ...[...TEAMS].sort((a, b) => a.handle.localeCompare(b.handle)).map(t => el("option", { value: t.handle }, t.handle)));
  op.value = state.owner;
}

function renderPlayers() {
  const P = DATA.players[state.pos];
  const q = state.q.trim().toLowerCase();
  const sort = state.playerSort;
  const onSort = key => {
    sort.dir = sort.key === key ? -sort.dir : (["player", "team", "owner", "rank"].includes(key) ? 1 : -1);
    sort.key = key; renderPlayers();
  };
  const table = $("#players-table");
  let rows, cols, groupRow = null;

  if (state.mode === "season") {
    rows = P.season.map((r, i) => ({ ...r, rank: i + 1 }));
    const ppgRank = [...rows].sort((a, b) => b.ppg - a.ppg);
    ppgRank.forEach((r, i) => { r.ppgRank = i + 1; });
    rows = rows.filter(r => (state.owner === "all" || r.owner === state.owner) && (!q || r.player.toLowerCase().includes(q)));
    const meHandle = BY_RID[state.team]?.handle;
    cols = [
      { key: "rank", label: "Rank", get: r => r.rank },
      { key: "player", label: "Player", l: true, get: r => r.player.toLowerCase(), render: r => r.player },
      { key: "team", label: "NFL", l: true, get: r => r.team },
      { key: "g", label: "G", get: r => r.g },
      { key: "fpts", label: "FPTS", get: r => r.fpts, render: r => fmt(r.fpts, 1) },
      { key: "ppg", label: "FPTS/G", get: r => r.ppg, render: r => fmt(r.ppg, 1) },
      { key: "ppgRank", label: "PPG rank", get: r => r.ppgRank },
      { key: "owner", label: "Owner", l: true, get: r => (r.owner === "FA" ? "~" : r.owner.toLowerCase()),
        render: r => r.owner === "FA" ? el("span", { class: "fa" }, "Free agent") : r.owner },
    ];
    const shown = sortableTable(table, cols, rows, sort, onSort, r => ({ class: r.owner === meHandle ? "me" : null }));
    limitRows(table, shown.length);
    $("#players-note").textContent = `${state.pos} season totals through Week ${WEEKS.at(-1)}, ${P.scoring || "half PPR"} scoring. Rank is by total points; PPG rank by points per game. Owner is the Go Big or Go Home roster.`;
  } else {
    const idx = Object.fromEntries(P.cols.map((c, i) => [c.group + ":" + c.name, i + 3]));
    rows = P.weekly.filter(r => (state.pWeek === "all" || r[0] === +state.pWeek) && (!q || r[2].toLowerCase().includes(q)));
    cols = [
      { key: "wk", label: "Wk", get: r => r[0] },
      { key: "player", label: "Player", l: true, get: r => r[2].toLowerCase(), render: r => r[2] },
      { key: "team", label: "NFL", l: true, get: r => r[1] },
      ...P.cols.map((c, i) => ({ key: "c" + i, label: c.name, group: c.group, get: r => r[i + 3],
        render: r => (c.name === "FPTS" ? el("b", {}, fmt(r[i + 3], 1)) : r[i + 3]) })),
    ];
    if (!cols.some(c => c.key === sort.key) || sort.key === "fpts") {
      sort.key = "c" + (idx["MISC:FPTS"] - 3); sort.dir = -1;
    }
    const shown = sortableTable(table, cols, rows, sort, onSort);
    groupRow = el("tr", { class: "group-row" }, cols.map(c => el("th", { class: c.l ? "l" : "" }, c.group || "")));
    $("thead", table).prepend(collapseGroups(groupRow));
    limitRows(table, shown.length);
    $("#players-note").textContent = `Weekly ${state.pos} box scores from FantasyPros, ${P.scoring || "half PPR"} scoring. Only players who played that week are listed.`;
  }
}

function collapseGroups(row) {
  const cells = [...row.children];
  const out = el("tr", { class: "group-row" });
  for (let i = 0; i < cells.length;) {
    let j = i;
    while (j + 1 < cells.length && cells[j + 1].textContent === cells[i].textContent) j++;
    out.append(el("th", { colspan: j - i + 1, style: "text-align:center" }, cells[i].textContent));
    i = j + 1;
  }
  return out;
}

function limitRows(table, total) {
  const body = $("tbody", table);
  [...body.children].forEach((tr, i) => { if (i >= state.limit) tr.remove(); });
  const btn = $("#players-more");
  btn.hidden = total <= state.limit;
  btn.textContent = `Show more (${total - state.limit} hidden)`;
}

$("#players-more").addEventListener("click", () => { state.limit += 200; renderPlayers(); });
document.querySelectorAll("#mode-seg button").forEach(b => b.addEventListener("click", () => {
  state.mode = b.dataset.mode; state.limit = 100; state.playerSort = { key: "fpts", dir: -1 };
  renderPlayerControls(); renderPlayers();
}));
$("#week-pick").addEventListener("change", e => { state.pWeek = e.target.value; state.limit = 100; renderPlayers(); });
$("#owner-pick").addEventListener("change", e => { state.owner = e.target.value; state.limit = 100; renderPlayers(); });
$("#player-search").addEventListener("input", e => { state.q = e.target.value; state.limit = 100; renderPlayers(); });

/* ---------- boot ---------- */
let resizeTimer, lastTrendWidth = 0;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  if (!DATA || w === lastTrendWidth) return;
  lastTrendWidth = w;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTrend, 80);
}).observe($("#trend"));

fetch("data.json", { cache: "no-cache" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => {
    DATA = data;
    TEAMS = data.teams;
    N = TEAMS.length;
    WEEKS = data.league.weeks;
    BY_RID = Object.fromEntries(TEAMS.map(t => [t.rid, t]));
    state.week = WEEKS.at(-1);
    const saved = +store.get("team");
    state.team = BY_RID[saved] ? saved : TEAMS[0].rid;

    document.title = `${data.league.name} ${data.league.season}`;
    $("#title").textContent = `${data.league.name} · ${data.league.season}`;
    $("#subtitle").textContent = `Through Week ${WEEKS.at(-1)} of ${data.league.regWeeks} · ${N} teams`;
    $("#updated").textContent = "Last updated " + new Date(data.league.updated).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + ".";
    const pick = $("#team-pick");
    pick.replaceChildren(...[...TEAMS].sort((a, b) => a.handle.localeCompare(b.handle)).map(t => el("option", { value: t.rid }, t.handle)));
    pick.value = state.team;
    pick.addEventListener("change", e => setTeam(+e.target.value));

    renderTiles(); renderStandings(); renderHeat(); renderWeekly();
    renderPlayerControls(); renderPlayers();
    route();
  })
  .catch(err => {
    $("#subtitle").textContent = "Could not load league data (" + err.message + ").";
  });
