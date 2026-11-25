// 규칙·지도·콘텐츠 검사 — 별도 설치 없이 node --test tests/*.test.cjs 로 돈다
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function load() {
  const s = { console, Math, Map, Set, JSON, Date, Int32Array, Int16Array, Uint8Array, Float32Array }; s.window = s; vm.createContext(s);
  for (const f of ['js/content.js', 'js/museum.js', 'js/rules.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), s, { filename: f });
  return s;
}
const ctx = load();
const { MM, Museum, Rules } = ctx;

function world(nPlayers, teams, extra) {
  const W = Rules.create({ teams, rounds: 4, hideTime: 10, seekTime: 90, beepEvery: 20, resultTime: 5, ...(extra || {}) });
  for (let i = 0; i < nPlayers; i++) Rules.addPlayer(W, 'p' + i, '학생' + i, i % teams);
  Rules.startGame(W, 12345);
  return W;
}
const hiders = W => [...W.players.values()].filter(p => p.role === 'hide');
const seekers = W => [...W.players.values()].filter(p => p.role === 'seek');
function toSeek(W) { while (W.phase === 'hide') Rules.tick(W, 0.5); W.events.length = 0; }
const roomCell = (W, room) => W.museum.cells.find(c => c.kind === 'room' && c.room === room);
// 미믹을 어떤 방의 빈 바닥(벽 옆)에 세워 둔다
function placeIn(W, H, cell) {
  for (let y = cell.y0; y <= cell.y1; y++) for (let x = cell.x0; x <= cell.x1; x++) {
    if (Museum.tile(x, y) !== 0 || Museum.hits(x + 0.5, y + 0.5, 0.3)) continue;
    if ([...W.players.values()].some(q => q !== H && Math.hypot(q.x - x - 0.5, q.y - y - 0.5) < 1)) continue;
    H.x = x + 0.5; H.y = y + 0.5; H.movedAt = -9; return { x: H.x, y: H.y };
  }
  throw new Error('no floor');
}
function pickSci(W, H) { const f = H.offers.find(i => i >= 0); Rules.handle(W, H.id, { t: 'pick', item: f }); return f; }
// 학예사를 대상 옆(LOS 확보) 바닥에 세운다
function standNear(W, S, x, y) {
  for (const [dx, dy] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2], [0, 2.4], [2.4, 0], [0, -2.4], [-2.4, 0]]) {
    const px = x + dx, py = y + dy;
    if (Museum.tile(Math.floor(px), Math.floor(py)) === 0 && Museum.los(px, py, x, y)) { S.x = px; S.y = py; return; }
  }
  throw new Error('no spot near target');
}
const fire = (W, S, ref) => { Rules.tick(W, 0.35); Rules.handle(W, S.id, { t: 'shoot', ref }); };

test('content: every room has at least 4 items, ids unique, conflicts symmetric, duplicate names only across conflicting wings', () => {
  const ids = new Set();
  for (const r of MM.ROOMS) { assert.ok(r.items.length >= 4, r.name); assert.ok(!ids.has(r.wing + '/' + r.id)); ids.add(r.wing + '/' + r.id); }
  for (const w of MM.WINGS) for (const c of w.conflicts) { assert.ok(MM.WING_BY_ID[c], `${w.id} -> ${c}`); assert.ok(MM.WING_BY_ID[c].conflicts.includes(w.id), `asym ${w.id} ${c}`); }
  const byName = {}; for (const it of MM.ITEMS) (byName[it.name] = byName[it.name] || []).push(MM.ROOMS[it.room].wing);
  for (const [n, ws] of Object.entries(byName)) for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++) assert.ok(ws[a] !== ws[b] && MM.WING_BY_ID[ws[a]].conflicts.includes(ws[b]), `duplicate name '${n}' in ${ws[a]} and ${ws[b]}`);
  assert.ok(MM.ITEMS.length > 500);
});

