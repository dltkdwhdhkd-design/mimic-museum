// 게임 규칙 (교사 기기에서만 판정)
// 라운드·역할 교대, 변신(과학 전시물 2 + 잡동사니 1), 아무 데나 숨기·받침대, 도장총 연사와 체력,
// 미믹 체력·도망, 저절로 나는 소리, 폐관 시간, 점수, 혼자 연습용 로봇(미믹·학예사)
window.Rules = (function () {
  const DEFAULTS = { teams: 4, rounds: 4, hideTime: 30, seekTime: 150, beepEvery: 30, size: "auto", units: null, resultTime: 20, tauntCd: 15 };
  const PTS = { catch: 50, assist: 20, real: -3, caught: -20, taunt: 10, jail: -20, escape: 15 };
  const HUNTER_HP = 100, DMG = 20, HEAL = 10, REAL_COST = 6, ITEM_HP = 80;
  const FIRE_GAP = 0.3, SHOT_RANGE = 10, PERCH_RANGE = 1.7, IMMUNE = 4, RESPAWN = 5, JAIL = 10, WHISTLE_CD = 40, PICK_TIME = 12, REGEN = 8, CLOSING = 30, ASSIST_WIN = 10;
  const SPEED = 3.1, MIMIC_SPEED = 3.0, CLOSING_BOOST = 1.2, DASH = { mul: 2.3, time: 0.3, cd: 3.5 };
  const SCHED4 = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  // 잡동사니 변신: 전시실·쉬는 곳에 진짜로 놓여 있는 가구들
  const EVERYDAY = [
    { kind: "plant", name: "화분", hp: 60 },
    { kind: "trash", name: "휴지통", hp: 40 },
    { kind: "extinguisher", name: "소화기", hp: 40 },
    { kind: "bench", name: "긴 의자", hp: 100 },
    { kind: "poster", name: "안내판", hp: 60 },
  ];
  const DECOR_NAMES = { bench: "긴 의자", plant: "화분", desk: "안내 데스크", vending: "자판기", rope: "차단줄", poster: "안내판", trash: "휴지통", extinguisher: "소화기" };
  // 변신 번호: 0 이상 = 과학 전시물(MM.ITEMS), -2 이하 = 잡동사니(EVERYDAY[-2 - f]), -1 = 아직 없음
  const decorOf = f => f <= -2 ? EVERYDAY[-2 - f] || null : null;
  function formName(f) { if (f >= 0) return MM.ITEMS[f] ? MM.ITEMS[f].name : "?"; const d = decorOf(f); return d ? d.name : ""; }
  function formHp(f) { if (f >= 0) return ITEM_HP; const d = decorOf(f); return d ? d.hp : 0; }

  function create(settings) {
    return { settings: { ...DEFAULTS, ...(settings || {}) }, players: new Map(), round: 0, phase: "lobby", t: 0, elapsed: 0, info: null, museum: null,
      events: [], log: [], occupied: new Map(), whistleAt: {}, wingUse: {}, practice: null, teamsN: 2, floorCache: null, spotCache: null, scores: [], closing: false, realShots: {}, heard: [], stamped: {} };
  }
  function emit(W, e) { W.events.push(e); }
  function newStats() { return { hideSec: 0, correctSec: 0, catches: 0, assists: 0, hits: 0, realShots: 0, caught: 0, escapes: 0, taunts: 0, jailed: 0 }; }
  function addPlayer(W, id, name, team, bot) {
    if (W.players.has(id)) return W.players.get(id);
    const P = { id, name: String(name || "?").slice(0, 8), team: team || 0, role: "seek", x: 0, y: 0, a: 0, bot: bot || null, score: 0, stats: newStats() };
    resetForRound(W, P);
    W.players.set(id, P);
    if (W.phase !== "lobby" && W.phase !== "over") joinMidRound(W, P);
    return P;
  }
  function resetForRound(W, P) {
    Object.assign(P, { item: -1, offers: [], perch: -1, perchFrom: null, state: "alive", respawnAt: 0, immuneUntil: 0, hp: HUNTER_HP, maxHp: HUNTER_HP, jailUntil: 0,
      tauntAt: -99, nextTaunt: Infinity, offerAt: W.elapsed, movedAt: -9, firedAt: -9, hitAt: -9, ammo: 3, ammoAt: W.elapsed, hitBy: {}, wasHit: false,
      roundCorrect: 0, roundSec: 0, caughtThisRound: 0, escapesThisRound: 0, brain: null });
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
    if (W.practice) return 7;
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
    W.round = 0; W.log = []; W.realShots = {}; W.scores = new Array(W.teamsN).fill(0);
    for (const P of W.players.values()) { P.score = 0; P.stats = newStats(); }
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
    W.floorCache = null; W.spotCache = null; W.occupied.clear(); W.whistleAt = {}; W.closing = false; W.heard = []; W.stamped = {};
    let si = 0; const spawn = () => W.museum.spawns[si++ % W.museum.spawns.length];
    const spawns = {};
    const L = W.museum.cells[W.museum.lobby];
    for (const P of W.players.values()) {
      P.role = W.info.hiders.includes(P.team) ? "hide" : "seek";
      resetForRound(W, P);
      const s = spawn(); P.x = s.x; P.y = s.y; P.a = Math.atan2((L.y0 + L.y1 + 1) / 2 - s.y, (L.x0 + L.x1 + 1) / 2 - s.x); spawns[P.id] = [P.x, P.y, +P.a.toFixed(2)];
    }
    W.phase = "hide"; W.t = W.practice === "seek" ? 4 : W.settings.hideTime;
    emit(W, { k: "round", ...W.info, hideTime: W.t, seekTime: W.settings.seekTime, spawns });
    for (const P of W.players.values()) if (P.role === "hide") giveOffers(W, P);
    for (const P of W.players.values()) if (P.bot && P.role === "hide") { pick(W, P, botChoose(W, P)); botPlan(W, P, null); botArrive(W, P, true); }
  }
  function joinMidRound(W, P) {
    if (!W.info) return;
    P.role = W.info.hiders.includes(P.team) ? "hide" : "seek";
    const s = P.role === "hide" ? farPoint(W) : W.museum.spawns[W.players.size % W.museum.spawns.length];
    P.x = s.x; P.y = s.y; P.a = 0;
    if (P.role === "hide") { P.immuneUntil = W.elapsed + IMMUNE + PICK_TIME; giveOffers(W, P); if (W.phase === "seek") scheduleTaunt(W, P); }
  }
  // 아직 전시되지 않았고 다른 미믹이 쓰지 않는 과학 전시물 2개(서로 다른 전시실) + 잡동사니 1개
  function giveOffers(W, P) {
    const used = new Set([...W.players.values()].filter(q => q !== P && q.role === "hide").flatMap(q => [q.item, ...q.offers]).filter(i => i >= 0));
    const byRoom = [];
    for (const ri in W.museum.pool) { const list = W.museum.pool[ri].filter(i => !used.has(i)); if (list.length) byRoom.push(list); }
    Museum._shuffle(byRoom, W.rnd);
    const out = [];
    for (const list of byRoom) { if (out.length >= 2) break; out.push(list[Math.floor(W.rnd() * list.length)]); }
    if (out.length < 2) for (const list of byRoom) for (const i of list) if (out.length < 2 && !out.includes(i)) out.push(i);
    if (!out.length) for (const ri in W.museum.pool) for (const i of W.museum.pool[ri]) if (out.length < 2 && !out.includes(i)) out.push(i);
    out.push(-2 - Math.floor(W.rnd() * EVERYDAY.length));
    P.offers = out; P.item = -1; P.offerAt = W.elapsed;
    if (!P.bot) emit(W, { k: "offer", to: P.id, list: out });
  }
  function pick(W, P, f) {
    if (P.role !== "hide") return false;
    if (P.item !== -1 && P.state === "alive" && W.phase === "seek") return false;
    if (!P.offers.includes(f)) return false;
    if (P.perch >= 0 && f < 0) { unperch(W, P); if (!P.bot) emit(W, { k: "unperched", to: P.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2) }); }
    P.item = f; P.hp = P.maxHp = formHp(f);
    if (!P.bot) emit(W, { k: "picked", to: P.id, item: f });
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
  // 숨은 자리: 받침대면 그 받침대의 전시실, 아니면 서 있는 칸의 전시실
  function roomAt(W, P) { if (P.perch >= 0) { const s = standOf(W, P.perch); return s ? s.room : -1; } const c = Museum.cellAt(P.x, P.y); return c && c.kind === "room" ? c.room : -1; }
  function still(W, P) { return P.perch >= 0 || W.elapsed - P.movedAt >= 0.6; }
  function correctAt(W, P) { return P.item >= 0 && still(W, P) && roomAt(W, P) === MM.ITEMS[P.item].room; }
  function whereName(W, P) { const c = Museum.cellAt(P.x, P.y); return c ? c.name : "복도"; }

  // ---------- 받침대 (과학 전시물로 변신했을 때만) ----------
  function perch(W, P, sid) {
    if (P.role !== "hide" || P.state !== "alive" || P.item < 0 || P.perch >= 0) return false;
    if (W.phase !== "hide" && W.phase !== "seek") return false;
    const s = standOf(W, sid); if (!s || s.item >= 0 || W.occupied.has(sid)) return false;
    if (Math.hypot(s.x + 0.5 - P.x, s.y + 0.5 - P.y) > PERCH_RANGE) return false;
    W.occupied.set(sid, P.id); P.perch = sid; P.perchFrom = { x: P.x, y: P.y }; P.x = s.x + 0.5; P.y = s.y + 0.5; P.movedAt = W.elapsed;
    return true;
  }
  function unperch(W, P) {
    if (P.perch < 0) return false;
    const s = standOf(W, P.perch); W.occupied.delete(P.perch); P.perch = -1;
    const off = Museum.stepOff(s, P.perchFrom); P.x = off.x; P.y = off.y; P.perchFrom = null; P.movedAt = W.elapsed;
    return true;
  }

  // ---------- 도장총 ----------
  // ref: "m:<미믹 id>" | "s:<받침대 id>" | "d:<가구 번호>" — 학생 화면이 조준한 것
  function resolveRef(W, ref) {
    if (typeof ref !== "string" || ref.length < 3) return null;
    const k = ref[0], v = ref.slice(2);
    if (k === "m") { const H = W.players.get(v); if (!H || H.role !== "hide" || H.state !== "alive" || H.item === -1) return null; return { x: H.x, y: H.y, H }; }
    if (k === "s") {
      const s = standOf(W, +v); if (!s) return null;
      const oid = W.occupied.get(s.id); if (oid) { const H = W.players.get(oid); if (H && H.state === "alive") return { x: s.x + 0.5, y: s.y + 0.5, H }; }
      return s.item >= 0 ? { x: s.x + 0.5, y: s.y + 0.5, real: true, ref, item: s.item } : null;
    }
    if (k === "d") { const d = W.museum.decor[+v]; return d ? { x: d.x + 0.5, y: d.y + 0.5, real: true, ref, item: -1 } : null; }
    return null;
  }
  function shoot(W, P, ref, bot) {
    if (P.role !== "seek" || W.phase !== "seek" || P.state !== "alive" || W.elapsed < P.jailUntil) return;
    if (!bot) { P.ammo = Math.min(3, P.ammo + (W.elapsed - P.ammoAt) / FIRE_GAP); P.ammoAt = W.elapsed; if (P.ammo < 0.999) return; P.ammo -= 1; }
    P.firedAt = W.elapsed;
    const t = resolveRef(W, ref); if (!t) return;
    if (Math.hypot(t.x - P.x, t.y - P.y) > SHOT_RANGE + 0.6 || !Museum.los(P.x, P.y, t.x, t.y)) return;
    if (t.H) hitMimic(W, P, t.H); else hitReal(W, P, t);
  }
  function hitMimic(W, S, H) {
    if (W.elapsed < H.immuneUntil) { emit(W, { k: "shield", to: S.id, id: H.id }); return; }
    H.hp -= DMG; H.hitAt = W.elapsed; H.hitBy[S.id] = W.elapsed; H.wasHit = true;
    S.hp = Math.min(HUNTER_HP, S.hp + HEAL); S.stats.hits++;
    if (H.hp <= 0) return caught(W, S, H);
    emit(W, { k: "hit", by: S.id, id: H.id, hp: H.hp, max: H.maxHp, shp: S.hp });
    if (H.bot) botFlee(W, H, S);
  }
  function hitReal(W, S, t) {
    S.hp -= REAL_COST; S.score += PTS.real; S.stats.realShots++; W.stamped[t.ref] = W.elapsed + 6;
    if (t.item >= 0 && !S.bot) { const r = W.realShots[t.item] || (W.realShots[t.item] = { n: 0, who: {} }); r.n++; r.who[S.name] = (r.who[S.name] || 0) + 1; }
    emit(W, { k: "real", by: S.id, ref: t.ref, item: t.item, hp: Math.max(0, S.hp) });
    if (S.hp <= 0) { S.hp = 0; S.jailUntil = W.elapsed + JAIL; S.score += PTS.jail; S.stats.jailed++; emit(W, { k: "jail", id: S.id, secs: JAIL }); }
  }
  function caught(W, S, H) {
    const item = H.item, stillNow = still(W, H), ok = correctAt(W, H), perched = H.perch >= 0, at = roomAt(W, H), where = whereName(W, H);
    if (H.perch >= 0) W.occupied.delete(H.perch);
    S.score += PTS.catch; S.stats.catches++;
    const assists = Object.entries(H.hitBy).filter(([id, t]) => id !== S.id && W.elapsed - t <= ASSIST_WIN).map(([id]) => id);
    for (const id of assists) { const A = W.players.get(id); if (A && A.role === "seek") { A.score += PTS.assist; A.stats.assists++; } }
    H.score += PTS.caught; H.stats.caught++; H.caughtThisRound++;
    if (item >= 0 && stillNow && at >= 0 && !ok) W.log.push({ type: "hideWrong", name: H.name, team: H.team, item, at, where, caught: true, round: W.round });
    H.state = "caught"; H.respawnAt = W.elapsed + RESPAWN; H.perch = -1; H.perchFrom = null; H.hitBy = {}; H.wasHit = false; H.brain = null;
    emit(W, { k: "caught", by: S.id, id: H.id, item, ok, still: stillNow, perched, at, where, assists, x: +H.x.toFixed(2), y: +H.y.toFixed(2) });
    giveOffers(W, H);
  }

  // ---------- 소리 ----------
  function scheduleTaunt(W, P) {
    const base = W.settings.beepEvery || 0;
    P.nextTaunt = base > 0 ? W.elapsed + (W.closing ? Math.min(base, 10) : base) * (0.6 + W.rnd() * 0.8) : Infinity;
  }
  function taunt(W, P, auto, delay) {
    if (!auto) { if (W.elapsed - P.tauntAt < W.settings.tauntCd) return; P.tauntAt = W.elapsed; P.score += PTS.taunt; P.stats.taunts++; }
    scheduleTaunt(W, P);
    W.heard.push({ x: P.x, y: P.y, t: W.elapsed + (delay || 0), id: P.id });
    emit(W, { k: "taunt", id: P.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2), item: P.item, auto: auto ? 1 : 0, dl: delay || 0 });
  }

  // ---------- 메시지 ----------
  function canMove(W, P) {
    if (P.bot || P.perch >= 0 || P.state !== "alive" || W.phase === "result") return false;
    if (P.role === "seek" && (W.phase === "hide" || W.elapsed < P.jailUntil)) return false;
    return true;
  }
  function handle(W, id, d) {
    const P = W.players.get(id); if (!P || !d) return;
    if (W.phase === "lobby" || W.phase === "over") return;
    switch (d.t) {
      case "pos": {
        if (Number.isFinite(d.a)) P.a = d.a;
        if (Number.isFinite(d.x) && Number.isFinite(d.y) && canMove(W, P)) {
          if (Math.hypot(d.x - P.x, d.y - P.y) > 0.02) P.movedAt = W.elapsed;
          P.x = d.x; P.y = d.y;
        }
        if (Array.isArray(d.sh)) for (const ref of d.sh.slice(0, 4)) shoot(W, P, ref);
        return;
      }
      case "shoot": shoot(W, P, d.ref); return;
      case "pick": if (pick(W, P, d.item) && P.state === "caught" && W.elapsed >= P.respawnAt) respawn(W, P); return;
      case "perch": perch(W, P, d.s); return;
      case "unperch": unperch(W, P); return;
      case "taunt": if (P.role === "hide" && P.state === "alive" && P.item !== -1 && W.phase === "seek") taunt(W, P, false, 0); return;
      case "whistle": {
        if (P.role !== "seek" || W.phase !== "seek" || W.elapsed < P.jailUntil) return;
        const last = W.whistleAt[P.team] ?? -99; if (W.elapsed - last < WHISTLE_CD) { emit(W, { k: "cool", to: P.id, left: Math.ceil(WHISTLE_CD - (W.elapsed - last)) }); return; }
        W.whistleAt[P.team] = W.elapsed;
        emit(W, { k: "whistle", by: P.id, team: P.team, x: +P.x.toFixed(2), y: +P.y.toFixed(2) });
        for (const H of W.players.values()) if (H.role === "hide" && H.state === "alive" && H.item !== -1) taunt(W, H, true, +(0.3 + W.rnd() * 1.2).toFixed(2));
        return;
      }
    }
  }
  function respawn(W, P) {
    const p = farPoint(W); P.x = p.x; P.y = p.y; P.state = "alive"; P.immuneUntil = W.elapsed + IMMUNE; P.perch = -1;
    P.hp = P.maxHp = formHp(P.item); P.wasHit = false; P.hitBy = {}; P.movedAt = W.elapsed;
    if (W.phase === "seek") scheduleTaunt(W, P);
    if (P.bot) botPlan(W, P, null);
    emit(W, { k: "respawn", id: P.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2) });
  }

  // ---------- 시간 ----------
  function tick(W, dt) {
    if (W.phase === "lobby" || W.phase === "over") return;
    W.elapsed += dt; W.t -= dt;
    const players = [...W.players.values()];
    if (W.phase === "hide") {
      for (const P of players) if (P.role === "hide" && P.item === -1 && P.offers.length && W.elapsed - P.offerAt >= PICK_TIME) pick(W, P, P.offers[0]);
      if (W.t <= 0) startSeek(W);
      return;
    }
    if (W.phase === "seek") {
      if (!W.closing && W.t <= CLOSING) {
        W.closing = true; emit(W, { k: "closing" });
        for (const P of players) if (P.role === "hide" && P.nextTaunt > W.elapsed + 10) P.nextTaunt = W.elapsed + 2 + W.rnd() * 8;
      }
      for (const P of players) { if (P.role === "hide") tickMimic(W, P, dt); else tickHunter(W, P, dt); }
      W.heard = W.heard.filter(h => W.elapsed - h.t < 3);
      if (W.t <= 0) endRound(W);
      return;
    }
    if (W.phase === "result" && W.t <= 0) nextRound(W);
  }
  function startSeek(W) {
    W.phase = "seek"; W.t = W.settings.seekTime;
    for (const P of W.players.values()) if (P.role === "hide") scheduleTaunt(W, P);
    emit(W, { k: "phase", ph: "seek", t: W.t });
  }
  function tickMimic(W, P, dt) {
    if (P.state === "alive" && P.item !== -1) {
      P.stats.hideSec += dt; P.roundSec += dt; P.score += dt;
      if (correctAt(W, P)) { P.stats.correctSec += dt; P.roundCorrect += dt; }
      if (P.wasHit && W.elapsed - P.hitAt >= REGEN) {
        P.wasHit = false; P.hp = P.maxHp; P.hitBy = {}; P.score += PTS.escape; P.stats.escapes++; P.escapesThisRound++;
        emit(W, { k: "escape", id: P.id });
      }
      if (W.elapsed >= P.nextTaunt) taunt(W, P, true, 0);
      if (P.bot) botMove(W, P, dt);
    }
    if (P.state === "caught" && W.elapsed >= P.respawnAt) {
      if (P.bot && P.item === -1) pick(W, P, botChoose(W, P));
      if (P.item === -1 && W.elapsed - P.offerAt >= PICK_TIME) pick(W, P, P.offers[0]);
      if (P.item !== -1) respawn(W, P);
    }
  }
  function tickHunter(W, P, dt) {
    if (P.jailUntil && W.elapsed >= P.jailUntil) {
      P.jailUntil = 0; P.hp = HUNTER_HP; const s = W.museum.spawns[Math.floor(W.rnd() * W.museum.spawns.length)]; P.x = s.x; P.y = s.y;
      if (P.brain) P.brain.path = null;
      emit(W, { k: "free", id: P.id, x: s.x, y: s.y });
    }
    if (P.bot && !P.jailUntil) botHunt(W, P, dt);
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
      const stillNow = still(W, P), ok = correctAt(W, P), at = roomAt(W, P);
      if (P.state === "alive" && P.item >= 0 && stillNow && at >= 0 && !ok) W.log.push({ type: "hideWrong", name: P.name, team: P.team, item: P.item, at, where: whereName(W, P), caught: false, round: W.round });
      hiders.push({ id: P.id, name: P.name, team: P.team, item: P.item, alive: P.state === "alive", ok, still: stillNow, perched: P.perch >= 0, where: whereName(W, P), at, sec: Math.round(P.roundSec), bonus, caught: P.caughtThisRound, esc: P.escapesThisRound, bot: !!P.bot, x: +P.x.toFixed(1), y: +P.y.toFixed(1) });
    }
    const last = W.round >= (W.practice ? 1 : W.settings.rounds);
    W.phase = "result"; W.t = last ? 3 : W.settings.resultTime;
    W.scores = teamScores(W);
    emit(W, { k: "rend", n: W.round, total: W.practice ? 1 : W.settings.rounds, hiders, scores: W.scores, last });
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
    const shots = Object.entries(W.realShots).map(([item, v]) => ({ item: +item, n: v.n, who: Object.keys(v.who) })).sort((a, b) => b.n - a.n).slice(0, 12);
    return { scores: teamScores(W), teams: W.teamsN, players, log: W.log.slice(0, 200), shots, rounds: W.round, practice: W.practice };
  }

  // ---------- 혼자 연습용 로봇 ----------
  function addBots(W, n, role) {
    const hunter = role === "seek";
    for (let i = 0; i < n; i++) addPlayer(W, (hunter ? "bothunt-" : "bot-") + i, (hunter ? "학예사 로봇 " : "미믹 로봇 ") + (i + 1), 1, hunter ? "hunter" : "mimic");
  }
  // 미믹 로봇: 열에 여덟은 과학 전시물, 둘은 잡동사니
  function botChoose(W, P) {
    const sci = P.offers.filter(f => f >= 0), junk = P.offers.filter(f => f < -1);
    return (W.rnd() < 0.2 && junk.length) || !sci.length ? junk[0] : sci[Math.floor(W.rnd() * sci.length)];
  }
  // 방 안에서 숨기 좋은 바닥: 벽·받침대·가구 옆, 문 앞은 빼고
  function hideSpots(W, ci) {
    W.spotCache = W.spotCache || {};
    if (W.spotCache[ci]) return W.spotCache[ci];
    const c = W.museum.cells[ci], out = [];
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
      if (Museum.tile(x, y) !== Museum.T_FLOOR) continue;
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => Museum.tile(x + dx, y + dy) !== Museum.T_FLOOR)) continue;
      if (W.museum.doorTiles.some(d => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) <= 2)) continue;
      out.push({ x: x + 0.5, y: y + 0.5 });
    }
    return (W.spotCache[ci] = out);
  }
  function botPlan(W, P, from) {
    const M = W.museum, rooms = M.cells.map((c, i) => ({ c, i })).filter(o => o.c.kind === "room");
    const ctr = o => ({ x: (o.c.x0 + o.c.x1 + 1) / 2, y: (o.c.y0 + o.c.y1 + 1) / 2 });
    let list;
    if (P.item >= 0) {
      const it = MM.ITEMS[P.item], wing = MM.ROOMS[it.room].wing, r = W.rnd();
      const right = rooms.filter(o => o.c.room === it.room), near = rooms.filter(o => o.c.room !== it.room && o.c.wing === wing);
      list = r < 0.65 && right.length ? right : r < 0.9 && near.length ? near : rooms;
    } else list = M.cells.map((c, i) => ({ c, i })).filter(o => o.c.kind !== "lobby");
    if (from) { // 도망: 쏜 학예사에게서 7~18칸 떨어진 방 (너무 멀면 가다가 잡힌다)
      const ok = o => { const d = Math.hypot(ctr(o).x - from.x, ctr(o).y - from.y); return d > 7 && d < 18; };
      const far = list.filter(ok); list = far.length ? far : rooms.filter(ok); if (!list.length) list = rooms.filter(o => Math.hypot(ctr(o).x - from.x, ctr(o).y - from.y) > 5); if (!list.length) list = rooms;
    }
    const target = list[Math.floor(W.rnd() * list.length)];
    let goal = null, stand = -1;
    if (P.item >= 0 && W.rnd() < 0.45) {
      const free = M.stands.filter(s => s.cell === target.i && s.item < 0 && !W.occupied.has(s.id) && ![...W.players.values()].some(q => q !== P && q.brain && q.brain.stand === s.id));
      if (free.length) { const s = free[Math.floor(W.rnd() * free.length)]; stand = s.id; goal = Museum.stepOff(s, null); }
    }
    if (!goal) {
      const taken = [...W.players.values()].filter(q => q !== P && q.role === "hide");
      const sp = hideSpots(W, target.i).filter(p => !taken.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1.2 || (q.brain && q.brain.goal && Math.hypot(q.brain.goal.x - p.x, q.brain.goal.y - p.y) < 1.2)));
      goal = sp.length ? sp[Math.floor(W.rnd() * sp.length)] : ctr(target);
    }
    P.brain = { goal, stand, path: Museum.path(P.x, P.y, goal.x, goal.y), flee: !!from };
  }
  function botArrive(W, P, instant) {
    const B = P.brain; if (!B) return;
    if (instant) { P.x = B.goal.x; P.y = B.goal.y; }
    if (B.stand >= 0 && !perch(W, P, B.stand)) B.stand = -1;
    if (B.stand < 0) { P.x = B.goal.x; P.y = B.goal.y; }
    P.movedAt = instant ? -9 : W.elapsed;
    B.path = null;
  }
  function botMove(W, P, dt) {
    const B = P.brain; if (!B || !B.path || P.perch >= 0) return;
    let left = MIMIC_SPEED * (B.flee ? 1 : 0.8) * dt;
    while (left > 0 && B.path.length) {
      const n = B.path[0], dx = n.x - P.x, dy = n.y - P.y, d = Math.hypot(dx, dy);
      if (d <= left) { P.x = n.x; P.y = n.y; left -= d; B.path.shift(); }
      else { P.x += dx / d * left; P.y += dy / d * left; P.a = Math.atan2(dy, dx); left = 0; }
    }
    P.movedAt = W.elapsed;
    if (!B.path.length) botArrive(W, P, false);
  }
  function botFlee(W, H, S) {
    if (H.perch >= 0) unperch(W, H);
    botPlan(W, H, { x: S.x, y: S.y });
  }
  // 학예사 로봇: 방을 골라 걸어가서 둘러보며 수상한 것을 쏜다. 움직이는 것·소리 난 것·엉뚱한 방의 전시물을 더 의심한다.
  function botHunt(W, B, dt) {
    const br = B.brain || (B.brain = { path: null, scanUntil: 0, nextShot: W.elapsed + 1, chase: null, chaseUntil: 0, visited: [], hearCd: 0, turn: 1, repath: 0 });
    const speed = SPEED * 0.8 * (W.closing ? CLOSING_BOOST : 1) * dt;
    let tgt = br.chase && W.players.get(br.chase);
    if (tgt && (tgt.state !== "alive" || tgt.role !== "hide" || W.elapsed > br.chaseUntil)) { br.chase = null; tgt = null; br.path = null; }
    if (tgt) {
      const d = Math.hypot(tgt.x - B.x, tgt.y - B.y), see = d < 9 && Museum.los(B.x, B.y, tgt.x, tgt.y);
      if (see) { B.a = Math.atan2(tgt.y - B.y, tgt.x - B.x); if (W.elapsed >= br.nextShot) { br.nextShot = W.elapsed + 0.45 + W.rnd() * 0.25; botFire(W, B, tgt, W.elapsed - tgt.movedAt < 0.3 ? 0.5 : 0.8); } }
      if (d > 1.6) { if (!br.path || !br.path.length || W.elapsed >= br.repath) { br.path = Museum.path(B.x, B.y, tgt.x, tgt.y); br.repath = W.elapsed + 0.7; } walk(W, B, br, speed); }
      return;
    }
    if (W.elapsed >= br.hearCd) {
      const h = W.heard.find(h => h.t <= W.elapsed && Math.hypot(h.x - B.x, h.y - B.y) < 14);
      if (h) {
        br.hearCd = W.elapsed + 5;
        const c = Museum.cellAt(h.x, h.y);
        if (c && W.rnd() < 0.6) { // 소리 난 방 어딘가로 (정확한 자리는 모른다)
          const fl = []; for (let y = c.y0 + 1; y <= c.y1 - 1; y++) for (let x = c.x0 + 1; x <= c.x1 - 1; x++) if (Museum.tile(x, y) === Museum.T_FLOOR) fl.push({ x: x + 0.5, y: y + 0.5 });
          const g = fl.length ? fl[Math.floor(W.rnd() * fl.length)] : h; br.path = Museum.path(B.x, B.y, g.x, g.y); br.scanUntil = 0; br.heardNear = Math.hypot(h.x - B.x, h.y - B.y) < 8 ? h.id : null;
        }
      }
    }
    if (br.path && br.path.length) { walk(W, B, br, speed); botScan(W, B, br, 0.5); return; }
    if (W.elapsed < br.scanUntil) { B.a += dt * 0.9 * br.turn; botScan(W, B, br, 1); return; }
    const M = W.museum;
    let rooms = M.cells.map((c, i) => i).filter(i => M.cells[i].kind === "room" && !br.visited.includes(i));
    if (!rooms.length) { br.visited = []; rooms = M.cells.map((c, i) => i).filter(i => M.cells[i].kind === "room"); }
    const ci = rooms.length ? rooms[Math.floor(W.rnd() * rooms.length)] : M.lobby, c = M.cells[ci];
    br.visited.push(ci); if (br.visited.length > 4) br.visited.shift();
    const floor = []; for (let y = c.y0 + 2; y <= c.y1 - 2; y++) for (let x = c.x0 + 2; x <= c.x1 - 2; x++) if (Museum.tile(x, y) === Museum.T_FLOOR) floor.push({ x: x + 0.5, y: y + 0.5 });
    const g = floor.length ? floor[Math.floor(W.rnd() * floor.length)] : { x: (c.x0 + c.x1 + 1) / 2, y: (c.y0 + c.y1 + 1) / 2 };
    br.path = Museum.path(B.x, B.y, g.x, g.y);
    if (!br.path.length) br.scanUntil = W.elapsed + 2;
  }
  function walk(W, B, br, step) {
    let left = step;
    while (left > 0 && br.path && br.path.length) {
      const n = br.path[0], dx = n.x - B.x, dy = n.y - B.y, d = Math.hypot(dx, dy);
      if (d <= left) { B.x = n.x; B.y = n.y; left -= d; br.path.shift(); }
      else { B.x += dx / d * left; B.y += dy / d * left; if (!br.chase) B.a = Math.atan2(dy, dx); left = 0; }
    }
    B.movedAt = W.elapsed;
    if (br.path && !br.path.length && !br.chase) { br.path = null; br.scanUntil = W.elapsed + 3 + W.rnd() * 2.5; br.turn = W.rnd() < 0.5 ? -1 : 1; }
  }
  function botScan(W, B, br, mul) {
    if (W.elapsed < br.nextShot) return;
    br.nextShot = W.elapsed + (0.9 + W.rnd() * 0.7) / mul;
    if (W.rnd() > 0.6) return;
    const cands = [];
    const add = (x, y, w, t) => { const d = Math.hypot(x - B.x, y - B.y); if (d > 7.5 || d < 0.4 || !Museum.los(B.x, B.y, x, y)) return; cands.push({ x, y, w, t }); };
    const fresh = ref => !(W.stamped[ref] > W.elapsed);   // 방금 '진짜' 도장이 찍힌 것은 다시 안 쏜다
    for (const s of W.museum.stands) if (s.item >= 0 && !W.occupied.has(s.id) && fresh("s:" + s.id)) add(s.x + 0.5, s.y + 0.5, 1, { ref: "s:" + s.id });
    W.museum.decor.forEach((d, i) => { if (fresh("d:" + i)) add(d.x + 0.5, d.y + 0.5, 0.5, { ref: "d:" + i }); });
    for (const H of W.players.values()) {
      if (H.role !== "hide" || H.state !== "alive" || H.item === -1) continue;
      let w = 1.2;
      if (W.elapsed - H.movedAt < 0.3) w += 30;
      if (H.item >= 0 && H.perch < 0) w += 1;
      if (H.item >= 0 && roomAt(W, H) !== MM.ITEMS[H.item].room && W.rnd() < 0.5) w += 3;
      if (br.heardNear === H.id && W.heard.some(h => h.id === H.id && h.t <= W.elapsed)) w += 3;
      add(H.x, H.y, w, { H });
    }
    if (!cands.length) return;
    let r = W.rnd() * cands.reduce((a, c) => a + c.w, 0), c = cands[0];
    for (const k of cands) { r -= k.w; if (r <= 0) { c = k; break; } }
    B.a = Math.atan2(c.y - B.y, c.x - B.x);
    if (c.t.H) botFire(W, B, c.t.H, W.elapsed - c.t.H.movedAt < 0.3 ? 0.55 : 0.85);
    else shoot(W, B, c.t.ref, true);
  }
  function botFire(W, B, H, acc) {
    B.firedAt = W.elapsed;
    if (W.rnd() > acc) return;
    shoot(W, B, H.perch >= 0 ? "s:" + H.perch : "m:" + H.id, true);
    if (H.state === "alive" && B.brain) { B.brain.chase = H.id; B.brain.chaseUntil = W.elapsed + 6; }
  }

  // ---------- 보내는 상태 ----------
  // p: [id, x, y, a, 역할(1 미믹), 변신, 받침대, 표시, 체력, 팀]
  // 표시: 1 잡힘, 2 보호, 8 경비실, 16 변신 전, 32 움직이는 중, 64 방금 맞음, 128 방금 쏨
  function snapshot(W) {
    const p = [];
    for (const P of W.players.values()) {
      let f = 0;
      if (P.state !== "alive") f |= 1; if (W.elapsed < P.immuneUntil) f |= 2; if (W.elapsed < P.jailUntil) f |= 8; if (P.role === "hide" && P.item === -1) f |= 16;
      if (W.elapsed - P.movedAt < 0.3) f |= 32; if (W.elapsed - P.hitAt < 0.6) f |= 64; if (W.elapsed - P.firedAt < 0.35) f |= 128;
      p.push([P.id, +P.x.toFixed(2), +P.y.toFixed(2), +P.a.toFixed(2), P.role === "hide" ? 1 : 0, P.item, P.perch, f, Math.max(0, Math.round(P.hp)), P.team]);
    }
    return { t: "st", ph: W.phase, tm: Math.max(0, Math.ceil(W.t)), rn: W.round, rt: W.practice ? 1 : W.settings.rounds, sc: teamScores(W), p, cl: W.closing ? 1 : 0,
      wh: Object.fromEntries(Object.entries(W.whistleAt).map(([k, v]) => [k, Math.max(0, Math.ceil(WHISTLE_CD - (W.elapsed - v)))])) };
  }
  function resumeState(W, id) {
    const P = W.players.get(id); if (!P) return null;
    return { x: P.x, y: P.y, a: P.a, role: P.role, item: P.item, offers: P.offers, perch: P.perch, perchFrom: P.perchFrom, hp: P.hp, score: Math.round(P.score), state: P.state };
  }
  function roundMsg(W) { return W.info ? { ...W.info, hideTime: W.settings.hideTime, seekTime: W.settings.seekTime } : null; }

  return { DEFAULTS, PTS, EVERYDAY, DECOR_NAMES, SHOT_RANGE, FIRE_GAP, PERCH_RANGE, WHISTLE_CD, SPEED, MIMIC_SPEED, CLOSING_BOOST, DASH, IMMUNE, HUNTER_HP, ITEM_HP, DMG, REAL_COST, HEAL,
    formName, formHp, create, addPlayer, startGame, startRound, tick, handle, snapshot, resumeState, roundMsg, finish, results, addBots, teamScores, correctAt, roomAt, hiderTeams, _giveOffers: giveOffers };
})();
