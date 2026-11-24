/* Planner engine: draws a project's plan (beats, text, animations, camera) live over the video.
   The project file carries its own CSS for its animations; it runs inside a shadow root so it
   never touches the app's own look. */
/* ---------- real 3D layers (Three.js, loaded only when a plan uses them) ----------
   An element with  three: { scene: '<name in scenes3d/>' | code: '<module source>', opts: {...} }  gets a WebGL canvas.
   The scene module's default export receives { THREE, renderer, canvas, opts, dur, RoomEnvironment, RoundedBoxGeometry }
   and returns { render(localTime, planTime), resize?(w, h) }. Rendering follows the plan time, so pause, scrub and export match. */
let LIB3 = null;
const lib3 = () => LIB3 ||= Promise.all([import('./vendor/three.module.min.js'), import('./vendor/RoomEnvironment.js'), import('./vendor/RoundedBoxGeometry.js')])
  .then(([THREE, a, b]) => ({ THREE, RoomEnvironment: a.RoomEnvironment, RoundedBoxGeometry: b.RoundedBoxGeometry }));
export function camAt(cam, t) {
  if (!cam.length) return [t, 1, 0, 0, 0];
  let k = cam[0];
  for (let i = 0; i < cam.length; i++) { if (cam[i][0] <= t) k = cam[i]; }
  const i = cam.indexOf(k), n = cam[i + 1];
  if (!n || n[5] || n[0] <= k[0]) return k;
  let f = Math.min(1, Math.max(0, (t - k[0]) / (n[0] - k[0]))); if (n[6] === 'e') f = f * f * (3 - 2 * f);
  const o = k.map((v, j) => j > 0 && j < 5 ? v + (n[j] - v) * f : v); o[7] = (k[7] || 0) + ((n[7] || 0) - (k[7] || 0)) * f; return o;
}
const grayAt = (all, t) => all.some(b => (b.gray || []).some(g => t >= g[0] && t < g[1]));

function loadMatte(m, onReady) {
  if (!m || !m.matte || m._loading) return; m._loading = true;
  const im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data; for (let k = 0; k < p.length; k += 4) { p[k + 3] = p[k]; p[k] = p[k + 1] = p[k + 2] = 0; }
    x.putImageData(d, 0, 0); m.alpha = c; onReady && onReady(); };
  im.src = m.matte;
}

