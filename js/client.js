// 학생 화면 — 학예사는 1인칭 도장총, 미믹은 3인칭(변신·숨기·튀어 도망), HUD, 소리
window.Client = (function () {
  const TEAM_COLORS = ["#e2574c", "#4a8fe2", "#46b16a", "#e0a63a"];
  const el = id => document.getElementById(id);
  const isTouch = ("ontouchstart" in window) && window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const DECOR_H = { bench: 0.55, plant: 1.0, desk: 0.7, vending: 1.45, rope: 0.62, poster: 1.1, trash: 0.55, extinguisher: 0.62 };
  const STAND_SPR = 1.32, LOOSE_SPR = 0.66;
  let cv, ctx, W = 800, H = 600;
  let me = null, names = {}, teams = {}, settings = {}, practice = null, onEnd = null;
  let running = false, raf = 0, last = 0, inputBound = false, connectionReady = true;
  let S = null, info = null, phase = "lobby", role = "seek", team = 0, closing = false;
  let pos = { x: 2, y: 2, a: 0 }, look = 0, keys = {}, input = { fwd: 0, strafe: 0 }, locked = false, moving = false, bobT = 0, walkT = 0;
  let item = -1, offers = [], perch = -1, perchFrom = null, perchPending = null, hp = 100, flags = 0, myScore = 0;
  let others = new Map(), aim = null, lastPos = 0, lastSentKey = "", tauntLocal = -99, pickT = 0;
  let firing = false, fireT = 0, shots = [], dashT = 0, dashCd = 0;
  let stamps = new Map(), puffs = [], cam = { x: 0, y: 0, d: 2 };
  let fx = { flash: 0, flashCol: "255,255,255", shake: 0, recoil: 0, marker: null, hurt: 0, myHit: 0 };
  let toast = { text: "", t: 0, big: false }, feed = [], mapOpen = false, offerOpen = false, banner = null, caughtMsg = null;
  let resetTouch = () => {}, stepT = 0;

  // ---------- 시작·정지 ----------
  function start(opts) {
    stop();
    me = opts.id; names = opts.names || {}; teams = opts.teams || {}; settings = opts.settings || {}; practice = opts.practice || null; onEnd = opts.onEnd;
    cv = el("game-canvas"); ctx = cv.getContext("2d");
    Art.load(); resize(); window.addEventListener("resize", resize);
    document.body.classList.toggle("pc", !isTouch);
    setupInput(); resetControls(); others.clear(); feed = []; S = null; stamps.clear(); puffs = [];
    running = true; last = performance.now(); connectionReady = true;
    Sound.init();
    if (opts.round) applyRound(opts.round, true);
    if (opts.snapshot) restore(opts.snapshot, opts.playerState, opts.round);
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); resetControls(); if (document.pointerLockElement) document.exitPointerLock(); closeOffers(); }
  function resetControls() { keys = {}; input.fwd = input.strafe = 0; moving = false; firing = false; resetTouch(); }
  function resize() { if (!cv) return; W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; Fps.setup(W, H); }
  function setConnectionLost(lost) { connectionReady = !lost; if (lost) { resetControls(); mapOpen = false; if (document.pointerLockElement) document.exitPointerLock(); } }

  function applyRound(r, quiet) {
    if (!r) return;
    const same = info && info.n === r.n && info.seed === r.seed;
    info = r;
    if (!same) { Museum.use(Museum.generate({ seed: r.seed, wings: r.wings, cols: r.cols, rows: r.rows })); mapImg = null; }
    team = teams[me] != null ? teams[me] : team;
    role = r.hiders.includes(team) ? "hide" : "seek";
    if (!same) {
      item = -1; offers = []; perch = -1; perchFrom = null; perchPending = null; hp = 100; flags = 0; aim = null; caughtMsg = null; closing = false;
      stamps.clear(); puffs = []; shots = []; firing = false; dashT = dashCd = 0; look = role === "hide" ? -0.08 : 0;
      closeOffers(); el("round-result").style.display = "none";
      if (r.spawns && r.spawns[me]) { const s = r.spawns[me]; pos = { x: s[0], y: s[1], a: s[2] || 0 }; }
      else if (Museum.cur) { const s = Museum.cur.spawns[0]; pos = { x: s.x, y: s.y, a: 0 }; }
      phase = "hide";
      if (!quiet) {
        Sound.play("horn");
        banner = role === "hide"
          ? { t: 5, title: `${r.n}라운드 — 🎭 당신은 미믹`, sub: "변신할 물건을 고르고 숨으세요. 멈춰 있으면 진짜 물건처럼 보이고, 움직이면 눈알이 튀어나와요. 과학 전시물은 원래 있어야 할 전시실에 숨으면 점수 2배!" }
          : { t: 5, title: `${r.n}라운드 — 🔍 당신은 학예사`, sub: "미믹이 숨는 동안 눈을 감고 기다립니다. 그다음 수상한 물건을 도장총으로 쏘세요. 진짜를 쏘면 내 체력이 깎이고, 미믹을 맞히면 찹니다." };
      }
    }
  }
  function restore(snap, ps, round) {
    resetControls();
    if (round) applyRound(round, true);
    if (snap) onMessage(snap);
    if (ps) {
      pos = { x: ps.x, y: ps.y, a: ps.a || 0 }; item = ps.item; offers = ps.offers || []; perch = ps.perch; perchFrom = ps.perchFrom; hp = ps.hp != null ? ps.hp : 100; myScore = ps.score || 0;
      role = ps.role || role; perchPending = null;
      if (role === "hide" && item === -1 && offers.length && (phase === "hide" || phase === "seek")) openOffers();
    }
    connectionReady = true; lastPos = 0;
  }

  // ---------- 입력 ----------
  // 한글 입력 상태여도 WASD·E·Q·M이 먹도록 글자 키는 자판 위치(e.code)로 읽는다
  const keyOf = e => { const c = e.code || ""; if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase(); if (/^Digit[0-9]$/.test(c)) return c.slice(5); return (e.key || "").toLowerCase(); };
  function setupInput() {
    if (inputBound) return; inputBound = true;
    window.addEventListener("blur", resetControls);
    window.addEventListener("keydown", e => {
      if (!running || isField(e.target)) return;
      const k = keyOf(e); keys[k] = true;
      if (k === " " || k === "e" || k === "shift") e.preventDefault();
      if (!e.repeat) {
        if (role === "seek") { if (k === " " || k === "e") firing = true; }
        else { if (k === "e") mainAction(); if (k === " " || k === "shift") dashAction(); }
        if (k === "q" || k === "r") subAction();
        if (k === "m" || k === "tab") { e.preventDefault(); toggleMap(); }
      }
      if (offerOpen && ["1", "2", "3"].includes(k)) choose(+k - 1);
      if (e.key === "Escape") { mapOpen = false; if (Options.isOpen) Options.close(); }
    });
    window.addEventListener("keyup", e => { const k = keyOf(e); keys[k] = false; if (k === " " || k === "e") firing = false; });
    const stick = el("stick"), knob = el("stick-knob"), zone = el("touch-zone");
    let sid = null, sx = 0, sy = 0, tid = null, tx = 0, ty = 0;
    resetTouch = () => { sid = tid = null; stick.style.display = "none"; knob.style.transform = ""; input.fwd = input.strafe = 0; };
    zone.addEventListener("touchstart", e => {
      if (!running || !connectionReady) return;
      for (const t of e.changedTouches) {
        if (sid === null && t.clientX < W * 0.45) { sid = t.identifier; sx = t.clientX; sy = t.clientY; stick.style.display = "block"; stick.style.left = (sx - 60) + "px"; stick.style.top = (sy - 60) + "px"; }
        else if (tid === null) { tid = t.identifier; tx = t.clientX; ty = t.clientY; }
      }
    }, { passive: true });
    zone.addEventListener("touchmove", e => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          let dx = t.clientX - sx, dy = t.clientY - sy; const d = Math.hypot(dx, dy), m = Math.min(d, 50);
          if (d > 0) { dx = dx / d * m; dy = dy / d * m; }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          input.fwd = d > 8 ? -dy / 50 : 0; input.strafe = d > 8 ? dx / 50 : 0;
        } else if (t.identifier === tid && canLook()) {
          const dx = t.clientX - tx, dy = t.clientY - ty; tx = t.clientX; ty = t.clientY;
          pos.a += dx * 0.0075 * Options.get("touchSens");
          look = Math.max(-0.25, Math.min(0.25, look - dy * 0.0018 * Options.get("touchSens")));
        }
      }
    }, { passive: true });
    const endT = e => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; input.fwd = input.strafe = 0; stick.style.display = "none"; knob.style.transform = ""; } if (t.identifier === tid) tid = null; } };
    zone.addEventListener("touchend", endT); zone.addEventListener("touchcancel", endT);
    zone.addEventListener("pointerdown", e => {
      if (e.pointerType !== "mouse") return;
      if (!locked) { if (connectionReady && !Options.isOpen && !offerOpen && zone.requestPointerLock) { try { const r = zone.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) {} } return; }
      if (e.button === 0) { if (role === "seek") firing = true; else mainAction(); }
      else if (e.button === 2) subAction();
    });
    window.addEventListener("pointerup", e => { if (e.pointerType === "mouse" && e.button === 0) firing = false; });
    zone.addEventListener("contextmenu", e => e.preventDefault());
    document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === zone; if (!locked) firing = false; });
    document.addEventListener("mousemove", e => {
      if (!locked || !running || !canLook()) return;
      const k = Options.get("mouseSens");
      pos.a += (e.movementX || 0) * 0.0024 * k;
      look = Math.max(-0.25, Math.min(0.25, look - (e.movementY || 0) * 0.0015 * k * (Options.get("invertY") ? -1 : 1)));
    });
    const tap = (id, fn) => { const b = el(id); b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); fn(); }); };
    // 쏘기 버튼은 누르고 있는 동안 연사
    const bm = el("btn-main");
    bm.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); if (role === "seek") { firing = true; try { bm.setPointerCapture(e.pointerId); } catch (err) {} } else mainAction(); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) bm.addEventListener(ev, () => { if (role === "seek") firing = false; });
    tap("btn-sub", subAction); tap("btn-dash", dashAction); tap("btn-map", toggleMap);
    for (let i = 0; i < 3; i++) el("offer-" + i).onclick = () => choose(i);
    el("offer-close").onclick = () => closeOffers();
  }
  const isField = t => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  function canLook() { return connectionReady && !mapOpen && !Options.isOpen && !(flags & 1); }
  function toggleMap() { if (!running) return; if (role === "seek" && phase === "hide") return; mapOpen = !mapOpen; if (mapOpen) { firing = false; if (document.pointerLockElement) document.exitPointerLock(); } }

  // ---------- 행동 ----------
  function nearStand() {
    const M = Museum.cur; if (!M || item < 0) return null;
    const occ = new Set(); for (const o of others.values()) if (o.role === "hide" && o.perch >= 0 && !(o.flags & 1)) occ.add(o.perch);
    let best = null, bs = 1e9;
    for (const s of M.stands) {
      if (s.item >= 0 || occ.has(s.id)) continue;
      const dx = s.x + 0.5 - pos.x, dy = s.y + 0.5 - pos.y, d = Math.hypot(dx, dy); if (d > Rules.PERCH_RANGE - 0.1) continue;
      const facing = Math.cos(Math.atan2(dy, dx) - pos.a), score = d - facing * 0.6;
      if (score < bs) { bs = score; best = s; }
    }
    return best;
  }
  // 미믹의 E·주 버튼: 변신 고르기 → 받침대 오르기/내리기 (터치에서 할 게 없으면 튀기)
  function mainAction() {
    if (!running || !connectionReady || Options.isOpen || mapOpen || offerOpen || role !== "hide") return;
    if ((flags & 1) || item === -1) { if (offers.length) openOffers(); return; }
    if (perch >= 0) { doUnperch(); return; }
    const s = nearStand();
    if (!s) { if (isTouch) dashAction(); else showToast(item >= 0 ? "빈 받침대 가까이 가야 올라갈 수 있어요. 받침대 없이 아무 데나 멈춰 서도 됩니다." : "잡동사니는 받침대에 못 올라가요. 아무 데나 멈춰 서면 됩니다.", 2); return; }
    perchFrom = { x: pos.x, y: pos.y }; perch = s.id; perchPending = { s: s.id, t: performance.now() };
    pos.x = s.x + 0.5; pos.y = s.y + 0.5; pos.a = faceRoom(s); look = 0.06; resetControls(); Sound.play("perch");
    Net.sendToHost({ t: "perch", s: s.id });
  }
  function faceRoom(s) { const c = Museum.cur.cells[s.cell]; return Math.atan2((c.y0 + c.y1 + 1) / 2 - (s.y + 0.5), (c.x0 + c.x1 + 1) / 2 - (s.x + 0.5)); }
  function doUnperch() {
    const M = Museum.cur, s = M && M.stands[perch];
    if (s) { const off = Museum.stepOff(s, perchFrom); pos.x = off.x; pos.y = off.y; }
    perch = -1; perchFrom = null; perchPending = null; look = -0.08; Net.sendToHost({ t: "unperch" }); Sound.play("perch", { g: 0.6 });
  }
  function dashAction() {
    if (!running || !connectionReady || role !== "hide" || item === -1 || (flags & 1) || offerOpen || mapOpen) return;
    if (phase !== "hide" && phase !== "seek") return;
    if (perch >= 0) doUnperch();
    if (dashCd > 0) return;
    dashT = Rules.DASH.time; dashCd = Rules.DASH.cd; Sound.play("dash", { g: 0.7 });
  }
  function subAction() {
    if (!running || !connectionReady || Options.isOpen) return;
    if (role === "seek") {
      if (phase !== "seek" || (flags & 8)) return;
      const left = S && S.wh && S.wh[team]; if (left > 0) { showToast(`호루라기는 ${left}초 뒤에 다시 불 수 있어요.`, 1.5); return; }
      Net.sendToHost({ t: "whistle" }); return;
    }
    if (phase === "hide" && item !== -1) { openOffers(); return; }
    if (phase !== "seek" || item === -1 || (flags & 1)) return;
    const now = performance.now() / 1000, cd = settings.tauntCd || 15;
    if (now - tauntLocal < cd) { showToast(`도발은 ${Math.ceil(cd - (now - tauntLocal))}초 뒤에 다시 할 수 있어요.`, 1.4); return; }
    tauntLocal = now; Net.sendToHost({ t: "taunt" });
  }
  function formImg(f) { return f >= 0 ? Art.object(MM.ITEMS[f]) : Art.decor(Rules.EVERYDAY[-2 - f].kind); }
  function openOffers() {
    if (!offers.length) return;
    offerOpen = true; firing = false; if (document.pointerLockElement) document.exitPointerLock();
    el("offers").style.display = "flex";
    for (let i = 0; i < 3; i++) {
      const b = el("offer-" + i), f = offers[i];
      b.style.display = f == null ? "none" : ""; if (f == null) continue;
      const c = b.querySelector("canvas"), g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
      const img = formImg(f), k = Math.min(c.width / img.width, c.height / img.height); g.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
      b.querySelector(".nm").textContent = Rules.formName(f);
      b.querySelector(".tag").textContent = f >= 0 ? "과학 전시물 · 제자리면 점수 2배" : "잡동사니 · 보너스 없음";
      b.classList.toggle("on", f === item); b.classList.toggle("junk", f < 0);
    }
    el("offer-close").style.display = item !== -1 ? "" : "none";
    el("offer-hint").textContent = phase === "seek" && (flags & 1) ? "잡혔다! 새로 변신할 것을 고르세요. 고른 뒤 다른 곳에서 다시 나타납니다." : "변신할 것을 고르세요. 과학 전시물은 원래 있어야 할 전시실에, 잡동사니는 아무 데나 어울리는 곳에 숨으세요.";
  }
  function closeOffers() { offerOpen = false; const o = el("offers"); if (o) o.style.display = "none"; }
  function choose(i) {
    const f = offers[i]; if (f == null) return;
    Net.sendToHost({ t: "pick", item: f }); Sound.play("pick");
    if (f < 0 && perch >= 0) { perch = -1; perchPending = null; }
    item = f; pickT = performance.now(); closeOffers();
    showToast(f >= 0 ? `'${Rules.formName(f)}'(으)로 변신했다. 원래 있어야 할 전시실을 찾아 숨자!` : `'${Rules.formName(f)}'(으)로 변신했다. 어울리는 곳에 멈춰 서자!`, 3);
  }

  // ---------- 받기 ----------
  function onMessage(d) {
    if (!running || !d) return;
    if (d.t === "st") {
      S = d; phase = d.ph; closing = !!d.cl;
      const seen = new Set(), now = performance.now();
      for (const p of d.p) {
        const [id, x, y, a, rl, it, pr, f, hpv, tm] = p;
        teams[id] = tm;
        if (id === me) {
          team = tm; role = rl ? "hide" : "seek"; flags = f; hp = hpv;
          if (role === "hide") {
            if (it !== item && !(now - pickT < 1500)) item = it;
            if (pr !== perch) {
              if (perchPending && now - perchPending.t < 1500) { /* 응답 대기 */ }
              else if (pr >= 0 && Museum.cur && Museum.cur.stands[pr]) { perchFrom = perchFrom || { x: pos.x, y: pos.y }; perch = pr; pos.x = x; pos.y = y; pos.a = faceRoom(Museum.cur.stands[pr]); }
              else if (perch >= 0) { if (perchPending) showToast("그 받침대에는 올라갈 수 없어요.", 1.5); perch = -1; perchPending = null; pos.x = x; pos.y = y; }
            } else perchPending = null;
          }
          continue;
        }
        seen.add(id);
        let o = others.get(id); if (!o) { o = { x, y, walk: 0, hitT: 0, shotT: 0, hopT: 0 }; others.set(id, o); }
        if (Math.hypot(o.x - x, o.y - y) > 3) { o.x = x; o.y = y; }
        if ((f & 64) && now - o.hitT > 700) o.hitT = now;
        Object.assign(o, { tx: x, ty: y, a, role: rl ? "hide" : "seek", item: it, perch: pr, flags: f, team: tm, hp: hpv });
      }
      for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
      return;
    }
    if (d.t === "evs") { for (const e of d.list) handleEvent(e); return; }
    if (d.t === "ev") handleEvent(d);
  }
  function itemName(f) { return Rules.formName(f) || "?"; }
  function roomOf(f) { return f >= 0 && MM.ITEMS[f] ? MM.ROOMS[MM.ITEMS[f].room] : null; }
  function explain(f) { const it = MM.ITEMS[f], r = roomOf(f); if (!it || !r) return ""; return `'${it.name}' → ${r.name} 전시실` + (it.note ? ` — ${it.note}` : ""); }
  function addFeed(html) { feed.unshift({ html, t: 7 }); if (feed.length > 5) feed.length = 5; }
  function nm(id) { return names[id] || (String(id).startsWith("bothunt-") ? "학예사 로봇" : String(id).startsWith("bot-") ? "미믹 로봇" : "?"); }
  function refPos(ref) {
    const M = Museum.cur; if (!M || !ref) return null; const k = ref[0], v = ref.slice(2);
    if (k === "s") { const s = M.stands[+v]; return s ? { x: s.x + 0.5, y: s.y + 0.5 } : null; }
    if (k === "d") { const d = M.decor[+v]; return d ? { x: d.x + 0.5, y: d.y + 0.5 } : null; }
    const o = others.get(v); return o ? { x: o.x, y: o.y } : null;
  }
  function handleEvent(e) {
    if (e.to && e.to !== me) return;
    const now = performance.now();
    switch (e.k) {
      case "round": applyRound(e); break;
      case "phase":
        if (e.ph === "seek") {
          phase = "seek"; Sound.play("horn"); Sound.vibrate(80);
          banner = role === "seek"
            ? { t: 4, title: "🔍 출발! 수상한 걸 쏴라", sub: "움직이는 것, 소리 나는 것, 엉뚱한 전시실에 있는 전시물, 받침대도 없이 서 있는 전시물이 수상해요. 누르고 있으면 연사!" }
            : { t: 4, title: "🔍 학예사들이 출발했다!", sub: "가만히 있으면 물건처럼 보여요. 맞으면 바로 튀기로 도망치세요. 8초 동안 안 맞으면 체력이 다 찹니다." };
        }
        break;
      case "closing":
        closing = true; Sound.play("closing", { g: 0.8 });
        banner = { t: 3.5, title: "⏰ 폐관 30초!", sub: role === "seek" ? "학예사가 빨라졌다. 미믹들이 자꾸 소리를 낸다!" : "소리가 자꾸 새어 나간다. 끝까지 버텨라!" };
        break;
      case "offer": offers = e.list; if (role === "hide") { item = -1; openOffers(); } break;
      case "picked": item = e.item; pickT = now; if (offerOpen) closeOffers(); break;
      case "unperched": perch = -1; perchFrom = null; perchPending = null; pos.x = e.x; pos.y = e.y; break;
      case "hit": {
        const o = others.get(e.id);
        if (e.id === me) { hp = e.hp; fx.myHit = 1; fx.shake = 0.5; fx.flash = 0.45; fx.flashCol = "230,40,40"; Sound.play("hit", { g: 0.9 }); Sound.vibrate([60, 30, 60]); showToast(`맞았다! 체력 ${e.hp}/${e.max} — 튀어서 도망쳐! (8초 버티면 회복)`, 2.2, true); if (perch >= 0) { /* 받침대 위에서는 내려와야 도망 */ } }
        else {
          if (o) o.hitT = now;
          if (e.by === me) hp = e.shp != null ? e.shp : hp;
          else if (o) Sound.at("hit", o.x, o.y, { range: 16, g: 0.8 });
        }
        break;
      }
      case "real": {
        stamps.set(e.ref, now + 6000);
        if (e.by === me) hp = e.hp;
        else { const p = refPos(e.ref); if (p) Sound.at("real", p.x, p.y, { range: 12, g: 0.6 }); }
        break;
      }
      case "shield": if (fx.marker && fx.marker.kind === "hit") fx.marker = { t: 0.6, kind: "shield" }; showToast("방금 나타난 미믹이라 잠깐 안 맞아요.", 1.4); break;
      case "caught": {
        const S_ = nm(e.by), H_ = nm(e.id), sci = e.item >= 0;
        puffs.push({ x: e.x, y: e.y, t: now });
        if (e.id === me) {
          Sound.play("caught"); Sound.vibrate([200, 80, 200]); fx.flash = 0.8; fx.flashCol = "220,40,40"; fx.shake = 0.6; perch = -1; perchFrom = null; perchPending = null; item = -1; firing = false;
          caughtMsg = { title: `${S_}에게 잡혔다! (−20점)`, sub: !sci ? `잡동사니 '${itemName(e.item)}'였어요.` : !e.still ? `움직이다 들켰어요. ${explain(e.item)}` : e.ok ? `'${itemName(e.item)}'은(는) 제자리(${roomOf(e.item).name})에 있었어요. 소리나 움직임에 들켰을지도.` : `엉뚱한 곳(${e.where})에 숨었어요. ${explain(e.item)}` };
        } else if (e.by === me) {
          Sound.play("ding"); fx.flash = 0.45; fx.flashCol = "60,200,90"; fx.marker = { t: 0.9, kind: "catch" };
          showToast(`가짜 발견! +50점 — ${!sci ? `잡동사니 '${itemName(e.item)}'` : e.ok && e.still ? `'${itemName(e.item)}' (제자리에 숨어 있었다)` : !e.still ? `도망치던 '${itemName(e.item)}'` : explain(e.item)}`, 4.5, true);
        } else {
          Sound.at("caught", e.x, e.y, { range: 18, g: 0.6 });
          if ((e.assists || []).includes(me)) showToast(`${S_}이(가) 잡았다. 먼저 맞혀서 도움 +20점!`, 2.5);
        }
        addFeed(`🔍 <b style="color:${TEAM_COLORS[teams[e.by] % 4]}">${esc(S_)}</b> → 🎭 ${esc(H_)} <span class="it">'${esc(itemName(e.item))}'</span> ${sci && e.still && !e.ok ? "<span class='bad'>엉뚱한 방</span>" : !e.still ? "<span class='muted'>도망치다</span>" : ""}`);
        break;
      }
      case "escape": if (e.id === me) { Sound.play("escape"); showToast("도망 성공! 체력 회복 · +15점", 2.2, true); } break;
      case "jail": if (e.id === me) { Sound.play("error"); firing = false; showToast(`체력이 바닥났다 — 경비실에서 ${e.secs}초 쉬고 로비로 돌아갑니다. (−20점)`, 4, true); } addFeed(`🚓 ${esc(nm(e.id))} 경비실로`); break;
      case "free": if (e.id === me) { pos.x = e.x; pos.y = e.y; hp = 100; showToast("로비로 돌아왔다. 체력 가득!", 2); } break;
      case "respawn": if (e.id === me) { pos.x = e.x; pos.y = e.y; caughtMsg = null; closeOffers(); look = -0.08; showToast(`다른 곳에서 '${itemName(item)}'(으)로 나타났다. 4초 동안은 안 맞아요 — 얼른 숨자!`, 3.5, true); } break;
      case "taunt": {
        const dl = (e.dl || 0) * 1000, o = others.get(e.id);
        if (o) { o.tauntFrom = now + dl; o.tauntT = now + dl + 1000; }
        if (e.id === me) { Sound.play("taunt", { seed: e.item, g: 0.7, delay: e.dl || 0 }); setTimeout(() => showToast(e.auto ? "앗, 저절로 소리가 났다! 근처 학예사가 들었을지도." : "도발! +10점", 1.8), dl); }
        else Sound.at("taunt", e.x, e.y, { seed: e.item, range: 26, g: 1.2, delay: e.dl || 0 });
        break;
      }
      case "whistle": Sound.at("whistle", e.x, e.y, { range: 40, g: 1 }); if (role === "hide") showToast("호루라기! 미믹들이 저절로 소리를 낸다.", 2.2); else if (e.by !== me) showToast(`${nm(e.by)}이(가) 호루라기를 불었다.`, 1.5); break;
      case "cool": showToast(`호루라기는 ${e.left}초 뒤에 다시 불 수 있어요.`, 1.5); break;
      case "rend": showRoundResult(e); break;
      case "end": phase = "over"; closeOffers(); firing = false; if (onEnd) onEnd(e); break;
    }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  function showRoundResult(e) {
    phase = "result"; closeOffers(); mapOpen = false; caughtMsg = null; firing = false; Sound.play("chime");
    if (document.pointerLockElement) document.exitPointerLock();
    const rows = e.hiders.filter(h => h.item !== -1).map(h => {
      const sci = h.item >= 0, right = roomOf(h.item);
      const verdict = !sci ? `<span class="muted">잡동사니 (보너스 없음)</span>` : !h.still ? `<span class="bad">움직이는 중 (${esc(h.where)})</span>` : h.ok ? `<span class="good">✔ 제자리 (+${h.bonus})</span>` : `<span class="bad">✘ ${esc(h.at >= 0 ? MM.ROOMS[h.at].name : h.where)}에 숨음</span>`;
      return `<tr><td>${h.bot ? "🤖" : "🎭"} ${esc(h.name)}</td><td><b>${esc(itemName(h.item))}</b>${sci ? `<br><small>있어야 할 곳: ${esc(right.name)}</small>` : ""}</td><td>${verdict}</td><td>${h.sec}초 · 잡힘 ${h.caught}${h.esc ? ` · 도망 ${h.esc}` : ""}</td></tr>`;
    }).join("");
    const sc = e.scores.map((v, i) => `<span class="chip" style="border-color:${TEAM_COLORS[i]}"><b style="color:${TEAM_COLORS[i]}">${i + 1}팀</b> ${v}</span>`).join(" ");
    el("round-result").innerHTML = `<div class="panel wide"><h2>${e.n}라운드 결과${practice ? "" : ` · ${e.n}/${e.total}`}</h2><div class="chips">${practice ? "" : sc}</div>
      <table><tr><th>미믹</th><th>마지막 변신</th><th>숨은 자리</th><th>버틴 시간</th></tr>${rows || "<tr><td colspan=4>미믹이 없었습니다.</td></tr>"}</table>
      <p class="muted small">${e.last ? "곧 최종 결과가 나옵니다." : "잠시 뒤 다음 라운드가 시작됩니다. 역할이 바뀔 수 있어요."}</p></div>`;
    el("round-result").style.display = "flex";
  }
  function showToast(text, sec, big) { toast = { text, t: sec, big: !!big }; }

  // ---------- 루프 ----------
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt, now); render(now);
    raf = requestAnimationFrame(frame);
  }
  // 학예사는 미믹 몸에도 부딪힌다 (진짜 물건처럼 — 통과하면 들통나니까)
  function bump(x, y, ox, oy) {
    if (role !== "seek") return false;
    for (const o of others.values()) {
      if (o.role !== "hide" || o.perch >= 0 || (o.flags & 1) || o.item === -1) continue;
      const d = Math.hypot(o.x - x, o.y - y); if (d < 0.6 && d < Math.hypot(o.x - ox, o.y - oy)) return true;
    }
    return false;
  }
  function update(dt, now) {
    if (!connectionReady) { moving = false; firing = false; updateCam(0); updateHud(now); return; }
    let fwd = input.fwd, strafe = input.strafe, turn = 0;
    if (keys["w"] || keys["arrowup"]) fwd += 1; if (keys["s"] || keys["arrowdown"]) fwd -= 1;
    if (keys["a"]) strafe -= 1; if (keys["d"]) strafe += 1;
    if (keys["arrowleft"]) turn -= 1; if (keys["arrowright"]) turn += 1;
    const frozen = (role === "seek" && (phase === "hide" || (flags & 8))) || (role === "hide" && (perch >= 0 || (flags & 1) || item === -1 && phase === "seek")) || phase === "result" || phase === "over" || mapOpen || offerOpen || Options.isOpen;
    if (!mapOpen && !Options.isOpen && !(flags & 1)) pos.a += turn * 2.4 * dt;
    dashT = Math.max(0, dashT - dt); dashCd = Math.max(0, dashCd - dt);
    moving = false;
    if (!frozen) {
      const len = Math.hypot(fwd, strafe), dash = role === "hide" && dashT > 0;
      if (len > 0.05 || dash) {
        const k = dash ? 1 : Math.min(1, len), L = len > 0.05 ? len : 1, f0 = len > 0.05 ? fwd : 1, s0 = len > 0.05 ? strafe : 0;
        const sp = role === "hide" ? Rules.MIMIC_SPEED * (dash ? Rules.DASH.mul : 1) : Rules.SPEED * (closing ? Rules.CLOSING_BOOST : 1);
        const dx = (Math.cos(pos.a) * f0 + Math.cos(pos.a + Math.PI / 2) * s0) / L * k, dy = (Math.sin(pos.a) * f0 + Math.sin(pos.a + Math.PI / 2) * s0) / L * k;
        const nx = pos.x + dx * sp * dt, ny = pos.y + dy * sp * dt;
        if (!Museum.hits(nx, pos.y, 0.28) && !bump(nx, pos.y, pos.x, pos.y)) pos.x = nx;
        if (!Museum.hits(pos.x, ny, 0.28) && !bump(pos.x, ny, pos.x, pos.y)) pos.y = ny;
        moving = true; bobT += dt * 9; walkT += dt * 8;
      }
    }
    if (role === "hide" && moving) { stepT -= dt; if (stepT <= 0) { stepT = 0.28; Sound.play("hop", { g: 0.6 }); } }
    updateCam(dt);
    Sound.setListener(pos.x, pos.y, pos.a);
    // 다른 사람 부드럽게 + 발소리·뛰는 소리·총소리
    for (const [id, o] of others) {
      const ox = o.x, oy = o.y; o.x += (o.tx - o.x) * Math.min(1, dt * 10); o.y += (o.ty - o.y) * Math.min(1, dt * 10);
      const sp = Math.hypot(o.x - ox, o.y - oy) / Math.max(dt, 1e-3); o.moving = sp > 0.35 || (o.role === "hide" && !!(o.flags & 32) && o.perch < 0); if (o.moving) o.walk += dt * 8;
      if (o.flags & 1) continue;
      const d = Math.hypot(o.x - pos.x, o.y - pos.y);
      if (o.moving && now > o.hopT && d < 10) { o.hopT = now + (o.role === "hide" ? 300 : 380); Sound.at(o.role === "hide" ? "hop" : "step", o.x, o.y, { range: 10, g: o.role === "hide" ? 0.9 : 1 }); }
      if (o.role === "seek" && (o.flags & 128) && now > o.shotT && d < 16) { o.shotT = now + Rules.FIRE_GAP * 1000; Sound.at("shot", o.x, o.y, { range: 16, g: 0.5 }); }
    }
    updateFire(dt, now);
    if (now - lastPos > 100) sendPos(now);
    if (perchPending && now - perchPending.t > 3000) perchPending = null;
    fx.flash *= Math.pow(0.05, dt); fx.shake *= Math.pow(0.03, dt); fx.recoil = Math.max(0, fx.recoil - dt * 7); fx.hurt = Math.max(0, fx.hurt - dt * 2.2); fx.myHit = Math.max(0, fx.myHit - dt * 2);
    if (fx.marker) { fx.marker.t -= dt; if (fx.marker.t <= 0) fx.marker = null; }
    if (toast.t > 0) toast.t -= dt; for (const f of feed) f.t -= dt; feed = feed.filter(f => f.t > 0);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    puffs = puffs.filter(p => now - p.t < 900);
    updateHud(now);
  }
  function sendPos(now, force) {
    const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.a.toFixed(2)}`;
    if (!force && !shots.length && key === lastSentKey && now - lastPos < 1000) return;
    lastSentKey = key; lastPos = now;
    const m = { t: "pos", x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), a: +pos.a.toFixed(2) };
    if (shots.length) { m.sh = shots.slice(0, 4); shots = []; }
    Net.sendToHost(m);
  }
  // 도장총: 누르고 있으면 0.3초마다. 맞힌 결과는 바로 보여 주고(교사 기기가 확정), 쏜 것은 위치 메시지에 실어 보낸다
  function updateFire(dt, now) {
    fireT = Math.max(0, fireT - dt);
    if (!firing || role !== "seek" || phase !== "seek" || (flags & 8) || !connectionReady || mapOpen || Options.isOpen || fireT > 0) return;
    fireT = Rules.FIRE_GAP; fx.recoil = 1; Sound.play("shot", { g: 0.55 });
    const a = aim && aim.dist <= Rules.SHOT_RANGE ? aim : null; if (!a) return;
    const r = a.s.ref; let key = null, kind = null, o = null;
    if (r.kind === "stand") { if (r.occ) { key = r.key; kind = "mimic"; o = others.get(r.occ); } else if (r.item >= 0) { key = r.key; kind = "real"; } }
    else if (r.kind === "decor") { key = r.key; kind = "real"; }
    else if (r.kind === "mimic") { key = r.key; kind = "mimic"; o = others.get(r.id); }
    if (!key) return;
    shots.push(key);
    if (kind === "mimic") {
      if (o && (o.flags & 2)) { fx.marker = { t: 0.5, kind: "shield" }; Sound.play("shield", { g: 0.5 }); }
      else { fx.marker = { t: 0.45, kind: "hit" }; Sound.play("hit", { g: 0.7 }); if (o) o.hitT = now; }
    } else { fx.marker = { t: 0.6, kind: "real" }; stamps.set(key, now + 6000); Sound.play("real", { g: 0.6 }); fx.hurt = 1; Sound.vibrate(30); }
    sendPos(now, true);
  }
  // 미믹 카메라: 어깨 너머 3인칭. 뒤가 벽·받침대로 막히면 반대쪽 어깨나 바로 뒤를 찾고, 그래도 좁으면 1인칭으로
  function camReach(ux, uy, len) {
    const tx0 = Math.floor(pos.x), ty0 = Math.floor(pos.y); let d = 0.2;
    for (; d <= len; d += 0.08) { const tx = Math.floor(pos.x + ux * d), ty = Math.floor(pos.y + uy * d); if ((tx !== tx0 || ty !== ty0) && Museum.tile(tx, ty) !== Museum.T_FLOOR) break; }
    return Math.min(len, d - 0.3);
  }
  function updateCam(dt) {
    let tx = pos.x, ty = pos.y;
    if (role === "hide" && perch < 0 && !(flags & 1) && item !== -1) {
      const back = 2.8, ca = Math.cos(pos.a), sa = Math.sin(pos.a);
      let best = null;
      for (const side of [0.62, -0.62, 0]) {
        const bx = -ca * back - sa * side, by = -sa * back + ca * side, len = Math.hypot(bx, by), ux = bx / len, uy = by / len, d = camReach(ux, uy, len);
        if (!best || d > best.d + 0.05) best = { d, ux, uy };
        if (d >= 1.8) break;
      }
      if (best && best.d >= 1.2) { tx = pos.x + best.ux * best.d; ty = pos.y + best.uy * best.d; }
    }
    const jump = Math.hypot(tx - cam.x, ty - cam.y) > 3 || !dt;
    const k = jump ? 1 : Math.min(1, dt * 9);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    if (Museum.tile(Math.floor(cam.x), Math.floor(cam.y)) === Museum.T_WALL) { cam.x = tx; cam.y = ty; }
    cam.d = Math.hypot(cam.x - pos.x, cam.y - pos.y);
  }

  // ---------- 그리기 ----------
  function accentFor(s) { const c = Museum.cur.cells[s.cell]; return Art.wingColor(c.wing); }
  function accentAt(x, y) { const c = Museum.cellAt(x, y); return c && c.kind === "room" ? Art.wingColor(c.wing) : "#8a7a5a"; }
  // 미믹 그림: 멈추면 진짜와 똑같이(전시물은 받침대째), 움직이면 눈알 달고 통통
  function mimicSprite(f, x, y, mv, now) {
    const dir = Math.sin(now / 140 + x * 3) > 0 ? 1 : -1;
    if (f >= 0) { const it = MM.ITEMS[f]; return mv ? { img: Art.withEyes(Art.loose(it), "l" + f, dir), h: LOOSE_SPR } : { img: Art.exhibit(it, accentAt(x, y)), h: STAND_SPR }; }
    const kind = Rules.EVERYDAY[-2 - f].kind, base = Art.decor(kind);
    return { img: mv ? Art.withEyes(base, "d" + kind, dir) : base, h: DECOR_H[kind] || 0.8 };
  }
  function decorateMimic(sp, id, now) {
    const o = others.get(id); if (!o) return;
    const k = Math.max(0, 1 - (now - (o.hitT || 0)) / 600);
    if (k > 0) { sp.tint = `rgba(255,40,40,${0.55 * k})`; sp.wob = Math.sin(now / 18) * 10 * k; }
    if (o.tauntT && now > o.tauntFrom && now < o.tauntT) sp.wob = (sp.wob || 0) + Math.sin(now / 22) * 7;
    if (o.flags & 2) sp.alpha = 0.5 + 0.2 * Math.sin(now / 90);
    if (role === "hide") { sp.name = nm(id); sp.nameColor = "#7dff9a"; }
  }
  let puffImg = null;
  function puff() {
    if (puffImg) return puffImg;
    const c = document.createElement("canvas"); c.width = 96; c.height = 96; const g = c.getContext("2d"), r = Art._rng(5);
    for (let i = 0; i < 34; i++) { g.fillStyle = ["#ff5a5a", "#ffd84a", "#5ad1ff", "#7dff9a", "#ff8ae0"][i % 5]; const a = r() * 7, d = 10 + r() * 34; g.save(); g.translate(48 + Math.cos(a) * d, 48 + Math.sin(a) * d); g.rotate(r() * 3); g.fillRect(-4, -2, 8, 4); g.restore(); }
    g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.arc(48, 48, 14, 0, 7); g.fill();
    return (puffImg = c);
  }
  function buildSprites(now) {
    const M = Museum.cur, sprites = [], vx = role === "hide" ? cam.x : pos.x, vy = role === "hide" ? cam.y : pos.y;
    const near = (x, y) => Math.abs(x - vx) < 26 && Math.abs(y - vy) < 26;
    const stampedNow = key => (stamps.get(key) || 0) > now;
    const occ = new Map();
    for (const [id, o] of others) if (o.role === "hide" && o.perch >= 0 && !(o.flags & 1) && o.item >= 0) occ.set(o.perch, id);
    for (const s of M.stands) {
      if (!near(s.x, s.y)) continue;
      if (role === "hide" && perch === s.id) continue;     // 내가 올라간 받침대(1인칭으로 내려다본다)
      const oid = occ.get(s.id), acc = accentFor(s), f = oid ? others.get(oid).item : s.item, it = f >= 0 ? MM.ITEMS[f] : null, key = "s:" + s.id;
      let img = Art.exhibit(it, acc);
      if (!oid && it && stampedNow(key)) img = Art.stamped(img, "x" + it.index + acc, 0.27);
      const sp = { img, x: s.x + 0.5, y: s.y + 0.5, h: STAND_SPR, aimable: true, ref: { kind: "stand", key, s, occ: oid || null, item: it ? it.index : -1 } };
      if (oid) decorateMimic(sp, oid, now);
      sprites.push(sp);
    }
    M.decor.forEach((d, i) => {
      if (!near(d.x, d.y)) return;
      const key = "d:" + i; let img = Art.decor(d.kind);
      if (stampedNow(key)) img = Art.stamped(img, "d" + d.kind, 0.42);
      sprites.push({ img, x: d.x + 0.5, y: d.y + 0.5, h: DECOR_H[d.kind] || 0.8, aimable: true, ref: { kind: "decor", key, dk: d.kind } });
    });
    for (const [id, o] of others) {
      if (o.flags & 1) continue;
      if (o.role === "seek") {
        if (role === "seek" && phase === "hide") continue;
        sprites.push({ img: Art.curator(TEAM_COLORS[o.team % 4], o.moving ? Math.floor(o.walk) % 2 : 0, !!(o.flags & 8), o.team % 4), x: o.x, y: o.y, h: 1.5, aimable: true, ref: { kind: "curator", id }, name: nm(id), nameColor: TEAM_COLORS[o.team % 4] });
      } else if (o.perch < 0 && o.item !== -1) {
        if (role === "seek" && phase === "hide") continue;
        const ms = mimicSprite(o.item, o.x, o.y, o.moving, now);
        const sp = { img: ms.img, x: o.x, y: o.y, h: ms.h, lift: o.moving ? Math.abs(Math.sin(o.walk * 1.1)) * 0.22 : 0, aimable: true, ref: { kind: "mimic", key: "m:" + id, id, item: o.item } };
        decorateMimic(sp, id, now);
        sprites.push(sp);
      }
    }
    // 나 (3인칭)
    if (role === "hide" && item !== -1 && perch < 0 && !(flags & 1) && cam.d >= 1.0) {
      const ms = mimicSprite(item, pos.x, pos.y, moving, now);
      sprites.push({ img: ms.img, x: pos.x, y: pos.y, h: ms.h, lift: moving ? Math.abs(Math.sin(walkT * 1.1)) * 0.22 : 0, aimable: false,
        alpha: (flags & 2) ? 0.55 : 1, tint: fx.myHit > 0 ? `rgba(255,40,40,${0.55 * fx.myHit})` : null, wob: fx.myHit > 0 ? Math.sin(now / 18) * 10 * fx.myHit : 0 });
    }
    for (const p of puffs) { const k = (now - p.t) / 900; sprites.push({ img: puff(), x: p.x, y: p.y, h: 0.7 + k * 0.9, lift: 0.2 + k * 0.5, alpha: 1 - k }); }
    return sprites;
  }
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!Museum.cur) { ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H); return; }
    const blind = role === "seek" && phase === "hide";
    if (blind) { drawBlind(now); return; }
    const third = role === "hide" && perch < 0 && !(flags & 1) && cam.d > 0.05;
    const sh = fx.shake * 12; ctx.save(); ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    const res = Fps.render(ctx, W, H, { pos: third ? { x: cam.x, y: cam.y, a: pos.a } : pos, look, eye: role === "hide" ? (perch >= 0 ? 1.22 : 1.05) : 0.8, bob: moving && !third ? Math.sin(bobT) * 3 : 0, sprites: buildSprites(now), now, gray: !!(flags & 8) });
    ctx.restore();
    aim = res.aim && res.aim.dist <= Rules.SHOT_RANGE ? res.aim : null;
    if (role === "seek") drawGun(now);
    drawCrosshair(now);
    const edge = (col, a) => { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); };
    if (fx.hurt > 0) edge("210,30,30", 0.5 * fx.hurt);
    if (role === "hide" && item !== -1 && !(flags & 1) && hp < Rules.formHp(item)) edge("210,30,30", 0.25 + 0.12 * Math.sin(now / 160));
    if (closing && phase === "seek") edge("255,120,40", 0.14 + 0.1 * Math.sin(now / 250));
    if (fx.flash > 0.02) { ctx.fillStyle = `rgba(${fx.flashCol},${Math.min(0.6, fx.flash)})`; ctx.fillRect(0, 0, W, H); }
    if (flags & 8) drawCenterCard("🚓 경비실에서 쉬는 중", "진짜 물건을 너무 많이 쐈어요. 잠시 뒤 로비에서 체력 가득으로 다시 시작합니다.");
    if (role === "hide" && (flags & 1)) { ctx.fillStyle = "rgba(10,5,5,0.78)"; ctx.fillRect(0, 0, W, H); drawCenterCard(caughtMsg ? caughtMsg.title : "잡혔다!", caughtMsg ? caughtMsg.sub : "", offers.length && item === -1 ? "새로 변신할 것을 고르면 다른 곳에서 다시 나타납니다." : "곧 다른 곳에서 다시 나타납니다…"); }
    if (banner) drawBanner();
    if (mapOpen) drawMap(now);
  }
  function drawCrosshair(now) {
    const x = W / 2, y = H / 2;
    if (role === "seek") {
      const sp = 10 + fx.recoil * 6;
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, sp, 0, 7); ctx.stroke();
      ctx.strokeStyle = aim && aim.s.ref.kind !== "curator" && !(aim.s.ref.kind === "stand" && !aim.s.ref.occ && aim.s.ref.item < 0) ? "#ffd84a" : "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, sp, 0, 7); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, y - 1, 2, 2);
      const m = fx.marker;
      if (m) {
        const a = Math.min(1, m.t * 3); ctx.save(); ctx.globalAlpha = a; ctx.lineWidth = 4;
        if (m.kind === "hit" || m.kind === "catch") { ctx.strokeStyle = m.kind === "catch" ? "#5dff8a" : "#fff"; const r = m.kind === "catch" ? 22 : 16; ctx.beginPath(); for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(x + dx * r * 0.45, y + dy * r * 0.45); ctx.lineTo(x + dx * r, y + dy * r); } ctx.stroke(); if (m.kind === "catch") { ctx.fillStyle = "#5dff8a"; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center"; ctx.fillText("가짜!", x, y - 34); } }
        else if (m.kind === "real") { ctx.translate(x, y - 46); ctx.rotate(-0.15); ctx.strokeStyle = ctx.fillStyle = "#e23030"; ctx.lineWidth = 3; ctx.strokeRect(-44, -18, 88, 36); ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("진짜…", 0, 1); }
        else if (m.kind === "shield") { ctx.strokeStyle = "#7ecbff"; ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.stroke(); }
        ctx.restore();
      }
    } else if (perch >= 0) { ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke(); }
  }
  // 도장총: 손잡이 + 빨간 잉크 통 + 큰 도장 머리. 쏘면 잉크 줄기
  function drawGun(now) {
    if (flags & 8) return;
    const s = Math.min(W, H) / 600, rc = fx.recoil, bob = moving ? Math.sin(bobT) * 6 * s : 0;
    const gx = W - 170 * s, gy = H - 30 * s + rc * 18 * s + bob;
    if (rc > 0.55) { ctx.strokeStyle = `rgba(214,30,40,${(rc - 0.55) * 2})`; ctx.lineWidth = 7 * s; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(gx - 40 * s, gy - 150 * s); ctx.quadraticCurveTo(W * 0.62, H * 0.6, W / 2, H / 2 + 4); ctx.stroke(); ctx.lineCap = "butt"; }
    ctx.save(); ctx.translate(gx, gy); ctx.rotate(-0.35 - rc * 0.12); ctx.scale(s, s);
    ctx.fillStyle = "#3a3d44"; ctx.fillRect(-18, -60, 36, 70);                      // 손잡이
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.ellipse(-4, -30, 30, 40, 0.2, 0, 7); ctx.fill();   // 손
    ctx.fillStyle = "#5a6070"; ctx.fillRect(-26, -130, 52, 76);                     // 몸통
    ctx.fillStyle = "#d32f2f"; ctx.fillRect(-16, -122, 18, 56); ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-13, -118, 4, 48);  // 잉크 통
    ctx.fillStyle = "#c8a050"; ctx.fillRect(-32, -160, 64, 32);                     // 도장 머리
    ctx.fillStyle = "#b71c1c"; ctx.fillRect(-30, -170, 60, 12);
    ctx.restore();
  }
  function drawCenterCard(title, sub, sub2) {
    const w = Math.min(W - 30, 620); ctx.fillStyle = "rgba(15,17,22,0.88)"; ctx.fillRect((W - w) / 2, H * 0.28, w, sub2 ? 150 : 120);
    ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.min(30, W / 18)}px sans-serif`; ctx.fillText(title, W / 2, H * 0.28 + 44);
    ctx.fillStyle = "#d9d2c4"; ctx.font = `${Math.min(17, W / 32)}px sans-serif`; wrapText(sub, W / 2, H * 0.28 + 78, w - 30, 22);
    if (sub2) { ctx.fillStyle = "#ffd27e"; ctx.fillText(sub2, W / 2, H * 0.28 + 132, w - 30); }
  }
  function wrapText(t, x, y, maxW, lh) { if (!t) return; const words = t.split(" "); let line = ""; for (const w of words) { const test = line ? line + " " + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = test; } if (line) ctx.fillText(line, x, y); }
  function drawBanner() {
    const a = Math.min(1, banner.t), w = Math.min(W - 20, 760);
    ctx.globalAlpha = a; ctx.fillStyle = "rgba(20,22,30,0.86)"; ctx.fillRect((W - w) / 2, H * 0.12, w, 104);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe9b0"; ctx.font = `bold ${Math.min(30, W / 20)}px sans-serif`; ctx.fillText(banner.title, W / 2, H * 0.12 + 40);
    ctx.fillStyle = "#e6e1d6"; ctx.font = `${Math.min(16, W / 36)}px sans-serif`; wrapText(banner.sub, W / 2, H * 0.12 + 68, w - 30, 20); ctx.globalAlpha = 1;
  }
  function drawBlind(now) {
    ctx.fillStyle = "#101218"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe9b0"; ctx.font = `bold ${Math.min(34, W / 16)}px sans-serif`;
    ctx.fillText(`🙈 미믹들이 숨는 중 … ${S ? S.tm : ""}`, W / 2, H * 0.16);
    ctx.fillStyle = "#cfc8b8"; ctx.font = `${Math.min(17, W / 34)}px sans-serif`; ctx.fillText("학예사는 눈을 감고 기다립니다. 이번 라운드 전시실을 미리 익혀 두세요 — 엉뚱한 방에 있는 전시물이 미믹입니다.", W / 2, H * 0.16 + 32, W - 20);
    if (!info) return;
    const list = info.wings.map(id => MM.WING_BY_ID[id]).filter(Boolean);
    const cols = W > 700 ? 2 : 1, colW = Math.min(420, (W - 40) / cols);
    let i = 0;
    for (const w of list) {
      const cx = W / 2 + (cols === 2 ? (i % 2 ? colW / 2 + 10 : -colW / 2 - 10) : 0), row = cols === 2 ? Math.floor(i / 2) : i;
      const y = H * 0.16 + 64 + row * (cols === 2 ? 118 : 96);
      ctx.fillStyle = Art.wingColor(w.id); ctx.fillRect(cx - colW / 2, y, colW, 4);
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.min(17, W / 34)}px sans-serif`; ctx.fillText(w.name, cx, y + 24);
      ctx.fillStyle = "#d9d2c4"; ctx.font = `${Math.min(15, W / 38)}px sans-serif`;
      w.rooms.forEach((r, k) => ctx.fillText(r.name, cx, y + 46 + k * 19, colW - 10));
      i++;
    }
  }
  let mapImg = null;
  function buildMapImg() {
    const M = Museum.cur, s = 9, c = document.createElement("canvas"); c.width = M.W * s; c.height = M.H * s; const g = c.getContext("2d");
    g.fillStyle = "#15171c"; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
      const t = Museum.tile(x, y); if (t === Museum.T_WALL) continue;
      const cell = Museum.cellAt(x + 0.5, y + 0.5);
      g.fillStyle = !cell ? "#6a645a" : cell.kind === "room" ? Art.wingColor(cell.wing) + "88" : cell.kind === "lobby" ? "#8a7550" : "#56604c"; g.fillRect(x * s, y * s, s, s);
    }
    g.fillStyle = "rgba(255,255,255,0.5)"; for (const st of M.stands) g.fillRect(st.x * s + 2, st.y * s + 2, s - 4, s - 4);
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const cell of M.cells) {
      const cx = (cell.x0 + cell.x1 + 1) / 2 * s, cy = (cell.y0 + cell.y1 + 1) / 2 * s;
      g.fillStyle = "#fff"; g.font = "bold 12px sans-serif";
      const lines = cell.name.replace(/\s*\(/, "\n(").split("\n"); lines.forEach((l, k) => g.fillText(l, cx, cy + (k - (lines.length - 1) / 2) * 14, (Museum.IN) * s - 4));
    }
    return c;
  }
  function drawMap(now) {
    if (!mapImg) mapImg = buildMapImg();
    ctx.fillStyle = "rgba(0,0,0,0.92)"; ctx.fillRect(0, 0, W, H);
    const k = Math.min((W - 24) / mapImg.width, (H - 120) / mapImg.height), mw = mapImg.width * k, mh = mapImg.height * k, ox = (W - mw) / 2, oy = 70 + (H - 120 - mh) / 2, u = 9 * k;
    ctx.drawImage(mapImg, ox, oy, mw, mh);
    for (const [id, o] of others) {
      if (o.flags & 1) continue;
      if (o.role !== role) continue;    // 같은 역할만 보인다
      ctx.fillStyle = role === "hide" ? "#7dff9a" : TEAM_COLORS[o.team % 4]; ctx.beginPath(); ctx.arc(ox + o.x * u, oy + o.y * u, Math.max(4, u * 0.5), 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(nm(id), ox + o.x * u, oy + o.y * u - 8);
    }
    ctx.save(); ctx.translate(ox + pos.x * u, oy + pos.y * u); ctx.rotate(pos.a); ctx.fillStyle = "#ffd84a"; const a = Math.max(7, u * 1.2); ctx.beginPath(); ctx.moveTo(a, 0); ctx.lineTo(-a * 0.6, -a * 0.6); ctx.lineTo(-a * 0.3, 0); ctx.lineTo(-a * 0.6, a * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = "#e8e2d6"; ctx.textAlign = "center"; ctx.font = "bold 18px sans-serif"; ctx.fillText("과학관 안내도", W / 2, 40);
    ctx.font = "13px sans-serif"; ctx.fillStyle = "#b9b0a2"; ctx.fillText(`노란 화살표: 나 · 점: ${role === "hide" ? "다른 미믹" : "같은 학예사"} · 흰 네모: 받침대 · M / 지도 버튼: 닫기`, W / 2, H - 20);
  }

  // ---------- HUD ----------
  let hudKey = "";
  function hpBar(v, max, col) { const p = Math.max(0, Math.min(100, v / max * 100)); return `<div class="hpbar"><i style="width:${p}%;background:${p < 30 ? "#e04a3a" : col}"></i><span>${Math.max(0, Math.round(v))}</span></div>`; }
  function updateHud(now) {
    const tm = S ? S.tm : 0, ph = phase;
    const phaseTxt = ph === "hide" ? "숨는 시간" : ph === "seek" ? (closing ? "⏰ 폐관 임박" : "찾는 시간") : ph === "result" ? "라운드 결과" : ph === "over" ? "끝" : "";
    el("hud-round").textContent = info ? `${practice ? "연습" : `${info.n}/${info.total} 라운드`} · ${phaseTxt} ${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, "0")}` : "";
    el("hud-round").classList.toggle("closing", closing && ph === "seek");
    el("hud-role").innerHTML = role === "hide" ? `<span class="badge hide">🎭 미믹</span>` : `<span class="badge seek" style="background:${TEAM_COLORS[team % 4]}">🔍 학예사 · ${team + 1}팀</span>`;
    if (S && !practice) { const sc = S.sc.map((v, i) => `<span class="chip${i === team ? " mine" : ""}" style="border-color:${TEAM_COLORS[i]}"><b style="color:${TEAM_COLORS[i]}">${i + 1}팀</b> ${v}</span>`).join(""); if (sc !== hudKey) { hudKey = sc; el("hud-scores").innerHTML = sc; } }
    const cell = Museum.cur && Museum.cellAt(pos.x, pos.y);
    el("hud-room").textContent = cell ? "📍 " + cell.name + (cell.kind === "room" ? ` · ${MM.WING_BY_ID[cell.wing].name}` : "") : "";
    // 내 상태
    let meHtml = "";
    if (role === "hide") {
      if (item !== -1) {
        const st = (flags & 1) ? "잡힘" : perch >= 0 ? "🟢 받침대 위 — 진짜와 똑같다" : moving ? "🟡 움직이는 중 — 눈알이 보인다!" : "🟢 멈춤 — 물건처럼 보인다";
        meHtml = `<canvas id="me-thumb" width="44" height="44"></canvas><div><div class="small muted">지금 내 모습</div><b>${esc(itemName(item))}</b>${hpBar(hp, Rules.formHp(item), "#5dd27a")}<div class="small">${st}${(flags & 2) ? " · 보호 중" : ""}</div></div>`;
      } else meHtml = `<div><b>변신 전</b><div class="small muted">변신할 것을 고르세요</div></div>`;
    } else meHtml = `<div><div class="small muted">체력</div>${hpBar(hp, 100, "#f0c24a")}<div class="small muted">진짜를 쏘면 깎이고, 미믹을 맞히면 찬다</div></div>`;
    const box = el("hud-me"); if (box.dataset.k !== meHtml) { box.dataset.k = meHtml; box.innerHTML = meHtml; const c = el("me-thumb"); if (c && item !== -1) { const img = formImg(item), k = Math.min(44 / img.width, 44 / img.height); c.getContext("2d").drawImage(img, (44 - img.width * k) / 2, (44 - img.height * k) / 2, img.width * k, img.height * k); } }
    // 조준 이름표: 학예사에게는 진짜와 미믹이 똑같이 보인다
    let label = "", sub = "";
    if (aim && !(role === "seek" && phase === "hide")) {
      const r = aim.s.ref;
      if (r.kind === "stand") { if (r.item >= 0) { label = MM.ITEMS[r.item].name; if (role === "hide" && r.occ) sub = `🟢 ${nm(r.occ)} (미믹)`; } else { label = "빈 받침대"; if (role === "hide" && item >= 0) sub = "가까이 가서 E로 올라갈 수 있어요"; } }
      else if (r.kind === "mimic") { label = itemName(r.item); if (role === "hide") sub = `🟢 ${nm(r.id)} (미믹)`; }
      else if (r.kind === "decor") label = Rules.DECOR_NAMES[r.dk] || "";
      else if (r.kind === "curator") { label = nm(r.id); sub = "학예사"; }
      if (role === "seek" && r.key && (stamps.get(r.key) || 0) > now) sub = "✔ 진짜로 확인됨";
    }
    el("aim-label").innerHTML = label ? `<b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}` : "";
    el("aim-label").style.display = label && !mapOpen ? "" : "none";
    // 버튼
    let main = "", sub2 = "", dash = "", mainOn = false, subOn = false, dashOn = false;
    if (role === "seek") {
      if (phase === "seek" && !(flags & 8)) { main = "쏘기"; mainOn = firing || (!!aim && aim.s.ref.kind !== "curator"); const left = S && S.wh && S.wh[team]; sub2 = left > 0 ? `호루라기 ${left}` : "호루라기"; subOn = !(left > 0); }
    } else {
      if ((flags & 1) || item === -1) { main = offers.length && item === -1 ? "변신 고르기" : ""; mainOn = !!main; }
      else if (perch >= 0) { main = "내려오기"; mainOn = phase === "hide" || phase === "seek"; }
      else if (item >= 0 && nearStand()) { main = "받침대에 오르기"; mainOn = true; }
      if (item !== -1 && !(flags & 1) && (phase === "hide" || phase === "seek")) { dash = dashCd > 0 ? `튀기 ${Math.ceil(dashCd)}` : "튀기"; dashOn = dashCd <= 0; }
      if (phase === "hide" && item !== -1) { sub2 = "변신 바꾸기"; subOn = true; }
      else if (phase === "seek" && item !== -1 && !(flags & 1)) { const left = Math.ceil((settings.tauntCd || 15) - (performance.now() / 1000 - tauntLocal)); sub2 = left > 0 ? `도발 ${left}` : "도발 +10"; subOn = left <= 0; }
    }
    const bm = el("btn-main"), bs = el("btn-sub"), bd = el("btn-dash");
    bm.textContent = !isTouch && main ? (role === "seek" ? "누르고 있기 · " : "E · ") + main : main; bm.classList.toggle("on", mainOn); bm.classList.toggle("fire", role === "seek"); bm.style.display = main ? "" : "none";
    bs.textContent = !isTouch && sub2 ? "Q · " + sub2 : sub2; bs.classList.toggle("on", subOn); bs.style.display = sub2 ? "" : "none";
    bd.textContent = !isTouch && dash ? "Space · " + dash : dash; bd.classList.toggle("on", dashOn); bd.style.display = dash ? "" : "none";
    const lh = el("lock-hint");
    lh.style.display = (!isTouch && !locked && !mapOpen && !offerOpen && !Options.isOpen && (phase === "hide" || phase === "seek") && !(role === "seek" && phase === "hide")) ? "block" : "none";
    lh.textContent = role === "seek" ? "화면을 클릭하면 마우스로 조준 · 왼쪽 버튼 누르고 있으면 연사 · WASD 이동 · Q 호루라기 · M 지도 · Esc 해제" : "화면을 클릭하면 마우스로 둘러보기 · WASD 이동 · Space 튀기 · E 받침대 · Q 도발 · M 지도 · Esc 해제";
    el("toast").textContent = toast.t > 0 ? toast.text : ""; el("toast").style.opacity = toast.t > 0 ? Math.min(1, toast.t * 2) : 0; el("toast").classList.toggle("big", toast.big);
    const fh = feed.map(f => `<div style="opacity:${Math.min(1, f.t)}">${f.html}</div>`).join(""); if (el("feed").dataset.k !== fh) { el("feed").dataset.k = fh; el("feed").innerHTML = fh; }
    el("hud").style.visibility = mapOpen ? "hidden" : "";
    el("offers").style.display = offerOpen && !mapOpen ? "flex" : "none";
  }

  return { start, stop, restore, setConnectionLost, onMessage, toast(t) { showToast(t, 5); }, setNames(n, t) { names = n; if (t) teams = t; }, get me() { return me; },
    _dbg: { pos: () => pos, set: (x, y, a) => { pos.x = x; pos.y = y; if (a !== undefined) pos.a = a; }, S: () => S, role: () => role, item: () => item, offers: () => offers, perch: () => perch, flags: () => flags, hp: () => hp, aim: () => aim, info: () => info, phase: () => phase,
      main: mainAction, sub: subAction, dash: dashAction, choose, nearStand, others: () => others, fire: v => { firing = !!v; }, shoot: key => { shots.push(key); sendPos(performance.now(), true); }, cam: () => cam, look: v => { if (v !== undefined) look = v; return look; } } };
})();
