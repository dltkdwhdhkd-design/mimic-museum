// 교사 관제 화면 — 과학관 지도, 학예사 위치, (원하면) 미믹 위치, 점수판, 사건 기록, 결과·오답 노트
window.HostView = (function () {
  const TEAM_COLORS = ["#e2574c", "#4a8fe2", "#46b16a", "#e0a63a"];
  let cv, ctx, base = null, baseKey = "", log = [], showHiders = false;
  try { showHiders = localStorage.getItem("mimicmuseum.showHiders") === "1"; } catch (e) {}
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function init() { cv = document.getElementById("host-canvas"); ctx = cv.getContext("2d"); log = []; base = null; document.getElementById("host-log").innerHTML = ""; }
  function addLog(html) { log.unshift(`<div>${html}</div>`); if (log.length > 60) log.length = 60; const b = document.getElementById("host-log"); if (b) b.innerHTML = log.join(""); }
  function itemName(i) { return MM.ITEMS[i] ? MM.ITEMS[i].name : "?"; }
  function roomName(r) { return MM.ROOMS[r] ? MM.ROOMS[r].name : "?"; }
  function onEvent(W, e) {
    const nm = id => (W.players.get(id) || {}).name || "?", tc = id => TEAM_COLORS[((W.players.get(id) || {}).team || 0) % 4];
    switch (e.k) {
      case "round": addLog(`<b class="sec">━ ${e.n}라운드 · 미믹: ${e.hiders.map(t => (t + 1) + "팀").join(", ")}</b><br><span class="muted">${e.wings.map(id => MM.WING_BY_ID[id].name).join(" · ")}</span>`); base = null; break;
      case "phase": addLog(`<b>학예사 출발!</b>`); break;
      case "caught": addLog(`🔍 <b style="color:${tc(e.by)}">${esc(nm(e.by))}</b> → 🎭 ${esc(nm(e.id))} <span class="it">'${esc(itemName(e.item))}'</span> ${e.ok ? "(제자리였음)" : e.perched ? `<span class="bad">잘못 숨음: ${esc(e.where)}</span>` : `<span class="muted">돌아다니다 들킴</span>`}`); break;
      case "wrong": addLog(`❌ <b style="color:${tc(e.by)}">${esc(nm(e.by))}</b> 진짜 전시물 <span class="it">'${esc(itemName(e.item))}'</span> 찍음`); break;
      case "jail": addLog(`🚓 ${esc(nm(e.id))} 경비실`); break;
      case "whistle": addLog(`📯 <b style="color:${tc(e.by)}">${esc(nm(e.by))}</b> 호루라기`); break;
      case "taunt": addLog(`🎺 ${esc(nm(e.id))} 도발`); break;
      case "rend": addLog(`<b class="sec">━ ${e.n}라운드 끝</b> ${e.scores.map((v, i) => `<span style="color:${TEAM_COLORS[i]}">${i + 1}팀 ${v}</span>`).join(" · ")}`); break;
    }
  }
  function buildBase(M, T) {
    const c = document.createElement("canvas"); c.width = Math.ceil(M.W * T); c.height = Math.ceil(M.H * T); const g = c.getContext("2d");
    g.fillStyle = "#0e1014"; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
      const t = Museum.tile(x, y); if (t === Museum.T_WALL) continue;
      const cell = Museum.cellAt(x + 0.5, y + 0.5);
      g.fillStyle = !cell ? "#5f5a50" : cell.kind === "room" ? Art.wingColor(cell.wing) + "77" : cell.kind === "lobby" ? "#7a6646" : "#4c5544";
      g.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    }
    for (const s of M.stands) { g.fillStyle = s.item >= 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.15)"; g.fillRect(s.x * T + T * 0.2, s.y * T + T * 0.2, T * 0.6, T * 0.6); }
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const cell of M.cells) {
      const cx = (cell.x0 + cell.x1 + 1) / 2 * T, cy = (cell.y0 + cell.y1 + 1) / 2 * T, fs = Math.max(10, Math.min(16, T * 1.1));
      g.font = `bold ${fs}px sans-serif`; g.fillStyle = "rgba(255,255,255,0.92)";
      const lines = cell.name.replace(/\s*\(/, "\n(").split("\n"); lines.forEach((l, k) => g.fillText(l, cx, cy + (k - (lines.length - 1) / 2) * (fs + 2), Museum.IN * T - 6));
    }
    return c;
  }
  function render(W) {
    if (!cv || !W || !W.museum) return;
    const Wd = cv.clientWidth, Hd = cv.clientHeight; if (Wd < 50 || Hd < 50) return;
    if (cv.width !== Wd || cv.height !== Hd) { cv.width = Wd; cv.height = Hd; }
    const M = W.museum; Museum.use(M);
    const T = Math.min((Wd - 16) / M.W, (Hd - 16) / M.H), ox = (Wd - M.W * T) / 2, oy = (Hd - M.H * T) / 2;
    const key = M.seed + "|" + T.toFixed(3); if (!base || baseKey !== key) { base = buildBase(M, T); baseKey = key; }
    ctx.fillStyle = "#07080a"; ctx.fillRect(0, 0, Wd, Hd); ctx.drawImage(base, ox, oy);
    const reveal = showHiders || W.phase === "result" || W.phase === "over";
    for (const P of W.players.values()) {
      const x = ox + P.x * T, y = oy + P.y * T;
      if (P.role === "seek") {
        if (W.phase === "hide") continue;
        ctx.fillStyle = P.jailUntil > W.elapsed ? "#777" : TEAM_COLORS[P.team % 4]; ctx.beginPath(); ctx.arc(x, y, Math.max(4, T * 0.45), 0, 7); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `${Math.max(10, T * 0.85)}px sans-serif`; ctx.textAlign = "center"; ctx.fillText(P.name, x, y - T * 0.8);
      } else if (reveal && P.state === "alive" && P.item >= 0) {
        const s = Math.max(14, T * 1.3); ctx.drawImage(Art.object(MM.ITEMS[P.item]), x - s / 2, y - s / 2, s, s);
        const ok = Rules.correctAt(W, P);
        if (P.perch >= 0) { ctx.strokeStyle = ok ? "#3cff7a" : "#ff4a4a"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, s * 0.6, 0, 7); ctx.stroke(); }
        ctx.fillStyle = "#ffe9b0"; ctx.font = `${Math.max(10, T * 0.8)}px sans-serif`; ctx.textAlign = "center"; ctx.fillText(P.name, x, y + s * 0.85);
      }
    }
    const ph = { hide: "숨는 시간", seek: "찾는 시간", result: "라운드 결과", over: "끝" }[W.phase] || "";
    const t = Math.max(0, Math.ceil(W.t));
    const sc = Rules.teamScores(W);
    const html = `<div class="cs-round">${W.practice ? "연습" : `${W.round}/${W.settings.rounds} 라운드`} · ${ph} <b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}</b></div>` +
      (W.practice ? "" : sc.map((v, i) => `<div class="cs-team" style="border-color:${TEAM_COLORS[i]}"><b style="color:${TEAM_COLORS[i]}">${i + 1}팀</b> ${W.info && W.info.hiders.includes(i) ? "🎭" : "🔍"} <span>${v}</span></div>`).join(""));
    const box = document.getElementById("console-scores"); if (box && box.dataset.k !== html) { box.dataset.k = html; box.innerHTML = html; }
  }
  function setShowHiders(v) { showHiders = !!v; try { localStorage.setItem("mimicmuseum.showHiders", showHiders ? "1" : "0"); } catch (e) {} }

  // ---------- 결과 ----------
  function results(res) {
    if (res.practice === "hide") {
      const p = res.players[0] || {}; const wrong = res.log.filter(l => l.type === "hideWrong");
      return `<p class="big">제자리 찾기 ${p.correctPerches || 0} / ${p.perches || 0}번</p>` + noteTable(wrong.map(l => ({ a: itemName(l.item), b: esc(roomName(l.at)), c: MM.ROOMS[MM.ITEMS[l.item].room].name, note: MM.ITEMS[l.item].note })), "틀린 자리", ["전시물", "올라간 전시실", "있어야 할 전시실"]);
    }
    if (res.practice === "seek") {
      const p = res.players[0] || {};
      return `<p class="big">점수 ${p.score} · 찾아낸 미믹 ${p.catches} · 잘못 찍음 ${p.wrongTags}</p>` + notes(res);
    }
    const order = res.scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const max = Math.max(1, ...res.scores);
    let html = `<div class="rank">${order.map(([v, i], k) => `<div class="rank-row"><span class="rk">${k + 1}위</span><b style="color:${TEAM_COLORS[i]}">${i + 1}팀</b><div class="bar"><div style="width:${Math.max(3, v / max * 100)}%;background:${TEAM_COLORS[i]}"></div></div><span class="pt">${v}점</span></div>`).join("")}</div>`;
    const ps = res.players.slice().sort((a, b) => b.score - a.score);
    html += `<h3>개인 기록</h3><table><tr><th>이름</th><th>팀</th><th>점수</th><th>찾아냄</th><th>잡힘</th><th>잘못 찍음</th><th>숨은 시간</th><th>제자리에 숨은 시간</th></tr>` +
      ps.map(p => `<tr><td>${esc(p.name)}</td><td style="color:${TEAM_COLORS[p.team % 4]}">${p.team + 1}팀</td><td><b>${p.score}</b></td><td>${p.catches}</td><td>${p.caught}</td><td>${p.wrongTags}</td><td>${p.hideSec}초</td><td>${p.correctSec}초</td></tr>`).join("") + `</table>`;
    return html + notes(res);
  }
  function notes(res) {
    const wrongTags = {}, wrongHides = [];
    for (const l of res.log) {
      if (l.type === "tagWrong") { const k = l.item; (wrongTags[k] = wrongTags[k] || { item: l.item, who: [] }).who.push(l.name); }
      if (l.type === "hideWrong") wrongHides.push(l);
    }
    let html = `<h3>오답 노트</h3>`;
    const tags = Object.values(wrongTags);
    html += noteTable(tags.map(t => ({ a: itemName(t.item), b: esc(t.who.join(", ")), c: MM.ROOMS[MM.ITEMS[t.item].room].name, note: MM.ITEMS[t.item].note })), "진짜인데 가짜로 찍은 전시물 — 원래 그 전시실에 있는 게 맞았다", ["전시물", "찍은 학생", "맞는 전시실"]);
    html += noteTable(wrongHides.map(l => ({ a: itemName(l.item), b: `${esc(l.name)} · ${l.at >= 0 ? esc(roomName(l.at)) : esc(l.where || "받침대 밖")}${l.caught ? " (잡힘)" : " (들키지 않음)"}`, c: MM.ROOMS[MM.ITEMS[l.item].room].name, note: MM.ITEMS[l.item].note })), "엉뚱한 곳에 숨은 미믹", ["전시물", "숨은 학생 · 숨은 곳", "있어야 할 전시실"]);
    if (!tags.length && !wrongHides.length) html += `<p>틀린 것이 없습니다. 👏</p>`;
    return html;
  }
  function noteTable(rows, title, head) {
    if (!rows.length) return "";
    return `<h4>${title}</h4><table><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr>` + rows.map(r => `<tr><td><b>${esc(r.a)}</b></td><td>${r.b}</td><td class="good">${esc(r.c)}${r.note ? `<br><small>${esc(r.note)}</small>` : ""}</td></tr>`).join("") + `</table>`;
  }
  return { init, render, addLog, onEvent, results, setShowHiders, get showHiders() { return showHiders; }, invalidate() { base = null; } };
})();
