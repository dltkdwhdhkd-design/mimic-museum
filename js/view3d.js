// 3D 화면 (Three.js) — 칸 지도로 전시관(바닥·벽·천장·표지판·그림)을 짓고,
// 블렌더 모델(assets/models/museum.glb: 받침대·가구·학예사·도장총)과 전시물 그림을 그린다.
// 규칙·네트워크는 2D 칸 좌표 그대로이고, 여기서는 칸 좌표 (x, y)를 3D (x, 높이, y)로 옮겨 그리기만 한다.
window.View3D = (function () {
  const WALL_H = 2.6, EYE = 1.45, PED_TOP = 0.87, ITEM = 0.62, LOOSE = 0.55;
  const SLOT = 128, ATL = 2048, PER = ATL / SLOT;
  const DECOR_KINDS = ["bench", "plant", "trash", "extinguisher", "poster", "vending", "rope", "desk"];
  const TEAM = [0xe2574c, 0x4a8fe2, 0x46b16a, 0xe0a63a];
  // 조준·그림자 크기: [반지름, 높이]
  const PICK = { pedestal: [0.34, PED_TOP], bench: [0.5, 0.52], plant: [0.3, 1.12], trash: [0.22, 0.64], extinguisher: [0.16, 0.68], poster: [0.34, 1.48], vending: [0.46, 1.84], rope: [0.46, 0.95], desk: [0.5, 0.95], curator: [0.3, 1.6] };
  const SHADOW = { pedestal: 0.5, bench: 0.62, plant: 0.34, trash: 0.28, extinguisher: 0.2, poster: 0.3, vending: 0.62, rope: 0.52, desk: 0.62, curator: 0.34, loose: 0.3 };
  let T = null, ADD = null;
  let renderer = null, scene = null, camera = null, gunScene = null, gunCam = null, gun = null, canvasEl = null;
  let failed = false, loadP = null, loaded = false, pending = null;
  const tpl = {}, matCache = new Map(), curMats = new Map();
  let world = null, batch = null, shadows = null, itemTex = null, itemCv = null, slots = new Map();
  const curators = new Map(), tags = new Map();
  let camD = 2.6, lastPick = null;

  // ---------- 준비 ----------
  function whenThree() { return new Promise(res => { if (window.THREE) return res(); window.addEventListener("three-ready", () => res(), { once: true }); }); }
  function init(canvas) {
    canvasEl = canvas;
    if (renderer) return true;
    if (failed || !window.THREE) return false;
    T = window.THREE; ADD = window.THREE_ADDONS;
    try { renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch (e) { failed = true; return false; }
    renderer.autoClear = false; renderer.info.autoReset = false; renderer.setClearColor(0x15130f);
    scene = new T.Scene(); scene.fog = new T.Fog(0x15130f, 11, 27);
    camera = new T.PerspectiveCamera(62, 1, 0.05, 40);
    scene.add(new T.HemisphereLight(0xfff3df, 0x6b5a46, 2.3));
    const key = new T.DirectionalLight(0xfff0d8, 1.25); key.position.set(0.35, 1, 0.55); scene.add(key);
    const fill = new T.DirectionalLight(0xdfe8ff, 0.45); fill.position.set(-0.6, 0.6, -0.4); scene.add(fill);
    gunScene = new T.Scene(); gunScene.add(new T.HemisphereLight(0xffffff, 0x5a4a3a, 2.4));
    const gl = new T.DirectionalLight(0xffffff, 1.4); gl.position.set(1, 2, 1.5); gunScene.add(gl);
    gunCam = new T.PerspectiveCamera(62, 1, 0.01, 5);
    return true;
  }
  function supported() { return !failed; }
  function load() {
    if (loadP) return loadP;
    loadP = (async () => {
      await whenThree(); T = window.THREE; ADD = window.THREE_ADDONS;
      const gltf = await new Promise((res, rej) => new ADD.GLTFLoader().load("assets/models/museum.glb?v=20261126", res, undefined, rej));
      prepare(gltf.scene);
      loaded = true;
      if (pending && renderer) { const M = pending; pending = null; setMuseum(M); }
    })();
    return loadP;
  }
  function lambert(m) {
    const name = (m && m.name) || "m"; if (matCache.has(name)) return matCache.get(name);
    const L = new T.MeshLambertMaterial({ color: m && m.color ? m.color.clone() : 0xffffff }); L.name = name;
    matCache.set(name, L); return L;
  }
  // node 아래 메시를 base 좌표계로 옮겨 재질별로 합친다 (skip: 따로 다룰 부위)
  function merged(node, base, skip) {
    const byMat = new Map();
    node.updateWorldMatrix(true, true);
    const inv = new T.Matrix4().copy(base.matrixWorld).invert();
    node.traverse(o => {
      if (!o.isMesh) return;
      for (let p = o; p && p !== node; p = p.parent) if (skip && skip(p)) return;
      const g = o.geometry.clone(); g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
      if (!g.index) { const n = g.attributes.position.count, idx = []; for (let i = 0; i < n; i++) idx.push(i); g.setIndex(idx); }
      const mat = Array.isArray(o.material) ? o.material[0] : o.material, key = mat.name;
      if (!byMat.has(key)) byMat.set(key, { mat, geos: [] });
      byMat.get(key).geos.push(g);
    });
    const geos = [], mats = [];
    for (const { mat, geos: gs } of byMat.values()) { geos.push(gs.length > 1 ? ADD.mergeGeometries(gs) : gs[0]); mats.push(lambert(mat)); }
    if (!geos.length) return null;
    const geo = ADD.mergeGeometries(geos, true); geo.computeBoundingSphere();
    return { geo, mats };
  }
  function prepare(root) {
    root.updateWorldMatrix(true, true);
    for (const node of root.children) {
      const name = node.name;
      if (name === "curator") {
        const parts = [];
        for (const ch of node.children) {
          if (ch.name === "curator__main") continue;
          const pn = ch.name.replace("curator__", "");
          const m = merged(ch, ch); if (m) parts.push({ name: pn, pos: ch.position.clone(), ...m });
        }
        const main = node.children.find(c => c.name === "curator__main");
        tpl.curator = { body: merged(main, node), parts };
      } else tpl[name] = merged(node, node);
    }
    // 1인칭 도장총
    if (tpl.stampgun) {
      gun = new T.Group();
      const mesh = new T.Mesh(tpl.stampgun.geo, tpl.stampgun.mats); mesh.rotation.y = Math.PI; mesh.scale.setScalar(0.74);
      gun.add(mesh); gun.visible = false; gunScene.add(gun);
    }
  }

  // ---------- 그림판 ----------
  function mk(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    return t;
  }
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // 벽: 왼쪽 반은 벽 무늬(걸레받이·징두리 판벽·띠·칠·천장 몰딩), 오른쪽 반은 흰색(색 띠용)
  function wallCanvas() {
    const c = mk(512, 512), g = c.getContext("2d"), W = 256, H = 512, y = m => H - m / WALL_H * H, r = rng(7);
    g.fillStyle = "#ebe4d6"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(90,70,40,${r() * 0.035})`; g.fillRect(r() * W, r() * H, 2, 2); }
    g.fillStyle = "#d9cdb6"; g.fillRect(0, y(1.0), W, y(0.12) - y(1.0));
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 3; g.strokeRect(22, y(0.9), W - 44, y(0.22) - y(0.9));
    g.strokeStyle = "rgba(90,70,40,0.25)"; g.lineWidth = 2; g.strokeRect(26, y(0.9) + 4, W - 52, y(0.22) - y(0.9) - 8);
    g.fillStyle = "#8a6848"; g.fillRect(0, y(1.07), W, y(1.0) - y(1.07)); g.fillStyle = "#a88462"; g.fillRect(0, y(1.07), W, 4);
    g.fillStyle = "#5a4330"; g.fillRect(0, y(0.13), W, H - y(0.13)); g.fillStyle = "#71553e"; g.fillRect(0, y(0.13), W, 5);
    g.fillStyle = "#f7f3ea"; g.fillRect(0, 0, W, y(2.42)); g.fillStyle = "rgba(0,0,0,0.08)"; g.fillRect(0, y(2.42) - 3, W, 3); g.fillRect(0, y(2.52), W, 2);
    g.fillStyle = "rgba(0,0,0,0.05)"; g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);
    g.fillStyle = "#ffffff"; g.fillRect(256, 0, 256, 512);
    return c;
  }
  // 바닥: [0,0.5) 원목 마루(2×2칸), [0.5,1) 대리석 바둑판(2×2칸)
  function floorCanvas() {
    const c = mk(1024, 512), g = c.getContext("2d"), r = rng(11);
    for (let row = 0; row < 16; row++) {
      let x = -(row % 2) * 60;
      while (x < 512) { const w = 90 + r() * 80, t = r(); g.fillStyle = `rgb(${Math.round(150 + t * 30)},${Math.round(104 + t * 22)},${Math.round(64 + t * 16)})`; g.fillRect(x, row * 32, w, 32); g.fillStyle = "rgba(60,35,15,0.35)"; g.fillRect(x, row * 32, 2, 32); x += w; }
      g.fillStyle = "rgba(60,35,15,0.35)"; g.fillRect(0, row * 32, 512, 2);
    }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(70,40,15,${r() * 0.08})`; g.fillRect(r() * 512, r() * 512, 8 + r() * 30, 1); }
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = 512 + i * 128, y = j * 128, light = (i + j) % 2 === 0;
      g.fillStyle = light ? "#ece6da" : "#c9c0b0"; g.fillRect(x, y, 128, 128);
      for (let k = 0; k < 7; k++) { g.strokeStyle = light ? "rgba(150,140,125,0.25)" : "rgba(255,255,255,0.18)"; g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x + r() * 128, y + r() * 128); g.bezierCurveTo(x + r() * 128, y + r() * 128, x + r() * 128, y + r() * 128, x + r() * 128, y + r() * 128); g.stroke(); }
      g.strokeStyle = "rgba(80,70,60,0.35)"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, 126, 126);
    }
    return c;
  }
  // 천장: 왼쪽 반은 흡음판, 오른쪽 반은 조명판
  function ceilCanvas() {
    const c = mk(512, 256), g = c.getContext("2d"), r = rng(5);
    g.fillStyle = "#d8d4cc"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.12})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
    g.strokeStyle = "#a9a49a"; g.lineWidth = 6; g.strokeRect(0, 0, 256, 256);
    g.fillStyle = "#b9b4aa"; g.fillRect(256, 0, 256, 256);
    const grd = g.createLinearGradient(0, 30, 0, 226); grd.addColorStop(0, "#fffdf2"); grd.addColorStop(1, "#fff6dc");
    g.fillStyle = grd; g.fillRect(282, 26, 204, 204);
    g.strokeStyle = "rgba(200,190,160,0.8)"; g.lineWidth = 3; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(282 + k * 51, 26); g.lineTo(282 + k * 51, 230); g.stroke(); }
    return c;
  }
  function splitName(n) { const m = n.match(/^(.*?)\s*(\(.*\))$/); if (m) return [m[1], m[2]]; if (n.length > 12) { const i = n.lastIndexOf(" ", 12); if (i > 0) return [n.slice(0, i), n.slice(i + 1)]; } return [n]; }
  // 표지판(512×128)과 액자 그림(256×192)을 한 장에 모은다
  function signAtlas(M) {
    const c = mk(2048, 2048), g = c.getContext("2d"), map = new Map(); let si = 0, ai = 0;
    M.cells.forEach((cell, ci) => {
      if (!cell.sign) return;
      const x = (si % 4) * 512, y = Math.floor(si / 4) * 128; si++;
      if (cell.kind === "room") {
        const room = MM.ROOMS[cell.room], acc = Art.wingColor(cell.wing), wing = MM.WING_BY_ID[room.wing];
        g.fillStyle = "#1e2430"; g.fillRect(x + 4, y + 4, 504, 120); g.fillStyle = acc; g.fillRect(x + 4, y + 4, 504, 10);
        g.strokeStyle = "#c9a24a"; g.lineWidth = 4; g.strokeRect(x + 6, y + 6, 500, 116);
        const lines = splitName(room.name); g.fillStyle = "#f6f2e8"; g.textAlign = "center"; g.textBaseline = "middle";
        if (lines.length === 1) { g.font = "bold 46px sans-serif"; g.fillText(lines[0], x + 256, y + 58, 470); }
        else { g.font = "bold 38px sans-serif"; g.fillText(lines[0], x + 256, y + 48, 470); g.font = "bold 24px sans-serif"; g.fillText(lines[1], x + 256, y + 84, 470); }
        g.fillStyle = "#c9b48a"; g.font = "20px sans-serif"; g.fillText(wing ? wing.name + " 전시동" : "", x + 256, y + 108, 470);
      } else {
        g.fillStyle = cell.kind === "lobby" ? "#3a2c1c" : "#4a3a2a"; g.fillRect(x + 40, y + 16, 432, 96); g.strokeStyle = "#c9a24a"; g.lineWidth = 4; g.strokeRect(x + 42, y + 18, 428, 92);
        g.fillStyle = "#f6f2e8"; g.font = "bold 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(cell.name, x + 256, y + 66, 400);
      }
      map.set("s" + ci, [x, y, 512, 128]);
    });
    for (const [k, seed] of M.wallArt) {
      const x = (ai % 8) * 256, y = 1024 + Math.floor(ai / 8) * 192; ai++; const r = rng(seed * 97 + ai);
      g.fillStyle = "#6b5236"; g.fillRect(x + 8, y + 8, 240, 176); g.fillStyle = "#c9a24a"; g.fillRect(x + 14, y + 14, 228, 164);
      const sky = ["#8fb8de", "#e6c27a", "#b8d48f", "#2b3a66", "#d79a8a"][seed % 5]; g.fillStyle = sky; g.fillRect(x + 22, y + 22, 212, 148);
      if (seed % 5 === 3) { for (let i = 0; i < 60; i++) { g.fillStyle = "rgba(255,255,255," + (0.4 + r() * 0.6) + ")"; g.fillRect(x + 22 + r() * 212, y + 22 + r() * 148, 2, 2); } g.fillStyle = "#e8c36a"; g.beginPath(); g.arc(x + 128, y + 96, 30, 0, 7); g.fill(); g.strokeStyle = "#f3e2b0"; g.lineWidth = 4; g.beginPath(); g.ellipse(x + 128, y + 96, 52, 14, -0.3, 0, 7); g.stroke(); }
      else { g.fillStyle = "rgba(255,255,255,0.65)"; g.beginPath(); g.arc(x + 60 + r() * 130, y + 60, 16, 0, 7); g.fill(); g.fillStyle = "rgba(60,100,60,0.75)"; g.beginPath(); g.moveTo(x + 22, y + 170); g.lineTo(x + 90, y + 100); g.lineTo(x + 150, y + 150); g.lineTo(x + 190, y + 110); g.lineTo(x + 234, y + 170); g.fill(); }
      map.set("a" + k, [x, y, 256, 192]);
    }
    return { c, map };
  }
  // 전시물 그림판: 128칸 16×16. 맨 끝 칸들은 눈알·도장·색종이
  const SPECIAL = { eyesL: PER * PER - 1, eyesR: PER * PER - 2, stamp: PER * PER - 3, puff: PER * PER - 4 };
  function slotXY(i) { return [(i % PER) * SLOT, Math.floor(i / PER) * SLOT]; }
  function drawSpecials(g) {
    for (const [k, dir] of [["eyesL", -1], ["eyesR", 1]]) {
      const [x, y] = slotXY(SPECIAL[k]);
      for (const sx of [-1, 1]) { const cx = x + 64 + sx * 27, cy = y + 64; g.fillStyle = "#fff"; g.strokeStyle = "#151515"; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 24, 0, 7); g.fill(); g.stroke(); g.fillStyle = "#111"; g.beginPath(); g.arc(cx + dir * 9, cy + 4, 11, 0, 7); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(cx + dir * 9 - 4, cy, 3.5, 0, 7); g.fill(); }
    }
    { const [x, y] = slotXY(SPECIAL.stamp); g.save(); g.translate(x + 64, y + 64); g.rotate(-0.3); g.strokeStyle = "rgba(214,28,28,0.95)"; g.lineWidth = 8; g.beginPath(); g.arc(0, 0, 52, 0, 7); g.stroke(); g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 42, 0, 7); g.stroke(); g.fillStyle = "rgba(214,28,28,0.98)"; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("진짜", 0, 2); g.restore(); }
    { const [x, y] = slotXY(SPECIAL.puff), r = rng(5); for (let i = 0; i < 46; i++) { g.fillStyle = ["#ff5a5a", "#ffd84a", "#5ad1ff", "#7dff9a", "#ff8ae0"][i % 5]; const a = r() * 7, d = 12 + r() * 46; g.save(); g.translate(x + 64 + Math.cos(a) * d, y + 64 + Math.sin(a) * d); g.rotate(r() * 3); g.fillRect(-6, -3, 12, 6); g.restore(); } }
  }
  function buildItemAtlas(M) {
    if (!itemCv) itemCv = mk(ATL, ATL);
    const g = itemCv.getContext("2d"); g.clearRect(0, 0, ATL, ATL); slots.clear();
    const want = new Set(); for (const s of M.stands) if (s.item >= 0) want.add(s.item); for (const ri in M.pool) for (const i of M.pool[ri]) want.add(i);
    let n = 0;
    for (const i of want) { if (n >= SPECIAL.puff) break; const [x, y] = slotXY(n); const img = Art.object(MM.ITEMS[i]); g.drawImage(img, x + 4, y + 4, SLOT - 8, SLOT - 8); slots.set(i, n); n++; }
    drawSpecials(g);
    if (!itemTex) { itemTex = tex(itemCv); itemTex.anisotropy = 2; } else itemTex.needsUpdate = true;
  }
  function slotOf(item) {
    if (slots.has(item)) return slots.get(item);
    // 그림판에 없던 전시물(게임 도중 참가 등): 빈칸에 그려 넣는다
    const n = slots.size; if (n >= SPECIAL.puff) return 0;
    const [x, y] = slotXY(n); itemCv.getContext("2d").drawImage(Art.object(MM.ITEMS[item]), x + 4, y + 4, SLOT - 8, SLOT - 8); slots.set(item, n); itemTex.needsUpdate = true; return n;
  }

  // ---------- 전시관 짓기 ----------
  function quadGeo() { return { p: [], n: [], uv: [], c: [], i: [] }; }
  function pushQuad(q, a, b, c, d, nrm, uvs, col) {
    const k = q.p.length / 3;
    for (const v of [a, b, c, d]) q.p.push(v[0], v[1], v[2]);
    for (let j = 0; j < 4; j++) { q.n.push(nrm[0], nrm[1], nrm[2]); q.c.push(col[0], col[1], col[2]); }
    for (const u of uvs) q.uv.push(u[0], u[1]);
    q.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  function toGeo(q) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(q.p, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(q.n, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(q.uv, 2)); g.setAttribute("color", new T.Float32BufferAttribute(q.c, 3));
    g.setIndex(q.i); g.computeBoundingSphere(); return g;
  }
  function hexRGB(h, k, base) { // 색 h를 흰색(또는 base)과 k만큼 섞어 [r,g,b] (선형이 아닌 화면 색)
    const c = new T.Color(h), b = new T.Color(base == null ? 0xffffff : base); b.lerp(c, k); return [b.r, b.g, b.b];
  }
  const ACC = { lobby: "#b08a4a", rest: "#7d8f6a" };
  function accentOf(cell) { return !cell ? "#8a8070" : cell.kind === "room" ? Art.wingColor(cell.wing) : ACC[cell.kind] || "#8a8070"; }
  function disposeWorld() {
    if (!world) return;
    for (const o of world.objs) { scene.remove(o); if (o.geometry) o.geometry.dispose(); }
    for (const t of world.texs) t.dispose();
    world = null;
  }
  function setMuseum(M) {
    if (!renderer || !loaded || !Art.ready) { pending = M; if (!Art.ready) Art.whenReady(() => { if (pending === M && loaded) { pending = null; setMuseum(M); } }); return; }
    disposeWorld();
    const objs = [], texs = [], add = o => { scene.add(o); objs.push(o); return o; };
    const W = M.W, H = M.H, tile = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 1 : M.grid[y * W + x];
    // 바닥·천장
    const fq = quadGeo(), cq = quadGeo();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tile(x, y) === 1) continue;
      const ci = M.cellOf[y * W + x], cell = ci >= 0 ? M.cells[ci] : null;
      const wood = cell && cell.kind !== "lobby", u0 = wood ? 0 : 0.5, du = 0.25, sx = (x % 2) * du, sy = (y % 2) * 0.5;
      const col = wood ? (cell.kind === "room" ? hexRGB(accentOf(cell), 0.1) : [1, 0.97, 0.93]) : [1, 1, 1];
      pushQuad(fq, [x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y], [0, 1, 0], [[u0 + sx, 1 - sy - 0.5], [u0 + sx + du, 1 - sy - 0.5], [u0 + sx + du, 1 - sy], [u0 + sx, 1 - sy]], col);
      const light = cell && ((x - cell.x0) % 3 === 1) && ((y - cell.y0) % 3 === 1), cu = light ? 0.5 : 0;
      pushQuad(cq, [x, WALL_H, y], [x + 1, WALL_H, y], [x + 1, WALL_H, y + 1], [x, WALL_H, y + 1], [0, -1, 0], [[cu, 1], [cu + 0.5, 1], [cu + 0.5, 0], [cu, 0]], [1, 1, 1]);
    }
    const ftex = tex(floorCanvas()), ctex = tex(ceilCanvas()); texs.push(ftex, ctex);
    add(new T.Mesh(toGeo(fq), new T.MeshLambertMaterial({ map: ftex, vertexColors: true })));
    add(new T.Mesh(toGeo(cq), new T.MeshBasicMaterial({ map: ctex, color: 0xd9d3c6 })));
    // 벽: 열린 칸을 바라보는 면마다 사각형 하나 + 위쪽 색 띠
    const wq = quadGeo(), dirs = [[0, -1, "N"], [0, 1, "S"], [-1, 0, "W"], [1, 0, "E"]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (tile(x, y) !== 1) continue;
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy; if (tile(nx, ny) === 1 || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        // 면의 두 끝점 (열린 칸 쪽에서 볼 때 왼쪽→오른쪽)
        let a, b;
        if (dy === 1) { a = [x, y + 1]; b = [x + 1, y + 1]; } else if (dy === -1) { a = [x + 1, y]; b = [x, y]; }
        else if (dx === 1) { a = [x + 1, y + 1]; b = [x + 1, y]; } else { a = [x, y]; b = [x, y + 1]; }
        const nrm = [dx, 0, dy], ncell = Museum.cellAt(nx + 0.5, ny + 0.5);
        pushQuad(wq, [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], WALL_H, b[1]], [a[0], WALL_H, a[1]], nrm, [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], [1, 1, 1]);
        const o = 0.006, acc = hexRGB(accentOf(ncell), 0.85, 0xffffff);
        pushQuad(wq, [a[0] + dx * o, 2.2, a[1] + dy * o], [b[0] + dx * o, 2.2, b[1] + dy * o], [b[0] + dx * o, 2.34, b[1] + dy * o], [a[0] + dx * o, 2.34, a[1] + dy * o], nrm, [[0.6, 0.2], [0.9, 0.2], [0.9, 0.3], [0.6, 0.3]], acc);
      }
    }
    const wtex = tex(wallCanvas()); texs.push(wtex);
    add(new T.Mesh(toGeo(wq), new T.MeshLambertMaterial({ map: wtex, vertexColors: true })));
    // 표지판·액자
    const sa = signAtlas(M), sq = quadGeo(), stex = tex(sa.c); texs.push(stex);
    const faceN = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };
    const plane = (tx, ty, face, w, h, cy, rect) => { // 벽 칸(tx,ty)의 face 쪽 면 가운데에 붙인다
      const [nx, ny] = faceN[face], cx = tx + 0.5 + nx * 0.5 + nx * 0.012, cz = ty + 0.5 + ny * 0.5 + ny * 0.012;
      const rx = ny, rz = -nx;   // 면을 바라볼 때 오른쪽
      const [px, py, pw, ph] = rect, u0 = px / 2048, u1 = (px + pw) / 2048, v1 = 1 - py / 2048, v0 = 1 - (py + ph) / 2048;
      pushQuad(sq, [cx - rx * w / 2, cy - h / 2, cz - rz * w / 2], [cx + rx * w / 2, cy - h / 2, cz + rz * w / 2], [cx + rx * w / 2, cy + h / 2, cz + rz * w / 2], [cx - rx * w / 2, cy + h / 2, cz - rz * w / 2], [nx, 0, ny], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [1, 1, 1]);
    };
    const signMid = new Map();
    for (const [k, v] of M.signs) if (v.slice === 1) signMid.set(v.cell, k);
    for (const [ci, k] of signMid) { const [tx, ty, face] = k.split(","); const rect = sa.map.get("s" + ci); if (rect) plane(+tx, +ty, face, 2.5, 0.62, 1.92, rect); }
    for (const [k] of M.wallArt) { const [tx, ty, face] = k.split(","); const rect = sa.map.get("a" + k); if (rect) plane(+tx, +ty, face, 0.82, 0.62, 1.5, rect); }
    if (sq.p.length) add(new T.Mesh(toGeo(sq), new T.MeshBasicMaterial({ map: stex, alphaTest: 0.5 })));
    // 받침대·가구 (같은 모델을 여러 번: InstancedMesh). 미믹이 쓸 자리를 남겨 둔다
    const m4 = new T.Matrix4(), q4 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1);
    const yawTo = (x, y, cell, step) => { if (!cell) return 0; const a = Math.atan2((cell.x0 + cell.x1 + 1) / 2 - x, (cell.y0 + cell.y1 + 1) / 2 - y); return Math.round(a / step) * step; };
    const inst = (name, list, extra) => {
      const t = tpl[name]; if (!t) return null;
      const im = new T.InstancedMesh(t.geo, t.mats, list.length + extra); im.frustumCulled = false; im.instanceMatrix.setUsage(T.DynamicDrawUsage);
      list.forEach((o, i) => { q4.setFromAxisAngle(up, o.yaw); m4.compose(new T.Vector3(o.x, 0, o.y), q4, one); im.setMatrixAt(i, m4); im.setColorAt(i, new T.Color(1, 1, 1)); });
      if (!im.instanceColor) im.setColorAt(0, new T.Color(1, 1, 1));
      for (let i = list.length; i < list.length + extra; i++) im.setColorAt(i, new T.Color(1, 1, 1));
      im.count = list.length; im.userData.base = list.length; im.userData.cap = list.length + extra;
      return add(im);
    };
    const peds = M.stands.map(s => { const cell = M.cells[s.cell]; return { x: s.x + 0.5, y: s.y + 0.5, yaw: yawTo(s.x + 0.5, s.y + 0.5, cell, Math.PI / 2) }; });
    const pedMesh = inst("pedestal", peds, 20);
    const decorMesh = {}, decorIdx = [];
    for (const kind of DECOR_KINDS) {
      const list = []; M.decor.forEach((d, i) => { if (d.kind !== kind) return; decorIdx[i] = list.length; list.push({ x: d.x + 0.5, y: d.y + 0.5, yaw: yawTo(d.x + 0.5, d.y + 0.5, Museum.cellAt(d.x + 0.5, d.y + 0.5), Math.PI / 4) }); });
      decorMesh[kind] = inst(kind, list, 10);
    }
    // 바닥 그림자(동그란 얼룩)
    if (!shadows) {
      const sc = mk(64, 64), g = sc.getContext("2d"), grd = g.createRadialGradient(32, 32, 2, 32, 32, 31); grd.addColorStop(0, "rgba(0,0,0,0.42)"); grd.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const pg = new T.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
      shadows = new T.InstancedMesh(pg, new T.MeshBasicMaterial({ map: tex(sc), transparent: true, depthWrite: false, fog: true }), 700);
      shadows.frustumCulled = false; shadows.renderOrder = 1; scene.add(shadows);
    }
    // 전시물 그림 묶음
    buildItemAtlas(M);
    if (!batch) batch = makeBatch(900);
    world = { M, objs, texs, pedMesh, decorMesh, decorIdx, peds };
  }

  // ---------- 그림 묶음(늘 카메라를 보는 사각형들을 한 번에 그린다) ----------
  function makeBatch(cap) {
    const g = new T.BufferGeometry();
    const pos = new T.BufferAttribute(new Float32Array(cap * 12), 3).setUsage(T.DynamicDrawUsage);
    const uv = new T.BufferAttribute(new Float32Array(cap * 8), 2).setUsage(T.DynamicDrawUsage);
    const col = new T.BufferAttribute(new Float32Array(cap * 12), 3).setUsage(T.DynamicDrawUsage);
    g.setAttribute("position", pos); g.setAttribute("uv", uv); g.setAttribute("color", col);
    const idx = new Uint32Array(cap * 6); for (let i = 0; i < cap; i++) { const k = i * 4; idx.set([k, k + 1, k + 2, k, k + 2, k + 3], i * 6); }
    g.setIndex(new T.BufferAttribute(idx, 1));
    const mat = new T.MeshBasicMaterial({ map: itemTex, vertexColors: true, alphaTest: 0.5, side: T.DoubleSide });
    const mesh = new T.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh);
    return { cap, n: 0, g, pos, uv, col, mesh, rx: 1, rz: 0 };
  }
  // 바닥 가운데 (x, y0, z)에 세운 w×h 사각형. 카메라 오른쪽 방향(rx, rz)으로 넓힌다. toward: 카메라 쪽으로 당김
  function bquad(x, y0, z, w, h, slot, r, gg, b, toward) {
    const B = batch; if (B.n >= B.cap) return;
    const i = B.n++, p = B.pos.array, u = B.uv.array, c = B.col.array, rx = B.rx * w / 2, rz = B.rz * w / 2;
    if (toward) { x += B.fx * -toward; z += B.fz * -toward; }
    p.set([x - rx, y0, z - rz, x + rx, y0, z + rz, x + rx, y0 + h, z + rz, x - rx, y0 + h, z - rz], i * 12);
    const [sx, sy] = slotXY(slot), u0 = sx / ATL, u1 = (sx + SLOT) / ATL, v1 = 1 - sy / ATL, v0 = 1 - (sy + SLOT) / ATL;
    u.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    c.set([r, gg, b, r, gg, b, r, gg, b, r, gg, b], i * 12);
  }

  // ---------- 학예사 ----------
  function curatorMats(team, jail) {
    const key = team + (jail ? "j" : ""); if (curMats.has(key)) return curMats.get(key);
    const body = tpl.curator.body.mats, all = [body, ...tpl.curator.parts.map(p => p.mats)];
    const conv = m => {
      let col = m.color.clone();
      if (m.name === "team") col = new T.Color(TEAM[team % 4]); else if (m.name === "team_d") col = new T.Color(TEAM[team % 4]).multiplyScalar(0.72);
      if (jail) { const l = col.r * 0.3 + col.g * 0.59 + col.b * 0.11; col.setRGB(l * 0.6, l * 0.6, l * 0.66); }
      if (m.name !== "team" && m.name !== "team_d" && !jail) return m;
      const L = new T.MeshLambertMaterial({ color: col }); L.name = m.name; return L;
    };
    const res = all.map(list => list.map(conv)); curMats.set(key, res); return res;
  }
  function getCurator(id, team) {
    let c = curators.get(id);
    if (c && c.team === team) return c;
    if (c) { scene.remove(c.g); }
    const g = new T.Group(), mats = curatorMats(team, false);
    const body = new T.Mesh(tpl.curator.body.geo, mats[0]); g.add(body);
    const parts = {}, meshes = [body];
    tpl.curator.parts.forEach((p, k) => { const piv = new T.Object3D(); piv.position.copy(p.pos); const mm = new T.Mesh(p.geo, mats[k + 1]); piv.add(mm); g.add(piv); parts[p.name] = piv; meshes.push(mm); });
    c = { g, parts, meshes, team, jail: false, seen: 0 }; curators.set(id, c); scene.add(g);
    return c;
  }
  function setCuratorJail(c, jail) {
    if (c.jail === jail) return; c.jail = jail;
    const mats = curatorMats(c.team, jail); c.meshes.forEach((m, i) => { m.material = mats[i]; });
  }

  // ---------- 이름표 ----------
  function nameTag(text, color) {
    const key = text + color; let t = tags.get(key);
    if (!t) {
      const c = mk(256, 64), g = c.getContext("2d"); g.font = "bold 30px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(text, 128, 34, 240); g.fillStyle = color; g.fillText(text, 128, 34, 240);
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex(c), depthTest: true, transparent: true })); s.scale.set(0.72, 0.18, 1); s.renderOrder = 3;
      t = { s, used: 0 }; tags.set(key, t); scene.add(s);
    }
    return t;
  }

  // ---------- 조준 ----------
  function wallDist(x, y, dx, dy, max) {
    let mx = Math.floor(x), my = Math.floor(y);
    const ddx = Math.abs(1 / (dx || 1e-9)), ddy = Math.abs(1 / (dy || 1e-9));
    let sx, sy, sdx, sdy;
    if (dx < 0) { sx = -1; sdx = (x - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - x) * ddx; }
    if (dy < 0) { sy = -1; sdy = (y - my) * ddy; } else { sy = 1; sdy = (my + 1 - y) * ddy; }
    for (let k = 0; k < 80; k++) {
      let d; if (sdx < sdy) { d = sdx; sdx += ddx; mx += sx; } else { d = sdy; sdy += ddy; my += sy; }
      if (d > max) return max;
      if (Museum.tile(mx, my) === Museum.T_WALL) return d;
    }
    return max;
  }
  // 세로 원기둥(가운데 cx,cz, 반지름 r, 높이 y0~y1)과 광선의 첫 만남
  function hitCyl(o, d, cx, cz, r, y0, y1) {
    const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z;
    let best = Infinity;
    if (a > 1e-9) {
      const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c;
      if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / (2 * a); if (t > 0) { const yy = o.y + d.y * t; if (yy >= y0 && yy <= y1) best = t; } }
    }
    if (Math.abs(d.y) > 1e-6) { for (const yy of [y1, y0]) { const t = (yy - o.y) / d.y; if (t > 0 && t < best) { const px = ox + d.x * t, pz = oz + d.z * t; if (px * px + pz * pz <= r * r) best = t; } } }
    return best;
  }
  function pickShape(e) {
    if (e.k === "stand") return [0.34, 0, PED_TOP + (e.item >= 0 ? ITEM : 0)];
    if (e.k === "decor") { const p = PICK[e.dk] || [0.4, 1]; return [p[0], 0, p[1]]; }
    if (e.k === "cur") return [0.3, 0, 1.6];
    if (e.k === "mimic") {
      const L = e.lift || 0;
      if (e.item >= 0) return e.moving ? [0.3, L, L + LOOSE] : [0.34, 0, PED_TOP + ITEM];
      const dk = Rules.EVERYDAY[-2 - e.item].kind, p = PICK[dk] || [0.4, 1]; return [p[0], L, L + p[1]];
    }
    return null;
  }

  // ---------- 그리기 ----------
  // v: { mode: "first"|"third", x, y, a, look, bob, targetH, ents, gun: {show, recoil, bob}, now, gray, w, h }
  const _o = { x: 0, y: 0, z: 0 }, _d = { x: 0, y: 0, z: 0 };
  function frame(v) {
    if (!renderer || !world) return { aim: null, camDist: 0, ready: false };
    const M = world.M, now = v.now;
    // 카메라
    const fx = Math.cos(v.a), fz = Math.sin(v.a);
    let cx, cy, cz, tx, ty, tz;
    if (v.mode === "first") {
      const pitch = Math.max(-0.75, Math.min(0.75, (v.look || 0) * 2.4));
      cx = v.x; cz = v.y; cy = (v.eye || EYE) + (v.bob || 0);
      tx = cx + fx * Math.cos(pitch); tz = cz + fz * Math.cos(pitch); ty = cy + Math.sin(pitch);
      camD = 0;
    } else {
      const th = v.targetH || 0.8, elev = Math.max(0.06, Math.min(1.0, 0.42 - (v.look || 0) * 1.8)), dist = 2.7;
      let hd = dist * Math.cos(elev); const free = wallDist(v.x, v.y, -fx, -fz, hd + 0.3) - 0.28; hd = Math.max(0.25, Math.min(hd, free));
      camD += (hd - camD) * (hd < camD ? 1 : 0.15);
      const hgt = Math.min(WALL_H - 0.15, th + camD * Math.tan(elev));
      cx = v.x - fx * camD; cz = v.y - fz * camD; cy = hgt;
      tx = v.x + fx * 0.6; tz = v.y + fz * 0.6; ty = th + 0.15;
    }
    camera.position.set(cx, cy, cz); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld();
    // 카메라 오른쪽 (가로)
    batch.rx = -fz; batch.rz = fx; batch.fx = fx; batch.fz = fz;
    // 물체 놓기
    batch.n = 0; let ns = 0;
    const m4 = new T.Matrix4(), q4 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1), white = new T.Color(1, 1, 1), red = new T.Color(1, 0.45, 0.45);
    const shadowAt = (x, z, r) => { if (ns >= 700) return; m4.makeScale(r * 2, 1, r * 2); m4.setPosition(x, 0.012, z); shadows.setMatrixAt(ns++, m4); };
    const ped = world.pedMesh, dyn = {}; let pedN = ped ? ped.userData.base : 0;
    for (const k of DECOR_KINDS) dyn[k] = world.decorMesh[k] ? world.decorMesh[k].userData.base : 0;
    // 받침대·가구 색 원래대로 (지난 프레임에 맞은 표시를 지운다)
    if (ped) { for (const s of M.stands) ped.setColorAt(s.id, white); }
    const near = (x, y) => Math.abs(x - cx) < 24 && Math.abs(y - cz) < 24;
    const tagUse = [];
    for (const t of tags.values()) t.used = 0;
    for (const c of curators.values()) c.seen = 0;
    const flick = now % 200 < 100;
    for (const e of v.ents) {
      const k = e.k;
      if (k === "stand") {
        shadowAt(e.x, e.y, SHADOW.pedestal);
        if (e.tint && ped) ped.setColorAt(e.id, red);
        if (e.item >= 0 && !e.hidden && near(e.x, e.y) && !(e.flicker && flick)) {
          const wob = e.wob || 0, tt = e.tint ? 1 - 0.55 * e.tint : 1;
          bquad(e.x + batch.rx * wob, PED_TOP - 0.02, e.y + batch.rz * wob, ITEM, ITEM, slotOf(e.item), 1, tt, tt, 0);
          if (e.stamped) bquad(e.x, PED_TOP + 0.08, e.y, 0.46, 0.46, SPECIAL.stamp, 1, 1, 1, 0.34);
        }
      } else if (k === "decor") {
        if (e.stamped) { const p = PICK[e.dk] || [0.4, 1]; bquad(e.x, Math.max(0.1, p[1] * 0.45 - 0.2), e.y, 0.46, 0.46, SPECIAL.stamp, 1, 1, 1, p[0] + 0.08); }
      } else if (k === "mimic") {
        if (e.hidden) continue;
        const L = e.lift || 0, wob = e.wob || 0, tt = e.tint ? 1 - 0.55 * e.tint : 1, fl = e.flicker && flick;
        if (e.item >= 0) {
          if (e.moving) {
            shadowAt(e.x, e.y, SHADOW.loose * (1 - L * 0.6));
            if (!fl) { bquad(e.x + batch.rx * wob, L, e.y + batch.rz * wob, LOOSE, LOOSE, slotOf(e.item), 1, tt, tt, 0); bquad(e.x + batch.rx * wob, L + LOOSE * 0.52, e.y + batch.rz * wob, 0.34, 0.34, e.eyes > 0 ? SPECIAL.eyesR : SPECIAL.eyesL, 1, 1, 1, 0.05); }
          } else {
            shadowAt(e.x, e.y, SHADOW.pedestal);
            if (ped && pedN < ped.userData.cap && !fl) { q4.setFromAxisAngle(up, e.yaw || 0); m4.compose(new T.Vector3(e.x, 0, e.y), q4, one); ped.setMatrixAt(pedN, m4); ped.setColorAt(pedN, e.tint ? red : white); pedN++; }
            if (!fl) bquad(e.x + batch.rx * wob, PED_TOP - 0.02, e.y + batch.rz * wob, ITEM, ITEM, slotOf(e.item), 1, tt, tt, 0);
          }
        } else {
          const dk = Rules.EVERYDAY[-2 - e.item].kind, im = world.decorMesh[dk];
          shadowAt(e.x, e.y, (SHADOW[dk] || 0.4) * (1 - L * 0.5));
          if (im && dyn[dk] < im.userData.cap && !fl) {
            q4.setFromEuler(new T.Euler(0, e.yaw || 0, wob * 0.25)); m4.compose(new T.Vector3(e.x + batch.rx * wob * 0.3, L, e.y + batch.rz * wob * 0.3), q4, one);
            im.setMatrixAt(dyn[dk], m4); im.setColorAt(dyn[dk], e.tint ? red : white); dyn[dk]++;
          }
          if (e.moving && !fl) { const p = PICK[dk] || [0.4, 1]; bquad(e.x, L + p[1] * 0.62, e.y, 0.36, 0.36, e.eyes > 0 ? SPECIAL.eyesR : SPECIAL.eyesL, 1, 1, 1, p[0] + 0.05); }
        }
        if (e.name) tagUse.push([e.name, e.nameColor || "#7dff9a", e.x, (e.item >= 0 && !e.moving ? PED_TOP + ITEM : 1.0) + L + 0.25, e.y]);
      } else if (k === "cur") {
        const c = getCurator(e.id, e.team); c.seen = 1; setCuratorJail(c, !!e.jailed);
        c.g.visible = true; c.g.position.set(e.x, e.moving ? Math.abs(Math.sin(e.walk * 1.0)) * 0.04 : 0, e.y);
        c.g.rotation.y = Math.atan2(Math.cos(e.a), Math.sin(e.a));
        const sw = e.moving ? Math.sin(e.walk * 1.0) * 0.65 : 0;
        if (c.parts.legL) c.parts.legL.rotation.x = sw; if (c.parts.legR) c.parts.legR.rotation.x = -sw;
        if (c.parts.armL) c.parts.armL.rotation.x = -sw * 0.8; if (c.parts.armR) c.parts.armR.rotation.x = e.firing ? -0.35 : sw * 0.25;
        if (c.parts.head) c.parts.head.rotation.z = e.moving ? Math.sin(e.walk * 0.5) * 0.04 : 0;
        shadowAt(e.x, e.y, SHADOW.curator);
        if (e.name) tagUse.push([e.name, e.nameColor || "#fff", e.x, 1.82, e.y]);
      } else if (k === "puff") {
        const s = 0.5 + e.t * 1.1; bquad(e.x, 0.2 + e.t * 0.6, e.y, s, s, SPECIAL.puff, 1, 1, 1, 0.1);
      }
    }
    // 가구 그림자 (고정)
    M.decor.forEach(d => { if (near(d.x, d.y)) shadowAt(d.x + 0.5, d.y + 0.5, SHADOW[d.kind] || 0.4); });
    if (ped) { ped.count = pedN; ped.instanceMatrix.needsUpdate = true; if (ped.instanceColor) ped.instanceColor.needsUpdate = true; }
    for (const k of DECOR_KINDS) { const im = world.decorMesh[k]; if (!im) continue; im.count = dyn[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    shadows.count = ns; shadows.instanceMatrix.needsUpdate = true;
    batch.g.setDrawRange(0, batch.n * 6); batch.pos.needsUpdate = true; batch.uv.needsUpdate = true; batch.col.needsUpdate = true;
    if (batch.mesh.material.map !== itemTex) { batch.mesh.material.map = itemTex; batch.mesh.material.needsUpdate = true; }
    for (const c of curators.values()) if (!c.seen) c.g.visible = false;
    for (const [name, col, x, y, z] of tagUse) { const t = nameTag(name, col); t.used = 1; t.s.position.set(x, y, z); }
    for (const t of tags.values()) t.s.visible = !!t.used;
    // 조준: 화면 가운데 광선
    const dir = new T.Vector3(); camera.getWorldDirection(dir);
    _o.x = cx; _o.y = cy; _o.z = cz; _d.x = dir.x; _d.y = dir.y; _d.z = dir.z;
    const hl = Math.hypot(dir.x, dir.z) || 1e-6, wd = wallDist(cx, cz, dir.x / hl, dir.z / hl, 30) / hl;
    let aim = null, best = Math.min(wd, 30);
    for (const e of v.ents) {
      if (!e.ref || e.self) continue;
      const sh = pickShape(e); if (!sh) continue;
      const t = hitCyl(_o, _d, e.x, e.y, sh[0], sh[1], sh[2]);
      if (t < best) { best = t; aim = e; }
    }
    lastPick = aim;
    // 1인칭 도장총
    if (gun) {
      gun.visible = !!(v.gun && v.gun.show);
      if (gun.visible) { const r = v.gun.recoil || 0, b = v.gun.bob || 0; gun.position.set(0.27 + Math.sin(b) * 0.012, -0.27 - Math.abs(Math.cos(b)) * 0.01 + r * 0.02, -0.52 + r * 0.08); gun.rotation.set(0.05 + r * 0.25, 0.16, -0.05); }
    }
    renderer.info.reset(); renderer.clear();
    renderer.render(scene, camera);
    if (gun && gun.visible) { renderer.clearDepth(); gunCam.aspect = camera.aspect; gunCam.fov = camera.fov; gunCam.updateProjectionMatrix(); renderer.render(gunScene, gunCam); }
    if (canvasEl) canvasEl.style.filter = v.gray ? "grayscale(1) brightness(0.8)" : "";
    return { aim: aim ? { s: { ref: aim.ref }, ent: aim, dist: best * Math.hypot(dir.x, dir.z) } : null, camDist: camD, ready: true };
  }
  function resize(w, h) {
    if (!renderer) return;
    const q = Options.get("quality"), dpr = window.devicePixelRatio || 1, touch = document.body.classList.contains("pc") ? false : true;
    const pr = q === "high" ? Math.min(dpr, 1.6) : q === "mid" ? 1 : q === "low" ? 0.66 : (touch ? Math.min(dpr, 1.0) * 0.9 : Math.min(dpr, 1.25));
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  // 가구 모델을 작은 그림으로 (변신 고르기·HUD·관제실 지도에 쓴다)
  function thumb(kind, size) {
    if (!renderer || !tpl[kind]) return null;
    size = size || 128;
    const rt = new T.WebGLRenderTarget(size, size), sc = new T.Scene(), cam = new T.PerspectiveCamera(30, 1, 0.05, 20); rt.texture.colorSpace = T.SRGBColorSpace;
    sc.add(new T.HemisphereLight(0xffffff, 0x6b5a46, 2.4)); const dl = new T.DirectionalLight(0xffffff, 1.2); dl.position.set(1, 2, 2); sc.add(dl);
    const mesh = new T.Mesh(tpl[kind].geo, tpl[kind].mats); mesh.rotation.y = -0.5; sc.add(mesh);
    const box = new T.Box3().setFromObject(mesh), ctr = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3()), r = Math.max(sz.x, sz.y, sz.z) * 0.62;
    cam.position.set(ctr.x + r * 0.9, ctr.y + r * 0.7, ctr.z + r * 2.9); cam.lookAt(ctr);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
    const px = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    renderer.setRenderTarget(null); renderer.setClearColor(0x15130f, 1); rt.dispose();
    const c = mk(size, size), g = c.getContext("2d"), id = g.createImageData(size, size);
    for (let y = 0; y < size; y++) id.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    g.putImageData(id, 0, 0);
    return c;
  }
  function stats() { return renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, texs: renderer.info.memory.textures } : null; }
  return { init, load, setMuseum, frame, resize, thumb, supported, whenThree, stats, get ready() { return loaded && !!renderer; }, get built() { return !!world; }, WALL_H, PED_TOP };
})();
