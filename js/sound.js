// 소리 — 파일 없이 Web Audio로 만든다. 위치가 있는 소리는 듣는 사람 기준 좌우·거리·벽을 반영
window.Sound = (function () {
  let ac = null, master = null, vol = 0.9, muted = false, listener = { x: 0, y: 0, a: 0 };
  const status = [];
  function init() {
    try {
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ac = new AC(); master = ac.createGain(); master.connect(ac.destination); apply(); }
      if (ac.state !== "running") ac.resume().catch(() => {});
    } catch (e) {}
    notify();
  }
  function apply() { if (master) master.gain.value = muted ? 0 : vol; notify(); }
  function notify() { const s = { state: ac ? ac.state : "idle", muted, volume: vol }; status.forEach(f => { try { f(s); } catch (e) {} }); }
  function out(pan) {
    if (!ac) return null;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(master); return p; }
    return master;
  }
  function env(g, t0, a, d, peak) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  function tone(f0, f1, dur, type, peak, pan, delay, vib) {
    if (!ac || muted) return; const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain(); o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t0); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    if (vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.05); }
    env(g, t0, Math.min(0.02, dur / 4), dur, peak); o.connect(g); g.connect(out(pan)); o.start(t0); o.stop(t0 + dur + 0.08);
  }
  function noise(dur, peak, pan, freq, delay, q) {
    if (!ac || muted) return; const t0 = ac.currentTime + (delay || 0);
    const n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(); s.buffer = b; const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 800; f.Q.value = q || 1;
    const g = ac.createGain(); env(g, t0, 0.005, dur, peak); s.connect(f); f.connect(g); g.connect(out(pan)); s.start(t0);
  }
  // 미믹 소리: 전시물마다 음높이가 조금씩 다르다
  function voice(seed) { return 520 + (seed * 97 % 11) * 60; }
  const kinds = {
    beep(o) { const f = voice(o.seed || 0); tone(f, f * 1.6, 0.16, "square", 0.16 * o.g, o.pan, o.delay); tone(f * 1.6, f * 1.2, 0.12, "square", 0.12 * o.g, o.pan, (o.delay || 0) + 0.17); },
    taunt(o) { const f = voice(o.seed || 0) * 0.7, k = (o.seed || 0) % 3; if (k === 0) { tone(f, f * 2.2, 0.35, "sawtooth", 0.14 * o.g, o.pan, 0, [9, 30]); tone(f * 2.2, f * 0.8, 0.4, "sawtooth", 0.12 * o.g, o.pan, 0.36, [9, 30]); } else if (k === 1) { for (let i = 0; i < 4; i++) tone(f * (1 + i * 0.25), f * (1.1 + i * 0.25), 0.1, "square", 0.12 * o.g, o.pan, i * 0.11); } else { tone(f * 1.5, f * 0.5, 0.6, "triangle", 0.2 * o.g, o.pan, 0, [6, 40]); } },
    stamp(o) { noise(0.12, 0.5 * o.g, o.pan, 180, 0, 0.8); tone(110, 60, 0.18, "sine", 0.45 * o.g, o.pan); },
    ding(o) { tone(880, 880, 0.25, "sine", 0.22 * o.g, o.pan); tone(1320, 1320, 0.4, "sine", 0.2 * o.g, o.pan, 0.12); },
    buzzer(o) { tone(150, 140, 0.45, "square", 0.18 * o.g, o.pan); tone(155, 145, 0.45, "square", 0.12 * o.g, o.pan); },
    whistle(o) { tone(2100, 2300, 0.5, "sine", 0.16 * o.g, o.pan, 0, [28, 120]); tone(2300, 1900, 0.25, "sine", 0.12 * o.g, o.pan, 0.55, [28, 120]); },
    tick(o) { tone(1200, 1200, 0.05, "square", 0.08 * o.g, o.pan); },
    horn(o) { tone(392, 392, 0.25, "sawtooth", 0.12 * o.g, 0); tone(523, 523, 0.5, "sawtooth", 0.12 * o.g, 0, 0.25); },
    chime(o) { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.3, "triangle", 0.14 * o.g, 0, i * 0.12)); },
    step(o) { noise(0.05, 0.12 * o.g, o.pan, 380 + Math.random() * 120, 0, 2); },
    pick(o) { tone(660, 990, 0.08, "sine", 0.15 * o.g, 0); },
    perch(o) { tone(300, 450, 0.08, "triangle", 0.18 * o.g, 0); noise(0.04, 0.1 * o.g, 0, 1200); },
    error(o) { tone(220, 180, 0.15, "square", 0.1 * o.g, 0); },
    caught(o) { tone(500, 180, 0.5, "sawtooth", 0.16 * o.g, 0, 0, [12, 20]); },
    test(o) { tone(660, 660, 0.15, "sine", 0.2 * o.g, -0.6); tone(880, 880, 0.15, "sine", 0.2 * o.g, 0.6, 0.18); },
  };
  function play(kind, o) { if (!ac || muted) return; o = o || {}; o.g = o.g == null ? 1 : o.g; try { kinds[kind] && kinds[kind](o); } catch (e) {} }
  function setListener(x, y, a) { listener.x = x; listener.y = y; listener.a = a; }
  // 위치 있는 소리
  function at(kind, x, y, o) {
    o = o || {};
    const dx = x - listener.x, dy = y - listener.y, d = Math.hypot(dx, dy);
    const range = o.range || 20; if (d > range) return;
    let g = Math.pow(1 - d / range, 1.4) * (o.g == null ? 1 : o.g);
    if (window.Museum && Museum.cur && d > 0.5 && !Museum.los(listener.x, listener.y, x, y)) g *= 0.45;
    const rel = Math.cos(listener.a + Math.PI / 2) * dx + Math.sin(listener.a + Math.PI / 2) * dy;
    play(kind, { ...o, g: Math.max(0.05, g), pan: d < 0.5 ? 0 : Math.max(-0.9, Math.min(0.9, rel / Math.max(1, d))) });
  }
  function vibrate(p) { try { if (window.Options && Options.get("vib") && navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  return { init, play, at, setListener, vibrate, setVolume(v) { vol = v; apply(); }, setMuted(m) { muted = !!m; apply(); if (!muted) init(); }, get muted() { return muted; }, onStatus(f) { status.push(f); notify(); }, test() { init(); setTimeout(() => play("test"), 60); return true; } };
})();
