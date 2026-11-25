// 게임 규칙 (교사 기기에서만 판정) — 라운드·역할 교대, 변신 고르기, 받침대, 찍기 판정, 기척, 점수
window.Rules = (function () {
  const DEFAULTS = { teams: 4, rounds: 4, hideTime: 45, seekTime: 180, beepEvery: 30, hearts: 5, size: "auto", units: null, resultTime: 20, tauntCd: 20 };
  const PTS = { catch: 60, wrong: -15, caught: -30, taunt: 10, jail: -20 };
  const TAG_RANGE = 3.2, TAG_CD = 0.8, PERCH_RANGE = 1.7, IMMUNE = 5, RESPAWN = 5, JAIL = 12, STUN = 1.5, WHISTLE_CD = 45, PICK_TIME = 12;
  const SCHED4 = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  const SPEED = 3.1;

  function create(settings) {
    return { settings: { ...DEFAULTS, ...(settings || {}) }, players: new Map(), round: 0, phase: "lobby", t: 0, elapsed: 0, info: null, museum: null,
      events: [], log: [], occupied: new Map(), whistleAt: {}, nextBeep: 0, wingUse: {}, practice: null, teamsN: 2, floorCache: null, scores: [] };
  }
  function emit(W, e) { W.events.push(e); }
  function teamCount(W) { return W.teamsN; }
  function addPlayer(W, id, name, team, bot) {
    if (W.players.has(id)) return W.players.get(id);
    const P = { id, name: String(name || "?").slice(0, 8), team: team || 0, role: "seek", x: 0, y: 0, a: 0, item: -1, offers: [], perch: -1, perchFrom: null,
      state: "alive", respawnAt: 0, immuneUntil: 0, hearts: W.settings.hearts, jailUntil: 0, stunUntil: 0, lastTag: -9, tauntAt: -99, offerAt: 0,
      score: 0, bot: !!bot, stats: { hideSec: 0, correctSec: 0, catches: 0, wrongTags: 0, caught: 0, taunts: 0, jailed: 0, perches: 0, correctPerches: 0 }, roundCorrect: 0, roundSec: 0 };
    W.players.set(id, P);
    if (W.phase !== "lobby" && W.phase !== "over") joinMidRound(W, P);
    return P;
  }

  // ---------- 라운드 ----------
  function hiderTeams(W, n) {
    if (W.practice === "seek") return [1];
    if (W.practice === "hide") return [0];
    const T = W.teamsN;
    if (T <= 2) return [(n - 1) % 2];
    if (T === 3) return [(n - 1) % 3];
    return SCHED4[(n - 1) % SCHED4.length];
  }
  function enabledWings(W) {
    const units = W.settings.units && W.settings.units.length ? W.settings.units : MM.UNITS.map(u => u.id);
    return MM.WINGS.filter(w => units.includes(w.unit));
  }
  function targetRooms(W) {
    const s = W.settings.size, n = [...W.players.values()].filter(p => !p.bot).length;
    if (s === "small") return 6; if (s === "medium") return 10; if (s === "large") return 15;
    if (W.practice) return 9;
    return n <= 4 ? 7 : n <= 8 ? 9 : n <= 12 ? 12 : 14;
  }
  function chooseWings(W, rnd) {
    const cand = enabledWings(W); if (!cand.length) return [];
    const target = targetRooms(W), max = target + 3;
    const order = cand.map(w => ({ w, k: (W.wingUse[w.id] || 0) * 10 + rnd() })).sort((a, b) => a.k - b.k).map(o => o.w);
    const pick = []; let rooms = 0;
    for (const w of order) {
      if (rooms >= target) break;
      if (pick.some(p => p.conflicts.includes(w.id) || w.conflicts.includes(p.id))) continue;
      if (rooms + w.rooms.length > max && rooms > 0) continue;
      pick.push(w); rooms += w.rooms.length;
    }
    for (const w of pick) W.wingUse[w.id] = (W.wingUse[w.id] || 0) + 1;
    return pick.map(w => w.id);
  }
  function startGame(W, seed) {
    W.gameSeed = seed || (1 + Math.floor(Math.random() * 1e9));
    W.rnd = Museum._rng(W.gameSeed);
    const humans = [...W.players.values()].filter(p => !p.bot);
    W.teamsN = W.practice ? 2 : Math.max(2, Math.min(W.settings.teams, 4, Math.max(2, ...humans.map(p => p.team + 1))));
    W.round = 0; W.log = []; W.scores = new Array(W.teamsN).fill(0);
    for (const P of W.players.values()) { P.score = 0; for (const k in P.stats) P.stats[k] = 0; }
    startRound(W);
  }
  function startRound(W) {
    W.round++;
    const seed = 1 + Math.floor(W.rnd() * 1e9);
    const wings = chooseWings(W, W.rnd);
    const nRooms = wings.reduce((a, id) => a + MM.WING_BY_ID[id].rooms.length, 0);
    const grid = Museum.gridFor(nRooms);
    W.info = { n: W.round, total: W.practice ? 1 : W.settings.rounds, seed, wings, cols: grid.cols, rows: grid.rows, hiders: hiderTeams(W, W.round) };
    W.museum = Museum.generate({ seed, wings, cols: grid.cols, rows: grid.rows }); Museum.use(W.museum);
    W.floorCache = null; W.occupied.clear(); W.whistleAt = {};
    let si = 0; const spawn = () => W.museum.spawns[si++ % W.museum.spawns.length];
    const spawns = {};
    for (const P of W.players.values()) {
      P.role = W.info.hiders.includes(P.team) ? "hide" : "seek";
      Object.assign(P, { item: -1, offers: [], perch: -1, perchFrom: null, state: "alive", respawnAt: 0, immuneUntil: 0, hearts: W.settings.hearts, jailUntil: 0, stunUntil: 0, lastTag: -9, tauntAt: -99, roundCorrect: 0, roundSec: 0, caughtThisRound: 0 });
      const s = spawn(); P.x = s.x; P.y = s.y; const L = W.museum.cells[W.museum.lobby]; P.a = Math.atan2((L.y0 + L.y1 + 1) / 2 - s.y, (L.x0 + L.x1 + 1) / 2 - s.x); spawns[P.id] = [P.x, P.y, +P.a.toFixed(2)];
    }
    W.phase = "hide"; W.t = W.practice === "seek" ? 4 : W.practice === "hide" ? 3 : W.settings.hideTime;
    emit(W, { k: "round", ...W.info, hideTime: W.t, seekTime: W.settings.seekTime, spawns });
    for (const P of W.players.values()) if (P.role === "hide") giveOffers(W, P);
    if (W.practice === "seek") for (const P of W.players.values()) if (P.bot) botHide(W, P);
  }
  function joinMidRound(W, P) {
    if (!W.info) return;
    P.role = W.info.hiders.includes(P.team) ? "hide" : "seek";
    P.hearts = W.settings.hearts;
    const s = P.role === "hide" ? farPoint(W) : W.museum.spawns[W.players.size % W.museum.spawns.length];
    P.x = s.x; P.y = s.y; P.a = 0;
    if (P.role === "hide") { P.immuneUntil = W.elapsed + IMMUNE + PICK_TIME; giveOffers(W, P); }
  }
  // 아직 전시되지 않았고 다른 미믹이 쓰지 않는 전시물 중에서, 서로 다른 전시실 것 3개
  function giveOffers(W, P) {
    const used = new Set([...W.players.values()].filter(q => q !== P && q.role === "hide").flatMap(q => [q.item, ...q.offers]).filter(i => i >= 0));
    const byRoom = [];
    for (const ri in W.museum.pool) { const list = W.museum.pool[ri].filter(i => !used.has(i)); if (list.length) byRoom.push(list); }
    Museum._shuffle(byRoom, W.rnd);
    const out = [];
    for (const list of byRoom) { if (out.length >= 3) break; out.push(list[Math.floor(W.rnd() * list.length)]); }
    if (out.length < 3) for (const list of byRoom) for (const i of list) if (out.length < 3 && !out.includes(i)) out.push(i);
    if (!out.length) { // 아주 작은 전시관: 이미 쓰는 것도 허용
      for (const ri in W.museum.pool) for (const i of W.museum.pool[ri]) if (out.length < 3 && !out.includes(i)) out.push(i);
    }
    P.offers = out; P.item = -1; P.offerAt = W.elapsed;
    if (!P.bot) emit(W, { k: "offer", to: P.id, list: out });
  }
  function pick(W, P, item) {
    if (P.role !== "hide" || P.item >= 0 && P.state === "alive" && W.phase === "seek") return false;
    if (!P.offers.includes(item)) return false;
    P.item = item; emit(W, { k: "picked", to: P.id, item });
    return true;
  }
  function floorList(W) { if (!W.floorCache) W.floorCache = Museum.floorTiles().filter(p => Museum.cellIndexAt(p.x, p.y) !== W.museum.lobby); return W.floorCache; }
  function farPoint(W) {
    const seekers = [...W.players.values()].filter(q => q.role === "seek");
    const list = floorList(W); if (!list.length) return W.museum.spawns[0];
    let best = list[0], bd = -1;
    for (let i = 0; i < 40; i++) { const p = list[Math.floor(W.rnd() * list.length)]; const d = seekers.length ? Math.min(...seekers.map(q => Math.hypot(q.x - p.x, q.y - p.y))) : W.rnd(); if (d > bd) { bd = d; best = p; } }
    return best;
  }
  function standOf(W, id) { return W.museum && W.museum.stands[id]; }
  function correctAt(W, P) { if (P.perch < 0 || P.item < 0) return false; const s = standOf(W, P.perch); return !!s && MM.ITEMS[P.item].room === s.room; }
  function whereName(W, P) { const c = Museum.cellAt(P.x, P.y); return c ? c.name : "복도"; }

  // ---------- 받침대 ----------
  function perch(W, P, sid) {
    if (P.role !== "hide" || P.state !== "alive" || P.item < 0 || P.perch >= 0) return false;
    if (W.phase !== "hide" && W.phase !== "seek") return false;
    const s = standOf(W, sid); if (!s || s.item >= 0 || W.occupied.has(sid)) return false;
    if (Math.hypot(s.x + 0.5 - P.x, s.y + 0.5 - P.y) > PERCH_RANGE) return false;
    W.occupied.set(sid, P.id); P.perch = sid; P.perchFrom = { x: P.x, y: P.y }; P.x = s.x + 0.5; P.y = s.y + 0.5;
    P.stats.perches++;
    if (W.practice === "hide") {
      const ok = correctAt(W, P); if (ok) { P.stats.correctPerches++; P.score += 10; } else W.log.push({ type: "hideWrong", name: P.name, item: P.item, at: s.room, caught: false, practice: true });
      emit(W, { k: "check", to: P.id, ok, item: P.item, at: s.room });
      P.nextOfferAt = W.elapsed + 1.6;
    }
    return true;
  }
  function unperch(W, P) {
    if (P.perch < 0) return false;
    const s = standOf(W, P.perch); W.occupied.delete(P.perch); P.perch = -1;
    const off = Museum.stepOff(s, P.perchFrom); P.x = off.x; P.y = off.y; P.perchFrom = null;
    return true;
  }

  // ---------- 찍기 ----------
  function tag(W, P, x, y) {
    if (P.role !== "seek" || W.phase !== "seek") return;
    if (W.elapsed < P.jailUntil || W.elapsed < P.stunUntil || W.elapsed - P.lastTag < TAG_CD) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    P.lastTag = W.elapsed;
    let target = null, td = 0.85;
    for (const H of W.players.values()) {
      if (H.role !== "hide" || H.state !== "alive" || H.item < 0) continue;
      const d = Math.hypot(H.x - x, H.y - y); if (d < td && Math.hypot(H.x - P.x, H.y - P.y) <= TAG_RANGE + 0.9) { td = d; target = H; }
    }
    if (target) {
      if (W.elapsed < target.immuneUntil) { emit(W, { k: "miss", to: P.id, why: "immune" }); return; }
      return caught(W, P, target);
    }
    const s = W.museum.stands.find(s => Math.hypot(s.x + 0.5 - x, s.y + 0.5 - y) < 0.7);
    if (s && s.item >= 0 && Math.hypot(s.x + 0.5 - P.x, s.y + 0.5 - P.y) <= TAG_RANGE + 0.9) {
      P.hearts--; P.score += PTS.wrong; P.stats.wrongTags++; P.stunUntil = W.elapsed + STUN;
      W.log.push({ type: "tagWrong", name: P.name, team: P.team, item: s.item, round: W.round });
      emit(W, { k: "wrong", by: P.id, item: s.item, s: s.id, hearts: P.hearts });
      if (P.hearts <= 0) { P.jailUntil = W.elapsed + JAIL; P.score += PTS.jail; P.stats.jailed++; emit(W, { k: "jail", id: P.id, secs: JAIL }); }
      return;
    }
    emit(W, { k: "miss", to: P.id, why: s ? "empty" : "none" });
  }
  function caught(W, S, H) {
    const ok = correctAt(W, H), perched = H.perch >= 0, at = perched ? standOf(W, H.perch).room : -1, where = whereName(W, H), item = H.item;
    if (H.perch >= 0) W.occupied.delete(H.perch);
    S.score += PTS.catch; S.stats.catches++;
    H.score += PTS.caught; H.stats.caught++; H.caughtThisRound = (H.caughtThisRound || 0) + 1;
    if (perched && !ok) W.log.push({ type: "hideWrong", name: H.name, team: H.team, item, at, where, caught: true, round: W.round });
    H.state = "caught"; H.respawnAt = W.elapsed + RESPAWN; H.perch = -1; H.perchFrom = null;
    emit(W, { k: "caught", by: S.id, id: H.id, item, ok, perched, at, where });
    giveOffers(W, H);
  }

  // ---------- 메시지 ----------
  function handle(W, id, d) {
    const P = W.players.get(id); if (!P || !d) return;
    if (W.phase === "lobby" || W.phase === "over") return;
    switch (d.t) {
      case "pos": {
        if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
        if (Number.isFinite(d.a)) P.a = d.a;
        if (P.perch >= 0 || P.state !== "alive" || P.bot) return;
        if (P.role === "seek" && (W.phase === "hide" || W.elapsed < P.jailUntil)) return;
        if (W.phase === "result") return;
        P.x = d.x; P.y = d.y; return;
      }
      case "pick": if (pick(W, P, d.item) && P.state === "caught" && W.elapsed >= P.respawnAt) respawn(W, P); return;
      case "perch": perch(W, P, d.s); return;
      case "unperch": unperch(W, P); return;
      case "tag": tag(W, P, d.x, d.y); return;
      case "taunt":
        if (P.role !== "hide" || P.state !== "alive" || P.item < 0 || W.phase !== "seek" || W.elapsed - P.tauntAt < W.settings.tauntCd) return;
        P.tauntAt = W.elapsed; P.score += PTS.taunt; P.stats.taunts++;
        emit(W, { k: "taunt", id: P.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2), item: P.item }); return;
      case "whistle": {
        if (P.role !== "seek" || W.phase !== "seek" || W.elapsed < P.jailUntil) return;
        const last = W.whistleAt[P.team] ?? -99; if (W.elapsed - last < WHISTLE_CD) { emit(W, { k: "cool", to: P.id, left: Math.ceil(WHISTLE_CD - (W.elapsed - last)) }); return; }
        W.whistleAt[P.team] = W.elapsed;
        emit(W, { k: "whistle", by: P.id, team: P.team, x: +P.x.toFixed(2), y: +P.y.toFixed(2) });
        beep(W, true); return;
      }
    }
  }
  function beep(W, loud) {
    const list = [...W.players.values()].filter(P => P.role === "hide" && P.state === "alive" && P.item >= 0).map(P => [P.id, +P.x.toFixed(2), +P.y.toFixed(2), P.item]);
    if (list.length) emit(W, { k: "beep", list, loud: !!loud });
  }
  function respawn(W, P) {
    const p = farPoint(W); P.x = p.x; P.y = p.y; P.state = "alive"; P.immuneUntil = W.elapsed + IMMUNE; P.perch = -1;
    if (P.bot) { botHide(W, P); }
    emit(W, { k: "respawn", id: P.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2) });
  }

  // ---------- 시간 ----------
  function tick(W, dt) {
    if (W.phase === "lobby" || W.phase === "over") return;
    W.elapsed += dt; W.t -= dt;
    const players = [...W.players.values()];
    if (W.phase === "hide") {
      for (const P of players) if (P.role === "hide" && P.item < 0 && P.offers.length && W.elapsed - P.offerAt >= PICK_TIME) pick(W, P, P.offers[0]);
      if (W.t <= 0) { W.phase = "seek"; W.t = W.settings.seekTime; W.nextBeep = W.settings.beepEvery || 0; emit(W, { k: "phase", ph: "seek", t: W.t }); }
      return;
    }
    if (W.phase === "seek") {
      for (const P of players) {
        if (P.role === "hide") {
          if (P.state === "alive" && P.item >= 0) {
            P.stats.hideSec += dt; P.roundSec += dt; P.score += dt;
            if (correctAt(W, P)) { P.stats.correctSec += dt; P.roundCorrect += dt; }
          }
          if (P.state === "caught" && W.elapsed >= P.respawnAt) {
            if (P.item < 0 && W.elapsed - P.offerAt >= PICK_TIME) pick(W, P, P.offers[0]);
            if (P.item >= 0) respawn(W, P);
          }
          if (W.practice === "hide" && P.perch >= 0 && P.nextOfferAt && W.elapsed >= P.nextOfferAt) { P.nextOfferAt = 0; unperch(W, P); emit(W, { k: "unperched", to: P.id, x: P.x, y: P.y }); giveOffers(W, P); }
        } else if (P.jailUntil && W.elapsed >= P.jailUntil) {
          P.jailUntil = 0; P.hearts = W.settings.hearts; const s = W.museum.spawns[Math.floor(W.rnd() * W.museum.spawns.length)]; P.x = s.x; P.y = s.y;
          emit(W, { k: "free", id: P.id, x: s.x, y: s.y });
        }
      }
      if (W.settings.beepEvery > 0 && W.practice !== "hide") { W.nextBeep -= dt; if (W.nextBeep <= 0) { W.nextBeep += W.settings.beepEvery; beep(W, false); } }
      if (W.t <= 0) endRound(W);
      return;
    }
    if (W.phase === "result" && W.t <= 0) nextRound(W);
  }
  function teamScores(W) {
    const sc = new Array(W.teamsN).fill(0);
    for (const P of W.players.values()) if (!P.bot && P.team < W.teamsN) sc[P.team] += P.score;
    return sc.map(v => Math.round(v));
  }
  function endRound(W) {
    const hiders = [];
    for (const P of W.players.values()) {
      if (P.role !== "hide") continue;
      const bonus = Math.round(P.roundCorrect); P.score += bonus;
      const ok = correctAt(W, P);
      if (P.state === "alive" && P.item >= 0 && P.perch >= 0 && !ok && !W.practice) W.log.push({ type: "hideWrong", name: P.name, team: P.team, item: P.item, at: P.perch >= 0 ? standOf(W, P.perch).room : -1, where: whereName(W, P), caught: false, round: W.round });
      hiders.push({ id: P.id, name: P.name, team: P.team, item: P.item, alive: P.state === "alive", ok, perched: P.perch >= 0, where: whereName(W, P), at: P.perch >= 0 ? standOf(W, P.perch).room : -1, sec: Math.round(P.roundSec), bonus, caught: P.caughtThisRound || 0, bot: P.bot, x: +P.x.toFixed(1), y: +P.y.toFixed(1) });
    }
    W.phase = "result"; W.t = W.round >= (W.practice ? 1 : W.settings.rounds) ? 3 : W.settings.resultTime;
    W.scores = teamScores(W);
    emit(W, { k: "rend", n: W.round, total: W.practice ? 1 : W.settings.rounds, hiders, scores: W.scores, last: W.round >= (W.practice ? 1 : W.settings.rounds) });
  }
  function nextRound(W) {
    if (W.round >= (W.practice ? 1 : W.settings.rounds)) return finish(W);
    startRound(W);
  }
  function finish(W) {
    if (W.phase === "over") return;
    if (W.phase === "seek") endRound(W);
    W.phase = "over"; W.scores = teamScores(W);
    emit(W, { k: "end", ...results(W) });
  }
  function results(W) {
    const players = [...W.players.values()].filter(p => !p.bot).map(P => ({ id: P.id, name: P.name, team: P.team, score: Math.round(P.score), ...Object.fromEntries(Object.entries(P.stats).map(([k, v]) => [k, Math.round(v)])) }));
    return { scores: teamScores(W), teams: W.teamsN, players, log: W.log.slice(0, 200), rounds: W.round, practice: W.practice };
  }

  // ---------- 혼자 연습용 미믹(봇) ----------
  function botHide(W, P) {
    if (P.item < 0) { if (!P.offers.length) giveOffers(W, P); P.item = P.offers[0]; }
    const item = MM.ITEMS[P.item];
    const free = W.museum.stands.filter(s => s.item < 0 && !W.occupied.has(s.id));
    const right = free.filter(s => s.room === item.room);
    const wing = MM.ROOMS[item.room].wing;
    const near = free.filter(s => s.room !== item.room && MM.ROOMS[s.room].wing === wing);
    let s = null; const r = W.rnd();
    if (r < 0.6 && right.length) s = right[Math.floor(W.rnd() * right.length)];
    else if (near.length && r < 0.9) s = near[Math.floor(W.rnd() * near.length)];
    else if (free.length) s = free[Math.floor(W.rnd() * free.length)];
    if (!s) return;
    W.occupied.set(s.id, P.id); P.perch = s.id; P.x = s.x + 0.5; P.y = s.y + 0.5; P.perchFrom = null; P.state = "alive";
  }
  function addBots(W, n) {
    for (let i = 0; i < n; i++) { const P = addPlayer(W, "bot-" + i, "미믹 " + (i + 1), 1, true); P.role = "hide"; }
  }

  // ---------- 보내는 상태 ----------
  function snapshot(W) {
    const p = [];
    for (const P of W.players.values()) {
      let f = 0;
      if (P.state !== "alive") f |= 1; if (W.elapsed < P.immuneUntil) f |= 2; if (W.elapsed < P.stunUntil) f |= 4; if (W.elapsed < P.jailUntil) f |= 8; if (P.role === "hide" && P.item < 0) f |= 16;
      p.push([P.id, +P.x.toFixed(2), +P.y.toFixed(2), +P.a.toFixed(2), P.role === "hide" ? 1 : 0, P.item, P.perch, f, P.hearts, P.team]);
    }
    return { t: "st", ph: W.phase, tm: Math.max(0, Math.ceil(W.t)), rn: W.round, rt: W.practice ? 1 : W.settings.rounds, sc: teamScores(W), p,
      wh: Object.fromEntries(Object.entries(W.whistleAt).map(([k, v]) => [k, Math.max(0, Math.ceil(WHISTLE_CD - (W.elapsed - v)))])) };
  }
  function resumeState(W, id) {
    const P = W.players.get(id); if (!P) return null;
    return { x: P.x, y: P.y, a: P.a, role: P.role, item: P.item, offers: P.offers, perch: P.perch, perchFrom: P.perchFrom, hearts: P.hearts, score: Math.round(P.score), state: P.state };
  }
  function roundMsg(W) { return W.info ? { ...W.info, hideTime: W.settings.hideTime, seekTime: W.settings.seekTime } : null; }

  return { DEFAULTS, PTS, TAG_RANGE, PERCH_RANGE, WHISTLE_CD, SPEED, IMMUNE, create, addPlayer, startGame, startRound, tick, handle, snapshot, resumeState, roundMsg, finish, results, addBots, teamScores, correctAt, hiderTeams, _giveOffers: giveOffers };
})();