test('content: every emoji used by an exhibit exists in the atlas map', () => {
  const s = {}; s.window = s; vm.createContext(s); vm.runInContext(fs.readFileSync(path.join(root, 'js/emoji-map.js'), 'utf8'), s);
  for (const it of MM.ITEMS) if (it.icon.startsWith('e:')) for (const e of it.icon.slice(2).split('+')) assert.ok(e in s.EMOJI_ATLAS.map, `${it.name}: ${e}`);
});

test('museum: 300 random layouts are connected, deterministic, cluttered, and every room has 2+ empty stands', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = Museum._rng(seed); const wings = Museum._shuffle(MM.WINGS.map(w => w.id), r), pick = []; let rooms = 0;
    for (const id of wings) { const w = MM.WING_BY_ID[id]; if (pick.some(p => w.conflicts.includes(p))) continue; if (rooms + w.rooms.length > 17) continue; pick.push(id); rooms += w.rooms.length; if (rooms >= 12) break; }
    const m = Museum.generate({ seed, wings: pick }); Museum.use(m);
    const seen = Museum.reachable();
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.grid[y * m.W + x] === 0 && m.cellOf[y * m.W + x] >= 0) assert.ok(seen[y * m.W + x], `isolated floor seed ${seed}`);
    for (const st of m.stands) assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(st.y + dy) * m.W + st.x + dx]), `stand unreachable ${seed}`);
    m.cells.forEach((c, ci) => {
      if (c.kind !== 'room') return;
      assert.ok(m.stands.filter(s => s.cell === ci && s.item < 0).length >= 2, `${seed} ${c.name}`);
      assert.ok(m.decor.filter(d => m.cellOf[d.y * m.W + d.x] === ci).length >= 1, `room without furniture ${seed} ${c.name}`);
    });
    assert.equal(JSON.stringify(Museum.generate({ seed, wings: pick }).decor), JSON.stringify(m.decor));
    if (seed % 30 === 0) { const s0 = m.spawns[0], far = m.stands[m.stands.length - 1], p = Museum.path(s0.x, s0.y, far.x + 0.5, far.y + 0.5); assert.ok(p.length > 3, 'path to the far stand'); for (const n of p) assert.equal(Museum.tile(Math.floor(n.x), Math.floor(n.y)), 0); }
  }
});

test('offers: two undisplayed science exhibits from different rooms plus one piece of museum junk', () => {
  const W = world(16, 4);
  assert.deepEqual([...W.info.hiders], [0, 1]);
  assert.equal(hiders(W).length, 8);
  const displayed = new Set(W.museum.stands.filter(s => s.item >= 0).map(s => s.item));
  const all = [];
  for (const H of hiders(W)) {
    assert.equal(H.offers.length, 3);
    const sci = H.offers.filter(f => f >= 0), junk = H.offers.filter(f => f <= -2);
    assert.equal(sci.length, 2); assert.equal(junk.length, 1);
    assert.notEqual(MM.ITEMS[sci[0]].room, MM.ITEMS[sci[1]].room);
    for (const i of sci) { assert.ok(!displayed.has(i)); assert.ok(W.museum.cells.some(c => c.room === MM.ITEMS[i].room)); all.push(i); }
    assert.ok(Rules.formName(junk[0]).length > 0); assert.ok(Rules.formHp(junk[0]) > 0);
  }
  assert.equal(new Set(all).size, all.length, 'no two hiders are offered the same exhibit');
  const wings = W.info.wings.map(id => MM.WING_BY_ID[id]);
  for (const a of wings) for (const b of wings) assert.ok(!a.conflicts.includes(b.id));
});

