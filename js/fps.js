// 1인칭 레이캐스팅 렌더러 — 밝은 과학관 조명, 벽 텍스처·표지판, 받침대·인물 스프라이트, 조준한 대상 찾기
window.Fps = (function () {
  let buf, bctx, RW = 360, RH = 200, zbuf = null, tmp = null, tctx = null;
  const FOV = 0.72, WALL_H = 1.6;
  const isTouch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  function cap() {
    const q = window.Options ? Options.get("quality") : "auto";
    return q === "high" ? 520 : q === "mid" ? 400 : q === "low" ? 300 : (isTouch ? 400 : 520);
  }
  function setup(W, H) {
    RW = Math.min(cap(), Math.max(220, Math.floor(W / 2.2)));
    RH = Math.max(120, Math.round(RW * H / W));
    if (!buf) { buf = document.createElement("canvas"); bctx = buf.getContext("2d"); }
    buf.width = RW; buf.height = RH; zbuf = new Float32Array(RW);
    bctx.imageSmoothingEnabled = false;
  }
  const ACC = { lobby: "#b08a4a", rest: "#7d8f6a" };
  function accentOf(cell) { return !cell ? "#8a8070" : cell.kind === "room" ? Art.wingColor(cell.wing) : ACC[cell.kind] || "#8a8070"; }
  function texFor(M, tx, ty, side, rdx, rdy, hx, hy) {
    const face = side === 1 ? (rdy < 0 ? "S" : "N") : (rdx < 0 ? "E" : "W");
    const fx = hx - Math.floor(hx), fy = hy - Math.floor(hy);
    const u = face === "S" ? fx : face === "N" ? 1 - fx : face === "E" ? 1 - fy : fy;
    const k = tx + "," + ty + "," + face;
    const sg = M.signs.get(k);
    if (sg) {
      const cell = M.cells[sg.cell];
      const img = cell.kind === "room" ? Art.sign(MM.ROOMS[cell.room], accentOf(cell)) : Art.restSign(cell.name);
      return { img, col: sg.slice * 128 + Math.min(127, Math.floor(u * 128)) };
    }
    const nx = face === "S" ? tx : face === "N" ? tx : face === "E" ? tx + 1 : tx - 1;
    const ny = face === "S" ? ty + 1 : face === "N" ? ty - 1 : ty;
    const cell = Museum.cellAt(nx + 0.5, ny + 0.5);
    const art = M.wallArt.get(k);
    const img = art ? Art.frameArt(accentOf(cell), art) : Art.wall(accentOf(cell), cell ? cell.kind : "rest");
    return { img, col: Math.min(127, Math.floor(u * 128)) };
  }
  function light(d) { return Math.max(0.42, Math.min(1, 1.12 - d * 0.045)); }

  // st: { pos:{x,y,a}, look, bob, sprites:[{img,x,y,h,lift,name,nameColor,aimable,ref,wob}], now, gray }
  function render(ctx, W, H, st) {
    const M = Museum.cur; if (!M) return { aim: null };
    if (!buf || buf.width !== Math.min(cap(), Math.max(220, Math.floor(W / 2.2)))) setup(W, H);
    const g = bctx, p = st.pos;
    const dirX = Math.cos(p.a), dirY = Math.sin(p.a), planeX = -dirY * FOV, planeY = dirX * FOV;
    const horizon = RH / 2 + (st.bob || 0) + (st.look || 0) * RH;
    const K = RW / (2 * FOV), EYE = st.eye || 0.8;
    // 천장과 바닥
    let gr = g.createLinearGradient(0, 0, 0, horizon);
    gr.addColorStop(0, "#cfc9bd"); gr.addColorStop(1, "#8f8a80"); g.fillStyle = gr; g.fillRect(0, 0, RW, Math.max(0, horizon));
    gr = g.createLinearGradient(0, horizon, 0, RH);
    gr.addColorStop(0, "#5a4632"); gr.addColorStop(1, "#9a7450"); g.fillStyle = gr; g.fillRect(0, horizon, RW, RH - horizon);
    g.fillStyle = "rgba(0,0,0,0.16)";
    for (let i = 1; i < 40; i++) { const y = horizon + K * EYE / (i * 0.5); if (y > RH || y < horizon) continue; g.fillRect(0, y, RW, 1); }
    // 천장 조명 줄
    g.fillStyle = "rgba(255,250,235,0.35)";
    for (let i = 1; i < 30; i++) { const y = horizon - K * (WALL_H - EYE) / (i * 1.5); if (y < 0) break; g.fillRect(0, y, RW, 1); }
    // 벽
    for (let x = 0; x < RW; x++) {
      const camX = 2 * x / RW - 1, rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
      let mx = Math.floor(p.x), my = Math.floor(p.y);
      const ddx = Math.abs(1 / (rdx || 1e-9)), ddy = Math.abs(1 / (rdy || 1e-9));
      let sx, sy, sdx, sdy;
      if (rdx < 0) { sx = -1; sdx = (p.x - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - p.x) * ddx; }
      if (rdy < 0) { sy = -1; sdy = (p.y - my) * ddy; } else { sy = 1; sdy = (my + 1 - p.y) * ddy; }
      let side = 0, guard = 0;
      while (guard++ < 256) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
        if (Museum.opaque(mx, my)) break;
      }
      const perp = Math.max(0.0001, side === 0 ? sdx - ddx : sdy - ddy);
      zbuf[x] = perp;
      const lineH = K * WALL_H / perp, top = horizon - K * (WALL_H - EYE) / perp;
      const hx = p.x + perp * rdx, hy = p.y + perp * rdy;
      const t = texFor(M, mx, my, side, rdx, rdy, hx, hy);
      g.drawImage(t.img, t.col, 0, 1, t.img.height, x, top, 1, lineH);
      const b = light(perp) * (side ? 0.86 : 1);
      if (b < 0.99) { g.fillStyle = `rgba(20,16,12,${1 - b})`; g.fillRect(x, top, 1, lineH); }
    }
    // 스프라이트
    const sprites = st.sprites || [];
    for (const s of sprites) { const dx = s.x - p.x, dy = s.y - p.y; s._d2 = dx * dx + dy * dy; }
    sprites.sort((a, b) => b._d2 - a._d2);
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const center = Math.floor(RW / 2);
    let aim = null; const labels = [];
    for (const s of sprites) {
      if (s._d2 > 26 * 26) continue;
      const dx = s.x - p.x, dy = s.y - p.y;
      const trX = invDet * (dirY * dx - dirX * dy), trY = invDet * (-planeY * dx + planeX * dy);
      if (trY <= 0.12) continue;
      const img = s.img; if (!img) continue;
      let scrX = (RW / 2) * (1 + trX / trY) + (s.wob || 0) * RW / 400;
      const sh = (K / trY) * s.h, sw = sh * img.width / img.height;
      const bottom = horizon + K * (EYE - (s.lift || 0)) / trY, top = bottom - sh;
      const x0 = Math.floor(scrX - sw / 2), x1 = Math.ceil(scrX + sw / 2);
      const cx0 = Math.max(0, x0), cx1 = Math.min(RW, x1);
      const vy0 = Math.max(0, Math.floor(top)), vy1 = Math.min(RH, Math.ceil(bottom));
      if (cx1 <= cx0 || vy1 <= vy0) continue;
      // 조준: 화면 가운데 세로줄이 스프라이트 가운데 70% 안에 들고, 벽에 가리지 않을 때
      if (s.aimable && center >= scrX - sw * 0.35 && center <= scrX + sw * 0.35 && trY < zbuf[center]) aim = { s, dist: Math.sqrt(s._d2) };
      const tw = cx1 - cx0, th = vy1 - vy0;
      if (!tmp) { tmp = document.createElement("canvas"); tctx = tmp.getContext("2d"); }
      if (tmp.width < tw || tmp.height < th) { tmp.width = Math.max(tmp.width, tw); tmp.height = Math.max(tmp.height, th); tctx.imageSmoothingEnabled = false; }
      tctx.globalCompositeOperation = "source-over"; tctx.clearRect(0, 0, tw, th);
      const sy0 = (vy0 - top) / sh * img.height, shh = th / sh * img.height, sxPer = img.width / (x1 - x0);
      let any = false, run = -1;
      for (let x = cx0; x <= cx1; x++) {
        const vis = x < cx1 && trY < zbuf[x];
        if (vis && run < 0) run = x;
        else if (!vis && run >= 0) { const a = (run - x0) * sxPer, bw = Math.max(1e-3, (x - run) * sxPer); tctx.drawImage(img, a, sy0, Math.min(bw, img.width - a), shh, run - cx0, 0, x - run, th); any = true; run = -1; }
      }
      if (!any) continue;
      const b = light(trY) * (s.dim || 1);
      if (b < 0.99) { tctx.globalCompositeOperation = "source-atop"; tctx.fillStyle = `rgba(20,16,12,${1 - b})`; tctx.fillRect(0, 0, tw, th); }
      if (s.tint) { tctx.globalCompositeOperation = "source-atop"; tctx.fillStyle = s.tint; tctx.fillRect(0, 0, tw, th); }
      g.globalAlpha = s.alpha == null ? 1 : s.alpha; g.drawImage(tmp, 0, 0, tw, th, cx0, vy0, tw, th); g.globalAlpha = 1;
      if (s.name && trY < 9 && trY < zbuf[Math.max(0, Math.min(RW - 1, Math.round(scrX)))] + 0.5) labels.push({ x: scrX, y: top, text: s.name, color: s.nameColor || "#fff", d: trY });
    }
    if (st.gray) { g.fillStyle = "rgba(80,80,90,0.55)"; g.globalCompositeOperation = "saturation"; g.fillRect(0, 0, RW, RH); g.globalCompositeOperation = "source-over"; g.fillStyle = "rgba(40,40,50,0.35)"; g.fillRect(0, 0, RW, RH); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, W, H);
    // 이름표는 고해상도로
    const kx = W / RW, ky = H / RH;
    for (const l of labels) {
      const fs = Math.max(11, Math.min(18, 22 - l.d * 1.3));
      ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      const tw2 = ctx.measureText(l.text).width + 10, x = l.x * kx, y = Math.max(fs + 6, l.y * ky - 4);
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x - tw2 / 2, y - fs - 4, tw2, fs + 6);
      ctx.fillStyle = l.color; ctx.fillText(l.text, x, y);
    }
    return { aim };
  }
  return { render, setup };
})();
