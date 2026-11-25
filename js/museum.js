// 과학관 지도 — 시드 하나로 교사와 학생 기기가 똑같은 건물을 만든다.
// 방(칸) 격자: 칸 하나의 안쪽은 8×8 타일, 벽 두께 1. 가운데 칸이 중앙 로비(시작 위치).
// 타일: 0 바닥, 1 벽, 2 받침대(지나갈 수 없지만 시야는 막지 않음), 3 가구
window.Museum = (function () {
  const IN = 8, P = IN + 1;
  const T_FLOOR = 0, T_WALL = 1, T_STAND = 2, T_DECOR = 3;
  let M = null;

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // 칸 수(가로×세로): 전시실 수 + 로비 + 쉬는 공간 1개 이상
  function gridFor(nRooms) {
    for (const [c, r] of [[3, 3], [4, 3], [4, 4], [5, 4], [6, 4], [6, 5], [7, 5]]) if (c * r >= nRooms + 2) return { cols: c, rows: r };
    return { cols: 7, rows: 5 };
  }

  // params: { seed, wings:[전시동 id...], cols, rows }
  function generate(params) {
    const r = rng(params.seed * 7919 + 17);
    const wings = params.wings.map(id => MM.WING_BY_ID[id]).filter(Boolean);
    const roomList = []; for (const w of wings) for (const ri of w.roomIdx) roomList.push(ri);
    const cols = params.cols || gridFor(roomList.length).cols, rows = params.rows || gridFor(roomList.length).rows;
    const W = cols * P + 1, H = rows * P + 1;
    const grid = new Uint8Array(W * H).fill(T_WALL);
    const cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push({ i, j, x0: i * P + 1, y0: j * P + 1, x1: i * P + IN, y1: j * P + IN, kind: "rest", room: -1, wing: null, name: "", doors: [] });
    const cellIdx = (i, j) => j * cols + i;
    const lobby = cellIdx(Math.floor((cols - 1) / 2), Math.floor((rows - 1) / 2));
    cells[lobby].kind = "lobby"; cells[lobby].name = "중앙 로비";

    // 뱀 모양 순서로 칸을 훑으며 전시동을 붙여 배치(같은 전시동 방이 이웃하게)
    const order = [];
    const byCol = r() < 0.5, revOuter = r() < 0.5, revInner = r() < 0.5;
    const A = byCol ? cols : rows, B = byCol ? rows : cols;
    for (let a0 = 0; a0 < A; a0++) {
      const a = revOuter ? A - 1 - a0 : a0;
      for (let b0 = 0; b0 < B; b0++) { const b = ((a0 % 2 === 1) !== revInner) ? B - 1 - b0 : b0; const id = byCol ? cellIdx(a, b) : cellIdx(b, a); if (id !== lobby) order.push(id); }
    }
    let rest = order.length - roomList.length;
    const restNames = shuffle(MM.REST.filter(x => x.id !== "lobby").map(x => x.name), r);
    let k = 0, restUsed = 0;
    const gaps = wings.length + 1;
    const putRest = () => { const c = cells[order[k++]]; c.kind = "rest"; c.name = restNames[restUsed++ % restNames.length]; rest--; };
    for (let wi = 0; wi < wings.length; wi++) {
      const want = Math.floor(rest / Math.max(1, gaps - wi)); for (let n = 0; n < want && rest > 0 && r() < 0.8; n++) putRest();
      for (const ri of wings[wi].roomIdx) { const c = cells[order[k++]]; c.kind = "room"; c.room = ri; c.wing = wings[wi].id; c.name = MM.ROOMS[ri].name; }
    }
    while (k < order.length) putRest();

    // 칸 안쪽을 바닥으로
    for (const c of cells) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) grid[y * W + x] = T_FLOOR;

    // 문: 로비에서 시작하는 무작위 신장 트리 + 고리를 만드는 문 몇 개
    const edges = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { if (i + 1 < cols) edges.push([cellIdx(i, j), cellIdx(i + 1, j)]); if (j + 1 < rows) edges.push([cellIdx(i, j), cellIdx(i, j + 1)]); }
    const key = (a, b) => a < b ? a + "," + b : b + "," + a;
    const open = new Set(), seen = new Set([lobby]);
    const stack = [lobby];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const nb = shuffle(edges.filter(([a, b]) => (a === cur && !seen.has(b)) || (b === cur && !seen.has(a))), r);
      if (!nb.length) { stack.pop(); continue; }
      const [a, b] = nb[0], nxt = a === cur ? b : a; open.add(key(a, b)); seen.add(nxt); stack.push(nxt);
    }
    for (const [a, b] of edges) {
      if (open.has(key(a, b))) continue;
      const sameWing = cells[a].wing && cells[a].wing === cells[b].wing;
      if (a === lobby || b === lobby || r() < (sameWing ? 0.55 : 0.3)) open.add(key(a, b));
    }
    const doorTiles = [];
    for (const [a, b] of edges) {
      if (!open.has(key(a, b))) continue;
      const A_ = cells[a], B_ = cells[b], off = 2 + Math.floor(r() * 3);
      if (B_.i === A_.i + 1) { const x = A_.x1 + 1; for (let d = 0; d < 2; d++) { const y = A_.y0 + off + d; grid[y * W + x] = T_FLOOR; doorTiles.push({ x, y, a, b, inA: { x: x - 1, y }, inB: { x: x + 1, y } }); } A_.doors.push("E"); B_.doors.push("W"); }
      else { const y = A_.y1 + 1; for (let d = 0; d < 2; d++) { const x = A_.x0 + off + d; grid[y * W + x] = T_FLOOR; doorTiles.push({ x, y, a, b, inA: { x, y: y - 1 }, inB: { x, y: y + 1 } }); } A_.doors.push("S"); B_.doors.push("N"); }
    }
    // 문 바로 안쪽 칸과 그 둘레(체비쇼프 거리 1)는 비워 둔다
    const nearDoor = (x, y) => doorTiles.some(d => Math.max(Math.abs(d.inA.x - x), Math.abs(d.inA.y - y)) <= 1 || Math.max(Math.abs(d.inB.x - x), Math.abs(d.inB.y - y)) <= 1);

    // 받침대와 전시물
    // 받침대 자리: 벽에 붙은 자리 10곳 + 안쪽 섬 4곳 (사이사이가 통로)
    const RING = [[1, 0], [3, 0], [6, 0], [7, 2], [7, 5], [6, 7], [4, 7], [1, 7], [0, 5], [0, 2]];
    const ISLE = [[2, 2], [5, 2], [2, 5], [5, 5]];
    const stands = [], decor = [], pool = {};
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci];
      if (c.kind === "room") {
        const room = MM.ROOMS[c.room];
        const wallSpots = shuffle(RING.map(([ix, iy]) => ({ x: c.x0 + ix, y: c.y0 + iy })).filter(p => !nearDoor(p.x, p.y)), r);
        const isles = shuffle(ISLE.map(([ix, iy]) => ({ x: c.x0 + ix, y: c.y0 + iy })).filter(p => !nearDoor(p.x, p.y)), r);
        // 벽 쪽 자리를 먼저 쓰고, 모자라면 섬 자리. 섬은 최소 1곳은 써서 방 가운데도 전시물이 보이게
        const cand = [...isles.slice(0, 1), ...wallSpots, ...isles.slice(1)];
        const items = shuffle(room.itemIdx.slice(), r);
        const nReal = Math.max(1, Math.min(items.length - 2, cand.length - 2, 6));
        const nStands = Math.min(cand.length, nReal + 3);
        for (let s = 0; s < nStands; s++) { const p = cand[s]; grid[p.y * W + p.x] = T_STAND; stands.push({ id: stands.length, x: p.x, y: p.y, cell: ci, room: c.room, item: s < nReal ? items[s] : -1 }); }
        pool[c.room] = items.slice(nReal);
      } else if (c.kind === "lobby") {
        const cx = c.x0 + 3, cy = c.y0 + 3;
        for (const [dx, dy, kind] of [[0, 0, "desk"], [1, 0, "desk"], [-2, 3, "bench"], [3, 3, "bench"], [-2, -2, "plant"], [3, -2, "plant"]]) { const x = cx + dx, y = cy + dy; if (x < c.x0 || x > c.x1 || y < c.y0 || y > c.y1 || nearDoor(x, y)) continue; grid[y * W + x] = T_DECOR; decor.push({ x, y, kind }); }
      } else {
        const spots = shuffle([[1, 1, "plant"], [6, 1, "plant"], [1, 6, "vending"], [6, 6, "plant"], [3, 3, "bench"], [4, 4, "bench"], [3, 6, "poster"], [5, 1, "poster"], [2, 3, "rope"]], r).slice(0, 4 + Math.floor(r() * 2));
        for (const [ix, iy, kind] of spots) { const x = c.x0 + ix, y = c.y0 + iy; if (nearDoor(x, y)) continue; grid[y * W + x] = T_DECOR; decor.push({ x, y, kind }); }
      }
    }

    // 표지판: 문이 없는 벽(없으면 문을 피한 자리)에 세 칸짜리
    const signs = new Map(), wallArt = new Map();
    for (let ci = 0; ci < cells.length; ci++) {
      const c = cells[ci];
      const sides = shuffle(["N", "S", "W", "E"], r).sort((a, b) => (c.doors.includes(a) ? 1 : 0) - (c.doors.includes(b) ? 1 : 0));
      for (const side of sides) {
        for (const start of [2, 3, 1, 4]) {
          const tiles = [];
          for (let k2 = 0; k2 < 3; k2++) {
            const t = start + k2;
            if (side === "N") tiles.push({ x: c.x0 + t, y: c.y0 - 1, face: "S", slice: k2 });
            if (side === "S") tiles.push({ x: c.x1 - t, y: c.y1 + 1, face: "N", slice: k2 });
            if (side === "W") tiles.push({ x: c.x0 - 1, y: c.y1 - t, face: "E", slice: k2 });
            if (side === "E") tiles.push({ x: c.x1 + 1, y: c.y0 + t, face: "W", slice: k2 });
          }
          if (tiles.some(t => grid[t.y * W + t.x] !== T_WALL)) continue;
          for (const t of tiles) signs.set(t.x + "," + t.y + "," + t.face, { cell: ci, slice: t.slice });
          c.sign = side; break;
        }
        if (c.sign) break;
      }
      if (c.kind === "rest") { // 쉬는 공간 벽에 액자 몇 개
        for (let n = 0; n < 3; n++) { const t = 1 + Math.floor(r() * 6); const opts = [{ x: c.x0 + t, y: c.y0 - 1, face: "S" }, { x: c.x1 - t, y: c.y1 + 1, face: "N" }]; const o = opts[Math.floor(r() * 2)]; const kk = o.x + "," + o.y + "," + o.face; if (grid[o.y * W + o.x] === T_WALL && !signs.has(kk)) wallArt.set(kk, 1 + Math.floor(r() * 5)); }
      }
    }

    // 시작 위치: 로비 바닥
    const L = cells[lobby], spawns = [];
    for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) if (grid[y * W + x] === T_FLOOR) spawns.push({ x: x + 0.5, y: y + 0.5 });
    shuffle(spawns, r);
    const cellOf = new Int16Array(W * H).fill(-1);
    cells.forEach((c, ci) => { for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) cellOf[y * W + x] = ci; });
    const standAt = new Map(stands.map(s => [s.y * W + s.x, s]));
    const roomCell = {}; cells.forEach((c, ci) => { if (c.kind === "room") roomCell[c.room] = ci; });
    return { seed: params.seed, wings: params.wings.slice(), cols, rows, W, H, grid, cells, lobby, stands, decor, signs, wallArt, spawns, pool, cellOf, standAt, roomCell, doorTiles };
  }

  // ---------- 지도 질의 ----------
  function use(m) { M = m; }
  function tile(x, y) { if (!M || x < 0 || y < 0 || x >= M.W || y >= M.H) return T_WALL; return M.grid[y * M.W + x]; }
  function solid(x, y) { return tile(x, y) !== T_FLOOR; }
  function opaque(x, y) { return tile(x, y) === T_WALL; }
  function cellAt(x, y) { if (!M) return null; x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= M.W || y >= M.H) return null; const ci = M.cellOf[y * M.W + x]; return ci >= 0 ? M.cells[ci] : null; }
  function cellIndexAt(x, y) { if (!M) return -1; x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= M.W || y >= M.H) return -1; return M.cellOf[y * M.W + x]; }
  function standAtTile(tx, ty) { return M ? M.standAt.get(ty * M.W + tx) || null : null; }
  function hits(cx, cy, rad) {
    const x0 = Math.floor(cx - rad), x1 = Math.floor(cx + rad), y0 = Math.floor(cy - rad), y1 = Math.floor(cy + rad);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = tile(x, y); if (t === T_FLOOR) continue;
      // 받침대·가구는 타일보다 조금 작은 원형으로 막는다(모서리에 덜 걸리게)
      if (t !== T_WALL) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d < rad + 0.36) return true; continue; }
      const nx = Math.max(x, Math.min(cx, x + 1)), ny = Math.max(y, Math.min(cy, y + 1));
      if ((nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad) return true;
    }
    return false;
  }
  function move(px, py, vx, vy, rad) {
    let nx = px + vx; if (!hits(nx, py, rad)) px = nx;
    let ny = py + vy; if (!hits(px, ny, rad)) py = ny;
    return { x: px, y: py };
  }
  function los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) * 3);
    for (let i = 1; i < n; i++) { const t = i / n; if (opaque(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false; }
    return true;
  }
  // 받침대에서 내려올 때 설 자리: 받침대 둘레의 빈 바닥 중 원하는 쪽에 가까운 곳
  function stepOff(stand, prefer) {
    let best = null, bd = 1e9;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = stand.x + dx, y = stand.y + dy; if (solid(x, y)) continue;
      const px = x + 0.5, py = y + 0.5; if (hits(px, py, 0.28)) continue;
      const d = prefer ? Math.hypot(px - prefer.x, py - prefer.y) : 0; if (d < bd) { bd = d; best = { x: px, y: py }; }
    }
    return best || { x: stand.x + 0.5, y: stand.y + 1.5 };
  }
  // 빈 바닥 칸 하나 (먼 곳 고르기용)
  function floorTiles() { const out = []; if (!M) return out; for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) if (M.grid[y * M.W + x] === T_FLOOR && M.cellOf[y * M.W + x] >= 0 && !hits(x + 0.5, y + 0.5, 0.3)) out.push({ x: x + 0.5, y: y + 0.5 }); return out; }
  // 로비에서 모든 칸에 갈 수 있는지(시험용)
  function reachable() {
    if (!M) return 0; const start = M.spawns[0]; const seen = new Uint8Array(M.W * M.H); const q = [[Math.floor(start.x), Math.floor(start.y)]]; seen[q[0][1] * M.W + q[0][0]] = 1; let qi = 0;
    while (qi < q.length) { const [x, y] = q[qi++]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= M.W || ny >= M.H || seen[ny * M.W + nx] || M.grid[ny * M.W + nx] !== T_FLOOR) continue; seen[ny * M.W + nx] = 1; q.push([nx, ny]); } }
    return seen;
  }
  return { generate, gridFor, use, get cur() { return M; }, tile, solid, opaque, cellAt, cellIndexAt, standAtTile, hits, move, los, stepOff, floorTiles, reachable, T_FLOOR, T_WALL, T_STAND, T_DECOR, IN, P, _rng: rng, _shuffle: shuffle };
})();