test('hiding: anywhere in the right room counts once still; pedestals only for science forms and only empty ones', () => {
  const W = world(4, 2); const [H] = hiders(W);
  const f = pickSci(W, H); assert.equal(H.item, f); assert.equal(H.hp, Rules.ITEM_HP);
  const right = roomCell(W, MM.ITEMS[f].room);
  placeIn(W, H, right); assert.ok(Rules.correctAt(W, H), 'standing still on the floor of the right room');
  H.movedAt = W.elapsed; assert.ok(!Rules.correctAt(W, H), 'moving does not count');
  H.movedAt = -9;
  const wrong = W.museum.cells.find(c => c.kind === 'room' && c.room !== MM.ITEMS[f].room); placeIn(W, H, wrong); assert.ok(!Rules.correctAt(W, H));
  const real = W.museum.stands.find(s => s.item >= 0); H.x = real.x + 0.5; H.y = real.y + 1.5;
  Rules.handle(W, H.id, { t: 'perch', s: real.id }); assert.equal(H.perch, -1, 'cannot perch on a real exhibit');
  const empty = W.museum.stands.find(s => s.item < 0 && s.room === MM.ITEMS[f].room); const off = Museum.stepOff(empty, null); H.x = off.x; H.y = off.y;
  Rules.handle(W, H.id, { t: 'perch', s: empty.id }); assert.equal(H.perch, empty.id); assert.ok(Rules.correctAt(W, H));
  // 잡동사니로 바꾸면 받침대에서 내려온다
  const junk = H.offers.find(x => x <= -2); Rules.handle(W, H.id, { t: 'pick', item: junk });
  assert.equal(H.item, junk); assert.equal(H.perch, -1); assert.ok(W.events.some(e => e.k === 'unperched' && e.to === H.id));
  Rules.handle(W, H.id, { t: 'perch', s: empty.id }); assert.equal(H.perch, -1, 'junk cannot stand on a pedestal');
  assert.ok(!Rules.correctAt(W, H), 'junk never earns the science bonus');
});

test('stamp gun: real objects cost hunter HP, mimics lose HP and heal the hunter, four hits catch with assist', () => {
  const W = world(4, 2); const [H] = hiders(W), [S1, S2] = seekers(W);
  const f = pickSci(W, H); placeIn(W, H, roomCell(W, MM.ITEMS[f].room)); toSeek(W);
  // 진짜 전시물
  const real = W.museum.stands.find(s => s.item >= 0 && !W.occupied.has(s.id)); standNear(W, S1, real.x + 0.5, real.y + 0.5);
  fire(W, S1, 's:' + real.id);
  assert.equal(S1.hp, 100 - Rules.REAL_COST); assert.equal(S1.stats.realShots, 1); assert.equal(S1.score, -3);
  assert.ok(W.events.some(e => e.k === 'real' && e.by === S1.id && e.ref === 's:' + real.id));
  // 가구도 진짜
  const d = W.museum.decor.findIndex(dd => Museum.cellIndexAt(dd.x, dd.y) !== W.museum.lobby); standNear(W, S1, W.museum.decor[d].x + 0.5, W.museum.decor[d].y + 0.5);
  fire(W, S1, 'd:' + d); assert.equal(S1.stats.realShots, 2);
  // 미믹: S2가 한 번, S1이 세 번
  standNear(W, S2, H.x, H.y); fire(W, S2, 'm:' + H.id);
  assert.equal(H.hp, Rules.ITEM_HP - Rules.DMG); assert.ok(W.events.some(e => e.k === 'hit' && e.id === H.id));
  standNear(W, S1, H.x, H.y); const hpBefore = S1.hp;
  for (let k = 0; k < 3; k++) fire(W, S1, 'm:' + H.id);
  assert.equal(H.state, 'caught'); assert.equal(S1.stats.catches, 1); assert.equal(S2.stats.assists, 1);
  assert.equal(S1.hp, Math.min(100, hpBefore + 2 * Rules.HEAL), 'two non-final hits healed');
  const ev = W.events.find(e => e.k === 'caught'); assert.equal(ev.ok, true); assert.deepEqual([...ev.assists], [S2.id]);
  assert.equal(W.log.length, 0, 'correct hiding is not an error');
  assert.ok(W.events.some(e => e.k === 'offer' && e.to === H.id), 'caught mimic gets new offers');
  Rules.handle(W, H.id, { t: 'pick', item: H.offers[0] });
  for (let i = 0; i < 12; i++) Rules.tick(W, 0.5);
  assert.equal(H.state, 'alive'); assert.ok(W.events.some(e => e.k === 'respawn' && e.id === H.id));
  // 막 나타난 미믹은 보호
  W.events.length = 0; standNear(W, S1, H.x, H.y); H.immuneUntil = W.elapsed + 3;
  fire(W, S1, 'm:' + H.id); assert.equal(H.hp, H.maxHp); assert.ok(W.events.some(e => e.k === 'shield'));
});

