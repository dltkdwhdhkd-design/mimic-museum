// 화면 흐름 — 타이틀, 교사 대기실·관제, 학생 참가·재접속, 혼자 연습, 결과
(function () {
  const $ = id => document.getElementById(id);
  const screens = ["title", "host-lobby", "client-lobby", "game", "host-console", "end"];
  function show(id) { for (const s of screens) $("s-" + s).style.display = s === id ? "" : "none"; }
  const TEAM_COLORS = ["#e2574c", "#4a8fe2", "#46b16a", "#e0a63a"];
  const MAX_PLAYERS = 16;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const UNITS_KEY = "mimicmuseum.units.v1", SET_KEY = "mimicmuseum.settings.v1";
  function loadUnits() { try { const u = JSON.parse(localStorage.getItem(UNITS_KEY) || "null"); if (Array.isArray(u) && u.length) return u.filter(id => MM.UNIT_BY_ID[id]); } catch (e) {} return MM.UNITS.map(u => u.id); }
  function saveUnits(u) { try { localStorage.setItem(UNITS_KEY, JSON.stringify(u)); } catch (e) {} }
  function loadSettings() { const s = { ...Rules.DEFAULTS }; try { const v = JSON.parse(localStorage.getItem(SET_KEY) || "{}"); for (const k of ["teams", "rounds", "hideTime", "seekTime", "beepEvery", "size"]) if (k in v) s[k] = v[k]; } catch (e) {} s.units = loadUnits(); return s; }
  function saveSettings(s) { try { const { units, ...rest } = s; localStorage.setItem(SET_KEY, JSON.stringify(rest)); } catch (e) {} }

  // ---------------- 호스트(교사 기기) ----------------
  const HostGame = {
    players: new Map(), settings: loadSettings(), W: null, started: false, timer: null, lastTick: 0, snapAcc: 0, viewAcc: 0, endAcc: 0, endSends: 0, localId: null, practice: null, final: null,
    onMsg(d, from) {
      if (!d || typeof d !== "object") return;
      if (d.t === "join") {
        if (d.roomId && d.roomId !== Net.id) { Net.sendToClients({ t: "join-error", to: from, requestId: d.requestId, reason: "이전 방이 종료되었습니다. 현재 방 코드를 확인하고 새로 입장하세요." }); return; }
        if (!this.players.has(from)) {
          if (this.final) { Net.sendToClients({ t: "join-error", to: from, requestId: d.requestId, reason: "이미 끝난 게임입니다. 선생님이 새 방을 만들면 입장하세요." }); return; }
          if (this.players.size >= MAX_PLAYERS && !this.practice) { Net.sendToClients({ t: "join-error", to: from, requestId: d.requestId, reason: `이 방은 ${MAX_PLAYERS}명이 다 찼습니다.` }); return; }
          const p = { id: from, name: String(d.name || "?").slice(0, 8), team: -1 }; this.players.set(from, p); this.assignTeam(p);
          if (this.started) { Rules.addPlayer(this.W, from, p.name, p.team); this.flush(); Net.sendToClients({ t: "roster", ...this.roster() }); }
        }
        { const p = this.players.get(from), nm = String(d.name || "?").slice(0, 8); if (p && nm !== p.name) Net.sendToClients({ t: "note", to: from, text: `이 기기는 이미 '${p.name}'(으)로 들어와 있어서 그 이름, 그 팀으로 이어서 합니다.` }); }
        if (!this.started) this.broadcastLobby(); else this.sendGo(from, d.requestId);
        return;
      }
      if (!this.started || !this.players.has(from)) return;
      Rules.handle(this.W, from, d);   // 결과 사건은 loop()가 0.05초마다 한꺼번에 보낸다
    },
    teamsN() { return Math.max(2, Math.min(4, this.settings.teams)); },
    assignTeam(p) {
      const n = this.teamsN(), cnt = new Array(n).fill(0);
      for (const q of this.players.values()) if (q !== p && q.team >= 0 && q.team < n) cnt[q.team]++;
      let best = 0; for (let t = 1; t < n; t++) if (cnt[t] < cnt[best]) best = t; p.team = best;
    },
    redistribute(shuffle) {
      const list = [...this.players.values()];
      if (shuffle) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const n = this.teamsN(); list.forEach((p, i) => p.team = i % n);
    },
    moveTeam(id, team) { const p = this.players.get(id); if (!p || this.started) return; p.team = Math.max(0, Math.min(this.teamsN() - 1, team)); this.broadcastLobby(); },
    kick(id) { if (this.started || !this.players.has(id)) return; this.players.delete(id); Net.sendToClients({ t: "kicked", to: id }); this.broadcastLobby(); },
    roster() { const names = {}, teams = {}; if (this.W) for (const p of this.W.players.values()) if (p.bot) { names[p.id] = p.name; teams[p.id] = p.team; } for (const p of this.players.values()) { names[p.id] = p.name; teams[p.id] = p.team; } return { names, teams }; },
    lobbyMsg() { return { t: "lobby", roomId: Net.id, players: [...this.players.values()].map(p => [p.id, p.name, p.team]), teams: this.teamsN() }; },
    broadcastLobby() { Net.sendToClients(this.lobbyMsg()); renderHostLobby(); },
    clientSettings() { const s = this.settings; return { tauntCd: s.tauntCd, seekTime: s.seekTime, hideTime: s.hideTime, beepEvery: s.beepEvery }; },
    start() {
      // 빈 팀 번호를 당긴다 (인원이 팀 수보다 적을 때)
      const used = [...new Set([...this.players.values()].map(p => p.team))].sort((a, b) => a - b);
      for (const p of this.players.values()) p.team = used.indexOf(p.team);
      this.started = true; this.final = null; this.endSends = 0;
      this.W = Rules.create(this.settings); this.W.practice = this.practice;
      for (const p of this.players.values()) Rules.addPlayer(this.W, p.id, p.name, p.team);
      if (this.practice === "seek") Rules.addBots(this.W, 6, "hide");
      if (this.practice === "hide") Rules.addBots(this.W, 3, "seek");
      Rules.startGame(this.W);
      HostView.init();
      this.flush(); this.sendGo();
      this.lastTick = performance.now(); clearInterval(this.timer); this.timer = setInterval(() => this.loop(), 50);
    },
    flush() {
      const W = this.W; if (!W || !W.events.length) return;
      const list = W.events.splice(0);
      Net.sendToClients({ t: "evs", list });   // 한 번에 묶어 보낸다 (연사 때문에 사건이 많다)
      for (const e of list) { HostView.onEvent(W, e); if (e.k === "end") this.final = e; }
    },
    sendGo(to, requestId) {
      const W = this.W, ros = this.roster();
      for (const p of this.players.values()) {
        if (to && p.id !== to) continue;
        Net.sendToClients({ t: "go", to: p.id, requestId, roomId: Net.id, ...ros, settings: this.clientSettings(), practice: this.practice, round: Rules.roundMsg(W), snapshot: Rules.snapshot(W), playerState: Rules.resumeState(W, p.id), end: this.final || undefined });
      }
    },
    loop() {
      const now = performance.now(); let dt = (now - this.lastTick) / 1000; this.lastTick = now;
      if (dt > 1) dt = 0.05;
      Rules.tick(this.W, dt); this.flush();
      this.snapAcc += dt; if (this.snapAcc >= 0.1) { this.snapAcc = 0; Net.sendToClients(Rules.snapshot(this.W)); }
      this.viewAcc += dt; if (this.viewAcc >= 0.1) { this.viewAcc = 0; if ($("s-host-console").style.display !== "none") HostView.render(this.W); updateConsoleButtons(); }
      if (this.final) { this.endAcc += dt; if (this.endAcc >= 3 && this.endSends < 10) { this.endAcc = 0; this.endSends++; Net.sendToClients({ t: "ev", ...this.final }); } if (!this.shownEnd && !this.localId && !this.practice) { this.shownEnd = true; showHostResults(); } }
    },
    end() { if (!this.W || this.final) { if (this.final) showHostResults(); return; } Rules.finish(this.W); this.flush(); showHostResults(); },
  };
  window.__host = HostGame; // 자동 시험용
  function showHostResults() {
    $("end-title").textContent = "최종 결과 — 오답 노트";
    $("end-body").innerHTML = HostView.results(HostGame.final);
    $("btn-end-again").style.display = "none"; show("end");
  }
  function updateConsoleButtons() {
    const W = HostGame.W; if (!W) return;
    $("btn-skip").style.display = W.phase === "result" ? "" : "none";
    $("btn-cut").style.display = W.phase === "seek" || W.phase === "hide" ? "" : "none";
    $("btn-host-end").textContent = W.phase === "over" ? "결과 보기" : "게임 종료";
  }

  // ---------------- 교사 대기실 ----------------
  let lastLobbyHtml = null;
  function renderHostLobby() {
    const n = HostGame.teamsN(), byTeam = Array.from({ length: n }, () => []);
    for (const p of HostGame.players.values()) (byTeam[p.team] || byTeam[0]).push(p);
    const opt = cur => Array.from({ length: n }, (_, t) => `<option value="${t}"${t === cur ? " selected" : ""}>${t + 1}팀</option>`).join("");
    const html = HostGame.players.size ? byTeam.map((list, t) => `<div class="team" style="border-color:${TEAM_COLORS[t]}"><b style="color:${TEAM_COLORS[t]}">${t + 1}팀</b> <span class="muted">${list.length}명</span><div class="team-list">${list.map(p => `<div class="mem"><span class="nm">${esc(p.name)}</span> <select data-id="${esc(p.id)}" title="팀 옮기기">${opt(t)}</select>${p.id === HostGame.localId ? `<span class="muted small">(선생님)</span>` : `<button class="kick" data-kick="${esc(p.id)}">내보내기</button>`}</div>`).join("")}</div></div>`).join("") : `<div class="muted">학생들이 접속하면 여기에 보입니다.</div>`;
    $("lobby-count").textContent = HostGame.players.size + "명";
    if (html === lastLobbyHtml) return;
    lastLobbyHtml = html; $("lobby-teams").innerHTML = html;
    $("lobby-teams").querySelectorAll("select[data-id]").forEach(sel => { sel.onchange = () => HostGame.moveTeam(sel.dataset.id, +sel.value); });
    $("lobby-teams").querySelectorAll("button[data-kick]").forEach(bt => { bt.onclick = () => { const p = HostGame.players.get(bt.dataset.kick); if (p && confirm(`${p.name} 학생을 내보낼까요?`)) HostGame.kick(bt.dataset.kick); }; });
  }
  function roundsFor(teams) { return teams === 3 ? [3, 6] : teams === 2 ? [2, 4, 6] : [2, 4, 6, 8]; }
  function bindSettings() {
    const s = HostGame.settings;
    const set = (k, v) => { s[k] = v; saveSettings(s); lobbyHint(); };
    const teamsSel = $("set-teams"); teamsSel.value = String(s.teams);
    const fillRounds = () => { const opts = roundsFor(s.teams); if (!opts.includes(s.rounds)) s.rounds = opts.includes(4) ? 4 : opts[0]; $("set-rounds").innerHTML = opts.map(r => `<option value="${r}"${r === s.rounds ? " selected" : ""}>${r}라운드 (팀마다 숨기 ${r * (s.teams === 4 ? 2 : 1) / s.teams}번)</option>`).join(""); };
    fillRounds();
    teamsSel.onchange = () => { set("teams", +teamsSel.value); fillRounds(); HostGame.redistribute(false); HostGame.broadcastLobby(); };
    $("set-rounds").onchange = () => set("rounds", +$("set-rounds").value);
    const range = (id, k, mul, fmt) => { const el = $(id); el.value = s[k] / mul; const out = () => $(id + "-v").textContent = fmt(+el.value); out(); el.oninput = () => { set(k, +el.value * mul); out(); }; };
    range("set-hide", "hideTime", 1, v => v + "초");
    range("set-seek", "seekTime", 60, v => (v % 1 ? v.toFixed(1) : v) + "분");
    $("set-beep").value = String(s.beepEvery); $("set-beep").onchange = () => set("beepEvery", +$("set-beep").value);
    $("set-size").value = s.size; $("set-size").onchange = () => set("size", $("set-size").value);
    renderUnits(); lobbyHint();
  }
  function renderUnits() {
    const s = HostGame.settings, box = $("units");
    let html = "";
    for (const g of [1, 2, 3]) {
      const list = MM.UNITS.filter(u => u.grade === g);
      html += `<div class="ugrp"><div class="ugrp-h"><b>${g}학년 단원</b> <button data-grade="${g}" class="mini">모두</button> <button data-grade-off="${g}" class="mini ghost">빼기</button></div>` +
        list.map(u => { const rooms = u.wings.reduce((a, w) => a + w.rooms.length, 0); return `<label class="unit"><input type="checkbox" data-unit="${u.id}"${s.units.includes(u.id) ? " checked" : ""}> ${esc(u.name)} <span class="muted small">전시실 ${rooms}</span></label>`; }).join("") + `</div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll("input[data-unit]").forEach(cb => cb.onchange = () => { const id = cb.dataset.unit; s.units = cb.checked ? [...new Set([...s.units, id])] : s.units.filter(x => x !== id); saveUnits(s.units); lobbyHint(); });
    box.querySelectorAll("button[data-grade]").forEach(b => b.onclick = () => { const g = +b.dataset.grade; s.units = [...new Set([...s.units, ...MM.UNITS.filter(u => u.grade === g).map(u => u.id)])]; saveUnits(s.units); renderUnits(); lobbyHint(); });
    box.querySelectorAll("button[data-grade-off]").forEach(b => b.onclick = () => { const g = +b.dataset.gradeOff; s.units = s.units.filter(id => MM.UNIT_BY_ID[id].grade !== g); saveUnits(s.units); renderUnits(); lobbyHint(); });
  }
  function lobbyHint() {
    const s = HostGame.settings, rooms = MM.WINGS.filter(w => s.units.includes(w.unit)).reduce((a, w) => a + w.rooms.length, 0);
    $("lobby-hint").textContent = !s.units.length ? "단원을 하나 이상 켜 주세요." : rooms < 6 ? `켠 단원의 전시실이 ${rooms}개뿐이라 숨을 곳이 적습니다. 단원을 더 켜면 라운드마다 다른 전시관이 열립니다.` : `켠 단원 ${s.units.length}개 · 전시실 ${rooms}개. 라운드마다 이 중 몇 개 전시동을 골라 전시관을 새로 짓습니다(서로 헷갈리는 전시동은 같은 판에 안 나옵니다).`;
  }
  $("units-all").onclick = () => { HostGame.settings.units = MM.UNITS.map(u => u.id); saveUnits(HostGame.settings.units); renderUnits(); lobbyHint(); };
  $("units-none").onclick = () => { HostGame.settings.units = []; saveUnits([]); renderUnits(); lobbyHint(); };

  // ---------------- 타이틀 ----------------
  let teacherPlays = false;
  function openRoom(play) {
    Sound.init();
    const code = String(Math.floor(1000 + Math.random() * 9000));
    Net.host(code);
    Net.onMessage((d, from) => HostGame.onMsg(d, from));
    $("lobby-code").textContent = code; $("lobby-url").textContent = location.href.split("#")[0].split("?")[0];
    bindSettings(); renderHostLobby(); show("host-lobby");
    setInterval(() => { if (!HostGame.started) HostGame.broadcastLobby(); }, 1500);
    if (play) {
      const name = (prompt("게임에서 쓸 이름 (8자 이내)", "선생님") || "선생님").trim().slice(0, 8) || "선생님";
      teacherPlays = true; HostGame.localId = Net.id;
      Net.addHostPlayer((d, from) => clientRecv(d, from));
      Net.sendToHost({ t: "join", name });
    }
  }
  $("btn-teacher").onclick = () => openRoom(false);
  $("btn-teacher-play").onclick = () => openRoom(true);
  $("btn-student").onclick = () => { fillSavedSession(); show("client-lobby"); $("inp-name").focus(); };
  function startPractice(mode) {
    Sound.init();
    Net.startLocal((d, from) => HostGame.onMsg(d, from));
    Net.setLocalClient(d => clientRecv(d));
    HostGame.practice = mode; practiceMode = mode;
    HostGame.settings = { ...Rules.DEFAULTS, units: loadUnits(), teams: 2, rounds: 1, hideTime: 25, seekTime: 150, beepEvery: mode === "seek" ? 25 : 30, size: "auto", resultTime: 3 };
    Net.onMessage(() => {});
    Net.sendToHost({ t: "join", name: "나" });
    HostGame.start();
  }
  let practiceMode = null;
  $("btn-practice-seek").onclick = () => startPractice("seek");
  $("btn-practice-hide").onclick = () => startPractice("hide");
  $("btn-start").onclick = () => {
    if (!HostGame.settings.units.length) { alert("단원을 하나 이상 켜 주세요."); return; }
    if (HostGame.players.size < 2) { alert("두 명 이상 들어와야 시작할 수 있습니다. 혼자 해 보려면 첫 화면의 '혼자 연습'을 쓰세요."); return; }
    HostGame.start(); show("host-console"); $("console-code").textContent = Net.code;
    $("btn-to-game").style.display = teacherPlays ? "" : "none";
  };
  $("btn-shuffle").onclick = () => { HostGame.redistribute(true); HostGame.broadcastLobby(); };
  $("btn-host-end").onclick = () => { if (HostGame.final || confirm("게임을 끝내고 결과를 볼까요?")) HostGame.end(); };
  $("btn-skip").onclick = () => { if (HostGame.W && HostGame.W.phase === "result") HostGame.W.t = 0; };
  $("btn-cut").onclick = () => { const W = HostGame.W; if (W && (W.phase === "seek" || W.phase === "hide") && confirm(W.phase === "hide" ? "숨는 시간을 끝내고 바로 찾기를 시작할까요?" : "이번 라운드를 지금 끝낼까요?")) W.t = 0; };
  const showHid = () => { $("btn-showhiders").textContent = HostView.showHiders ? "미믹 위치 숨기기" : "미믹 위치 보기"; $("btn-showhiders").classList.toggle("on", HostView.showHiders); };
  $("btn-showhiders").onclick = () => { HostView.setShowHiders(!HostView.showHiders); showHid(); }; showHid();
  $("btn-to-console").onclick = () => { if (document.pointerLockElement) document.exitPointerLock(); show("host-console"); };
  $("btn-to-game").onclick = () => { if (!ending) show("game"); };
  $("btn-end-back").onclick = () => location.reload();
  $("btn-end-again").onclick = () => { const m = practiceMode; location.hash = m ? "practice-" + m : ""; location.reload(); };

  // ---------------- 학생 ----------------
  let joined = false, gameStarted = false, myTeam = -1;
  const SESSION_KEY = "mimicmuseum.session.v1";
  let noteText = "", activeSession = null, joinTimer = null, lastHostAt = 0, lastJoinAt = 0, syncRequest = null, recovering = false, ending = false;
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && /^\d{4}$/.test(s.code) && typeof s.name === "string" && s.name.length > 0 && s.name.length <= 8 && typeof s.id === "string" && s.id.length >= 8 && s.id.length <= 80 && Number.isFinite(s.savedAt) && Date.now() - s.savedAt < 12 * 60 * 60 * 1000) return s;
    } catch (e) {}
    return null;
  }
  function saveSession() { if (!activeSession) return; activeSession.savedAt = Date.now(); try { localStorage.setItem(SESSION_KEY, JSON.stringify(activeSession)); } catch (e) {} }
  function deviceId() { try { let id = localStorage.getItem("mimicmuseum.device"); if (!id || id.length < 8) { id = Net.newId(); localStorage.setItem("mimicmuseum.device", id); } return id; } catch (e) { return Net.newId(); } }
  function forgetSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function fillSavedSession() {
    const s = readSession(); if (s) { $("inp-name").value = s.name; $("inp-code").value = s.code; }
    $("btn-resume").style.display = s ? "" : "none"; if (s) $("btn-resume").textContent = `이전 게임 이어하기 · ${s.name} (${s.code})`;
  }
  function reconnectNotice(v) { $("reconnect").style.display = v && gameStarted ? "flex" : "none"; }
  function sendJoin() {
    if (!activeSession || ending || document.hidden) return;
    if (!syncRequest) syncRequest = Net.newId();
    lastJoinAt = Date.now();
    Net.sendToHost({ t: "join", name: activeSession.name, roomId: activeSession.roomId, requestId: syncRequest });
  }
  function recover() {
    if (!activeSession || ending) return;
    if (!recovering) { recovering = true; syncRequest = Net.newId(); Client.setConnectionLost(true); }
    reconnectNotice(true);
    if (!gameStarted) $("join-msg").textContent = "연결을 다시 확인하는 중… 방 코드와 선생님 화면을 확인하세요.";
    Net.reconnect(); sendJoin();
  }
  function watchConnection() {
    if (!activeSession || ending || document.hidden) return;
    if (joined && Date.now() - lastHostAt > 4000 && !recovering) recover();
    if ((!joined || recovering) && Date.now() - lastJoinAt >= 2000) sendJoin();
    if (!joined && Date.now() - lastHostAt > 10000) $("join-msg").textContent = "방을 찾는 중… 방 코드와 선생님 화면을 확인하세요. 아래에서 취소 후 다시 입력할 수 있습니다.";
  }
  function cancelJoin() {
    clearInterval(joinTimer); joinTimer = null; activeSession = null; syncRequest = null;
    Client.stop(); Net.disconnect(); joined = false; gameStarted = false; recovering = false; myTeam = -1;
    reconnectNotice(false); $("btn-join").disabled = false; $("inp-name").disabled = $("inp-code").disabled = false;
    $("btn-join-cancel").style.display = "none"; $("join-msg").textContent = "";
    show("client-lobby"); fillSavedSession();
  }
  function joinGame() {
    const name = $("inp-name").value.trim(), code = $("inp-code").value.trim();
    if (!name || !/^\d{4}$/.test(code)) { $("join-msg").textContent = "별명과 4자리 방 코드를 입력하세요."; return; }
    const saved = readSession(); noteText = "";
    activeSession = saved && saved.code === code ? { ...saved, id: deviceId(), name } : { id: deviceId(), code, name, roomId: null };
    saveSession();
    joined = false; gameStarted = false; recovering = false; ending = false; myTeam = -1; syncRequest = Net.newId();
    lastHostAt = Date.now(); lastJoinAt = 0;
    Sound.init();
    Net.onMessage((d, from) => clientRecv(d, from));
    Net.join(code, activeSession.id);
    $("btn-join").disabled = true; $("join-msg").textContent = "방을 찾는 중…";
    $("inp-name").disabled = $("inp-code").disabled = true; $("btn-join-cancel").style.display = "";
    clearInterval(joinTimer); joinTimer = setInterval(watchConnection, 1000); sendJoin();
  }
  $("btn-join").onclick = joinGame;
  $("btn-resume").onclick = () => { fillSavedSession(); show("client-lobby"); joinGame(); };
  $("btn-join-cancel").onclick = cancelJoin;
  $("btn-reconnect").onclick = recover;
  $("btn-reconnect-back").onclick = cancelJoin;
  window.addEventListener("online", recover);
  window.addEventListener("offline", recover);
  document.addEventListener("visibilitychange", () => {
    if (!activeSession || ending) return;
    if (document.hidden) { recovering = true; syncRequest = Net.newId(); Client.setConnectionLost(true); }
    else recover();
  });
  Net.onStatus(s => { const t = s.local ? "" : `연결 ${s.brokers}/3${s.peers ? " · 직접 연결" : ""}`; $("net-status").textContent = t; $("console-net").textContent = t; });

  function clientRecv(d, from) {
    if (!d || ending || (d.to && d.to !== Net.id)) return;
    if (d.t === "note") { noteText = d.text; if (gameStarted) Client.toast(d.text); else $("join-msg").innerHTML += `<br><span class="muted">${esc(d.text)}</span>`; return; }
    if (d.t === "kicked") { if (gameStarted) return; forgetSession(); cancelJoin(); $("join-msg").textContent = "선생님이 대기실에서 내보냈습니다. 이름을 확인하고 다시 들어오세요."; return; }
    if (d.t === "join-error" && activeSession && d.requestId === syncRequest) { const m = d.reason; forgetSession(); cancelJoin(); $("join-msg").textContent = m; return; }
    if (activeSession && activeSession.roomId && from !== activeSession.roomId) return;
    if (d.t === "lobby") {
      if (gameStarted) return;
      const mine = d.players.find(p => p[0] === Net.id);
      if (mine) { joined = true; myTeam = mine[2]; lastHostAt = Date.now(); recovering = false; syncRequest = null; if (activeSession && !activeSession.roomId) { activeSession.roomId = from || d.roomId; saveSession(); } }
      if (mine && activeSession && mine[1] !== activeSession.name) noteText = `이 기기는 이미 '${mine[1]}'(으)로 들어와 있어서 그 이름, 그 팀으로 이어서 합니다.`;
      const mates = d.players.filter(p => p[2] === myTeam).map(p => esc(p[1]));
      $("join-msg").innerHTML = mine ? `<b style="color:${TEAM_COLORS[myTeam % 4]}">${myTeam + 1}팀</b> — ${mates.join(", ")}<br><span class="muted">선생님이 시작하면 바로 시작됩니다. 소리를 켜 두세요.</span>${noteText ? `<br><span class="muted">${esc(noteText)}</span>` : ""}` : "입장 중…";
      return;
    }
    if (d.t === "go") {
      if (syncRequest && d.requestId && d.requestId !== syncRequest) return;
      if (gameStarted && !syncRequest && !recovering) return;
      joined = true; lastHostAt = Date.now();
      if (activeSession && !activeSession.roomId) { activeSession.roomId = from || d.roomId; saveSession(); }
      Client.setNames(d.names, d.teams);
      if (d.end) { showClientEnd(d.end); return; }
      show("game");
      $("btn-to-console").style.display = teacherPlays ? "" : "none";
      const wasStarted = gameStarted; gameStarted = true; recovering = false; syncRequest = null; reconnectNotice(false);
      if (wasStarted) Client.restore(d.snapshot, d.playerState, d.round);
      else Client.start({ id: Net.id, names: d.names, teams: d.teams, settings: d.settings, practice: d.practice, round: d.round, snapshot: d.snapshot, playerState: d.playerState, onEnd: clientEnd });
      return;
    }
    if (d.t === "roster") { Client.setNames(d.names, d.teams); return; }
    if (d.t === "st" && d.p.some(p => p[0] === Net.id)) lastHostAt = Date.now();
    if (recovering) return;
    Client.onMessage(d);
  }
  function clientEnd(e) {
    if (ending) return;
    if (teacherPlays) { setTimeout(() => { Client.stop(); $("btn-to-game").style.display = "none"; showHostResults(); }, 2500); ending = true; return; }
    showClientEnd(e);
  }
  function showClientEnd(e) {
    ending = true; clearInterval(joinTimer); joinTimer = null; activeSession = null; forgetSession(); reconnectNotice(false);
    setTimeout(() => {
      Client.stop();
      const mine = e.players.find(p => p.id === Net.id);
      $("end-title").textContent = e.practice === "hide" ? "미믹 연습 결과" : e.practice === "seek" ? "학예사 연습 결과" : "최종 결과";
      $("end-body").innerHTML = (mine && !e.practice ? `<p class="big">나: <b>${mine.score}점</b> · 잡음 ${mine.catches} (도움 ${mine.assists}) · 잡힘 ${mine.caught} · 도망 ${mine.escapes} · 진짜 쏨 ${mine.realShots} · 제자리에 숨은 시간 ${mine.correctSec}초</p>` : "") + HostView.results(e);
      $("btn-end-again").style.display = e.practice ? "" : "none";
      show("end");
    }, e.practice ? 1200 : 2500);
  }

  $("btn-options-title").onclick = () => Options.show();
  $("btn-options").onclick = () => Options.show();
  for (const id of ["btn-options", "btn-to-console", "btn-mute", "btn-map"]) $(id).addEventListener("pointerdown", e => e.stopPropagation());
  $("btn-lobby-audio").onclick = () => Options.enableSound();
  $("btn-mute").onclick = () => { if (Sound.muted) Options.enableSound(); else Sound.setMuted(true); };
  Sound.onStatus(s => {
    const off = s.muted || s.volume === 0, ready = s.state === "running";
    $("btn-mute").textContent = off ? "🔇" : ready ? "🔊" : "🔈";
    const msg = off ? "게임 소리가 꺼져 있습니다. 소리 켜기를 눌러 주세요." : ready ? "소리 준비됨 · 시험음이 왼쪽→오른쪽으로 들리면 됩니다." : s.state === "idle" ? "입장 전에 소리가 들리는지 확인해 주세요." : "소리가 멈춰 있습니다. 소리 켜기를 눌러 주세요.";
    $("lobby-audio-status").textContent = msg; $("opt-audio-status").textContent = msg;
  });

  // 패드·폰: 확대·길게 누르기 막기
  const isField = t => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener("dblclick", e => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", e => { if (e.touches.length > 1 || (e.scale !== undefined && e.scale !== 1)) e.preventDefault(); }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener("touchend", e => { const t = Date.now(); const btn = e.target && e.target.closest && e.target.closest("button, label, a"); if (t - lastTouchEnd < 350 && !isField(e.target) && !btn) e.preventDefault(); lastTouchEnd = t; }, { passive: false });
  document.addEventListener("contextmenu", e => { if (!isField(e.target)) e.preventDefault(); });

  Art.load();
  fillSavedSession();
  show("title");
  // 다시 하기(연습) — 새로고침 뒤 바로 같은 연습으로
  if (location.hash === "#practice-seek" || location.hash === "#practice-hide") { const m = location.hash.slice(10); history.replaceState(null, "", location.pathname + location.search); Art.whenReady(() => startPractice(m)); }
})();
