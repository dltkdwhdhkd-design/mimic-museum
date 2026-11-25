// 설정: 소리, 감도, 진동, 화질 — 이 기기 브라우저에 저장
window.Options = (function () {
  const DEF = { vol: 0.9, mouseSens: 1.0, touchSens: 1.0, invertY: false, vib: true, quality: "auto" };
  const KEY = "mimicmuseum.options.v1";
  let v = { ...DEF }, open = false, onClose = null;
  try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); for (const k in DEF) if (k in s) v[k] = s[k]; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function get(k) { return v[k]; }
  function apply() { if (window.Sound) Sound.setVolume(v.vol); }
  function enableSound() { if (!(v.vol > 0)) { v.vol = DEF.vol; save(); } Sound.setMuted(false); apply(); Sound.test(); if (open) bind(); }
  const $ = id => document.getElementById(id);
  function bind() {
    for (const [id, k, fmt] of [["opt-vol", "vol", x => Math.round(x * 100) + "%"], ["opt-mouse", "mouseSens", x => x.toFixed(1) + "×"], ["opt-touch", "touchSens", x => x.toFixed(1) + "×"]]) {
      const el = $(id); el.value = v[k]; $(id + "-v").textContent = fmt(v[k]);
      el.oninput = () => { v[k] = +el.value; $(id + "-v").textContent = fmt(v[k]); apply(); save(); };
    }
    $("opt-invert").checked = v.invertY; $("opt-invert").onchange = () => { v.invertY = $("opt-invert").checked; save(); };
    $("opt-vib").checked = v.vib; $("opt-vib").onchange = () => { v.vib = $("opt-vib").checked; save(); Sound.vibrate(60); };
    $("opt-quality").value = v.quality; $("opt-quality").onchange = () => { v.quality = $("opt-quality").value; save(); };
    $("opt-test").onclick = () => enableSound();
    $("opt-reset").onclick = () => { v = { ...DEF }; save(); bind(); apply(); };
    $("opt-close").onclick = close;
  }
  function show(cb) { onClose = cb || null; open = true; if (document.pointerLockElement) document.exitPointerLock(); bind(); $("options").style.display = "flex"; }
  function close() { open = false; $("options").style.display = "none"; if (onClose) onClose(); }
  apply();
  return { get, apply, show, close, enableSound, get isOpen() { return open; } };
})();