test('stamp gun: rate limit, range and walls are enforced; no shooting while blind', () => {
  const W = world(4, 2); const [S] = seekers(W);
  const real = W.museum.stands.find(s => s.item >= 0);
  standNear(W, S, real.x + 0.5, real.y + 0.5);
  Rules.handle(W, S.id, { t: 'shoot', ref: 's:' + real.id }); assert.equal(S.stats.realShots, 0, 'hide phase');
  toSeek(W); standNear(W, S, real.x + 0.5, real.y + 0.5);
  for (let k = 0; k < 8; k++) Rules.handle(W, S.id, { t: 'shoot', ref: 's:' + real.id });
  assert.equal(S.stats.realShots, 3, 'burst limited to 3');
  Rules.handle(W, S.id, { t: 'pos', x: S.x, y: S.y, a: 0, sh: ['s:' + real.id] }); assert.equal(S.stats.realShots, 3);
  Rules.tick(W, 0.31); Rules.handle(W, S.id, { t: 'pos', x: S.x, y: S.y, a: 0, sh: ['s:' + real.id] }); assert.equal(S.stats.realShots, 4, 'shots ride on position messages');
  const far = W.museum.stands.find(s => s.item >= 0 && Math.hypot(s.x - S.x, s.y - S.y) > 13);
  if (far) { Rules.tick(W, 1); Rules.handle(W, S.id, { t: 'shoot', ref: 's:' + far.id }); assert.equal(S.stats.realShots, 4, 'out of range'); }
});

test('hunter at 0 HP goes to the guard room and comes back full', () => {
  const W = world(4, 2); const [S] = seekers(W); toSeek(W);
  const real = W.museum.stands.find(s => s.item >= 0); standNear(W, S, real.x + 0.5, real.y + 0.5);
  const need = Math.ceil(100 / Rules.REAL_COST);
  for (let k = 0; k < need; k++) fire(W, S, 's:' + real.id);
  assert.ok(S.jailUntil > W.elapsed); assert.ok(W.events.some(e => e.k === 'jail' && e.id === S.id));
  const n = S.stats.realShots; fire(W, S, 's:' + real.id); assert.equal(S.stats.realShots, n, 'no shooting in jail');
  for (let i = 0; i < 24; i++) Rules.tick(W, 0.5);
  assert.equal(S.hp, 100); assert.ok(W.events.some(e => e.k === 'free' && e.id === S.id));
});

test('a hit mimic that gets away heals fully and earns an escape bonus', () => {
  const W = world(4, 2); const [H] = hiders(W), [S] = seekers(W);
  pickSci(W, H); placeIn(W, H, roomCell(W, MM.ITEMS[H.item].room)); toSeek(W);
  standNear(W, S, H.x, H.y); fire(W, S, 'm:' + H.id); assert.equal(H.hp, Rules.ITEM_HP - Rules.DMG);
  const sc = H.score; for (let i = 0; i < 18; i++) Rules.tick(W, 0.5);
  assert.equal(H.hp, H.maxHp); assert.equal(H.stats.escapes, 1); assert.ok(W.events.some(e => e.k === 'escape' && e.id === H.id));
  assert.ok(H.score >= sc + 15 + 8);
});

