// 학생 화면 — 1인칭 이동, 미믹(숨기)·학예사(찾기) 조작, HUD, 소리
window.Client = (function () {
  const TEAM_COLORS = ["#e2574c", "#4a8fe2", "#46b16a", "#e0a63a"];
  const el = id => document.getElementById(id);
  const isTouch = ("ontouchstart" in window) && window.matchMedia && matchMedia("(pointer: coarse)").matches;
  let cv, ctx, W = 800, H = 600;
  let me = null, names = {}, teams = {}, settings = {}, practice = null, onEnd = null;
  let running = false, raf = 0, last = 0, inputBound = false, connectionReady = true;
  let S = null, info = null, phase = "lobby", role = "seek", team = 0;
  let pos = { x: 2, y: 2, a: 0 }, look = 0, keys = {}, input = { fwd: 0, strafe: 0 }, locked = false, moving = false, bobT = 0;
  let item = -1, offers = [], perch = -1, perchFrom = null, perchPending = null, hearts = 5, flags = 0, myScore = 0;
  let others = new Map(), wiggle = new Map(), aim = null, lastPos = 0, lastSentKey = "", tagAt = 0, tauntLocal = -99;
  let fx = { flash: 0, flashCol: "255,255,255", shake: 0, stamp: 0, mark: null, stun: 0 };
  let toast = { text: "", t: 0, big: false }, feed = [], mapOpen = false, offerOpen = false, banner = null, checkMsg = null, caughtMsg = null;
  let resetTouch = () => {}, stepT = 0;

  // ---------- 시작·정지 ----------
  function start(opts) {
    stop();
    me = opts.id; names = opts.names || {}; teams = opts.teams || {}; settings = opts.settings || {}; practice = opts.practice || null; onEnd = opts.onEnd;
    cv = el("game-canvas"); ctx = cv.getContext("2d");
    Art.load(); resize(); window.addEventListener("resize", resize);
    document.body.classList.toggle("pc", !isTouch);
    setupInput(); resetControls(); others.clear(); feed = []; S = null;
    running = true; last = performance.now(); connectionReady = true;
    Sound.init();
    if (opts.round) applyRound(opts.round, true);
    if (opts.snapshot) restore(opts.snapshot, opts.playerState, opts.round);
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); resetControls(); if (document.pointerLockElement) document.exitPointerLock(); closeOffers(); }
  function resetControls() { keys = {}; input.fwd = input.strafe = 0; moving = false; resetTouch(); }
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
      item = -1; offers = []; perch = -1; perchFrom = null; perchPending = null; hearts = settings.hearts || 5; flags = 0; aim = null; checkMsg = null; caughtMsg = null;
      wiggle.clear(); closeOffers(); el("round-result").style.display = "none";
      if (r.spawns && r.spawns[me]) { const s = r.spawns[me]; pos = { x: s[0], y: s[1], a: s[2] || 0 }; }
      else if (Museum.cur) { const s = Museum.cur.spawns[0]; pos = { x: s.x, y: s.y, a: 0 }; }
      phase = "hide";
      if (!quiet) { Sound.play("horn"); banner = { t: 4, title: `${r.n}라운드 — ${role === "hide" ? "🎭 당신은 미믹" : "🔍 당신은 학예사"}`, sub: role === "hide" ? "전시물로 변신해서, 그 전시물이 있어야 할 전시실의 빈 받침대에 올라가 숨으세요." : "미믹들이 숨는 동안 눈을 감고 기다립니다. 그다음 '있어서는 안 될 전시물'을 찾아 찍으세요." }; }
    }
  }
  function restore(snap, ps, round) {
    resetControls();
    if (round) applyRound(round, true);
    if (snap) onMessage(snap);
    if (ps) {
      pos = { x: ps.x, y: ps.y, a: ps.a || 0 }; item = ps.item; offers = ps.offers || []; perch = ps.perch; perchFrom = ps.perchFrom; hearts = ps.hearts; myScore = ps.score || 0;
      role = ps.role || role; perchPending = null;
      if (role === "hide" && item < 0 && offers.length && (phase === "hide" || phase === "seek")) openOffers();
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
      if (k === " " || k === "e") { e.preventDefault(); if (!e.repeat) mainAction(); }
      if ((k === "q" || k === "r") && !e.repeat) subAction();
      if ((k === "m" || k === "tab") && !e.repeat) { e.preventDefault(); toggleMap(); }
      if (offerOpen && ["1", "2", "3"].includes(k)) choose(+k - 1);
      if (e.key === "Escape") { mapOpen = false; if (Options.isOpen) Options.close(); }
    });
    window.addEventListener("keyup", e => { keys[keyOf(e)] = false; });
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
      if (e.button === 0) mainAction(); else if (e.button === 2) subAction();
    });
    zone.addEventListener("contextmenu", e => e.preventDefault());
    document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === zone; });
    document.addEventListener("mousemove", e => {
      if (!locked || !running || !canLook()) return;
      const k = Options.get("mouseSens");
      pos.a += (e.movementX || 0) * 0.0024 * k;
      look = Math.max(-0.25, Math.min(0.25, look - (e.movementY || 0) * 0.0015 * k * (Options.get("invertY") ? -1 : 1)));
    });
    const tap = (id, fn) => { const b = el(id); b.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); fn(); }); };
    tap("btn-main", mainAction); tap("btn-sub", subAction); tap("btn-map", toggleMap);
    for (let i = 0; i < 3; i++) el("offer-" + i).onclick = () => choose(i);
    el("offer-close").onclick = () => closeOffers();
  }
  const isField = t => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  function canLook() { return connectionReady && !mapOpen && !Options.isOpen && !(flags & 1); }
  function toggleMap() { if (!running) return; if (role === "seek" && phase === "hide") return; mapOpen = !mapOpen; if (mapOpen && document.pointerLockElement) document.exitPointerLock(); }

  // ---------- 행동 ----------
  function nearStand() {
    const M = Museum.cur; if (!M) return null;
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
  function mainAction() {
    if (!running || !connectionReady || Options.isOpen || mapOpen) return;
    if (offerOpen) return;
    if (role === "seek") {
      if (phase !== "seek" || (flags & 8)) return;
      if (flags & 4) { showToast("잠깐! 방금 진짜 전시물을 찍어서 어지러워요.", 1.2); return; }
      if (!aim) { showToast("가운데 조준점을 전시물에 맞추고 찍으세요.", 1.5); return; }
      if (aim.dist > Rules.TAG_RANGE) { showToast("너무 멀어요. 가까이 가서 찍으세요.", 1.4); return; }
      const now = performance.now(); if (now - tagAt < 800) return; tagAt = now;
      const r = aim.s.ref;
      if (r.kind === "decor" || r.kind === "curator") { showToast(r.kind === "curator" ? "같은 학예사예요!" : "전시물이 아니에요.", 1.2); return; }
      Net.sendToHost({ t: "pos", x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), a: +pos.a.toFixed(2) });
      Net.sendToHost({ t: "tag", x: aim.s.x, y: aim.s.y }); fx.stamp = 1; Sound.play("stamp", { g: 0.6 });
      return;
    }
    // 미믹
    if (flags & 1) { if (offers.length) openOffers(); return; }
    if (item < 0) { if (offers.length) openOffers(); return; }
    if (perch >= 0) { doUnperch(); return; }
    const s = nearStand();
    if (!s) { showToast("빈 받침대 가까이 가야 올라갈 수 있어요.", 1.5); return; }
    perchFrom = { x: pos.x, y: pos.y }; perch = s.id; perchPending = { s: s.id, t: performance.now() };
    pos.x = s.x + 0.5; pos.y = s.y + 0.5; pos.a = faceRoom(s); look = 0.06; resetControls(); Sound.play("perch");
    Net.sendToHost({ t: "perch", s: s.id });
    if (!practice) showToast("받침대에 올라갔다. 이제 진짜 전시물인 척!", 2);
  }
  function faceRoom(s) { const c = Museum.cur.cells[s.cell]; return Math.atan2((c.y0 + c.y1 + 1) / 2 - (s.y + 0.5), (c.x0 + c.x1 + 1) / 2 - (s.x + 0.5)); }
  function doUnperch() {
    const M = Museum.cur, s = M && M.stands[perch];
    if (s) { const off = Museum.stepOff(s, perchFrom); pos.x = off.x; pos.y = off.y; }
    perch = -1; perchFrom = null; perchPending = null; Net.sendToHost({ t: "unperch" }); Sound.play("perch", { g: 0.6 });
  }
  function subAction() {
    if (!running || !connectionReady || Options.isOpen) return;
    if (role === "seek") {
      if (phase !== "seek" || (flags & 8)) return;
      const left = S && S.wh && S.wh[team]; if (left > 0) { showToast(`호루라기는 ${left}초 뒤에 다시 불 수 있어요.`, 1.5); return; }
      Net.sendToHost({ t: "whistle" }); return;
    }
    if (phase === "hide" && item >= 0 && perch < 0) { openOffers(); return; }
    if (phase !== "seek" || item < 0 || (flags & 1)) return;
    const now = performance.now() / 1000, cd = settings.tauntCd || 20;
    if (now - tauntLocal < cd) { showToast(`도발은 ${Math.ceil(cd - (now - tauntLocal))}초 뒤에 다시 할 수 있어요.`, 1.4); return; }
    tauntLocal = now; Net.sendToHost({ t: "taunt" });
  }
  function openOffers() {
    if (!offers.length) return;
    offerOpen = true; if (document.pointerLockElement) document.exitPointerLock();
    el("offers").style.display = "flex";
    for (let i = 0; i < 3; i++) {
      const b = el("offer-" + i), it = MM.ITEMS[offers[i]];
      b.style.display = it ? "" : "none"; if (!it) continue;
      const c = b.querySelector("canvas"), g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); g.drawImage(Art.object(it), 0, 0, c.width, c.height);
      b.querySelector(".nm").textContent = it.name; b.classList.toggle("on", it.index === item);
    }
    el("offer-close").style.display = item >= 0 ? "" : "none";
    el("offer-hint").textContent = phase === "seek" && (flags & 1) ? "잡혔다! 새로 변신할 전시물을 고르세요. 고른 뒤 다른 곳에서 다시 나타납니다." : "변신할 전시물을 고르세요. 그 전시물이 원래 있어야 할 전시실을 찾아가 빈 받침대에 올라가세요.";
  }
  function closeOffers() { offerOpen = false; const o = el("offers"); if (o) o.style.display = "none"; }
  function choose(i) {
    const id = offers[i]; if (id == null) return;
    Net.sendToHost({ t: "pick", item: id }); Sound.play("pick");
    item = id; pickT = performance.now(); closeOffers();
    if (perch >= 0 && phase === "hide") showToast(`'${MM.ITEMS[id].name}'(으)로 변신했다.`, 1.5);
    else showToast(`'${MM.ITEMS[id].name}'(으)로 변신했다. 있어야 할 전시실의 빈 받침대를 찾자!`, 3);
  }

  // ---------- 받기 ----------
  function onMessage(d) {
    if (!running || !d) return;
    if (d.t === "st") {
      S = d; phase = d.ph;
      const seen = new Set();
      for (const p of d.p) {
        const [id, x, y, a, rl, it, pr, f, hp, tm] = p;
        teams[id] = tm;
        if (id === me) {
          team = tm; role = rl ? "hide" : "seek"; flags = f; hearts = hp;
          if (role === "hide") {
            if (it !== item && !(it < 0 && item >= 0 && performance.now() - lastPickT() < 1500)) item = it;
            if (pr !== perch) {
              if (perchPending && performance.now() - perchPending.t < 1500) { /* 응답 대기 */ }
              else if (pr >= 0 && Museum.cur && Museum.cur.stands[pr]) { perchFrom = perchFrom || { x: pos.x, y: pos.y }; perch = pr; pos.x = x; pos.y = y; pos.a = faceRoom(Museum.cur.stands[pr]); }
              else if (perch >= 0) { if (perchPending) showToast("그 받침대에는 올라갈 수 없어요.", 1.5); perch = -1; perchPending = null; pos.x = x; pos.y = y; }
            } else perchPending = null;
          }
          continue;
        }
        seen.add(id);
        let o = others.get(id); if (!o) { o = { x, y, walk: 0 }; others.set(id, o); }
        if (Math.hypot(o.x - x, o.y - y) > 3) { o.x = x; o.y = y; }
        Object.assign(o, { tx: x, ty: y, a, role: rl ? "hide" : "seek", item: it, perch: pr, flags: f, team: tm });
      }
      for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
      return;
    }
    if (d.t === "ev") handleEvent(d);
  }
  let pickT = 0; const lastPickT = () => pickT;
  function itemName(i) { return MM.ITEMS[i] ? MM.ITEMS[i].name : "?"; }
  function roomOf(i) { return MM.ITEMS[i] ? MM.ROOMS[MM.ITEMS[i].room] : null; }
  function explain(i) { const it = MM.ITEMS[i], r = roomOf(i); if (!it || !r) return ""; return `'${it.name}' → ${r.name} 전시실` + (it.note ? ` — ${it.note}` : ""); }
  function addFeed(html) { feed.unshift({ html, t: 7 }); if (feed.length > 5) feed.length = 5; }
  function nm(id) { return names[id] || (String(id).startsWith("bot-") ? "미믹" : "?"); }
  function handleEvent(e) {
    if (e.to && e.to !== me) return;
    switch (e.k) {
      case "round": applyRound(e); break;
      case "phase":
        if (e.ph === "seek") { phase = "seek"; Sound.play("horn"); banner = { t: 3, title: role === "seek" ? "🔍 출발! 가짜를 찾아라" : "🔍 학예사들이 출발했다!", sub: role === "seek" ? "있어서는 안 될 전시실에 있는 전시물, 움찔거리는 전시물, 소리 나는 전시물을 찾아 찍으세요." : "움직이면 들킨다. 기척 소리가 날 때 주의!" }; Sound.vibrate(80); }
        break;
      case "offer": offers = e.list; if (role === "hide") { item = -1; openOffers(); } break;
      case "picked": item = e.item; pickT = performance.now(); break;
      case "caught": {
        const S_ = nm(e.by), H_ = nm(e.id);
        if (e.id === me) { Sound.play("caught"); Sound.vibrate([200, 80, 200]); fx.flash = 0.8; fx.flashCol = "220,40,40"; fx.shake = 0.6; perch = -1; perchFrom = null; perchPending = null; item = -1; caughtMsg = { title: `${S_}에게 잡혔다! (−30점)`, sub: e.ok ? `'${itemName(e.item)}'은(는) 제자리(${roomOf(e.item).name})에 있었어요. 기척이나 도발 소리에 들켰어요.` : !e.perched ? `받침대 밖에서 돌아다니다 들켰어요. ${explain(e.item)}` : `${explain(e.item)}. 숨은 곳: ${e.where}` }; }
        else if (e.by === me) { Sound.play("ding"); fx.mark = { ok: true, t: 1.3 }; fx.flash = 0.5; fx.flashCol = "60,200,90"; showToast(`가짜 발견! +60점 — ${e.ok ? `'${itemName(e.item)}' (제자리에 있었지만 찾아냈다)` : !e.perched ? `돌아다니던 '${itemName(e.item)}'` : explain(e.item)}`, 4.5, true); }
        else Sound.play("stamp", { g: 0.25 });
        addFeed(`🔍 <b style="color:${TEAM_COLORS[teams[e.by] % 4]}">${esc(S_)}</b> → 🎭 ${esc(H_)} <span class="it">'${esc(itemName(e.item))}'</span> ${e.ok ? "" : e.perched ? "<span class='bad'>잘못 숨음</span>" : "<span class='muted'>돌아다니다</span>"}`);
        break;
      }
      case "wrong":
        if (e.by === me) { Sound.play("buzzer"); Sound.vibrate([80, 40, 80]); fx.mark = { ok: false, t: 1.3 }; fx.flash = 0.6; fx.flashCol = "230,60,40"; fx.stun = 1; showToast(`진짜 전시물이었어요! −15점, ❤ −1 — ${explain(e.item)} (여기 있는 게 맞아요)`, 4.5, true); }
        addFeed(`❌ <b style="color:${TEAM_COLORS[teams[e.by] % 4]}">${esc(nm(e.by))}</b> 진짜 전시물 <span class="it">'${esc(itemName(e.item))}'</span>을(를) 찍음`);
        break;
      case "miss": if (e.why === "immune") showToast("방금 변신해서 아직 잡을 수 없어요 (5초 보호).", 1.6); else if (e.why === "empty") showToast("빈 받침대예요.", 1.2); else showToast("아무것도 없어요.", 1); break;
      case "jail": if (e.id === me) { Sound.play("error"); showToast(`하트를 다 잃었다 — 경비실에서 ${e.secs}초 쉬고 로비로 돌아갑니다. (−20점)`, 4, true); } addFeed(`🚓 ${esc(nm(e.id))} 경비실로`); break;
      case "free": if (e.id === me) { pos.x = e.x; pos.y = e.y; hearts = settings.hearts || 5; showToast("로비로 돌아왔다. 다시 찾자!", 2); } break;
      case "respawn": if (e.id === me) { pos.x = e.x; pos.y = e.y; caughtMsg = null; showToast(`다른 곳에서 '${itemName(item)}'(으)로 나타났다. 5초 동안은 잡히지 않아요 — 얼른 숨자!`, 3.5, true); } break;
      case "taunt": wiggle.set(e.id, performance.now() + 1100); if (e.id === me) { Sound.play("taunt", { seed: e.item, g: 0.7 }); showToast("도발! +10점 (근처 학예사에게 들렸을지도)", 1.8); } else Sound.at("taunt", e.x, e.y, { seed: e.item, range: 26, g: 1.2 }); break;
      case "whistle": Sound.at("whistle", e.x, e.y, { range: 40, g: 1 }); if (role === "hide") showToast("호루라기! 미믹들이 저절로 소리를 낸다.", 2.2); else if (e.by !== me) showToast(`${nm(e.by)}이(가) 호루라기를 불었다.`, 1.5); break;
      case "beep":
        for (const [id, x, y, it] of e.list) {
          const delay = Math.random() * 1.1; wiggle.set(id, performance.now() + delay * 1000 + 900);
          if (id === me) setTimeout(() => { Sound.play("beep", { seed: it, g: 0.45 }); showToast("삑! 내 기척이 새어 나갔다 — 근처 학예사에게 들렸을지도.", 1.6); }, delay * 1000);
          else setTimeout(() => Sound.at("beep", x, y, { seed: it, range: e.loud ? 30 : 22, g: e.loud ? 1.3 : 1 }), delay * 1000);
        }
        break;
      case "cool": showToast(`호루라기는 ${e.left}초 뒤에 다시 불 수 있어요.`, 1.5); break;
      case "check":
        if (e.ok) { Sound.play("ding"); checkMsg = { ok: true, t: 2.4, text: `정답! '${itemName(e.item)}' → ${roomOf(e.item).name}` + (MM.ITEMS[e.item].note ? ` — ${MM.ITEMS[e.item].note}` : "") }; }
        else { Sound.play("buzzer"); checkMsg = { ok: false, t: 3.2, text: `아쉬워요. 여기는 ${MM.ROOMS[e.at].name} — ${explain(e.item)}` }; }
        break;
      case "unperched": perch = -1; perchFrom = null; perchPending = null; pos.x = e.x; pos.y = e.y; item = -1; break;
      case "rend": showRoundResult(e); break;
      case "end": phase = "over"; closeOffers(); if (onEnd) onEnd(e); break;
    }
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
  function showRoundResult(e) {
    phase = "result"; closeOffers(); mapOpen = false; caughtMsg = null; checkMsg = null; Sound.play("chime");
    if (document.pointerLockElement) document.exitPointerLock();
    const rows = e.hiders.filter(h => h.item >= 0).map(h => {
      const it = MM.ITEMS[h.item], right = roomOf(h.item);
      const verdict = h.perched ? (h.ok ? `<span class="good">✔ 제자리 (+${h.bonus})</span>` : `<span class="bad">✘ ${esc(MM.ROOMS[h.at].name)}에 숨음</span>`) : `<span class="bad">받침대 밖 (${esc(h.where)})</span>`;
      return `<tr><td>${h.bot ? "🤖" : "🎭"} ${esc(h.name)}</td><td><b>${esc(it.name)}</b><br><small>있어야 할 곳: ${esc(right.name)}</small></td><td>${verdict}</td><td>${h.sec}초 · 잡힘 ${h.caught}</td></tr>`;
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
  function update(dt, now) {
    if (!connectionReady) { moving = false; updateHud(); return; }
    let fwd = input.fwd, strafe = input.strafe, turn = 0;
    if (keys["w"] || keys["arrowup"]) fwd += 1; if (keys["s"] || keys["arrowdown"]) fwd -= 1;
    if (keys["a"]) strafe -= 1; if (keys["d"]) strafe += 1;
    if (keys["arrowleft"]) turn -= 1; if (keys["arrowright"]) turn += 1;
    const frozen = (role === "seek" && (phase === "hide" || (flags & 8) || fx.stun > 0.4)) || (role === "hide" && (perch >= 0 || (flags & 1) || item < 0 && phase === "seek")) || phase === "result" || phase === "over" || mapOpen || offerOpen || Options.isOpen;
    if (!mapOpen && !Options.isOpen && !(flags & 1)) pos.a += turn * 2.4 * dt;
    moving = false;
    if (!frozen) {
      const len = Math.hypot(fwd, strafe);
      if (len > 0.05) {
        const k = Math.min(1, len), sp = Rules.SPEED;
        const dx = (Math.cos(pos.a) * fwd + Math.cos(pos.a + Math.PI / 2) * strafe) / len * k, dy = (Math.sin(pos.a) * fwd + Math.sin(pos.a + Math.PI / 2) * strafe) / len * k;
        const np = Museum.move(pos.x, pos.y, dx * sp * dt, dy * sp * dt, 0.28); pos.x = np.x; pos.y = np.y; moving = true; bobT += dt * 9;
      }
    }
    Sound.setListener(pos.x, pos.y, pos.a);
    // 다른 사람 부드럽게 + 발소리
    stepT -= dt;
    for (const [id, o] of others) {
      const ox = o.x, oy = o.y; o.x += (o.tx - o.x) * Math.min(1, dt * 10); o.y += (o.ty - o.y) * Math.min(1, dt * 10);
      const sp = Math.hypot(o.x - ox, o.y - oy) / Math.max(dt, 1e-3); o.moving = sp > 0.4; if (o.moving) o.walk += dt * 8;
      if (o.moving && stepT <= 0 && !(o.flags & 1)) { const d = Math.hypot(o.x - pos.x, o.y - pos.y); if (d < 9) Sound.at("step", o.x, o.y, { range: 10, g: o.role === "hide" ? 0.7 : 1 }); }
    }
    if (stepT <= 0) stepT = 0.38;
    if (now - lastPos > 100) {
      const key = `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.a.toFixed(2)}`;
      if (key !== lastSentKey || now - lastPos > 1000) { lastSentKey = key; lastPos = now; Net.sendToHost({ t: "pos", x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), a: +pos.a.toFixed(2) }); }
    }
    if (perchPending && now - perchPending.t > 3000) perchPending = null;
    fx.flash *= Math.pow(0.05, dt); fx.shake *= Math.pow(0.03, dt); fx.stamp = Math.max(0, fx.stamp - dt * 3); if (fx.mark) fx.mark.t -= dt; fx.stun = Math.max(0, fx.stun - dt * 0.66);
    if (toast.t > 0) toast.t -= dt; for (const f of feed) f.t -= dt; feed = feed.filter(f => f.t > 0);
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
    if (checkMsg) { checkMsg.t -= dt; if (checkMsg.t <= 0) checkMsg = null; }
    updateHud();
  }

  // ---------- 그리기 ----------
  const DECOR_H = { bench: 0.55, plant: 1.0, desk: 0.7, vending: 1.45, rope: 0.62, poster: 1.1 };
  function accentFor(s) { const c = Museum.cur.cells[s.cell]; return Art.wingColor(c.wing); }
  function buildSprites(now) {
    const M = Museum.cur, sprites = [];
    const occ = new Map();
    for (const [id, o] of others) if (o.role === "hide" && o.perch >= 0 && !(o.flags & 1) && o.item >= 0) occ.set(o.perch, { id, o });
    const wob = id => { const u = wiggle.get(id); return u && now < u ? Math.sin(now / 22) * 7 : 0; };
    for (const s of M.stands) {
      if (perch === s.id && role === "hide") continue;
      if (Math.abs(s.x - pos.x) > 26 || Math.abs(s.y - pos.y) > 26) continue;
      const oc = occ.get(s.id), acc = accentFor(s);
      const it = oc ? MM.ITEMS[oc.o.item] : s.item >= 0 ? MM.ITEMS[s.item] : null;
      const sp = { img: Art.exhibit(it, acc), x: s.x + 0.5, y: s.y + 0.5, h: 1.32, aimable: true, ref: { kind: "stand", s, occ: oc ? oc.id : null, item: it ? it.index : -1 }, wob: oc ? wob(oc.id) : 0 };
      if (oc && role === "hide") { sp.name = nm(oc.id); sp.nameColor = "#7dff9a"; }
      sprites.push(sp);
    }
    for (const d of M.decor) sprites.push({ img: Art.decor(d.kind), x: d.x + 0.5, y: d.y + 0.5, h: DECOR_H[d.kind] || 0.8, aimable: true, ref: { kind: "decor" } });
    for (const [id, o] of others) {
      if (o.flags & 1) continue;
      if (o.role === "seek") {
        if (role === "seek" && phase === "hide") continue;
        sprites.push({ img: Art.curator(TEAM_COLORS[o.team % 4], o.moving ? Math.floor(o.walk) % 2 : 0, !!(o.flags & 8), o.team % 4), x: o.x, y: o.y, h: 1.5, aimable: true, ref: { kind: "curator", id }, name: nm(id), nameColor: TEAM_COLORS[o.team % 4] });
      } else if (o.perch < 0 && o.item >= 0) {
        if (role === "seek" && phase === "hide") continue;
        const hop = o.moving ? Math.abs(Math.sin(o.walk * 0.9)) * 0.16 : 0;
        const sp = { img: Art.loose(MM.ITEMS[o.item]), x: o.x, y: o.y, h: 0.66, lift: hop, aimable: true, ref: { kind: "loose", id, item: o.item }, wob: wob(id), alpha: (o.flags & 2) ? 0.55 : 1 };
        if (role === "hide") { sp.name = nm(id); sp.nameColor = "#7dff9a"; }
        sprites.push(sp);
      }
    }
    return sprites;
  }
  function render(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!Museum.cur) { ctx.fillStyle = "#111"; ctx.fillRect(0, 0, W, H); return; }
    const blind = role === "seek" && phase === "hide";
    if (blind) { drawBlind(now); return; }
    const sh = fx.shake * 12; ctx.save(); ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    const res = Fps.render(ctx, W, H, { pos, look, eye: role === "hide" && perch >= 0 ? 1.22 : 0.8, bob: moving ? Math.sin(bobT) * 3 : 0, sprites: buildSprites(now), now, gray: !!(flags & 8) });
    ctx.restore();
    aim = res.aim && res.aim.dist <= 7 ? res.aim : null;
    if (role === "seek") drawStampTool(now);
    drawCrosshair();
    if (fx.stun > 0) { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, "rgba(255,0,0,0)"); g.addColorStop(1, `rgba(200,20,20,${0.45 * fx.stun})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (fx.flash > 0.02) { ctx.fillStyle = `rgba(${fx.flashCol},${Math.min(0.6, fx.flash)})`; ctx.fillRect(0, 0, W, H); }
    if (flags & 8) drawCenterCard("🚓 경비실에서 쉬는 중", "하트를 다 잃었어요. 잠시 뒤 로비에서 다시 시작합니다.");
    if (role === "hide" && (flags & 1)) { ctx.fillStyle = "rgba(10,5,5,0.78)"; ctx.fillRect(0, 0, W, H); drawCenterCard(caughtMsg ? caughtMsg.title : "잡혔다!", caughtMsg ? caughtMsg.sub : "", offers.length && item < 0 ? "아래에서 새 전시물을 고르면 다른 곳에서 다시 나타납니다." : "곧 다른 곳에서 다시 나타납니다…"); }
    if (checkMsg) drawCheck();
    if (banner) drawBanner();
    if (mapOpen) drawMap(now);
  }
  function drawCrosshair() {
    const x = W / 2, y = H / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
    if (role === "seek") { ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.stroke(); ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke(); }
  }
  function drawStampTool(now) {
    if (flags & 8) return;
    const s = Math.min(W, H) / 600, press = fx.stamp > 0 ? Math.sin(fx.stamp * Math.PI) : 0;
    const x = W - 150 * s, y = H - 40 * s - press * 60 * s + (moving ? Math.sin(bobT) * 6 * s : 0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-0.25 - press * 0.15); ctx.scale(s, s);
    ctx.fillStyle = "#7a4e2a"; ctx.fillRect(-14, -150, 28, 90); ctx.fillStyle = "#9a6a3a"; ctx.fillRect(-14, -150, 8, 90);
    ctx.fillStyle = "#c8a050"; ctx.beginPath(); ctx.arc(0, -160, 22, 0, 7); ctx.fill();
    ctx.fillStyle = "#3a3d44"; ctx.fillRect(-46, -64, 92, 30); ctx.fillStyle = "#c62828"; ctx.fillRect(-42, -36, 84, 14);
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.ellipse(-30, -100, 26, 36, 0.3, 0, 7); ctx.fill();
    ctx.restore();
    if (fx.mark && fx.mark.t > 0) { ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.15); ctx.globalAlpha = Math.min(1, fx.mark.t * 2); ctx.strokeStyle = fx.mark.ok ? "#1fbf4f" : "#e03030"; ctx.lineWidth = 6; ctx.strokeRect(-110, -40, 220, 80); ctx.fillStyle = ctx.strokeStyle; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(fx.mark.ok ? "가짜!" : "진짜…", 0, 2); ctx.restore(); }
  }
  function drawCenterCard(title, sub, sub2) {
    const w = Math.min(W - 30, 620); ctx.fillStyle = "rgba(15,17,22,0.88)"; ctx.fillRect((W - w) / 2, H * 0.28, w, sub2 ? 150 : 120);
    ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.min(30, W / 18)}px sans-serif`; ctx.fillText(title, W / 2, H * 0.28 + 44);
    ctx.fillStyle = "#d9d2c4"; ctx.font = `${Math.min(17, W / 32)}px sans-serif`; wrapText(sub, W / 2, H * 0.28 + 78, w - 30, 22);
    if (sub2) { ctx.fillStyle = "#ffd27e"; ctx.fillText(sub2, W / 2, H * 0.28 + 132, w - 30); }
  }
  function wrapText(t, x, y, maxW, lh) { if (!t) return; const words = t.split(" "); let line = ""; for (const w of words) { const test = line ? line + " " + w : w; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; } else line = test; } if (line) ctx.fillText(line, x, y); }
  function drawCheck() {
    const w = Math.min(W - 30, 640); ctx.fillStyle = checkMsg.ok ? "rgba(20,90,40,0.92)" : "rgba(110,30,25,0.92)"; ctx.fillRect((W - w) / 2, H * 0.16, w, 70);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `bold ${Math.min(19, W / 30)}px sans-serif`; wrapText(checkMsg.text, W / 2, H * 0.16 + 30, w - 24, 24);
  }
  function drawBanner() {
    const a = Math.min(1, banner.t), w = Math.min(W - 20, 760);
    ctx.globalAlpha = a; ctx.fillStyle = "rgba(20,22,30,0.86)"; ctx.fillRect((W - w) / 2, H * 0.12, w, 96);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe9b0"; ctx.font = `bold ${Math.min(30, W / 20)}px sans-serif`; ctx.fillText(banner.title, W / 2, H * 0.12 + 40);
    ctx.fillStyle = "#e6e1d6"; ctx.font = `${Math.min(16, W / 36)}px sans-serif`; wrapText(banner.sub, W / 2, H * 0.12 + 70, w - 30, 20); ctx.globalAlpha = 1;
  }
  function drawBlind(now) {
    ctx.fillStyle = "#101218"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.fillStyle = "#ffe9b0"; ctx.font = `bold ${Math.min(34, W / 16)}px sans-serif`;
    ctx.fillText(`🙈 미믹들이 숨는 중 … ${S ? S.tm : ""}`, W / 2, H * 0.16);
    ctx.fillStyle = "#cfc8b8"; ctx.font = `${Math.min(17, W / 34)}px sans-serif`; ctx.fillText("학예사는 눈을 감고 기다립니다. 이번 라운드 전시실을 미리 익혀 두세요.", W / 2, H * 0.16 + 32);
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
  function updateHud() {
    const tm = S ? S.tm : 0, ph = phase;
    const phaseTxt = ph === "hide" ? "숨는 시간" : ph === "seek" ? "찾는 시간" : ph === "result" ? "라운드 결과" : ph === "over" ? "끝" : "";
    el("hud-round").textContent = info ? `${practice ? "연습" : `${info.n}/${info.total} 라운드`} · ${phaseTxt} ${Math.floor(tm / 60)}:${String(tm % 60).padStart(2, "0")}` : "";
    el("hud-role").innerHTML = role === "hide" ? `<span class="badge hide">🎭 미믹</span>` : `<span class="badge seek" style="background:${TEAM_COLORS[team % 4]}">🔍 학예사 · ${team + 1}팀</span>`;
    if (S && !practice) { const sc = S.sc.map((v, i) => `<span class="chip${i === team ? " mine" : ""}" style="border-color:${TEAM_COLORS[i]}"><b style="color:${TEAM_COLORS[i]}">${i + 1}팀</b> ${v}</span>`).join(""); if (sc !== hudKey) { hudKey = sc; el("hud-scores").innerHTML = sc; } }
    const cell = Museum.cur && Museum.cellAt(pos.x, pos.y);
    el("hud-room").textContent = cell ? "📍 " + cell.name + (cell.kind === "room" ? ` · ${MM.WING_BY_ID[cell.wing].name}` : "") : "";
    // 내 상태
    let meHtml = "";
    if (role === "hide") {
      const it = MM.ITEMS[item];
      meHtml = it ? `<canvas id="me-thumb" width="44" height="44"></canvas><div><div class="small muted">지금 내 모습</div><b>${esc(it.name)}</b><div class="small">${(flags & 1) ? "잡힘" : perch >= 0 ? "🟢 받침대 위" : "🟡 돌아다니는 중"}${(flags & 2) ? " · 보호 중" : ""}</div></div>` : `<div><b>변신 전</b><div class="small muted">전시물을 고르세요</div></div>`;
    } else meHtml = `<div><span class="hearts">${"❤".repeat(Math.max(0, hearts))}<span class="lost">${"❤".repeat(Math.max(0, (settings.hearts || 5) - hearts))}</span></span><div class="small muted">틀리게 찍으면 하트가 줄어요</div></div>`;
    const box = el("hud-me"); if (box.dataset.k !== meHtml) { box.dataset.k = meHtml; box.innerHTML = meHtml; const c = el("me-thumb"); if (c && MM.ITEMS[item]) c.getContext("2d").drawImage(Art.object(MM.ITEMS[item]), 0, 0, 44, 44); }
    // 조준 이름표
    let label = "", sub = "";
    if (aim && !(role === "seek" && phase === "hide")) {
      const r = aim.s.ref;
      if (r.kind === "stand") { if (r.item >= 0) { label = MM.ITEMS[r.item].name; if (role === "hide" && r.occ) sub = `🟢 ${nm(r.occ)} (미믹)`; } else { label = "빈 받침대"; if (role === "hide") sub = "가까이 가서 올라갈 수 있어요"; } }
      else if (r.kind === "loose") { label = MM.ITEMS[r.item].name; if (role === "hide") sub = `🟢 ${nm(r.id)} (미믹)`; }
      else if (r.kind === "curator") { label = nm(r.id); sub = "학예사"; }
      if (role === "seek" && label && r.kind !== "curator" && r.kind !== "decor" && phase === "seek") sub = aim.dist > Rules.TAG_RANGE ? "가까이 가야 찍을 수 있어요" : (isTouch ? "찍기 버튼" : "클릭/E로 찍기");
    }
    el("aim-label").innerHTML = label ? `<b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}` : "";
    el("aim-label").style.display = label && !mapOpen ? "" : "none";
    // 버튼
    let main = "", sub2 = "", mainOn = false, subOn = false;
    if (role === "seek") {
      if (phase === "seek" && !(flags & 8)) { main = "찍기"; mainOn = !!aim && aim.dist <= Rules.TAG_RANGE && (aim.s.ref.kind === "stand" || aim.s.ref.kind === "loose"); const left = S && S.wh && S.wh[team]; sub2 = left > 0 ? `호루라기 ${left}` : "호루라기"; subOn = !(left > 0); }
    } else {
      if (flags & 1) { main = offers.length && item < 0 ? "변신 고르기" : ""; mainOn = !!main; }
      else if (item < 0) { main = offers.length ? "변신 고르기" : ""; mainOn = !!main; }
      else if (perch >= 0) { main = "내려오기"; mainOn = phase === "hide" || phase === "seek"; }
      else { const s = nearStand(); main = s ? "받침대에 오르기" : "빈 받침대 찾기"; mainOn = !!s; }
      if (phase === "hide" && item >= 0 && perch < 0) { sub2 = "변신 바꾸기"; subOn = true; }
      else if (phase === "seek" && item >= 0 && !(flags & 1) && !practice) { const left = Math.ceil((settings.tauntCd || 20) - (performance.now() / 1000 - tauntLocal)); sub2 = left > 0 ? `도발 ${left}` : "도발 +10"; subOn = left <= 0; }
    }
    const bm = el("btn-main"), bs = el("btn-sub");
    bm.textContent = !isTouch && main ? (role === "seek" ? "클릭·E · " : "E · ") + main : main; bm.classList.toggle("on", mainOn); bm.style.display = main ? "" : "none";
    bs.textContent = !isTouch && sub2 ? "Q · " + sub2 : sub2; bs.classList.toggle("on", subOn); bs.style.display = sub2 ? "" : "none";
    el("lock-hint").style.display = (!isTouch && !locked && !mapOpen && !offerOpen && !Options.isOpen && (phase === "hide" || phase === "seek") && !(role === "seek" && phase === "hide")) ? "block" : "none";
    el("toast").textContent = toast.t > 0 ? toast.text : ""; el("toast").style.opacity = toast.t > 0 ? Math.min(1, toast.t * 2) : 0; el("toast").classList.toggle("big", toast.big);
    const fh = feed.map(f => `<div style="opacity:${Math.min(1, f.t)}">${f.html}</div>`).join(""); if (el("feed").dataset.k !== fh) { el("feed").dataset.k = fh; el("feed").innerHTML = fh; }
    el("hud").style.visibility = mapOpen ? "hidden" : "";
    el("offers").style.display = offerOpen && !mapOpen ? "flex" : "none";
  }

  return { start, stop, restore, setConnectionLost, onMessage, toast(t) { showToast(t, 5); }, setNames(n, t) { names = n; if (t) teams = t; }, get me() { return me; },
    _dbg: { pos: () => pos, set: (x, y, a) => { pos.x = x; pos.y = y; if (a !== undefined) pos.a = a; }, S: () => S, role: () => role, item: () => item, offers: () => offers, perch: () => perch, flags: () => flags, hearts: () => hearts, aim: () => aim, info: () => info, phase: () => phase, main: mainAction, sub: subAction, choose, nearStand, others: () => others } };
})();
