// 규칙·지도·콘텐츠 검사 — 별도 설치 없이 node --test tests/ 로 돈다
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function load() {
  const s = { console, Math, Map, Set, JSON, Date }; s.window = s; vm.createContext(s);
  for (const f of ['js/content.js', 'js/museum.js', 'js/rules.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), s, { filename: f });
  return s;
}
const ctx = load();
const { MM, Museum, Rules } = ctx;

function world(nPlayers, teams, extra) {
  const W = Rules.create({ teams, rounds: 4, hideTime: 10, seekTime: 60, beepEvery: 20, hearts: 3, resultTime: 5, ...(extra || {}) });
  for (let i = 0; i < nPlayers; i++) Rules.addPlayer(W, 'p' + i, '학생' + i, i % teams);
  Rules.startGame(W, 12345);
  return W;
}
const P = (W, id) => W.players.get(id);
const hiders = W => [...W.players.values()].filter(p => p.role === 'hide');
const seekers = W => [...W.players.values()].filter(p => p.role === 'seek');
function toSeek(W) { while (W.phase === 'hide') Rules.tick(W, 0.5); W.events.length = 0; }
function pickAndPerch(W, H, correct) {
  Rules.handle(W, H.id, { t: 'pick', item: H.offers[0] });
  const it = MM.ITEMS[H.item];
  const s = W.museum.stands.find(s => s.item < 0 && !W.occupied.has(s.id) && (correct ? s.room === it.room : s.room !== it.room));
  const off = Museum.stepOff(s, null); H.x = off.x; H.y = off.y;
  Rules.handle(W, H.id, { t: 'perch', s: s.id });
  return s;
}

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

test('museum: 300 random layouts are connected, deterministic, and every room has 2+ empty stands', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = Museum._rng(seed); const wings = Museum._shuffle(MM.WINGS.map(w => w.id), r), pick = []; let rooms = 0;
    for (const id of wings) { const w = MM.WING_BY_ID[id]; if (pick.some(p => w.conflicts.includes(p))) continue; if (rooms + w.rooms.length > 17) continue; pick.push(id); rooms += w.rooms.length; if (rooms >= 12) break; }
    const m = Museum.generate({ seed, wings: pick }); Museum.use(m);
    const seen = Museum.reachable();
    for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) if (m.grid[y * m.W + x] === 0 && m.cellOf[y * m.W + x] >= 0) assert.ok(seen[y * m.W + x], `isolated floor seed ${seed}`);
    for (const st of m.stands) assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(st.y + dy) * m.W + st.x + dx]), `stand unreachable ${seed}`);
    m.cells.forEach((c, ci) => { if (c.kind === 'room') assert.ok(m.stands.filter(s => s.cell === ci && s.item < 0).length >= 2, `${seed} ${c.name}`); });
    assert.equal(JSON.stringify(Museum.generate({ seed, wings: pick }).stands), JSON.stringify(m.stands));
  }
});

test('rules: 4 teams of 4 — two teams hide, offers are 3 undisplayed items from different rooms', () => {
  const W = world(16, 4);
  assert.deepEqual([...W.info.hiders], [0, 1]);
  assert.equal(hiders(W).length, 8);
  const displayed = new Set(W.museum.stands.filter(s => s.item >= 0).map(s => s.item));
  const all = [];
  for (const H of hiders(W)) {
    assert.equal(H.offers.length, 3);
    assert.equal(new Set(H.offers.map(i => MM.ITEMS[i].room)).size, 3);
    for (const i of H.offers) { assert.ok(!displayed.has(i)); assert.ok(W.museum.cells.some(c => c.room === MM.ITEMS[i].room)); all.push(i); }
  }
  assert.equal(new Set(all).size, all.length, 'no two hiders are offered the same exhibit');
  const wings = W.info.wings.map(id => MM.WING_BY_ID[id]);
  for (const a of wings) for (const b of wings) assert.ok(!a.conflicts.includes(b.id));
});