test('auto taunts, closing time, whistle and scoring across a full round with rotation', () => {
  const W = world(4, 2, { rounds: 2, seekTime: 60 }); const [H1, H2] = hiders(W), [S] = seekers(W);
  pickSci(W, H1); placeIn(W, H1, roomCell(W, MM.ITEMS[H1.item].room));
  const f2 = pickSci(W, H2); placeIn(W, H2, W.museum.cells.find(c => c.kind === 'room' && c.room !== MM.ITEMS[f2].room));
  toSeek(W);
  const taunts = { [H1.id]: 0, [H2.id]: 0 }; let closing = 0;
  for (let i = 0; i < 121; i++) { Rules.tick(W, 0.5); for (const e of W.events) { if (e.k === 'taunt') taunts[e.id]++; if (e.k === 'closing') closing++; } W.events.length = 0; }
  assert.equal(closing, 1);
  for (const id in taunts) assert.ok(taunts[id] >= 2 && taunts[id] <= 7, `taunts ${taunts[id]}`);
  assert.equal(W.phase, 'result');
  assert.ok(Math.abs(H1.score - 120) < 2, `H1 = 60 s alive + 60 s correct bonus: ${H1.score}`);
  assert.ok(Math.abs(H2.score - 60) < 2, `H2 = 60 s alive only: ${H2.score}`);
  assert.ok(W.log.some(l => l.type === 'hideWrong' && l.name === H2.name && !l.caught));
  while (W.phase === 'result') Rules.tick(W, 0.5);
  assert.equal(W.round, 2); assert.equal(S.role, 'hide'); assert.equal(H1.role, 'seek');
  // 2라운드: 호루라기와 직접 도발
  const [M] = hiders(W).filter(p => p.id === S.id); pickSci(W, M); toSeek(W);
  Rules.handle(W, H1.id, { t: 'whistle' }); Rules.handle(W, H1.id, { t: 'whistle' });
  assert.equal(W.events.filter(e => e.k === 'whistle').length, 1); assert.ok(W.events.some(e => e.k === 'cool'));
  assert.ok(W.events.some(e => e.k === 'taunt' && e.id === M.id && e.auto === 1 && e.dl > 0));
  W.events.length = 0; const before = M.score;
  Rules.handle(W, M.id, { t: 'taunt' }); Rules.handle(W, M.id, { t: 'taunt' });
  assert.equal(W.events.filter(e => e.k === 'taunt').length, 1, 'taunt cooldown'); assert.ok(Math.abs(M.score - before - 10) < 0.01);
  W.events.length = 0; Rules.finish(W);
  const end = W.events.find(e => e.k === 'end'); assert.equal(W.phase, 'over');
  assert.equal(end.players.length, 4); assert.equal(end.scores.length, 2); assert.ok(Array.isArray(end.shots));
});

test('four-team schedule gives every team the same number of hiding rounds', () => {
  const W = world(8, 4, { rounds: 4 }); const count = [0, 0, 0, 0];
  for (let r = 1; r <= 4; r++) { for (const t of Rules.hiderTeams(W, r)) count[t]++; }
  assert.deepEqual(count, [2, 2, 2, 2]);
  const W3 = world(6, 3, { rounds: 3 }); const c3 = [0, 0, 0];
  for (let r = 1; r <= 3; r++) for (const t of Rules.hiderTeams(W3, r)) c3[t]++;
  assert.deepEqual(c3, [1, 1, 1]);
});

test('a student who joins mid-round gets a role, offers and protection', () => {
  const W = world(4, 2); toSeek(W);
  const P1 = Rules.addPlayer(W, 'late', '늦게', 0);
  assert.equal(P1.role, W.info.hiders.includes(0) ? 'hide' : 'seek');
  if (P1.role === 'hide') { assert.equal(P1.offers.length, 3); assert.ok(P1.immuneUntil > W.elapsed); assert.ok(Number.isFinite(P1.nextTaunt)); }
  const snap = Rules.snapshot(W); assert.ok(snap.p.some(p => p[0] === 'late'));
});

test('a mimic caught while running is not logged as a wrong hiding place', () => {
  const W = world(4, 2); const [H] = hiders(W), [S] = seekers(W);
  pickSci(W, H); toSeek(W);
  placeIn(W, H, W.museum.cells.find(c => c.kind === 'room' && c.room !== MM.ITEMS[H.item].room));
  standNear(W, S, H.x, H.y);
  for (let k = 0; k < 4; k++) { Rules.tick(W, 0.35); H.movedAt = W.elapsed; Rules.handle(W, S.id, { t: 'shoot', ref: 'm:' + H.id }); }
  assert.equal(H.state, 'caught');
  const ev = W.events.find(e => e.k === 'caught'); assert.equal(ev.still, false); assert.equal(ev.ok, false);
  assert.equal(W.log.length, 0);
});