/* host: an element in the app. project: the parsed .planner file. src: object URL of the video. */
export function createPreview(host, project, src) {
  host.innerHTML = '';
  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.innerHTML = '';
  const st = document.createElement('style');
  st.textContent = (project.css || '').replace(/:root\b/g, ':host') +
    `\n:host{display:block}\n.frame{border-radius:0!important}\n.playBtn,.tcLive{display:none!important}\n.ov.pa-sel{outline:2px dashed rgba(255,224,138,.9);outline-offset:4px}` +
    `\n.uTxt{font:900 italic 6.4cqw/1.05 'Roboto Condensed',Roboto,sans-serif;color:#fff;text-align:center;white-space:pre-line;text-shadow:0 .25cqw .9cqw rgba(0,0,0,.65),0 0 .15cqw rgba(0,0,0,.5)}`;
  root.appendChild(st);
  /* animations that only start when a [data-show] turns on (their CSS rule has .show); every other animation keeps the element's own start */
  const SHOW_ANIMS = (() => { const css = project.css || '', set = new Set();
    const names = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) if (/\.show\b/.test(m[1])) for (const w of m[2].match(/[\w-]+/g) || []) if (names.has(w)) set.add(w);
    return set; })();
  const el = document.createElement('div'); el.className = 'frame'; el.id = 'frame-all'; root.appendChild(el);

  const FPSRC = project.fps || 30, DUR = project.duration;
  const all = project.beats; all.forEach(b => b.els.forEach((e, i) => { e._k = e._uid ? 'u:' + e._uid : b.id + ':' + i; }));
  /* layer order (back → front) the user set on the timeline; new layers go on top */
  const ORDER = ((project.review && project.review.layers && project.review.layers.order) || []);
  const rank = e => { const i = ORDER.indexOf(e._k); return i < 0 ? 1e6 : i; };
  const live = all.flatMap(b => b.els.filter(e => !e._del));
  const byRank = list => list.map((e, j) => [e, j]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(x => x[0]);
  const bgEls = byRank(live.filter(e => e.bg)), fgEls = byRank(live.filter(e => !e.bg));
  const v = document.createElement('video');
  v.src = src || ''; v.preload = 'auto'; v.playsInline = true;
  el.appendChild(v);
  const scrim = document.createElement('div'); scrim.className = 'scrim'; el.appendChild(scrim);
  const ovs = [], byK = {}, threes = [];
  const scs = all.filter(b => b.scene); let sbg = null, pc = null, pctx = null;
  const base = {};
  const mk = e => { const d = document.createElement('div'); d.className = 'ov ' + (e.cls || ''); d.style.cssText = e.pos || ''; d.innerHTML = e.html || ''; d.dataset.k = e._k; el.appendChild(d); ovs.push([e, d]); byK[e._k] = d;
    if (e.three) { const cv = document.createElement('canvas'); cv.className = 'c3d'; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none'; d.appendChild(cv); const r = { e, d, cv, inst: null }; threes.push(r); r.ready = start3(r); }
    const tr = /translate:\s*(-?[\d.]+)cqw\s+(-?[\d.]+)cqw/.exec(e.pos || ''), sc = /(?:^|;)\s*scale:\s*([\d.]+)/.exec(e.pos || '');
    base[e._k] = { x: tr ? +tr[1] : 0, y: tr ? +tr[2] : 0, s: sc ? +sc[1] : 1 }; };
  if (scs.length) { sbg = document.createElement('div'); sbg.className = 'scenebg'; el.appendChild(sbg); }
  bgEls.forEach(mk);
  if (scs.length) { pc = document.createElement('canvas'); pc.className = 'person'; pc.width = 640; pc.height = 360; el.appendChild(pc); pctx = pc.getContext('2d'); scs.forEach(b => loadMatte(b.scene, () => render(time()))); }
  fgEls.forEach(mk);
  const baseCams = all.flatMap(b => b.cam || []);
  /* your Zoom/Pan keys replace Claude's camera inside the beats where you set them (blur / darkening kept) */
  function camsNow() {
    const keys = (project.review && project.review.cams) || []; if (!keys.length) return baseCams;
    const inUser = t => all.some(b => t >= b.t0 && t < b.t1 && keys.some(k => k.t >= b.t0 && k.t < b.t1));
    const out = baseCams.filter(c => !inUser(c[0]));
    keys.forEach(k => { const b = camAt(baseCams, k.t); out.push([k.t, k.s, k.x, b[3] || 0, b[4] || 0, false, 'e', k.y]); });
    return out.sort((a, b) => a[0] - b[0]);
  }
  function applyMoves() { const mv = (project.review && project.review.moves) || {};
    Object.keys(byK).forEach(k => { const d = byK[k], b = base[k], m = mv[k];
      if (!m || d.classList.contains('guide')) { d.style.translate = b.x || b.y ? `${b.x}cqw ${b.y}cqw` : ''; d.style.scale = b.s !== 1 ? String(b.s) : ''; return; }
      d.style.translate = `${(b.x + m.x).toFixed(2)}cqw ${(b.y + m.y).toFixed(2)}cqw`; d.style.scale = String(+(b.s * m.s).toFixed(3)); }); }
  let lt;
  function render(t) {
    if (lt !== undefined && t < lt - 0.05) { ovs.forEach(([, d]) => d.classList.remove('on')); void el.offsetWidth; } lt = t;
    const c = camAt(camsNow(), t);
    v.style.transformOrigin = '50% 12%'; v.style.transform = `translate(${c[2]}%, ${c[7] || 0}%) scale(${c[1]})`;
    const gr = grayAt(all, t); v.style.filter = ((c[3] ? `blur(${c[3]}cqw)` : '') + (gr ? ' grayscale(1)' : '')) || 'none';
    { const fk = all.filter(b => b.cut && t >= b.t0).length; const cutNow = el._fk !== undefined && el._fk !== fk; v.style.transition = cutNow ? 'none' : 'transform .35s cubic-bezier(.3,.9,.3,1)'; if (cutNow) void v.offsetWidth; el._fk = fk; }
    scrim.style.opacity = c[4] || 0; all.flatMap(x => x.fx || []).forEach(f => el.classList.toggle('fx-' + f[2], t >= f[0] && t < f[1]));
    if (sbg) { const sc = scs.find(b => t >= b.scene.t0 && t < b.scene.t1); sbg.classList.toggle('on', !!sc); sbg.classList.toggle('noperson', !!sc && sc.scene.person === false); pc.classList.toggle('on', !!sc && sc.scene.person !== false);
      if (sc && sc.scene.person !== false) { try { pctx.globalCompositeOperation = 'source-over'; pctx.clearRect(0, 0, 640, 360); pctx.drawImage(v, 0, 0, 640, 360); const m = sc.scene; if (m.alpha) { const i = Math.max(0, Math.min(m.n - 1, Math.round(t * FPSRC) - m.f0)); pctx.globalCompositeOperation = 'destination-in'; pctx.drawImage(m.alpha, (i % m.cols) * m.w, Math.floor(i / m.cols) * m.h, m.w, m.h, 0, 0, 640, 360); pctx.globalCompositeOperation = 'source-over'; } } catch (err) {} } }
    ovs.forEach(([e, d]) => { d.classList.toggle('on', t >= e.in && t < e.out); if (e.fly !== undefined) d.classList.toggle('flying', t >= e.fly);
      d.querySelectorAll('[data-glow]').forEach(g => g.classList.toggle('glow', t >= +g.dataset.glow)); d.querySelectorAll('[data-show]').forEach(g => g.classList.toggle('show', t >= +g.dataset.show)); });
    syncAnims(t);
    threes.forEach(r => { const on = t >= r.e.in && t < r.e.out; r.cv.style.visibility = on ? '' : 'hidden';   // a 3D layer never stays on screen outside its time, even if the plan's CSS forgets to hide it
      if (r.inst && on) { try { r.inst.render(t - r.e.in, t); } catch (err) {} } });
  }
  async function start3(r) {
    try { const L = await lib3(), T = r.e.three;
      const mod = T.code ? await import(URL.createObjectURL(new Blob([T.code], { type: 'text/javascript' }))) : await import(new URL('./scenes3d/' + T.scene + '.js', import.meta.url).href);
      if (dead) return;
      const renderer = new L.THREE.WebGLRenderer({ canvas: r.cv, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = L.THREE.SRGBColorSpace; renderer.toneMapping = L.THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
      r.renderer = renderer; r.inst = await mod.default({ ...L, renderer, canvas: r.cv, opts: T.opts || {}, dur: r.e.out - r.e.in });
      size3(r); const t = lt === undefined ? 0 : lt; if (t >= r.e.in && t < r.e.out) r.inst.render(t - r.e.in, t);
    } catch (err) { console.warn('3D layer failed', r.e._k, err); } }
  function size3(r) { if (!r.renderer) return; const w = el.clientWidth || 960, h = el.clientHeight || 540; const pr = Math.min(2, Math.max(1, 1920 / w, window.devicePixelRatio || 1));
    r.renderer.setPixelRatio(pr); r.renderer.setSize(w, h, false); if (r.inst && r.inst.resize) r.inst.resize(w, h); }
  let dead = false;
  const ro3 = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { threes.forEach(size3); if (lt !== undefined) threes.forEach(r => { if (r.inst && lt >= r.e.in && lt < r.e.out) r.inst.render(lt - r.e.in, lt); }); }) : null;
  if (ro3) ro3.observe(el);
  function dispose() { dead = true; if (ro3) ro3.disconnect(); threes.forEach(r => { try { r.inst && r.inst.dispose && r.inst.dispose(); r.renderer && (r.renderer.dispose(), r.renderer.forceContextLoss()); } catch (err) {} }); }
  /* paused = every animation freezes at the playhead (and scrubbing shows the right pose); play = they carry on from there */
  let wasPaused = null;
  function syncAnims(t) {
    const paused = v.paused;
    if (!paused && wasPaused === false) return; wasPaused = paused;
    ovs.forEach(([e, d]) => { if (!d.classList.contains('on')) return; let an; try { an = d.getAnimations({ subtree: true }); } catch (err) { return; }
      an.forEach(a => { try {
        if (paused) {
          const tg = a.effect && a.effect.target, ds = tg && tg.closest ? tg.closest('[data-show]') : null;
          const t0 = ds && d.contains(ds) && ds.classList.contains('show') && SHOW_ANIMS.has(a.animationName) ? +ds.dataset.show : e.in;
          a.currentTime = Math.max(0, (t - t0) * 1000); a.pause();
        } else if (a.playState === 'paused') { const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity; if (a.currentTime >= end) a.finish(); else a.play(); }
      } catch (err) {} }); });
  }
  /* plan time ↔ source time: the preview plays the original footage following the exact cuts from Premiere */
  const cuts = (project.media && Array.isArray(project.media.cuts) && project.media.cuts.length) ? project.media.cuts : [[0, DUR, 0, DUR]];
  let seg = 0;
  const segAt = t => { for (let i = 0; i < cuts.length; i++) if (t < cuts[i][1] - 1e-4) return i; return cuts.length - 1; };
  const toSrc = t => { const i = segAt(t), c = cuts[i]; seg = i; return c[2] + Math.max(0, t - c[0]); };
  const toPlan = src => { const c = cuts[seg]; if (src >= c[2] - 0.05 && src <= c[3] + 0.05) return c[0] + (src - c[2]);
    for (let i = 0; i < cuts.length; i++) { const k = cuts[i]; if (src >= k[2] - 1e-3 && src <= k[3] + 1e-3) { seg = i; return k[0] + (src - k[2]); } } return 0; };
  const time = () => Math.min(DUR, Math.max(0, toPlan(v.currentTime)));
  let raf = null, stopAt = DUR, jumping = false;
  function loop() {
    const c = cuts[seg];
    if (!jumping && v.currentTime >= c[3] - 0.5 / FPSRC) {
      if (seg + 1 < cuts.length && cuts[seg + 1][0] < stopAt - 1e-3) { seg++; jumping = true; v.currentTime = cuts[seg][2]; }
      else { v.pause(); render(Math.min(stopAt, c[1])); return; }
    }
    const t = time(); render(t); if (t >= stopAt - 1e-3) v.pause();
    if (!v.paused) raf = requestAnimationFrame(loop);
  }
  function seek(t) { t = Math.max(0, Math.min(DUR, t)); v.currentTime = toSrc(t); render(t); }
  function playFrom(s, until) { stopAt = until || DUR; seek(s >= DUR - 0.05 ? 0 : s); v.play().catch(() => {}); }
  v.addEventListener('play', () => { cancelAnimationFrame(raf); loop(); });
  v.addEventListener('pause', () => render(time()));
  v.addEventListener('seeked', () => { jumping = false; if (v.paused) render(time()); });
  v.addEventListener('loadedmetadata', () => { v.currentTime = toSrc(Math.min(2, DUR / 2)); });
  applyMoves(); render(0);
  function refresh() { ovs.forEach(([, d]) => d.classList.remove('on')); void el.offsetWidth; lt = undefined; render(time()); }
  return { video: v, render, refresh, playFrom, seek, time, toSrc, cuts, byK, frame: el, applyMoves, camsNow, base, dispose, ready3d: () => Promise.all(threes.map(r => r.ready)), has3d: () => threes.length > 0, zOrder: { bg: bgEls.map(e => e._k), fg: fgEls.map(e => e._k) } };
}