test('rules: perch only on an empty stand within reach; tagging a correctly hidden mimic scores and respawns it', () => {
  const W = world(4, 2); const [H] = hiders(W), [S] = seekers(W);
  Rules.handle(W, H.id, { t: 'pick', item: H.offers[0] });
  const real = W.museum.stands.find(s => s.item >= 0);
  H.x = real.x + 0.5; H.y = real.y + 1.5; Rules.handle(W, H.id, { t: 'perch', s: real.id });
  assert.equal(H.perch, -1, 'cannot perch on a real exhibit');
  const st = pickAndPerch(W, H, true);
  assert.equal(H.perch, st.id); assert.ok(Rules.correctAt(W, H));
  Rules.handle(W, S.id, { t: 'tag', x: st.x + 0.5, y: st.y + 0.5 });
  assert.equal(H.state, 'alive', 'no tagging during hide phase');
  toSeek(W);
  S.x = st.x + 0.5; S.y = st.y + 2.2;
  Rules.tick(W, 5);
  const before = H.score;
  Rules.handle(W, S.id, { t: 'tag', x: st.x + 0.5, y: st.y + 0.5 });
  assert.equal(H.state, 'caught'); assert.equal(S.stats.catches, 1); assert.equal(S.score, 60); assert.equal(H.score, before - 30);
  const ev = W.events.find(e => e.k === 'caught'); assert.equal(ev.ok, true);
  assert.equal(W.log.length, 0, 'correct hiding is not an error');
  assert.ok(W.events.some(e => e.k === 'offer' && e.to === H.id), 'caught mimic gets new offers');
  Rules.handle(W, H.id, { t: 'pick', item: H.offers[1] });
  for (let i = 0; i < 12; i++) Rules.tick(W, 0.5);
  assert.equal(H.state, 'alive'); assert.ok(W.events.some(e => e.k === 'respawn' && e.id === H.id));
  // 막 나타난 미믹은 5초 보호
  W.events.length = 0; S.x = H.x + 1; S.y = H.y; S.lastTag = -9;
  Rules.handle(W, S.id, { t: 'tag', x: H.x, y: H.y });
  assert.equal(H.state, 'alive'); assert.ok(W.events.some(e => e.k === 'miss' && e.why === 'immune'));
});

test('rules: wrong room is logged; tagging a real exhibit costs a heart, and 0 hearts sends the seeker to jail', () => {
  const W = world(4, 2); const [H] = hiders(W), [S] = seekers(W);
  const st = pickAndPerch(W, H, false); toSeek(W);
  S.x = st.x + 0.5; S.y = st.y + 2; Rules.handle(W, S.id, { t: 'tag', x: st.x + 0.5, y: st.y + 0.5 });
  assert.equal(W.log[0].type, 'hideWrong'); assert.equal(W.log[0].caught, true);
  const real = W.museum.stands.filter(s => s.item >= 0);
  for (let k = 0; k < 3; k++) { const r = real[k]; S.x = r.x + 0.5; S.y = r.y + 1.8; Rules.tick(W, 2); Rules.handle(W, S.id, { t: 'tag', x: r.x + 0.5, y: r.y + 0.5 }); }
  assert.equal(S.hearts, 0); assert.equal(S.stats.wrongTags, 3); assert.ok(S.jailUntil > W.elapsed);
  assert.ok(W.events.some(e => e.k === 'jail' && e.id === S.id));
  assert.equal(S.score, 60 - 45 - 20);
  for (let i = 0; i < 30; i++) Rules.tick(W, 0.5);
  assert.equal(S.hearts, 3); assert.ok(W.events.some(e => e.k === 'free' && e.id === S.id));
});

test('rules: tag cooldown stops spamming; far tags do nothing', () => {
  const W = world(4, 2); const [S] = seekers(W); toSeek(W);
  const r = W.museum.stands.find(s => s.item >= 0); S.x = r.x + 0.5; S.y = r.y + 1.8;
  Rules.handle(W, S.id, { t: 'tag', x: r.x + 0.5, y: r.y + 0.5 }); Rules.handle(W, S.id, { t: 'tag', x: r.x + 0.5, y: r.y + 0.5 });
  assert.equal(S.stats.wrongTags, 1);
  Rules.tick(W, 2); S.x = r.x + 0.5; S.y = r.y + 8; Rules.handle(W, S.id, { t: 'tag', x: r.x + 0.5, y: r.y + 0.5 });
  assert.equal(S.stats.wrongTags, 1);
});

