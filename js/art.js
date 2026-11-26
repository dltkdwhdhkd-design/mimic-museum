// 그림 — 전시물(이모지 아틀라스 + 코드로 그린 암석·행성·분자 등), 받침대, 학예사, 가구, 벽·표지판
// 3D 화면의 받침대·가구·학예사는 블렌더 모델이다(docs/blender.md). 가구 작은 그림은 3D 모델을 찍어 provide()로 받는다.
window.Art = (function () {
  const O = 96;                     // 전시물 그림 크기
  const STAND_W = 96, STAND_H = 176, STAND_TOP = 92;   // 받침대 합성 그림 (위 92px가 전시물 자리)
  const WH = 205;                   // 벽 텍스처 높이 (폭 128 : 높이 205 = 벽 1 : 1.6)
  const cache = new Map();
  let atlas = null, atlasReady = false; const onReady = [];
  const provided = {};
  // 예전 2D용 그림 바꾸기: img/ 폴더에 PNG를 넣고 여기에 이름을 적는다. 3D 화면에는 쓰이지 않는다(모델은 docs/blender.md)
  // 쓸 수 있는 이름: curator, curator1~curator4(팀별), pedestal, bench, plant, desk, vending, rope, poster, trash, extinguisher
  const PROVIDED = [];

  function load(base) {
    if (atlas) return; base = base || "";
    atlas = new Image();
    atlas.onload = () => { atlasReady = true; cache.clear(); onReady.splice(0).forEach(f => f()); };
    atlas.onerror = () => { atlasReady = false; };
    atlas.src = base + "img/emoji.png";
    for (const n of PROVIDED) { const im = new Image(); im.onload = () => { provided[n] = im; cache.clear(); }; im.src = base + "img/" + n + ".png"; }
  }
  function whenReady(f) { if (atlasReady) f(); else onReady.push(f); }
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- 이모지 ----------
  function emoji(g, e, x, y, size) {
    const A = window.EMOJI_ATLAS, i = A && A.map[e];
    if (atlasReady && i !== undefined) { g.drawImage(atlas, (i % A.cols) * A.cell, Math.floor(i / A.cols) * A.cell, A.cell, A.cell, x, y, size, size); return; }
    g.save(); g.font = `${Math.floor(size * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(e, x + size / 2, y + size / 2 + 2); g.restore();
  }
  function drawEmojiIcon(g, spec) {
    const parts = spec.split("+").filter(Boolean);
    emoji(g, parts[0], 8, 4, 80);
    if (parts[1]) { g.save(); g.fillStyle = "rgba(255,255,255,0.92)"; g.beginPath(); g.arc(74, 72, 21, 0, 7); g.fill(); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 2; g.stroke(); g.restore(); emoji(g, parts[1], 56, 54, 36); }
    if (parts[2]) { g.save(); g.fillStyle = "rgba(255,255,255,0.92)"; g.beginPath(); g.arc(22, 72, 19, 0, 7); g.fill(); g.restore(); emoji(g, parts[2], 6, 56, 32); }
  }

  // ---------- 공통 도우미 ----------
  function blobPath(g, cx, cy, rx, ry, r, n, rough) {
    g.beginPath();
    for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, k = 1 + (r() - 0.5) * rough; const x = cx + Math.cos(a) * rx * k, y = cy + Math.sin(a) * ry * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath();
  }
  function shade(g, cx, cy, R, col) {
    const gr = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(0.45, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,0.38)");
    g.fillStyle = gr; g.fill();
  }
  function frameDisc(g, bg) { // 망원경·현미경 시야처럼 둥근 틀
    g.save(); g.beginPath(); g.arc(48, 48, 44, 0, 7); g.fillStyle = bg; g.fill(); g.clip();
    return () => { g.restore(); g.beginPath(); g.arc(48, 48, 44, 0, 7); g.lineWidth = 4; g.strokeStyle = "#2a2d33"; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = "#8b8f96"; g.stroke(); };
  }

  // ---------- 암석·광물 ----------
  const ROCK = {
    granite: { base: "#d8c8c0", dots: [["#1d1d22", 40, 2.6], ["#f4efe8", 30, 3.2], ["#e3a99a", 22, 3.2]] },
    basalt: { base: "#3c3d42", holes: 26, dots: [["#2a2b30", 40, 1.2]] },
    gabbro: { base: "#2d332f", dots: [["#e6e6e0", 34, 3], ["#151815", 30, 3.2]] },
    rhyolite: { base: "#d9b8ad", bands: "#c79e92", dots: [["#f1e6de", 10, 1.4]] },
    andesite: { base: "#7d7e80", dots: [["#e9e8e2", 18, 1.8], ["#4a4b4e", 14, 1.4]] },
    diorite: { base: "#b9b8b3", dots: [["#1c1c1e", 46, 2.4], ["#f6f6f2", 30, 2.4]] },
    sandstone: { base: "#d7b07a", layers: "#c39a63", dots: [["#e8c995", 90, 0.9], ["#a98352", 50, 0.8]] },
    shale: { base: "#55585e", layers: "#3f4247", thin: true },
    conglomerate: { base: "#b49a78", pebbles: ["#8d8f93", "#d9d2c6", "#7a5f4a", "#a8b1b9", "#e0c8a0"] },
    limestone: { base: "#d8d4c8", dots: [["#c7c2b4", 40, 1.4]], fossil: true },
    tuff: { base: "#cfc6a8", dots: [["#8e8779", 26, 2.2], ["#efe8d2", 30, 1.4]], holes: 10 },
    halite: { crystal: "#f2e4e4" },
    marble: { base: "#f2f0ec", veins: "#9a9c9f" },
    quartzite: { base: "#ecd6d0", dots: [["#f8ece8", 60, 1.6], ["#d9bcb4", 30, 1.4]] },
    gneiss: { base: "#d8d0c6", stripes: ["#2c2b2e", "#e9e2d8", "#a39a92"], wavy: 6 },
    schist: { base: "#8f9497", stripes: ["#b8c0c4", "#6f7579"], wavy: 3, glitter: true },
    slate: { base: "#3d4652", layers: "#323a45", thin: true, flat: true },
    hornfels: { base: "#3a3734", dots: [["#55504b", 50, 1.6], ["#2a2725", 30, 2]] },
  };
  function drawRock(g, kind, seedStr) {
    const r = rng(hash(seedStr)), d = ROCK[kind] || ROCK.granite;
    if (d.crystal) { // 암염: 정육면체 결정 덩어리
      for (const [x, y, s] of [[22, 38, 34], [46, 30, 30], [40, 52, 32], [60, 48, 26]]) {
        g.fillStyle = d.crystal; g.fillRect(x, y, s, s); g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x, y, s, 5); g.fillStyle = "rgba(180,140,140,0.35)"; g.fillRect(x + s - 6, y, 6, s); g.strokeStyle = "rgba(150,120,120,0.6)"; g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      }
      return;
    }
    g.save();
    if (d.flat) { g.beginPath(); g.moveTo(10, 40); g.lineTo(84, 30); g.lineTo(88, 66); g.lineTo(14, 76); g.closePath(); }
    else blobPath(g, 48, 52, 38, 30, r, 14, 0.28);
    g.fillStyle = d.base; g.fill(); g.clip();
    if (d.layers) for (let y = 14; y < 96; y += d.thin ? 4 : 9) { g.fillStyle = d.layers; g.fillRect(0, y + r() * 2, 96, d.thin ? 1.4 : 3); }
    if (d.bands) for (let y = 10; y < 96; y += 7) { g.strokeStyle = d.bands; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 96; x += 12) g.lineTo(x, y + Math.sin(x / 9 + y) * 2.5); g.stroke(); }
    if (d.stripes) { let y = 6, k = 0; while (y < 96) { const h = 3 + r() * 6; g.fillStyle = d.stripes[k++ % d.stripes.length]; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 96; x += 8) g.lineTo(x, y + Math.sin(x / 11 + k) * d.wavy); for (let x = 96; x >= 0; x -= 8) g.lineTo(x, y + h + Math.sin(x / 11 + k) * d.wavy); g.fill(); y += h; } }
    if (d.dots) for (const [c, n, s] of d.dots) { g.fillStyle = c; for (let i = 0; i < n; i++) { const x = 8 + r() * 80, y = 18 + r() * 66, w = s * (0.6 + r() * 0.9); g.fillRect(x, y, w, w * (0.6 + r() * 0.8)); } }
    if (d.pebbles) for (let i = 0; i < 16; i++) { g.fillStyle = d.pebbles[i % d.pebbles.length]; blobPath(g, 12 + r() * 72, 22 + r() * 60, 4 + r() * 7, 3 + r() * 6, r, 9, 0.3); g.fill(); g.strokeStyle = "rgba(0,0,0,0.2)"; g.stroke(); }
    if (d.holes) for (let i = 0; i < d.holes; i++) { g.fillStyle = "rgba(10,10,12,0.75)"; g.beginPath(); g.ellipse(10 + r() * 76, 22 + r() * 60, 1 + r() * 2.6, 1 + r() * 2, 0, 0, 7); g.fill(); }
    if (d.veins) for (let i = 0; i < 4; i++) { g.strokeStyle = d.veins; g.lineWidth = 0.8 + r() * 1.2; g.beginPath(); let x = r() * 96, y = 14; g.moveTo(x, y); while (y < 90) { x += (r() - 0.5) * 16; y += 6 + r() * 8; g.lineTo(x, y); } g.stroke(); }
    if (d.fossil) { g.strokeStyle = "rgba(120,110,95,0.8)"; g.lineWidth = 1.4; g.beginPath(); for (let a = 0; a < 12; a += 0.3) { const rr = 1 + a * 1.1; g.lineTo(58 + Math.cos(a) * rr, 52 + Math.sin(a) * rr); } g.stroke(); }
    if (d.glitter) for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.5})`; g.fillRect(r() * 96, r() * 96, 1.4, 1.4); }
    g.restore();
    if (!d.flat) { blobPath(g, 48, 52, 38, 30, rng(hash(seedStr)), 14, 0.28); }
    else { g.beginPath(); g.moveTo(10, 40); g.lineTo(84, 30); g.lineTo(88, 66); g.lineTo(14, 76); g.closePath(); }
    const gr = g.createLinearGradient(0, 20, 0, 86); gr.addColorStop(0, "rgba(255,255,255,0.22)"); gr.addColorStop(0.5, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = gr; g.fill(); g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 1.5; g.stroke();
  }
  function drawMineral(g, kind, seedStr) {
    const r = rng(hash(seedStr));
    const prism = (x, y, w, h, top, col, edge) => { g.fillStyle = col; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + top); g.lineTo(x + w / 2, y); g.lineTo(x + w, y + top); g.lineTo(x + w, y + h); g.closePath(); g.fill(); g.strokeStyle = edge; g.lineWidth = 1; g.stroke(); g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 2, y + top, w * 0.25, h - top - 2); };
    if (kind === "quartz") { g.globalAlpha = 0.9; for (const [x, w, h] of [[30, 16, 56], [44, 18, 66], [60, 14, 48], [20, 12, 40]]) prism(x, 88 - h, w, h, 12, "rgba(235,240,248,0.85)", "rgba(120,140,170,0.9)"); g.globalAlpha = 1; return; }
    if (kind === "feldspar") { for (const [x, y, w, h, c] of [[18, 40, 34, 30, "#e8b9a8"], [44, 34, 32, 38, "#f2d2c4"], [30, 58, 40, 24, "#dca592"]]) { g.fillStyle = c; g.fillRect(x, y, w, h); g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x, y, w, 4); g.strokeStyle = "rgba(120,70,60,0.6)"; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); } return; }
    if (kind === "biotite") { for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? "#1a1612" : "#2c241c"; g.beginPath(); g.moveTo(18, 70 - i * 4); g.lineTo(42, 58 - i * 4); g.lineTo(80, 64 - i * 4); g.lineTo(56, 78 - i * 4); g.closePath(); g.fill(); g.strokeStyle = "rgba(200,170,120,0.5)"; g.stroke(); } return; }
    if (kind === "amphibole") { for (let i = 0; i < 5; i++) prism(18 + i * 12 + r() * 4, 26 + r() * 10, 10, 58, 6, i % 2 ? "#1e2b22" : "#2b3a2e", "#0d140f"); return; }
    if (kind === "pyroxene") { for (const [x, y, s] of [[22, 40, 28], [46, 30, 30], [36, 58, 28], [60, 54, 22]]) { g.fillStyle = "#24321f"; g.fillRect(x, y, s, s * 0.9); g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x, y, s, 3); g.strokeStyle = "#0e140b"; g.strokeRect(x + 0.5, y + 0.5, s - 1, s * 0.9 - 1); } return; }
    if (kind === "olivine") { for (let i = 0; i < 28; i++) { g.fillStyle = ["#8fb83a", "#a3c94a", "#6f9a2a"][i % 3]; blobPath(g, 20 + r() * 56, 34 + r() * 44, 4 + r() * 5, 3 + r() * 4, r, 7, 0.3); g.fill(); g.strokeStyle = "rgba(40,60,10,0.5)"; g.stroke(); } return; }
    if (kind === "calcite") { g.fillStyle = "rgba(250,248,240,0.92)"; g.beginPath(); g.moveTo(22, 46); g.lineTo(56, 30); g.lineTo(80, 50); g.lineTo(46, 70); g.closePath(); g.fill(); g.fillStyle = "rgba(225,220,205,0.95)"; g.beginPath(); g.moveTo(22, 46); g.lineTo(46, 70); g.lineTo(46, 88); g.lineTo(22, 64); g.closePath(); g.fill(); g.fillStyle = "rgba(205,198,180,0.95)"; g.beginPath(); g.moveTo(46, 70); g.lineTo(80, 50); g.lineTo(80, 68); g.lineTo(46, 88); g.closePath(); g.fill(); g.strokeStyle = "rgba(120,110,90,0.7)"; g.stroke(); return; }
  }

  // ---------- 천체 ----------
  function drawPlanet(g, kind, seedStr) {
    const r = rng(hash(seedStr)); const cx = 48, cy = 50;
    const disc = (R, col) => { g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = col; g.fill(); };
    const clip = R => { g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); };
    const lit = R => { g.restore(); g.beginPath(); g.arc(cx, cy, R, 0, 7); shade(g, cx, cy, R); };
    const craters = (R, n, col) => { for (let i = 0; i < n; i++) { const a = r() * 7, d = r() * R * 0.85, s = 1.5 + r() * R * 0.13; g.fillStyle = col; g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, 7); g.fill(); g.strokeStyle = "rgba(255,255,255,0.25)"; g.stroke(); } };
    const bands = (R, cols) => { for (let i = 0; i < 14; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(cx - R, cy - R + i * (2 * R / 14), 2 * R, 2 * R / 14 + 1); } };
    const lumpy = (rx, ry, col, n) => { blobPath(g, cx, cy, rx, ry, r, n || 12, 0.35); g.fillStyle = col; g.fill(); g.save(); g.clip(); craters(rx, 7, "rgba(0,0,0,0.25)"); g.restore(); blobPath(g, cx, cy, rx, ry, rng(hash(seedStr)), n || 12, 0.35); shade(g, cx, cy, Math.max(rx, ry)); };
    switch (kind) {
      case "mercury": disc(26, "#9a9792"); clip(26); craters(26, 14, "rgba(60,58,55,0.5)"); lit(26); break;
      case "venus": disc(33, "#e9cf95"); clip(33); for (let i = 0; i < 6; i++) { g.strokeStyle = "rgba(255,240,200,0.6)"; g.lineWidth = 3; g.beginPath(); g.arc(cx + (r() - 0.5) * 30, cy + (r() - 0.5) * 30, 10 + r() * 20, r() * 3, r() * 3 + 2); g.stroke(); } lit(33); break;
      case "earth": disc(34, "#2f6fd0"); clip(34); g.fillStyle = "#4b9a45"; for (const [x, y, rx, ry] of [[-10, -8, 12, 16], [14, 6, 10, 13], [-4, 18, 8, 6]]) { blobPath(g, cx + x, cy + y, rx, ry, r, 10, 0.5); g.fill(); } g.fillStyle = "rgba(255,255,255,0.75)"; for (let i = 0; i < 5; i++) { g.fillRect(cx - 34 + r() * 60, cy - 30 + r() * 60, 14 + r() * 12, 3); } g.fillStyle = "#eef3f8"; g.fillRect(cx - 34, cy - 35, 68, 6); lit(34); break;
      case "mars": disc(28, "#c8573a"); clip(28); g.fillStyle = "rgba(90,30,20,0.45)"; for (let i = 0; i < 5; i++) { blobPath(g, cx + (r() - 0.5) * 36, cy + (r() - 0.5) * 30, 6 + r() * 8, 4 + r() * 5, r, 9, 0.5); g.fill(); } g.fillStyle = "#f4ede8"; g.beginPath(); g.ellipse(cx, cy - 26, 10, 4, 0, 0, 7); g.fill(); lit(28); break;
      case "jupiter": disc(42, "#d9b38c"); clip(42); bands(42, ["#e7cfae", "#c99a6c", "#efdcc0", "#b78354", "#ddc09a"]); g.fillStyle = "#c2563c"; g.beginPath(); g.ellipse(cx + 14, cy + 12, 8, 5, 0, 0, 7); g.fill(); lit(42); break;
      case "saturn": g.save(); g.translate(cx, cy); g.rotate(-0.35); g.strokeStyle = "rgba(220,200,150,0.9)"; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, 46, 12, 0, Math.PI, Math.PI * 2); g.stroke(); g.restore(); disc(28, "#e6cf98"); clip(28); bands(28, ["#efdcae", "#d7bb80", "#e9d39f"]); lit(28); g.save(); g.translate(cx, cy); g.rotate(-0.35); g.strokeStyle = "rgba(235,215,165,0.95)"; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, 46, 12, 0, 0, Math.PI); g.stroke(); g.strokeStyle = "rgba(120,100,70,0.6)"; g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, 40, 10, 0, 0, Math.PI); g.stroke(); g.restore(); break;
      case "uranus": g.save(); g.translate(cx, cy); g.strokeStyle = "rgba(200,240,245,0.5)"; g.lineWidth = 2; g.beginPath(); g.ellipse(0, 0, 8, 40, 0.15, 0, 7); g.stroke(); g.restore(); disc(30, "#9fdde3"); clip(30); lit(30); break;
      case "neptune": disc(30, "#3d63d8"); clip(30); g.fillStyle = "rgba(20,30,90,0.7)"; g.beginPath(); g.ellipse(cx - 8, cy + 6, 7, 4, 0, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(cx - 4, cy - 10, 14, 2); lit(30); break;
      case "moon": disc(30, "#b9b6ae"); clip(30); g.fillStyle = "rgba(90,88,84,0.45)"; for (let i = 0; i < 5; i++) { blobPath(g, cx + (r() - 0.5) * 34, cy + (r() - 0.5) * 30, 5 + r() * 9, 4 + r() * 7, r, 9, 0.4); g.fill(); } craters(30, 10, "rgba(120,118,112,0.6)"); lit(30); break;
      case "io": disc(26, "#e8d35a"); clip(26); for (let i = 0; i < 14; i++) { g.fillStyle = ["#b8572e", "#f3efc0", "#6a4a22"][i % 3]; g.beginPath(); g.arc(cx + (r() - 0.5) * 48, cy + (r() - 0.5) * 48, 1.5 + r() * 4, 0, 7); g.fill(); } lit(26); break;
      case "europa": disc(24, "#eee3cf"); clip(24); g.strokeStyle = "rgba(150,90,60,0.8)"; g.lineWidth = 1.2; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(cx - 26, cy - 26 + r() * 52); g.bezierCurveTo(cx - 6, cy + (r() - 0.5) * 50, cx + 6, cy + (r() - 0.5) * 50, cx + 26, cy - 26 + r() * 52); g.stroke(); } lit(24); break;
      case "ganymede": disc(30, "#a49a8c"); clip(30); g.fillStyle = "rgba(80,70,60,0.6)"; for (let i = 0; i < 6; i++) { blobPath(g, cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 40, 6 + r() * 8, 5 + r() * 7, r, 9, 0.5); g.fill(); } lit(30); break;
      case "titan": disc(30, "#d99a45"); clip(30); g.fillStyle = "rgba(255,210,140,0.35)"; g.fillRect(cx - 30, cy - 30, 60, 14); lit(30); g.beginPath(); g.arc(cx, cy, 32, 0, 7); g.strokeStyle = "rgba(240,190,110,0.5)"; g.lineWidth = 3; g.stroke(); break;
      case "phobos": lumpy(26, 18, "#7e766e", 11); break;
      case "pluto": disc(24, "#c8a888"); clip(24); g.fillStyle = "#efe3d2"; g.beginPath(); g.moveTo(cx + 4, cy + 14); g.bezierCurveTo(cx - 18, cy, cx - 6, cy - 14, cx + 4, cy - 4); g.bezierCurveTo(cx + 14, cy - 14, cx + 24, cy, cx + 4, cy + 14); g.fill(); g.fillStyle = "rgba(90,50,40,0.5)"; g.fillRect(cx - 24, cy + 6, 18, 10); lit(24); break;
      case "ceres": disc(20, "#8d8a85"); clip(20); craters(20, 8, "rgba(60,58,56,0.5)"); g.fillStyle = "#fff"; g.beginPath(); g.arc(cx + 4, cy - 2, 2.2, 0, 7); g.fill(); lit(20); break;
      case "eris": disc(20, "#dcdad4"); clip(20); craters(20, 5, "rgba(150,148,140,0.5)"); lit(20); break;
      case "vesta": lumpy(24, 21, "#8f8478", 12); break;
      case "ryugu": g.fillStyle = "#3a3632"; g.beginPath(); g.moveTo(cx - 28, cy); g.lineTo(cx, cy - 24); g.lineTo(cx + 28, cy); g.lineTo(cx, cy + 24); g.closePath(); g.fill(); g.save(); g.clip(); for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(${90 + r() * 60},${85 + r() * 50},${80 + r() * 40},0.8)`; g.beginPath(); g.arc(cx + (r() - 0.5) * 56, cy + (r() - 0.5) * 48, 1 + r() * 2.5, 0, 7); g.fill(); } g.restore(); g.beginPath(); g.moveTo(cx - 28, cy); g.lineTo(cx, cy - 24); g.lineTo(cx + 28, cy); g.lineTo(cx, cy + 24); g.closePath(); shade(g, cx, cy, 28); break;
      case "comet": { const end = frameDisc(g, "#05070d"); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(150,200,255,${0.05 + r() * 0.05})`; g.beginPath(); g.ellipse(38 - i * 1.2, 40 - i * 0.6, 10 + i * 1.4, 4 + i * 0.5, -0.45, 0, 7); g.fill(); } const gr = g.createRadialGradient(62, 56, 0, 62, 56, 12); gr.addColorStop(0, "#fff"); gr.addColorStop(1, "rgba(170,220,255,0)"); g.fillStyle = gr; g.beginPath(); g.arc(62, 56, 12, 0, 7); g.fill(); g.globalCompositeOperation = "source-over"; end(); break; }
    }
  }
  function starField(g, r, n, cols, cx, cy, spread, dens) {
    for (let i = 0; i < n; i++) {
      const a = r() * 7, d = Math.pow(r(), dens || 1) * spread, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const s = 0.6 + r() * 1.4; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.6 + r() * 0.4; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
  function glowStar(g, x, y, R, col) {
    const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.25, col); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill();
  }
  function cloud(g, r, cx, cy, rx, ry, col, n, a) {
    for (let i = 0; i < n; i++) { const x = cx + (r() - 0.5) * rx * 2, y = cy + (r() - 0.5) * ry * 2, R = 6 + r() * 14; const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, col.replace("A", String(a))); gr.addColorStop(1, col.replace("A", "0")); g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); }
  }
  function drawSky(g, kind, seedStr) {
    const r = rng(hash(seedStr)), end = frameDisc(g, "#03050b");
    starField(g, r, 40, ["#ffffff", "#cfe0ff", "#ffe8c8"], 48, 48, 46, 1);
    g.globalCompositeOperation = "lighter";
    const t = kind.replace(/\d+$/, ""), v = +kind.replace(/\D/g, "") || 1;
    if (t === "open") {
      if (v === 1) cloud(g, r, 48, 48, 26, 22, "rgba(120,160,255,A)", 14, 0.12);
      if (v === 4) { for (const cx of [30, 66]) for (let i = 0; i < 14; i++) glowStar(g, cx + (r() - 0.5) * 22, 48 + (r() - 0.5) * 22, 2 + r() * 3, "#bcd2ff"); }
      else for (let i = 0; i < (v === 5 ? 22 : 12); i++) glowStar(g, 48 + (r() - 0.5) * 60, 48 + (r() - 0.5) * 50, 2.5 + r() * 4, ["#b8ceff", "#dfe8ff", "#9fbaff"][i % 3]);
    } else if (t === "glob") {
      const gr = g.createRadialGradient(48, 48, 0, 48, 48, 26); gr.addColorStop(0, "rgba(255,225,170,0.85)"); gr.addColorStop(0.5, "rgba(255,200,140,0.3)"); gr.addColorStop(1, "rgba(255,190,120,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(48, 48, 26, 0, 7); g.fill();
      starField(g, r, 260 + v * 20, ["#ffd9a8", "#ffc285", "#fff0d8", "#ffb27a"], 48, 48, 28, 1.8);
    } else if (t === "neb") {
      if (v === 1) { cloud(g, r, 48, 50, 26, 20, "rgba(255,90,140,A)", 26, 0.22); cloud(g, r, 50, 46, 12, 10, "rgba(120,200,255,A)", 10, 0.2); for (let i = 0; i < 4; i++) glowStar(g, 44 + i * 3, 46 + (i % 2) * 3, 3, "#ffffff"); }
      else if (v === 2) { cloud(g, r, 48, 40, 34, 22, "rgba(255,70,90,A)", 28, 0.25); g.globalCompositeOperation = "source-over"; g.fillStyle = "#06060a"; g.beginPath(); g.moveTo(30, 96); g.lineTo(34, 60); g.bezierCurveTo(30, 48, 38, 36, 48, 38); g.bezierCurveTo(56, 36, 62, 44, 58, 50); g.bezierCurveTo(54, 54, 50, 52, 48, 56); g.lineTo(54, 96); g.closePath(); g.fill(); }
      else if (v === 3) { g.strokeStyle = "rgba(120,220,160,0.6)"; g.lineWidth = 8; g.beginPath(); g.ellipse(48, 48, 18, 14, 0.4, 0, 7); g.stroke(); g.strokeStyle = "rgba(255,120,90,0.5)"; g.lineWidth = 4; g.beginPath(); g.ellipse(48, 48, 23, 18, 0.4, 0, 7); g.stroke(); glowStar(g, 48, 48, 3, "#bfe0ff"); }
      else if (v === 4) { cloud(g, r, 48, 48, 22, 16, "rgba(140,170,255,A)", 18, 0.2); g.strokeStyle = "rgba(255,120,80,0.55)"; g.lineWidth = 1.5; for (let i = 0; i < 18; i++) { g.beginPath(); const a = r() * 7; g.moveTo(48 + Math.cos(a) * 6, 48 + Math.sin(a) * 5); g.lineTo(48 + Math.cos(a) * (18 + r() * 8), 48 + Math.sin(a) * (14 + r() * 6)); g.stroke(); } }
      else if (v === 5) { cloud(g, r, 48, 48, 30, 18, "rgba(255,110,150,A)", 26, 0.22); g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(5,5,10,0.8)"; g.fillRect(20, 46, 56, 4); }
      else { cloud(g, r, 48, 46, 30, 26, "rgba(120,200,170,A)", 20, 0.18); cloud(g, r, 48, 40, 26, 20, "rgba(255,170,90,A)", 14, 0.15); g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(30,22,18,0.92)"; for (const [x, w, h] of [[32, 8, 40], [48, 10, 48], [64, 7, 30]]) { g.beginPath(); g.moveTo(x - w, 96); g.lineTo(x - w * 0.6, 96 - h); g.quadraticCurveTo(x, 90 - h - 6, x + w * 0.6, 96 - h); g.lineTo(x + w, 96); g.fill(); } }
    } else if (t === "gal") {
      const spiral = (cx, cy, R, tilt, rot, col) => { g.save(); g.translate(cx, cy); g.scale(1, tilt); g.rotate(rot); for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 70; i++) { const a = i / 70 * 4.2 + arm * Math.PI, d = 3 + i / 70 * R; g.fillStyle = col; g.globalAlpha = 0.25 + 0.4 * (1 - i / 70); g.beginPath(); g.arc(Math.cos(a) * d + (r() - 0.5) * 3, Math.sin(a) * d + (r() - 0.5) * 3, 1.5 + r() * 2, 0, 7); g.fill(); } g.globalAlpha = 1; const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.35); gr.addColorStop(0, "rgba(255,235,200,0.95)"); gr.addColorStop(1, "rgba(255,220,170,0)"); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.35, 0, 7); g.fill(); g.restore(); };
      if (v === 1) { spiral(48, 48, 34, 1, 0.3, "rgba(170,190,255,1)"); g.fillStyle = "rgba(255,230,180,0.5)"; g.fillRect(40, 45, 16, 6); }
      else if (v === 2) spiral(48, 48, 38, 0.38, 0.5, "rgba(190,200,255,1)");
      else if (v === 3) cloud(g, r, 48, 48, 26, 16, "rgba(200,210,255,A)", 30, 0.2);
      else if (v === 4) { const gr = g.createRadialGradient(48, 48, 0, 48, 48, 36); gr.addColorStop(0, "rgba(255,240,210,0.95)"); gr.addColorStop(1, "rgba(255,220,170,0)"); g.save(); g.translate(48, 48); g.scale(1, 0.38); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 36, 0, 7); g.fill(); g.restore(); g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(30,15,10,0.85)"; g.beginPath(); g.ellipse(48, 50, 34, 3, 0, 0, 7); g.fill(); }
      else if (v === 5) { spiral(44, 46, 30, 1, 1.2, "rgba(180,200,255,1)"); glowStar(g, 70, 70, 7, "#ffd8a0"); }
      else spiral(48, 48, 32, 0.7, 2, "rgba(200,190,255,1)");
    }
    g.globalCompositeOperation = "source-over"; end();
  }
  function drawStar(g, col) {
    const end = frameDisc(g, "#04060c"); const r = rng(hash(col)); starField(g, r, 30, ["#ffffff"], 48, 48, 46, 1);
    g.globalCompositeOperation = "lighter";
    const gr = g.createRadialGradient(48, 48, 0, 48, 48, 34); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.18, col); gr.addColorStop(0.5, col.length === 7 ? col + "55" : col); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(48, 48, 34, 0, 7); g.fill();
    g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = 1.5; for (const a of [0, Math.PI / 2]) { g.beginPath(); g.moveTo(48 + Math.cos(a) * 40, 48 + Math.sin(a) * 40); g.lineTo(48 - Math.cos(a) * 40, 48 - Math.sin(a) * 40); g.stroke(); }
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; end();
  }

  // ---------- 분자·원소·이온 ----------
  const CPK = { H: "#f4f4f4", O: "#e0342b", C: "#3b3d42", N: "#3555e0", Cl: "#3ec43a", Na: "#9b5de5", F: "#9fe35a", S: "#e8d23a", I: "#8a3ab8", K: "#8b4fd6", Ca: "#7ed36b", Mg: "#4fd38c", Cu: "#d0773c", Ag: "#c8ccd2", Fe: "#9aa0a8", Au: "#f2c43c", He: "#d9f4ff", Ne: "#ff8a4a", Ar: "#c9a8ff", NH4: "#6f88ee", OH: "#ec6a5e", SO4: "#e9cf44", NO3: "#5c79e8", CO3: "#6b6f78" };
  function ball(g, x, y, R, col, label) {
    g.beginPath(); g.arc(x, y, R, 0, 7); g.fillStyle = col; g.fill(); shade(g, x, y, R); g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 1; g.stroke();
    if (label) { g.fillStyle = col === CPK.C || col === "#3b3d42" || col === CPK.I ? "#fff" : "#1a1a1a"; g.font = `bold ${Math.max(9, R * 0.85)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, x, y + 1); }
  }
  function bond(g, x1, y1, x2, y2, n) { g.strokeStyle = "#7c7f86"; g.lineWidth = 3; for (let k = 0; k < (n || 1); k++) { const o = (k - ((n || 1) - 1) / 2) * 4, dx = y2 - y1, dy = x1 - x2, l = Math.hypot(dx, dy) || 1; g.beginPath(); g.moveTo(x1 + dx / l * o, y1 + dy / l * o); g.lineTo(x2 + dx / l * o, y2 + dy / l * o); g.stroke(); } }
  function drawMol(g, f) {
    const A = (x, y, el, R) => ball(g, x, y, R || (el === "H" ? 11 : 16), CPK[el] || "#aaa", el);
    switch (f) {
      case "H2": bond(g, 36, 50, 60, 50); A(36, 50, "H", 14); A(60, 50, "H", 14); break;
      case "O2": bond(g, 32, 50, 64, 50, 2); A(32, 50, "O"); A(64, 50, "O"); break;
      case "N2": bond(g, 32, 50, 64, 50, 3); A(32, 50, "N"); A(64, 50, "N"); break;
      case "H2O": bond(g, 48, 44, 26, 62); bond(g, 48, 44, 70, 62); A(26, 62, "H"); A(70, 62, "H"); A(48, 44, "O", 18); break;
      case "CO2": bond(g, 20, 50, 76, 50, 2); A(20, 50, "O", 14); A(76, 50, "O", 14); A(48, 50, "C", 15); break;
      case "NH3": for (const [x, y] of [[26, 64], [70, 64], [48, 74]]) bond(g, 48, 44, x, y); A(26, 64, "H"); A(70, 64, "H"); A(48, 44, "N", 17); A(48, 74, "H"); break;
      case "CH4": for (const [x, y] of [[48, 18], [22, 64], [74, 64], [48, 78]]) bond(g, 48, 50, x, y); A(48, 18, "H"); A(22, 64, "H"); A(74, 64, "H"); A(48, 50, "C", 16); A(48, 78, "H"); break;
      case "H2O2": bond(g, 18, 36, 36, 52); bond(g, 36, 52, 60, 52); bond(g, 60, 52, 78, 68); A(18, 36, "H"); A(78, 68, "H"); A(36, 52, "O", 14); A(60, 52, "O", 14); break;
      case "HCl": bond(g, 32, 50, 58, 50); A(32, 50, "H", 13); A(60, 50, "Cl", 20); break;
      case "N2O": bond(g, 18, 50, 78, 50, 2); A(20, 50, "N", 14); A(48, 50, "N", 14); A(76, 50, "O", 14); break;
      case "O3": bond(g, 22, 62, 48, 42); bond(g, 48, 42, 74, 62, 2); A(22, 62, "O", 14); A(48, 42, "O", 14); A(74, 62, "O", 14); break;
      case "NaCl": for (let z = 1; z >= 0; z--) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { const px = 24 + x * 22 + z * 8, py = 28 + y * 22 - z * 8, na = (x + y + z) % 2 === 0; ball(g, px, py, na ? 8 : 10, na ? CPK.Na : CPK.Cl); } break;
      case "C6H12O6": { const pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 - Math.PI / 2; pts.push([48 + Math.cos(a) * 24, 50 + Math.sin(a) * 24]); } for (let i = 0; i < 6; i++) bond(g, pts[i][0], pts[i][1], pts[(i + 1) % 6][0], pts[(i + 1) % 6][1]); pts.forEach(([x, y], i) => { bond(g, x, y, 48 + (x - 48) * 1.6, 50 + (y - 50) * 1.6); A(48 + (x - 48) * 1.6, 50 + (y - 50) * 1.6, "H", 7); }); pts.forEach(([x, y], i) => A(x, y, i === 0 ? "O" : "C", 9)); break; }
    }
  }
  function drawAtom(g, el) {
    if (el === "He" || el === "Ne" || el === "Ar") { // 원자 하나가 그대로 기체 분자
      if (el !== "He") { const gr = g.createRadialGradient(48, 50, 6, 48, 50, 40); gr.addColorStop(0, CPK[el] + "99"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.beginPath(); g.arc(48, 50, 40, 0, 7); g.fill(); }
      ball(g, 34, 54, 16, CPK[el], el); ball(g, 64, 42, 13, CPK[el]); return;
    }
    if (el === "C") { for (let layer = 0; layer < 3; layer++) { const oy = 30 + layer * 20, ox = layer % 2 ? 6 : 0; g.strokeStyle = "#55595f"; g.lineWidth = 2; for (let i = 0; i < 4; i++) { const cx = 18 + ox + i * 18; g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2; const x = cx + Math.cos(a) * 9, y = oy + Math.sin(a) * 5; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } } return; }
    for (let z = 1; z >= 0; z--) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ball(g, 24 + x * 22 + z * 8, 28 + y * 22 - z * 8, 10, CPK[el] || "#aaa", z === 0 && x === 1 && y === 1 ? el : "");
  }
  function drawIon(g, sym) {
    const col = CPK[sym] || "#aaa";
    const gr = g.createRadialGradient(48, 50, 10, 48, 50, 42); gr.addColorStop(0, col + "66"); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.beginPath(); g.arc(48, 50, 42, 0, 7); g.fill();
    if (sym.length > 2 && /\d/.test(sym) || sym === "OH") { // 여러 원자로 된 이온
      const parts = { NH4: ["N", "H", "H", "H", "H"], OH: ["O", "H"], SO4: ["S", "O", "O", "O", "O"], NO3: ["N", "O", "O", "O"], CO3: ["C", "O", "O", "O"] }[sym];
      const n = parts.length - 1;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 - Math.PI / 2, x = 48 + Math.cos(a) * 24, y = 50 + Math.sin(a) * 24; bond(g, 48, 50, x, y); ball(g, x, y, parts[i + 1] === "H" ? 9 : 12, CPK[parts[i + 1]]); }
      ball(g, 48, 50, 15, CPK[parts[0]]);
      g.fillStyle = "#fff"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.strokeStyle = "rgba(0,0,0,0.75)"; g.lineWidth = 3; const lab = sym.replace(/\d/g, d => "₀₁₂₃₄₅₆₇₈₉"[d]); g.strokeText(lab, 48, 92); g.fillText(lab, 48, 92); return;
    }
    ball(g, 48, 50, 28, col, sym);
  }

  // ---------- 세포·조류·혈구 ----------
  function micro(g) { const end = frameDisc(g, "#eef3e6"); return end; }
  function drawCell(g, kind, seedStr) {
    const r = rng(hash(seedStr)), end = micro(g);
    if (kind === "amoeba") { blobPath(g, 48, 50, 30, 24, r, 16, 0.6); g.fillStyle = "rgba(170,190,200,0.75)"; g.fill(); g.strokeStyle = "#6d8794"; g.lineWidth = 2; g.stroke(); g.fillStyle = "#5b6a8a"; g.beginPath(); g.arc(44, 48, 7, 0, 7); g.fill(); for (let i = 0; i < 10; i++) { g.fillStyle = "rgba(90,110,120,0.5)"; g.beginPath(); g.arc(30 + r() * 36, 34 + r() * 30, 1.5 + r() * 2, 0, 7); g.fill(); } }
    else if (kind === "paramecium") { g.save(); g.translate(48, 50); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, 36, 15, 0, 0, 7); g.fillStyle = "rgba(200,205,170,0.85)"; g.fill(); g.strokeStyle = "#7a8a5a"; g.lineWidth = 2; g.stroke(); g.strokeStyle = "rgba(90,100,70,0.7)"; g.lineWidth = 1; for (let i = 0; i < 40; i++) { const a = i / 40 * 7; g.beginPath(); g.moveTo(Math.cos(a) * 36, Math.sin(a) * 15); g.lineTo(Math.cos(a) * 41, Math.sin(a) * 19); g.stroke(); } g.fillStyle = "#6a6a96"; g.beginPath(); g.ellipse(-4, 0, 8, 5, 0, 0, 7); g.fill(); g.fillStyle = "rgba(255,255,255,0.7)"; g.beginPath(); g.arc(18, -3, 4, 0, 7); g.arc(-22, 3, 4, 0, 7); g.fill(); g.restore(); }
    else if (kind === "euglena") { g.save(); g.translate(48, 50); g.rotate(-0.6); g.beginPath(); g.moveTo(-34, 0); g.quadraticCurveTo(0, -18, 30, 0); g.quadraticCurveTo(0, 18, -34, 0); g.fillStyle = "rgba(120,190,110,0.9)"; g.fill(); g.strokeStyle = "#4a8a3e"; g.lineWidth = 2; g.stroke(); g.strokeStyle = "#4a8a3e"; g.beginPath(); g.moveTo(30, 0); g.bezierCurveTo(40, -8, 44, 8, 52, -2); g.stroke(); g.fillStyle = "#d33"; g.beginPath(); g.arc(22, -3, 2.5, 0, 7); g.fill(); for (let i = 0; i < 8; i++) { g.fillStyle = "#2f7a2a"; g.beginPath(); g.ellipse(-22 + i * 6, (r() - 0.5) * 8, 2.5, 1.5, 0, 0, 7); g.fill(); } g.restore(); }
    else if (kind === "chloroplast") { g.beginPath(); g.ellipse(48, 50, 36, 22, 0, 0, 7); g.fillStyle = "#7fc46a"; g.fill(); g.strokeStyle = "#3d7a30"; g.lineWidth = 2.5; g.stroke(); for (let i = 0; i < 6; i++) for (let k = 0; k < 4; k++) { g.fillStyle = "#2f6e24"; g.fillRect(24 + i * 8, 40 + k * 5 + (i % 2) * 4, 6, 3); } }
    else if (kind === "palisade") { for (let i = 0; i < 5; i++) { g.fillStyle = "rgba(190,225,170,0.9)"; g.fillRect(14 + i * 14, 18, 12, 62); g.strokeStyle = "#5f8f4e"; g.strokeRect(14.5 + i * 14, 18.5, 11, 61); for (let k = 0; k < 7; k++) { g.fillStyle = "#3f8a30"; g.beginPath(); g.arc(17 + i * 14 + (k % 2) * 6, 24 + k * 8, 2.4, 0, 7); g.fill(); } } }
    else if (kind === "stomata" || kind === "guard") {
      for (let i = 0; i < 8; i++) { g.strokeStyle = "rgba(140,160,120,0.6)"; g.beginPath(); g.moveTo(r() * 96, 0); g.lineTo(r() * 96, 96); g.stroke(); }
      const gc = (sx) => { g.beginPath(); g.ellipse(48 + sx * 10, 50, 10, 24, 0, 0, 7); g.fillStyle = "#8cc876"; g.fill(); g.strokeStyle = "#3e7a33"; g.lineWidth = 2; g.stroke(); for (let k = 0; k < 4; k++) { g.fillStyle = "#2e6e25"; g.beginPath(); g.arc(48 + sx * 12, 38 + k * 8, 2.2, 0, 7); g.fill(); } };
      if (kind === "guard") { gc(-1); g.strokeStyle = "#e45"; g.lineWidth = 2; g.beginPath(); g.ellipse(38, 50, 14, 28, 0, 0, 7); g.stroke(); gc(1); g.globalAlpha = 0.35; gc(1); g.globalAlpha = 1; }
      else { gc(-1); gc(1); g.fillStyle = "#3a2f25"; g.beginPath(); g.ellipse(48, 50, 3, 14, 0, 0, 7); g.fill(); }
    }
    end();
  }
  function drawAlga(g, kind, seedStr) {
    const r = rng(hash(seedStr));
    if (kind === "gim") { g.fillStyle = "#1e1a22"; g.fillRect(18, 18, 60, 64); g.fillStyle = "rgba(90,70,110,0.45)"; for (let i = 0; i < 60; i++) g.fillRect(18 + r() * 58, 18 + r() * 62, 2, 1); g.strokeStyle = "#3b2f48"; g.strokeRect(18.5, 18.5, 59, 63); return; }
    if (kind === "haekam") { g.strokeStyle = "#4fa35a"; g.lineWidth = 2; for (let i = 0; i < 22; i++) { g.beginPath(); let x = 20 + r() * 56, y = 86; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 18; y -= 11; g.lineTo(x, y); } g.stroke(); } return; }
    const col = kind === "dasima" ? "#4b3a1e" : "#5a6a2a", w = kind === "dasima" ? 22 : 10;
    for (let s = 0; s < (kind === "dasima" ? 2 : 4); s++) { g.fillStyle = col; g.beginPath(); const x0 = 30 + s * 12; g.moveTo(x0, 90); for (let y = 90; y > 10; y -= 8) g.lineTo(x0 + Math.sin(y / 10 + s) * 6 - w / 2, y); for (let y = 10; y <= 90; y += 8) g.lineTo(x0 + Math.sin(y / 10 + s) * 6 + w / 2 + (kind === "miyeok" ? Math.sin(y) * 4 : 0), y); g.fill(); g.strokeStyle = "rgba(0,0,0,0.3)"; g.stroke(); }
  }
  function drawBlood(g, kind, seedStr) {
    const r = rng(hash(seedStr));
    if (kind === "plasma") { g.fillStyle = "rgba(230,230,235,0.6)"; g.fillRect(36, 10, 24, 80); g.fillStyle = "#f3d36a"; g.fillRect(37, 20, 22, 46); g.fillStyle = "#e9e1c0"; g.fillRect(37, 66, 22, 4); g.fillStyle = "#9c1f22"; g.fillRect(37, 70, 22, 19); g.strokeStyle = "#8b8f96"; g.lineWidth = 2; g.strokeRect(36, 10, 24, 80); return; }
    const end = micro(g);
    const rbc = (x, y, s) => { g.beginPath(); g.arc(x, y, s, 0, 7); g.fillStyle = "#cf3a3a"; g.fill(); g.beginPath(); g.arc(x, y, s * 0.45, 0, 7); g.fillStyle = "#e57373"; g.fill(); };
    if (kind === "rbc") for (let i = 0; i < 9; i++) rbc(16 + r() * 64, 16 + r() * 64, 9 + r() * 3);
    else { for (let i = 0; i < 6; i++) rbc(16 + r() * 64, 16 + r() * 64, 7 + r() * 2); g.globalAlpha = kind === "wbc" ? 0.35 : 0.35; }
    g.globalAlpha = 1;
    if (kind === "wbc") { g.beginPath(); g.arc(48, 48, 22, 0, 7); g.fillStyle = "#d9d2ef"; g.fill(); g.fillStyle = "#5a3ea8"; for (const [x, y] of [[40, 42], [52, 40], [56, 52], [44, 54]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); } }
    if (kind === "platelet") for (let i = 0; i < 14; i++) { g.fillStyle = "#b07ac8"; blobPath(g, 22 + r() * 52, 22 + r() * 52, 3 + r() * 2, 2 + r() * 2, r, 7, 0.5); g.fill(); }
    end();
  }
  function drawJar(g, col, seedStr) {
    const r = rng(hash(seedStr));
    g.fillStyle = "#3c3f45"; g.fillRect(28, 8, 40, 10); g.fillStyle = "#575b63"; g.fillRect(28, 8, 40, 3);
    g.fillStyle = "rgba(215,230,240,0.35)"; g.fillRect(24, 18, 48, 72);
    g.fillStyle = "rgba(240,230,170,0.35)"; g.fillRect(25, 30, 46, 59);
    blobPath(g, 48, 58, 14 + r() * 6, 16 + r() * 8, r, 12, 0.45); g.fillStyle = col; g.fill(); shade(g, 48, 58, 22); g.strokeStyle = "rgba(0,0,0,0.25)"; g.stroke();
    if (r() < 0.5) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(48, 42); g.quadraticCurveTo(40 + r() * 16, 34, 48 + (r() - 0.5) * 20, 30); g.stroke(); }
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 3; g.beginPath(); g.moveTo(30, 24); g.lineTo(30, 84); g.stroke();
    g.strokeStyle = "rgba(120,140,155,0.9)"; g.lineWidth = 2; g.strokeRect(24, 18, 48, 72);
    g.fillStyle = "#f1ead8"; g.fillRect(34, 74, 28, 10); g.fillStyle = "#9c8d6c"; g.fillRect(37, 77, 22, 1.5); g.fillRect(37, 80, 16, 1.5);
  }
  function drawPea(g, kind) {
    const seed = (x, y, R, col, wr) => { g.beginPath(); if (wr) { for (let i = 0; i <= 14; i++) { const a = i / 14 * 7, k = 1 + (i % 2 ? -0.12 : 0.06); g.lineTo(x + Math.cos(a) * R * k, y + Math.sin(a) * R * k); } } else g.arc(x, y, R, 0, 7); g.fillStyle = col; g.fill(); shade(g, x, y, R); g.strokeStyle = "rgba(0,0,0,0.25)"; g.stroke(); if (wr) { g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + (i - 1.5) * 4, y, R * 0.6, 1, 2.2); g.stroke(); } } };
    const pod = (col, constrict) => { g.fillStyle = col; g.beginPath(); g.moveTo(10, 56); if (constrict) { for (let i = 0; i <= 4; i++) { const x = 10 + i * 19; g.quadraticCurveTo(x + 9, 30, x + 19, 50); } g.lineTo(86, 56); for (let i = 4; i >= 0; i--) { const x = 10 + i * 19; g.quadraticCurveTo(x + 9, 72, x, 58); } } else { g.bezierCurveTo(20, 24, 76, 24, 86, 50); g.bezierCurveTo(76, 76, 20, 76, 10, 56); } g.fill(); g.strokeStyle = "rgba(0,0,0,0.3)"; g.lineWidth = 1.5; g.stroke(); g.strokeStyle = "#3e5a1e"; g.beginPath(); g.moveTo(86, 50); g.lineTo(92, 44); g.stroke(); };
    const flower = (x, y, col, s) => { for (let i = 0; i < 5; i++) { const a = i / 5 * 7; g.fillStyle = col; g.beginPath(); g.ellipse(x + Math.cos(a) * 6 * s, y + Math.sin(a) * 6 * s, 6 * s, 4 * s, a, 0, 7); g.fill(); } g.fillStyle = "#f6e27a"; g.beginPath(); g.arc(x, y, 2.5 * s, 0, 7); g.fill(); };
    const stem = (h) => { g.strokeStyle = "#4e8a2e"; g.lineWidth = 4; g.beginPath(); g.moveTo(48, 92); g.lineTo(48, 92 - h); g.stroke(); g.fillStyle = "#68a83e"; for (let y = 92 - 12; y > 92 - h; y -= 16) { g.beginPath(); g.ellipse(40, y, 8, 4, -0.5, 0, 7); g.fill(); g.beginPath(); g.ellipse(56, y - 6, 8, 4, 0.5, 0, 7); g.fill(); } };
    switch (kind) {
      case "round": seed(34, 50, 16, "#c9cf6a"); seed(62, 54, 15, "#c3c965"); break;
      case "wrinkled": seed(34, 50, 15, "#c4c46a", true); seed(62, 54, 14, "#bdbd62", true); break;
      case "yellow": seed(34, 50, 15, "#f1d23c"); seed(62, 54, 14, "#ead045"); break;
      case "green": seed(34, 50, 15, "#6fb03c"); seed(62, 54, 14, "#66a836"); break;
      case "purple": stem(60); flower(48, 30, "#8a4fc8", 1.6); break;
      case "white": stem(60); flower(48, 30, "#f6f4ee", 1.6); break;
      case "greenpod": pod("#5fa83a"); break;
      case "yellowpod": pod("#e9cf4a"); break;
      case "inflated": pod("#6ab040"); break;
      case "constricted": pod("#6ab040", true); break;
      case "axial": stem(80); for (const y of [30, 50, 70]) flower(y % 40 ? 60 : 36, y, "#f6f4ee", 0.8); break;
      case "terminal": stem(70); flower(42, 22, "#f6f4ee", 0.8); flower(54, 20, "#f6f4ee", 0.8); flower(48, 14, "#f6f4ee", 0.8); break;
      case "tall": stem(86); break;
      case "short": stem(30); break;
    }
  }
  function drawNano(g, kind) {
    g.strokeStyle = "#3c4048"; g.lineWidth = 2.2;
    const hex = (cx, cy, s, sy) => { g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s * (sy || 1); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); };
    if (kind === "graphene") { for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) hex(14 + col * 14 + (row % 2) * 7, 16 + row * 12, 8); }
    else { for (let i = 0; i < 7; i++) for (let k = 0; k < 4; k++) hex(18 + i * 10, 34 + k * 9 + (i % 2) * 4, 6, 0.8); g.strokeStyle = "#7d838d"; g.beginPath(); g.ellipse(14, 50, 6, 18, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(84, 50, 6, 18, 0, 0, 7); g.stroke(); }
  }
  function drawText(g, t) {
    g.fillStyle = "#f4efe2"; g.fillRect(10, 26, 76, 44); g.strokeStyle = "#8a7a5a"; g.lineWidth = 3; g.strokeRect(10, 26, 76, 44);
    g.fillStyle = "#2b2b2b"; g.font = "bold 20px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, 48, 49, 70);
  }

  // ---------- 전시물 그림 ----------
  function object(item) {
    const key = "o" + item.index; if (cache.has(key)) return cache.get(key);
    const c = mk(O, O), g = c.getContext("2d");
    const [kind, ...rest] = item.icon.split(":"), arg = rest.join(":");
    try {
      if (kind === "e") drawEmojiIcon(g, arg);
      else if (kind === "rock") drawRock(g, arg, item.name);
      else if (kind === "min") drawMineral(g, arg, item.name);
      else if (kind === "planet") drawPlanet(g, arg, item.name);
      else if (kind === "sky") drawSky(g, arg, item.name);
      else if (kind === "star") drawStar(g, arg);
      else if (kind === "mol") drawMol(g, arg);
      else if (kind === "atom") drawAtom(g, arg);
      else if (kind === "ion") drawIon(g, arg);
      else if (kind === "cell") drawCell(g, arg, item.name);
      else if (kind === "alga") drawAlga(g, arg, item.name);
      else if (kind === "blood") drawBlood(g, arg, item.name);
      else if (kind === "jar") drawJar(g, arg, item.name);
      else if (kind === "pea") drawPea(g, arg);
      else if (kind === "nano") drawNano(g, arg);
      else drawText(g, item.name.slice(0, 4));
    } catch (e) { drawText(g, item.name.slice(0, 4)); }
    if (kind === "e" && !atlasReady) return c;   // 아틀라스가 오면 다시 그린다
    cache.set(key, c); return c;
  }
  function pedestal(g, accent) {
    const top = STAND_TOP;
    if (provided.pedestal) { g.drawImage(provided.pedestal, 0, top, STAND_W, STAND_H - top); return; }
    g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(48, STAND_H - 3, 40, 5, 0, 0, 7); g.fill();
    g.fillStyle = "#4a4237"; g.fillRect(12, STAND_H - 14, 72, 12);
    const body = g.createLinearGradient(16, 0, 80, 0); body.addColorStop(0, "#d8d2c6"); body.addColorStop(0.5, "#f1ede4"); body.addColorStop(1, "#c9c2b5");
    g.fillStyle = body; g.fillRect(16, top + 10, 64, STAND_H - top - 24);
    g.fillStyle = accent || "#8a7a5a"; g.fillRect(16, top + 14, 64, 5);
    g.fillStyle = "#fbf8f2"; g.fillRect(10, top, 76, 11); g.fillStyle = "#d8d1c3"; g.fillRect(10, top + 9, 76, 3);
    g.fillStyle = "#b8975a"; g.fillRect(34, top + 34, 28, 14); g.fillStyle = "#e3c985"; g.fillRect(36, top + 36, 24, 2); g.fillStyle = "#7d6640"; g.fillRect(37, top + 40, 22, 1.5); g.fillRect(37, top + 43, 15, 1.5);
  }
  // 받침대 위 전시물 (진짜 전시물과 받침대에 올라간 미믹이 똑같이 보이도록 같은 그림을 쓴다)
  function exhibit(item, accent) {
    const key = "x" + (item ? item.index : -1) + accent; if (cache.has(key)) return cache.get(key);
    const c = mk(STAND_W, STAND_H), g = c.getContext("2d");
    pedestal(g, accent);
    if (item) { const o = object(item); g.drawImage(o, 0, STAND_TOP - O + 6, O, O); if (item.icon.startsWith("e:") && !atlasReady) return c; }
    cache.set(key, c); return c;
  }
  function loose(item) { // 받침대에서 내려온 미믹(움직이는 물건)
    const key = "l" + item.index; if (cache.has(key)) return cache.get(key);
    const c = mk(O, O + 10), g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0.28)"; g.beginPath(); g.ellipse(48, O + 4, 30, 5, 0, 0, 7); g.fill();
    g.drawImage(object(item), 0, 0);
    if (item.icon.startsWith("e:") && !atlasReady) return c;
    cache.set(key, c); return c;
  }

  // ---------- 학예사(찾는 쪽) ----------
  function curator(color, frame, jailed, team) {
    const key = "c" + color + frame + (jailed ? 1 : 0); if (cache.has(key)) return cache.get(key);
    const c = mk(80, 168), g = c.getContext("2d");
    const pim = provided["curator" + ((team || 0) + 1)] || provided.curator;
    if (pim) {
      const s = Math.min(80 / pim.width, 168 / pim.height), w = pim.width * s, h = pim.height * s;
      g.drawImage(pim, (80 - w) / 2 + (frame ? 1 : -1), 168 - h, w, h);
      if (!provided["curator" + ((team || 0) + 1)]) { g.fillStyle = color; g.fillRect(0, 160, 80, 8); }
      if (jailed) { g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(60,60,70,0.6)"; g.fillRect(0, 0, 80, 168); g.globalCompositeOperation = "source-over"; }
      cache.set(key, c); return c;
    }
    const legOff = frame ? 5 : -5;
    g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(40, 163, 26, 5, 0, 0, 7); g.fill();
    g.fillStyle = "#2f3340"; g.fillRect(27 + legOff * 0.4, 112, 11, 46); g.fillRect(43 - legOff * 0.4, 112, 11, 46);
    g.fillStyle = "#1c1d22"; g.fillRect(24 + legOff * 0.4, 154, 16, 8); g.fillRect(41 - legOff * 0.4, 154, 16, 8);
    g.fillStyle = "#f4f1ea"; g.fillRect(20, 58, 40, 58);
    g.fillStyle = color; g.fillRect(22, 60, 14, 54); g.fillRect(44, 60, 14, 54);
    g.fillStyle = "#e7ddc9"; g.fillRect(36, 60, 8, 10);
    g.fillStyle = "#f2c9a0"; g.fillRect(12, 64, 9, 38); g.fillRect(59, 64, 9, 30);
    g.fillStyle = "#c79a58"; g.beginPath(); g.arc(68, 100, 9, 0, 7); g.fill(); g.fillStyle = "#cfe8ff"; g.beginPath(); g.arc(68, 100, 6, 0, 7); g.fill(); g.fillStyle = "#6b4b2a"; g.fillRect(65, 107, 4, 12);
    g.fillStyle = "#f2c9a0"; g.beginPath(); g.arc(40, 38, 19, 0, 7); g.fill();
    g.fillStyle = "#2a2220"; g.beginPath(); g.arc(40, 30, 19, Math.PI, 0); g.fill(); g.fillRect(21, 28, 6, 12); g.fillRect(53, 28, 6, 12);
    g.fillStyle = "#1c1c1c"; g.fillRect(31, 38, 5, 5); g.fillRect(44, 38, 5, 5);
    g.strokeStyle = "#7a5a3a"; g.lineWidth = 2; g.beginPath(); g.arc(40, 46, 5, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = "#fff"; g.fillRect(24, 76, 10, 7); g.fillStyle = color; g.fillRect(25, 77, 8, 2);
    if (jailed) { g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(60,60,70,0.6)"; g.fillRect(0, 0, 80, 168); g.globalCompositeOperation = "source-over"; }
    cache.set(key, c); return c;
  }

  // ---------- 가구 ----------
  function decor(kind) {
    const key = "d" + kind; if (cache.has(key)) return cache.get(key);
    let c;
    if (provided[kind]) { c = provided[kind]; cache.set(key, c); return c; }
    if (kind === "bench") { c = mk(120, 60); const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(8, 54, 104, 5); g.fillStyle = "#6b4a2c"; g.fillRect(10, 22, 100, 12); g.fillStyle = "#8a6038"; g.fillRect(10, 20, 100, 5); g.fillStyle = "#3a3a3e"; g.fillRect(16, 34, 8, 22); g.fillRect(96, 34, 8, 22); }
    else if (kind === "plant") { c = mk(64, 110); const g = c.getContext("2d"); g.fillStyle = "#a35f3a"; g.beginPath(); g.moveTo(16, 70); g.lineTo(48, 70); g.lineTo(44, 106); g.lineTo(20, 106); g.closePath(); g.fill(); const r = rng(7); for (let i = 0; i < 14; i++) { g.fillStyle = ["#3f8a3a", "#58a84a", "#2f6e2c"][i % 3]; g.beginPath(); g.ellipse(32 + (r() - 0.5) * 34, 20 + r() * 50, 7, 16, (r() - 0.5) * 1.6, 0, 7); g.fill(); } }
    else if (kind === "desk") { c = mk(140, 80); const g = c.getContext("2d"); g.fillStyle = "#3d4a5e"; g.fillRect(6, 24, 128, 52); g.fillStyle = "#566886"; g.fillRect(4, 18, 132, 10); g.fillStyle = "#e9e3d6"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.fillText("안내", 70, 56); }
    else if (kind === "vending") { c = mk(70, 130); const g = c.getContext("2d"); g.fillStyle = "#b83a3a"; g.fillRect(4, 4, 62, 124); g.fillStyle = "#cfe8f6"; g.fillRect(10, 12, 38, 70); for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) { g.fillStyle = ["#e5c64a", "#59a3e0", "#e57a3a"][(x + y) % 3]; g.fillRect(13 + x * 12, 16 + y * 17, 8, 12); } g.fillStyle = "#2a2a2a"; g.fillRect(10, 92, 38, 14); g.fillStyle = "#ddd"; g.fillRect(52, 30, 8, 20); }
    else if (kind === "trash") { c = mk(56, 74); const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(28, 70, 22, 4, 0, 0, 7); g.fill(); const b = g.createLinearGradient(8, 0, 48, 0); b.addColorStop(0, "#4f6b5a"); b.addColorStop(0.5, "#6f9079"); b.addColorStop(1, "#486152"); g.fillStyle = b; g.beginPath(); g.moveTo(9, 18); g.lineTo(47, 18); g.lineTo(43, 70); g.lineTo(13, 70); g.closePath(); g.fill(); g.fillStyle = "#3a4d41"; g.fillRect(6, 12, 44, 8); g.fillStyle = "#5b7a66"; g.fillRect(20, 7, 16, 6); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 2; for (const x of [20, 28, 36]) { g.beginPath(); g.moveTo(x, 26); g.lineTo(x - 1, 62); g.stroke(); } g.fillStyle = "#f2f2f2"; g.fillRect(23, 36, 10, 8); g.fillStyle = "#4f6b5a"; g.fillRect(25, 38, 6, 1.5); g.fillRect(25, 41, 6, 1.5); }
    else if (kind === "extinguisher") { c = mk(44, 88); const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(22, 84, 15, 3.5, 0, 0, 7); g.fill(); const b = g.createLinearGradient(9, 0, 35, 0); b.addColorStop(0, "#a8231c"); b.addColorStop(0.45, "#e0473a"); b.addColorStop(1, "#9a1f19"); g.fillStyle = b; g.beginPath(); g.moveTo(10, 30); g.quadraticCurveTo(10, 22, 22, 21); g.quadraticCurveTo(34, 22, 34, 30); g.lineTo(34, 82); g.lineTo(10, 82); g.closePath(); g.fill(); g.fillStyle = "#2a2a2e"; g.fillRect(17, 12, 10, 10); g.fillRect(14, 8, 18, 5); g.strokeStyle = "#1e1e22"; g.lineWidth = 3; g.beginPath(); g.moveTo(28, 12); g.quadraticCurveTo(40, 18, 36, 40); g.stroke(); g.fillStyle = "#f4f0e6"; g.fillRect(12, 44, 20, 18); g.fillStyle = "#c62828"; g.font = "bold 9px sans-serif"; g.textAlign = "center"; g.fillText("소화기", 22, 56); g.fillStyle = "#e8e8e8"; g.beginPath(); g.arc(22, 32, 4, 0, 7); g.fill(); }
    else if (kind === "rope") { c = mk(120, 70); const g = c.getContext("2d"); g.fillStyle = "#c8a64a"; for (const x of [10, 104]) { g.fillRect(x, 18, 6, 48); g.beginPath(); g.arc(x + 3, 16, 6, 0, 7); g.fill(); g.fillRect(x - 6, 62, 18, 6); } g.strokeStyle = "#9b1d2a"; g.lineWidth = 5; g.beginPath(); g.moveTo(14, 22); g.quadraticCurveTo(60, 46, 106, 22); g.stroke(); }
    else { c = mk(80, 110); const g = c.getContext("2d"); g.fillStyle = "#30343c"; g.fillRect(36, 40, 8, 66); g.fillStyle = "#f3efe5"; g.fillRect(8, 6, 64, 44); g.strokeStyle = "#555"; g.strokeRect(8.5, 6.5, 63, 43); g.fillStyle = "#4b6aa8"; g.fillRect(14, 12, 52, 6); g.fillStyle = "#999"; for (let i = 0; i < 4; i++) g.fillRect(14, 24 + i * 6, 40 - i * 6, 2); }
    cache.set(key, c); return c;
  }

  // ---------- 미믹 표시 ----------
  // 움직이는 미믹: 그림 위에 동그란 눈알 두 개 (dir: 눈동자 방향 -1·1)
  function withEyes(img, key, dir) {
    const k = "ey" + key + dir; if (cache.has(k)) return cache.get(k);
    const c = mk(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const R = Math.max(6, Math.min(img.width * 0.15, img.height * 0.11)), cy = Math.max(R + 2, img.height * 0.3), cx = img.width / 2;
    for (const sx of [-1, 1]) {
      const x = cx + sx * R * 1.1;
      g.fillStyle = "#fff"; g.strokeStyle = "#1b1b1b"; g.lineWidth = Math.max(1.5, R * 0.16); g.beginPath(); g.arc(x, cy, R, 0, 7); g.fill(); g.stroke();
      g.fillStyle = "#111"; g.beginPath(); g.arc(x + dir * R * 0.42, cy + R * 0.18, R * 0.5, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(x + dir * R * 0.42 - R * 0.16, cy + R * 0.02, R * 0.14, 0, 7); g.fill();
    }
    if (!atlasReady) return c;
    cache.set(k, c); return c;
  }
  // 학예사가 쏜 진짜 물건: 빨간 '진짜' 도장 (fy: 도장 높이 비율)
  function stamped(img, key, fy) {
    const k = "st" + key; if (cache.has(k)) return cache.get(k);
    const c = mk(img.width, img.height), g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const R = Math.min(img.width * 0.4, img.height * 0.28), cx = img.width / 2, cy = img.height * (fy || 0.4);
    g.save(); g.translate(cx, cy); g.rotate(-0.3);
    g.strokeStyle = "rgba(206,28,28,0.92)"; g.lineWidth = Math.max(2, R * 0.13); g.beginPath(); g.arc(0, 0, R, 0, 7); g.stroke();
    g.lineWidth = Math.max(1, R * 0.05); g.beginPath(); g.arc(0, 0, R * 0.8, 0, 7); g.stroke();
    g.fillStyle = "rgba(206,28,28,0.95)"; g.font = `bold ${Math.round(R * 0.62)}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("진짜", 0, 1);
    g.restore();
    if (!atlasReady) return c;
    cache.set(k, c); return c;
  }

  // ---------- 벽 ----------
  function wall(accent, kind) {
    const key = "w" + accent + kind; if (cache.has(key)) return cache.get(key);
    const c = mk(128, WH), g = c.getContext("2d");
    const base = kind === "rest" ? "#e9e4da" : kind === "lobby" ? "#efe8dc" : "#ece8e1";
    g.fillStyle = base; g.fillRect(0, 0, 128, WH);
    const r = rng(hash(accent + kind)); for (let i = 0; i < 380; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.03})`; g.fillRect(r() * 128, r() * WH, 2, 2); }
    g.fillStyle = accent; g.fillRect(0, 0, 128, 12); g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, 12, 128, 3);
    g.fillStyle = "rgba(0,0,0,0.05)"; g.fillRect(0, 118, 128, 2);
    g.fillStyle = "#5a4a3a"; g.fillRect(0, WH - 22, 128, 22); g.fillStyle = "#7a6650"; g.fillRect(0, WH - 22, 128, 4);
    g.fillStyle = "rgba(0,0,0,0.07)"; g.fillRect(0, 0, 2, WH); g.fillRect(126, 0, 2, WH);
    cache.set(key, c); return c;
  }
  function frameArt(accent, seed) { // 쉬는 공간 벽에 걸린 그림
    const key = "fa" + accent + seed; if (cache.has(key)) return cache.get(key);
    const c = wall(accent, "rest"), out = mk(128, WH), g = out.getContext("2d"); g.drawImage(c, 0, 0);
    const r = rng(seed); g.fillStyle = "#6b5236"; g.fillRect(24, 44, 80, 64); g.fillStyle = ["#8fb8de", "#e6c27a", "#b8d48f"][seed % 3]; g.fillRect(30, 50, 68, 52);
    g.fillStyle = "rgba(255,255,255,0.5)"; g.beginPath(); g.arc(50 + r() * 30, 68, 8, 0, 7); g.fill(); g.fillStyle = "rgba(60,90,60,0.6)"; g.beginPath(); g.moveTo(30, 102); g.lineTo(54, 74); g.lineTo(98, 102); g.fill();
    cache.set(key, out); return out;
  }
  // 전시실 표지판: 벽 세 칸에 걸친 큰 그림. 칸마다 128px씩 잘라 쓴다.
  function sign(room, accent) {
    const key = "s" + room.index; if (cache.has(key)) return cache.get(key);
    const c = mk(384, WH), g = c.getContext("2d");
    for (let i = 0; i < 3; i++) g.drawImage(wall(accent, "room"), i * 128, 0);
    g.fillStyle = "#24262b"; g.fillRect(52, 30, 280, 62); g.fillStyle = accent; g.fillRect(52, 30, 280, 5);
    const lines = splitName(room.name);
    g.fillStyle = "#f6f2e8"; g.textAlign = "center"; g.textBaseline = "middle";
    if (lines.length === 1) { g.font = "bold 28px sans-serif"; g.fillText(lines[0], 192, 64, 264); }
    else { g.font = "bold 22px sans-serif"; g.fillText(lines[0], 192, 53, 264); g.font = "bold 16px sans-serif"; g.fillText(lines[1], 192, 77, 264); }
    const w = MM.WING_BY_ID[room.wing]; g.fillStyle = "#4a4d55"; g.font = "13px sans-serif"; g.fillText(w ? w.name + " 전시동" : "", 192, 106, 300);
    cache.set(key, c); return c;
  }
  function splitName(n) { const m = n.match(/^(.*?)\s*(\(.*\))$/); if (m) return [m[1], m[2]]; if (n.length > 11) { const i = n.lastIndexOf(" ", 11); if (i > 0) return [n.slice(0, i), n.slice(i + 1)]; } return [n]; }
  function restSign(name) {
    const key = "rs" + name; if (cache.has(key)) return cache.get(key);
    const c = mk(384, WH), g = c.getContext("2d");
    for (let i = 0; i < 3; i++) g.drawImage(wall("#8a7a5a", "rest"), i * 128, 0);
    g.fillStyle = "#5a4a3a"; g.fillRect(92, 34, 200, 46); g.fillStyle = "#f6f2e8"; g.font = "bold 24px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, 192, 58, 186);
    cache.set(key, c); return c;
  }
  // 작은 아이콘(HUD용): 전시물 그림을 원하는 크기 캔버스로
  function thumb(item, size) { const c = mk(size, size); c.getContext("2d").drawImage(object(item), 0, 0, size, size); return c; }
  function clear() { cache.clear(); }
  // 3D 모델로 그린 가구 그림 등을 넣어 쓴다(변신 고르기·HUD·관제실 지도)
  function provide(name, img) { provided[name] = img; cache.delete("d" + name); }

  const WING_COLORS = ["#c0504d", "#4f81bd", "#9bbb59", "#8064a2", "#4bacc6", "#f79646", "#2c7a6b", "#b5874b", "#c2185b", "#5d6d7e", "#7cb342", "#6d4c41", "#00897b", "#3949ab", "#e65100", "#8e24aa"];
  function wingColor(wingId) { const w = MM.WING_BY_ID[wingId]; return w ? WING_COLORS[w.index % WING_COLORS.length] : "#8a7a5a"; }

  return { load, whenReady, object, exhibit, loose, curator, decor, withEyes, stamped, wall, sign, restSign, frameArt, thumb, clear, provide, wingColor, STAND_H, STAND_W, get ready() { return atlasReady; }, _hash: hash, _rng: rng };
})();