test('practice seek: robot mimics hide in rooms, flee when hit, and show as moving', () => {
  const W = Rules.create({ seekTime: 90, beepEvery: 20, rounds: 1, resultTime: 3 }); W.practice = 'seek';
  Rules.addPlayer(W, 'me', '나', 0); Rules.addBots(W, 6, 'hide'); Rules.startGame(W, 99);
  const me = W.players.get('me'); assert.equal(me.role, 'seek');
  const bots = [...W.players.values()].filter(p => p.bot);
  assert.equal(bots.length, 6);
  for (const b of bots) { assert.notEqual(b.item, -1); assert.ok(Museum.cellAt(b.x, b.y).kind !== 'lobby'); }
  assert.ok(bots.some(b => b.item >= 0));
  toSeek(W);
  const b = bots.find(x => x.state === 'alive'); standNear(W, me, b.x, b.y);
  fire(W, me, b.perch >= 0 ? 's:' + b.perch : 'm:' + b.id);
  assert.equal(b.hp, b.maxHp - Rules.DMG); assert.ok(b.brain && b.brain.flee && b.brain.path && b.brain.path.length > 0, 'robot runs away');
  Rules.tick(W, 0.1); const snap = Rules.snapshot(W); const row = snap.p.find(p => p[0] === b.id); assert.ok(row[7] & 32, 'moving flag');
  for (let i = 0; i < 200 && b.brain && b.brain.path; i++) Rules.tick(W, 0.1);
  assert.ok(b.brain && !b.brain.path, 'robot reached a new hiding place within 20 s');
  assert.ok(Math.hypot(b.x - me.x, b.y - me.y) > 4, 'and it is away from the hunter');
});

test('practice hide: robot hunters roam, shoot and catch a mimic that keeps moving', () => {
  const W = Rules.create({ seekTime: 150, beepEvery: 30, rounds: 1, resultTime: 3, hideTime: 25 }); W.practice = 'hide';
  Rules.addPlayer(W, 'me', '나', 0); Rules.addBots(W, 3, 'seek'); Rules.startGame(W, 7);
  const H = W.players.get('me'); assert.equal(H.role, 'hide');
  const bots = [...W.players.values()].filter(p => p.bot); assert.equal(bots.length, 3); for (const b of bots) assert.equal(b.role, 'seek');
  pickSci(W, H); placeIn(W, H, roomCell(W, MM.ITEMS[H.item].room)); toSeek(W);
  const start = bots.map(b => [b.x, b.y]); let shots = 0, hits = 0, caughtN = 0;
  // 미믹이 계속 방 안을 왔다 갔다 한다
  const cell = Museum.cellAt(H.x, H.y); let dir = 1;
  for (let i = 0; i < 1400 && W.phase === 'seek'; i++) {
    if (H.state === 'alive') { const nx = H.x + dir * 0.25; if (nx < cell.x0 + 0.6 || nx > cell.x1 + 0.4 || Museum.hits(nx, H.y, 0.28)) dir = -dir; else Rules.handle(W, H.id, { t: 'pos', x: nx, y: H.y, a: 0 }); }
    else if (H.item === -1) Rules.handle(W, H.id, { t: 'pick', item: H.offers[0] });
    Rules.tick(W, 0.1);
    for (const e of W.events) { if (e.k === 'real') shots++; if (e.k === 'hit') hits++; if (e.k === 'caught') caughtN++; }
    W.events.length = 0;
  }
  assert.ok(bots.some((b, k) => Math.hypot(b.x - start[k][0], b.y - start[k][1]) > 3), 'robots walked away from the lobby');
  assert.ok(shots + hits + caughtN > 0, 'robots shot at things');
  assert.ok(caughtN >= 1, 'a mimic that keeps moving gets caught');
});