test('rules: survival points, correct-room bonus, beeps, whistle cooldown, round rotation and final results', () => {
  const W = world(4, 2, { rounds: 2 }); const [H1, H2] = hiders(W), [S] = seekers(W);
  pickAndPerch(W, H1, true); pickAndPerch(W, H2, false); toSeek(W);
  let beeps = 0;
  for (let i = 0; i < 40; i++) { Rules.tick(W, 0.5); beeps += W.events.filter(e => e.k === 'beep').length; W.events.length = 0; }
  assert.equal(beeps, 1, 'one beep every 20 s');
  assert.ok(Math.abs(H1.score - 20) < 0.6 && Math.abs(H2.score - 20) < 0.6);
  Rules.handle(W, S.id, { t: 'whistle' }); Rules.handle(W, S.id, { t: 'whistle' });
  assert.equal(W.events.filter(e => e.k === 'whistle').length, 1); assert.ok(W.events.some(e => e.k === 'cool'));
  assert.ok(W.events.some(e => e.k === 'beep' && e.loud));
  W.events.length = 0;
  Rules.handle(W, H1.id, { t: 'taunt' }); assert.ok(Math.abs(H1.score - 30) < 0.6);
  while (W.phase === 'seek') Rules.tick(W, 0.5);
  const rend = W.events.find(e => e.k === 'rend');
  assert.ok(rend.hiders.find(h => h.id === H1.id).ok && !rend.hiders.find(h => h.id === H2.id).ok);
  assert.ok(Math.abs(H1.score - (60 + 10 + 60)) < 1.5, 'H1 = 60 s + taunt + 60 s bonus');
  assert.ok(W.log.some(l => l.type === 'hideWrong' && l.name === H2.name && !l.caught));
  while (W.phase === 'result') Rules.tick(W, 0.5);
  assert.equal(W.round, 2); assert.equal(S.role, 'hide'); assert.equal(H1.role, 'seek');
  W.events.length = 0; Rules.finish(W);
  const end = W.events.find(e => e.k === 'end'); assert.equal(W.phase, 'over');
  assert.equal(end.players.length, 4); assert.equal(end.scores.length, 2);
});

test('rules: four-team schedule gives every team the same number of hiding rounds', () => {
  const W = world(8, 4, { rounds: 4 }); const count = [0, 0, 0, 0];
  for (let r = 1; r <= 4; r++) { for (const t of Rules.hiderTeams(W, r)) count[t]++; }
  assert.deepEqual(count, [2, 2, 2, 2]);
  const W3 = world(6, 3, { rounds: 3 }); const c3 = [0, 0, 0];
  for (let r = 1; r <= 3; r++) for (const t of Rules.hiderTeams(W3, r)) c3[t]++;
  assert.deepEqual(c3, [1, 1, 1]);
});

test('rules: a student who joins mid-round gets a role, offers and protection', () => {
  const W = world(4, 2); toSeek(W);
  const P1 = Rules.addPlayer(W, 'late', '늦게', 0);
  assert.equal(P1.role, W.info.hiders.includes(0) ? 'hide' : 'seek');
  if (P1.role === 'hide') { assert.equal(P1.offers.length, 3); assert.ok(P1.immuneUntil > W.elapsed); }
  const snap = Rules.snapshot(W); assert.ok(snap.p.some(p => p[0] === 'late'));
});

test('rules: practice — bots hide on stands at once; hide practice grades each perch', () => {
  const W = Rules.create({ seekTime: 60, beepEvery: 20, rounds: 1, resultTime: 3 }); W.practice = 'seek';
  Rules.addPlayer(W, 'me', '나', 0); Rules.addBots(W, 6); Rules.startGame(W, 99);
  assert.equal(P(W, 'me').role, 'seek');
  const bots = [...W.players.values()].filter(p => p.bot);
  assert.equal(bots.length, 6); for (const b of bots) { assert.ok(b.perch >= 0); assert.ok(b.item >= 0); }
  const W2 = Rules.create({ seekTime: 60, rounds: 1, resultTime: 3 }); W2.practice = 'hide';
  Rules.addPlayer(W2, 'me', '나', 0); Rules.startGame(W2, 7);
  const H = P(W2, 'me'); assert.equal(H.role, 'hide');
  pickAndPerch(W2, H, true);
  assert.ok(W2.events.some(e => e.k === 'check' && e.ok === true));
  for (let i = 0; i < 12; i++) Rules.tick(W2, 0.5);
  assert.equal(H.perch, -1); assert.equal(H.item, -1); assert.equal(H.offers.length, 3);
});

test('rules: a mimic caught while walking is not logged as a wrong hiding place', () => {
  const W = world(4, 2); const [H] = hiders(W), [S] = seekers(W);
  Rules.handle(W, H.id, { t: 'pick', item: H.offers[0] }); toSeek(W);
  const c = W.museum.cells.find(c => c.kind === 'room' && c.room !== MM.ITEMS[H.item].room);
  H.x = c.x0 + 3.5; H.y = c.y0 + 3.5; S.x = H.x + 1.5; S.y = H.y;
  Rules.handle(W, S.id, { t: 'tag', x: H.x, y: H.y });
  assert.equal(H.state, 'caught');
  const ev = W.events.find(e => e.k === 'caught'); assert.equal(ev.perched, false); assert.equal(ev.ok, false);
  assert.equal(W.log.length, 0);
});
