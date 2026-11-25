/* Premiere-style timeline: ruler, beats, words, V tracks (text / animation / scene), V1 video,
   camera keyframes and A1 audio. Drag a clip to move it, drag its edges to trim. */
import { camAt, offOf } from './engine.js?v=17.6';
import { wireMic } from './tools.js?v=17.6';
const FPS = 30;
export const fmtTC = t => { t = Math.max(0, t); const f = Math.round(t * FPS), s = Math.floor(f / FPS), fr = f % FPS; return '00:00:' + String(s).padStart(2, '0') + ':' + String(fr).padStart(2, '0'); };
const fmtS = t => t.toFixed(2) + ' s';
const AUDIO = new Map();   // decoded audio of the last source file, shared by every sequence
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createTimeline(box, project, pv, { onChange, onSelect, onUndo, onMedia, onLayers, onDelete, onAddLayer, onMute, status, ro: readOnly } = {}) {
  const v = pv.video, BEATS = project.beats, W = project.words || [], DUR = project.duration;
  project.timeline = project.timeline || {};
  box.innerHTML = `
  <div class="tlBar">
    <button type="button" class="tlBtn tlPlay" title="Play / pause (Space)">▶</button>
    <button type="button" class="tlBtn tlStep" data-d="-1" title="1 frame back (←)">◀︎|</button>
    <button type="button" class="tlBtn tlStep" data-d="1" title="1 frame forward (→)">|▶︎</button>
    <button type="button" class="tlBtn tlGuide" title="Safe margins and center (G)" aria-pressed="false"><svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><rect x=".75" y=".75" width="14.5" height="10.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3.5" y="3" width="9" height="6" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M8 4.6v2.8M6.6 6h2.8" stroke="currentColor" stroke-width="1"/></svg></button>
    <span class="tlTC">00:00:00:00</span><span class="tlDur">/ ${fmtTC(DUR)}</span>
    <span class="tlSep"></span>
    <button type="button" class="tlBtn tlSnap on" title="Snapping (S)">🧲 Snap</button>
    <button type="button" class="tlBtn tlUndo" title="Undo your last change (Ctrl+Z)">↶ Undo</button>
    <button type="button" class="tlBtn tlReset" disabled title="Put the selected clip back where Claude had it">Reset clip</button>
    <button type="button" class="tlBtn tlResetAll" title="Undo every timing change">Reset all</button>
    <span class="tlSep"></span>
    <button type="button" class="tlBtn tlUp" disabled title="Move the selected layer up, in front (Alt+↑)">▲ Up</button>
    <button type="button" class="tlBtn tlDown" disabled title="Move the selected layer down, behind (Alt+↓)">▼ Down</button>
    <button type="button" class="tlBtn tlDel" disabled title="Delete the selected layer (Delete / Backspace)">🗑</button>
    <button type="button" class="tlBtn tlMute" disabled title="Mute: turn the selected layer off / on, like Premiere's Enable (Shift+E)">⊘ Mute</button>
    <span class="tlSep"></span>
    <button type="button" class="tlBtn tlMark" title="Add a marker at the playhead, then write what Claude should do there (M)">📍 Mark</button>
    <span class="tlSel"></span><span class="tlGrow"></span>
    <label class="tlZoom">− <input type="range" min="0" max="100" value="0" aria-label="Timeline zoom"> +</label>
    <span class="tlAddWrap"><button type="button" class="tlBtn tlAdd" title="Add a layer at the playhead">＋ Layer</button>
      <span class="tlAddMenu" hidden><button type="button" data-add="text">T&nbsp; Text layer</button><button type="button" data-add="media">🖼&nbsp; Photo / video</button>
        <span class="tlAddText" hidden><input type="text" placeholder="Type the text, then Enter"><button type="button" data-add="ok">Add</button></span></span></span>
  </div>
  <div class="kfEd" hidden></div>
  <div class="mkPop" hidden></div>
  <div class="tlBody"><div class="tlHeads"></div><div class="tlScroll"><div class="tlInner"><div class="tlPH"><i></i></div></div></div></div>`;
  const heads = box.querySelector('.tlHeads'), scroll = box.querySelector('.tlScroll'), inner = box.querySelector('.tlInner'), ph = box.querySelector('.tlPH');
  const tcEl = box.querySelector('.tlTC'), selEl = box.querySelector('.tlSel'), zoomIn = box.querySelector('.tlZoom input');

  const labelOf = e => { if (e.three) { const h = e.three.opts && e.three.opts.half; return '3D ' + (e.three.scene || 'scene') + (h && h !== 'all' ? ' · ' + h.toUpperCase() : ''); } const t = document.createElement('div'); t.innerHTML = e.html || ''; t.querySelectorAll('[aria-hidden="true"],style,script,svg').forEach(x => x.remove()); let s = (t.textContent || '').replace(/\s+/g, ' ').trim(); if (!s) s = 'FX · ' + ((e.cls || 'graphic').split(' ')[0]); return s.length > 34 ? s.slice(0, 33) + '…' : s; };
  const clips = [];
  BEATS.forEach(b => b.els.forEach((e, i) => {
    if (e.in === undefined || e.out === undefined || e._del) return;
    const d = pv.byK[e._k];
    const inner_ = d ? [...d.querySelectorAll('[data-show],[data-glow]')].map(n => ({ n, show: n.dataset.show, glow: n.dataset.glow })) : [];
    const o = { in: e.in, out: Math.min(e.out, DUR), fly: e.fly };
    const c = { k: e._k, beat: b.id, i, e, d, bg: !!e.bg, user: !!e._uid, off: offOf(e), guide: /\bguide\b/.test(e.cls || ''), label: labelOf(e), o, inner: inner_, st: { in: o.in, out: o.out, off: 0 } };
    const saved = project.timeline[e._k]; if (saved) c.st = { in: +saved.in, out: +saved.out, off: +(saved.off || 0) };
    clips.push(c); apply(c);
  }));
  function apply(c) { const e = c.e; e.in = c.st.in; e.out = c.st.out; if (c.o.fly !== undefined) e.fly = c.o.fly + c.st.off;
    c.inner.forEach(x => { if (x.show !== undefined) x.n.dataset.show = String(+x.show + c.st.off); if (x.glow !== undefined) x.n.dataset.glow = String(+x.glow + c.st.off); }); }
  const changed = c => Math.abs(c.st.in - c.o.in) > .004 || Math.abs(c.st.out - c.o.out) > .004;
  function commit(c) { if (changed(c)) project.timeline[c.k] = { in: +c.st.in.toFixed(3), out: +c.st.out.toFixed(3), off: +c.st.off.toFixed(3) }; else delete project.timeline[c.k]; onChange && onChange(); }

  /* layers: a clip that is in front of another one (at the same time) always sits on a higher track, like Premiere */
  const Z = pv.zOrder || { bg: [], fg: [] };
  const zList = bg => { const ks = bg ? Z.bg : Z.fg; return clips.filter(c => c.bg === bg).sort((a, b) => ks.indexOf(a.k) - ks.indexOf(b.k)); };
  const overlap = (a, b) => a.st.in < b.st.out - 1e-3 && b.st.in < a.st.out - 1e-3;
  function pack(list) { const lanes = [], at = new Map();
    list.forEach((c, j) => { let L = 0; for (let q = 0; q < j; q++) if (overlap(list[q], c)) L = Math.max(L, at.get(list[q]) + 1);
      at.set(c, L); (lanes[L] ||= { clips: [] }).clips.push(c); });
    return lanes.filter(Boolean); }
  const gL = pack(zList(false)), sL = pack(zList(true));
  const TR = [{ id: 'beats', name: 'Beats', cls: 'trBeats', h: 22 }, { id: 'words', name: 'Words', cls: 'trWords', h: 20 }];
  const nV = gL.length + sL.length + 1;
  gL.slice().reverse().forEach((L, j) => TR.push({ id: 'g' + j, name: 'V' + (nV - j), sub: 'Text / anim', cls: 'trG', h: 24, lane: L }));
  sL.slice().reverse().forEach((L, j) => TR.push({ id: 's' + j, name: 'V' + (sL.length - j + 1), sub: 'Scene', cls: 'trS', h: 24, lane: L }));
  TR.splice(2, 0, { id: 'mine', name: 'Yours', sub: 'Photo / video', cls: 'trM', h: 24 });
  /* Cam track: ◆ makes it tall so every keyframe is big, draggable (time + zoom) and editable */
  const CXKEY = 'planner-camx'; let camX = (() => { try { return localStorage.getItem(CXKEY) === '1'; } catch (e) { return false; } })();
  const camH = () => camX ? 118 : 22;
  TR.push({ id: 'video', name: 'V1', sub: 'Video', cls: 'trV', h: 42 }, { id: 'cam', name: 'Cam', sub: 'Zoom / pan', cls: 'trC', h: camH() }, { id: 'audio', name: 'A1', sub: 'Audio', cls: 'trA', h: 38 });
  const A1KEY = 'planner-a1mute'; let a1m = (() => { try { return localStorage.getItem(A1KEY) === '1'; } catch (e) { return false; } })(); v.muted = a1m;
  const headExtra = t => t.id === 'cam' ? `<button type="button" class="tCamX${camX ? ' on' : ''}" title="Show the camera keyframes big: drag to move, drag up / down to zoom, click to edit, double-click to add">◆ Keys</button>`
    : t.id === 'audio' ? `<button type="button" class="tA1M${a1m ? ' on' : ''}" title="Mute the audio in the preview">${a1m ? '🔇' : '🔊'}</button>` : '';
  const RULER = 24;
  /* track lock (like Premiere): a locked track's clips cannot be picked, moved or deleted */
  const LKEY = 'planner-locks:' + (project.id || '') + ':' + DUR;
  const locks = new Set((() => { try { return JSON.parse(localStorage.getItem(LKEY) || '[]'); } catch (e) { return []; } })());
  const lockable = t => !!t.lane || t.id === 'mine';
  heads.innerHTML = `<div class="thd thRuler" style="height:${RULER}px"></div>` + TR.map(t => `<div class="thd ${t.cls}${locks.has(t.id) ? ' lk' : ''}" data-tr="${t.id}" style="height:${t.h}px"><b>${t.name}</b>${t.sub ? `<small>${t.sub}</small>` : ''}${headExtra(t)}${lockable(t) ? `<button type="button" class="tLock" data-lock="${t.id}" title="Lock / unlock this track" aria-pressed="${locks.has(t.id)}">${locks.has(t.id) ? '🔒' : '🔓'}</button>` : ''}</div>`).join('');
  const trackOf = k => { if (String(k).startsWith('m:')) return 'mine'; const t = TR.find(x => x.lane && x.lane.clips.some(c => c.k === k)); return t ? t.id : null; };
  const isLocked = k => { const c = clips.find(x => x.k === k); return (c && c.guide) || locks.has(trackOf(k)); };   // roto guides are always locked
  heads.addEventListener('click', ev => {
    if (ev.target.closest('.tCamX')) { camX = !camX; try { localStorage.setItem(CXKEY, camX ? '1' : ''); } catch (e) {} const h = camH() + 'px';
      heads.querySelector('.thd[data-tr="cam"]').style.height = h; lane('cam').style.height = h; ev.target.closest('.tCamX').classList.toggle('on', camX); draw(); showKf(); return; }
    if (ev.target.closest('.tA1M')) { a1m = !a1m; v.muted = a1m; try { localStorage.setItem(A1KEY, a1m ? '1' : ''); } catch (e) {} const b2 = ev.target.closest('.tA1M'); b2.textContent = a1m ? '🔇' : '🔊'; b2.classList.toggle('on', a1m); return; }
    const b = ev.target.closest('.tLock'); if (!b) return; const id = b.dataset.lock;
    if (locks.has(id)) locks.delete(id); else locks.add(id); try { localStorage.setItem(LKEY, JSON.stringify([...locks])); } catch (e) {}
    const on = locks.has(id); b.textContent = on ? '🔒' : '🔓'; b.setAttribute('aria-pressed', on); b.closest('.thd').classList.toggle('lk', on); lane(id)?.classList.toggle('lk', on);
    if (on && sel && trackOf(sel.k) === id) select(null); if (on && id === 'mine') { msel = null; } draw(); });
  inner.insertAdjacentHTML('afterbegin', `<div class="tlRuler" style="height:${RULER}px"></div>` + TR.map(t => `<div class="tlLane ${t.cls}${locks.has(t.id) ? ' lk' : ''}" data-tr="${t.id}" style="height:${t.h}px"></div>`).join(''));
  const ruler = inner.querySelector('.tlRuler'), lane = id => inner.querySelector(`.tlLane[data-tr="${id}"]`);

  let pps = 100, sel = null, sels = new Set(), msel = null, mdr = null;
  let kSel = null, kdr = null, mkOpen = null, mkdr = null;   // selected camera key (its time), key drag, open marker, marker drag
  const mineList = () => ((project.review || {}).media || []);
  const fitPPS = () => Math.max(30, (scroll.clientWidth - 8) / DUR);
  const setZoom = z => { pps = fitPPS() * Math.pow(8, z / 100); draw(); };
  zoomIn.oninput = () => setZoom(+zoomIn.value);
  scroll.addEventListener('wheel', ev => { if (!(ev.ctrlKey || ev.metaKey)) return; ev.preventDefault(); const x = ev.clientX - scroll.getBoundingClientRect().left, t = (x + scroll.scrollLeft) / pps; zoomIn.value = Math.max(0, Math.min(100, +zoomIn.value - (ev.deltaY > 0 ? 6 : -6))); setZoom(+zoomIn.value); scroll.scrollLeft = t * pps - x; }, { passive: false });

  function drawRuler() { const steps = [0.1, 0.2, 0.5, 1, 2, 5]; const step = steps.find(s => s * pps >= 46) || 5, minor = step / 5; let h = '';
    for (let k = 0; k * minor <= DUR + 1e-6; k++) { const t = k * minor, maj = k % 5 === 0; h += `<i class="${maj ? 'maj' : ''}" style="left:${t * pps}px"></i>`; if (maj) h += `<span style="left:${t * pps}px">${fmtTC(t).slice(6)}</span>`; }
    ruler.innerHTML = h; }
  const clipHTML = c => `<div class="clip ${c.bg ? 'cS' : 'cG'}${c.user ? ' cU' : ''}${c.off ? ' off' : ''}${c.guide ? ' cGuide' : ''}${sels.has(c) ? ' sel' : ''}${changed(c) ? ' moved' : ''}" data-k="${c.k}" style="left:${c.st.in * pps}px;width:${Math.max(4, (c.st.out - c.st.in) * pps)}px" title="${esc(c.label)} · ${c.beat} · ${fmtS(c.st.in)} → ${fmtS(c.st.out)}"><i class="hl"></i><span>${c.guide ? '🔒 ' : ''}${c.off ? '⊘ ' : ''}${esc(c.label)}</span><i class="hr"></i></div>`;
  function draw() {
    inner.style.width = (DUR * pps + 40) + 'px'; drawRuler();
    lane('beats').innerHTML = BEATS.map((b, j) => `<div class="bt b${j % 4}" style="left:${b.t0 * pps}px;width:${(Math.min(b.t1, DUR) - b.t0) * pps}px" title="${esc(b.title)}"><span>${b.id} · ${b.kind || ''}</span></div>`).join('');
    lane('words').innerHTML = W.map(w => `<span class="wd" style="left:${w[0] * pps}px;width:${Math.max(6, (w[1] - w[0]) * pps)}px">${esc(w[2])}</span>`).join('');
    TR.filter(t => t.lane).forEach(t => { lane(t.id).innerHTML = t.lane.clips.map(clipHTML).join(''); });
    drawMine();
    const cuts = [...new Set([...BEATS.filter(b => b.cut).map(b => b.t0), ...cutsL.slice(1).map(c => c[0])])];
    lane('video').innerHTML = `<div class="clip cV" style="left:0;width:${DUR * pps}px"><canvas class="thumbs" width="${Math.round(DUR * pps)}" height="40"></canvas><span>${esc(project.media?.video?.split('/').pop() || 'Video')}</span>${cuts.map(t => `<i class="cut" style="left:${t * pps}px"></i>`).join('')}</div>`;
    paintThumbs();
    drawCam(); drawMarks();
    lane('audio').innerHTML = `<div class="clip cA" style="left:0;width:${DUR * pps}px"><canvas class="wave" width="${Math.round(DUR * pps)}" height="36"></canvas></div>`;
    paintWave(); movePH();
  }

  /* thumbnails + waveform from the linked video */
  const cutsL = pv.cuts || [[0, DUR, 0, DUR]];
  const srcAt = t => { const c = cutsL.find(k => t < k[1] - 1e-4) || cutsL[cutsL.length - 1]; return c[2] + Math.max(0, t - c[0]); };
  const thumbs = []; let thumbsOK = false, peaks = null;
  async function makeThumbs() { try {
    const tv = document.createElement('video'); tv.src = v.src; tv.muted = true; tv.preload = 'auto';
    await new Promise(r => { tv.onloadeddata = r; tv.onerror = r; setTimeout(r, 8000); });
    for (let k = 0; k <= Math.ceil(DUR / 0.5); k++) { const t = Math.min(DUR - 0.05, k * 0.5); const st = srcAt(t); await new Promise(r => { tv.onseeked = r; tv.currentTime = st; setTimeout(r, 1500); });
      const c = document.createElement('canvas'); c.width = 72; c.height = 40; c.getContext('2d').drawImage(tv, 0, 0, 72, 40); thumbs.push({ t, c }); }
    thumbsOK = true; paintThumbs(); } catch (e) {} }
  async function makeWave() { try {
    const blob = await (await fetch(v.src)).blob(); if (blob.size > 600e6) return;
    const key = blob.size + ':' + blob.type; let ab = AUDIO.get(key);
    if (!ab) { const ac = new OfflineAudioContext(1, 44100, 44100); ab = await ac.decodeAudioData(await blob.arrayBuffer()); AUDIO.clear(); AUDIO.set(key, ab); }
    const ch = ab.getChannelData(0), sr = ab.sampleRate, per = Math.floor(sr / 200); peaks = new Float32Array(Math.ceil(DUR * 200));
    for (let i = 0; i < peaks.length; i++) { const s0 = Math.floor(srcAt(i / 200) * sr); let m = 0; for (let j = s0; j < Math.min(ch.length, s0 + per); j++) { const a = Math.abs(ch[j]); if (a > m) m = a; } peaks[i] = m; }
    paintWave(); } catch (e) {} }
  function paintThumbs() { const cv = lane('video')?.querySelector('canvas.thumbs'); if (!cv || !thumbsOK) return; const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height);
    for (let px = 0; px < cv.width; px += 72) { const t = px / pps; const th = thumbs.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a, thumbs[0]); x.globalAlpha = .85; x.drawImage(th.c, px, 0); } }
  function paintWave() { const cv = lane('audio')?.querySelector('canvas.wave'); if (!cv || !peaks) return; const x = cv.getContext('2d'), H = cv.height; x.clearRect(0, 0, cv.width, H); x.fillStyle = 'rgba(170,255,190,.9)';
    let mx = 0; peaks.forEach(p => { if (p > mx) mx = p; }); mx = mx || 1; for (let px = 0; px < cv.width; px++) { const p = (peaks[Math.floor(px / pps * 200)] || 0) / mx * (H / 2 - 2); x.fillRect(px, H / 2 - p, 1, Math.max(1, p * 2)); } }
  if (v.src) { makeThumbs(); makeWave(); }

  /* playhead + transport */
  const now = () => pv.time();
  function movePH() { ph.style.left = (now() * pps) + 'px'; tcEl.textContent = fmtTC(now()); }
  let alive = true; (function loop() { if (!alive) return; movePH(); if (!v.paused) { const x = now() * pps; if (x > scroll.scrollLeft + scroll.clientWidth - 30 || x < scroll.scrollLeft) scroll.scrollLeft = x - 60; } requestAnimationFrame(loop); })();
  const playBtn = box.querySelector('.tlPlay'); const setIcon = () => { playBtn.textContent = v.paused ? '▶' : '❚❚'; };
  v.addEventListener('play', setIcon); v.addEventListener('pause', setIcon);
  function togglePlay() { if (v.paused) { const t = now(); pv.playFrom(t >= DUR - 0.05 ? 0 : t); } else v.pause(); }
  playBtn.onclick = togglePlay;
  function seek(t) { t = Math.max(0, Math.min(DUR, t)); v.pause(); pv.seek(t); movePH(); }
  box.querySelectorAll('.tlStep').forEach(b => b.onclick = () => seek(Math.round(now() * FPS + +b.dataset.d) / FPS));
  let scrub = false; const tAt = cx => (cx - inner.getBoundingClientRect().left) / pps;
  inner.addEventListener('pointerdown', ev => { if (ev.target.closest('.clip.cG,.clip.cS,.clip.cM,.trC .kf,.mk')) return; if (ev.target.closest('.trC') && camX) return; scrub = true; inner.setPointerCapture(ev.pointerId); seek(tAt(ev.clientX)); });
  inner.addEventListener('pointermove', ev => { if (scrub) seek(tAt(ev.clientX)); });
  inner.addEventListener('pointerup', () => { scrub = false; });

  /* edit */
  let snap = true; const snapBtn = box.querySelector('.tlSnap'); const setSnap = on => { snap = on; snapBtn.classList.toggle('on', on); }; snapBtn.onclick = () => setSnap(!snap);
  const undo = [];
  const snapPts = skip => { const p = [now(), 0, DUR]; BEATS.forEach(b => p.push(b.t0, Math.min(b.t1, DUR))); W.forEach(w => p.push(w[0], w[1])); clips.forEach(c => { if (c !== skip) p.push(c.st.in, c.st.out); }); return p; };
  function snapT(t, skip) { if (!snap) return Math.round(t * FPS) / FPS; const th = 7 / pps; let best = null; snapPts(skip).forEach(p => { if (Math.abs(p - t) < th && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p; }); return best !== null ? best : Math.round(t * FPS) / FPS; }
  let drag = null;
  inner.addEventListener('pointerdown', ev => { const el = ev.target.closest('.clip.cG,.clip.cS'); if (!el) return; ev.preventDefault(); const c = clips.find(x => x.k === el.dataset.k); if (!c || c.guide) return;
    /* Shift+click adds / removes a layer; dragging one of the selected layers moves them all */
    const keepGroup = !ev.shiftKey && sels.has(c) && sels.size > 1;
    if (ev.shiftKey) select(c, true); else if (!keepGroup) select(c); else { sel = c; showSel(); }
    if (!sels.has(c)) return;
    const mode = ev.target.classList.contains('hl') ? 'l' : ev.target.classList.contains('hr') ? 'r' : 'm';
    drag = { c, mode, x0: ev.clientX, st0: { ...c.st }, moved: false, keepGroup, group: mode === 'm' ? [...sels].filter(x => !isLocked(x.k)).map(x => ({ c: x, st0: { ...x.st } })) : [{ c, st0: { ...c.st } }] }; inner.setPointerCapture(ev.pointerId); });
  inner.addEventListener('pointermove', ev => {
    if (!drag) return; const c = drag.c, dt = (ev.clientX - drag.x0) / pps; if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 3) return;
    if (!drag.moved) { undo.push({ c, st: { ...drag.st0 } }); drag.moved = true; }
    const s0 = drag.st0, len = s0.out - s0.in, MIN = 0.1;
    if (drag.mode === 'm') { let a = s0.in + dt; const sa = snapT(a, c), sb = snapT(a + len, c); a = (snap && Math.abs(sb - (a + len)) < Math.abs(sa - a)) ? sb - len : sa;
      let d = a - s0.in; const lo = Math.min(...drag.group.map(g => g.st0.in)), hi = Math.max(...drag.group.map(g => g.st0.out)); d = Math.max(-lo, Math.min(DUR - hi, d));
      drag.group.forEach(g => { const x = g.c; x.st.in = g.st0.in + d; x.st.out = g.st0.out + d; x.st.off = g.st0.off + d; if (x !== c) { apply(x); const ex = inner.querySelector(`.clip[data-k="${CSS.escape(x.k)}"]`); if (ex) ex.style.left = (x.st.in * pps) + 'px'; } }); }
    else if (drag.mode === 'l') c.st.in = Math.max(0, Math.min(s0.out - MIN, snapT(s0.in + dt, c)));
    else c.st.out = Math.min(DUR, Math.max(s0.in + MIN, snapT(s0.out + dt, c)));
    apply(c); const el = inner.querySelector(`.clip[data-k="${c.k}"]`); if (el) { el.style.left = (c.st.in * pps) + 'px'; el.style.width = Math.max(4, (c.st.out - c.st.in) * pps) + 'px'; }
    if (drag.mode === 'l') seek(c.st.in + 0.02); else if (drag.mode === 'r') seek(Math.max(0, c.st.out - 0.04)); else pv.refresh();
    showSel(); });
  inner.addEventListener('pointerup', () => { if (drag && drag.moved) { pv.refresh(); draw(); drag.group.forEach(g => { if (g.c !== drag.c) commit(g.c); }); commit(drag.c); } else if (drag && drag.keepGroup) select(drag.c); drag = null; });
  function paintSel() { Object.values(pv.byK).forEach(d => d.classList.remove('pa-sel')); sels.forEach(x => x.d && x.d.classList.add('pa-sel'));
    inner.querySelectorAll('.clip.sel').forEach(x => x.classList.remove('sel')); sels.forEach(x => inner.querySelector(`.clip[data-k="${CSS.escape(x.k)}"]`)?.classList.add('sel')); showSel(); }
  function select(c, add) {
    if (add && c) { if (sels.has(c)) { sels.delete(c); if (sel === c) sel = [...sels].pop() || null; } else { sels.add(c); sel = c; } }
    else { sels = new Set(c ? [c] : []); sel = c || null; }
    if (sel) msel = null; if (c && kSel !== null) { kSel = null; drawCam(); showKf(); } paintSel(); onSelect && onSelect([...sels].map(x => x.k), sel ? sel.k : null); }
  function showSel() { const r = box.querySelector('.tlReset'); upB.disabled = downB.disabled = !sel || sels.size !== 1; delB.disabled = !sels.size && !msel; muteB.disabled = !onMute || (!sels.size && !msel);
    { const offNow = sel ? sel.off : msel ? !!(mineList().find(x => x.id === msel) || {}).off : false; muteB.textContent = offNow ? '◉ Unmute' : '⊘ Mute'; }
    if (!sel) { selEl.textContent = msel ? 'Your photo/video selected' : ''; r.disabled = true; return; } r.disabled = false;
    if (sels.size > 1) { selEl.innerHTML = `<b>${sels.size} layers</b> selected · drag one to move them all · Shift+click to add or remove`; return; }
    selEl.innerHTML = `<b>${esc(sel.label)}</b> · ${sel.beat} · ${fmtS(sel.st.in)} → ${fmtS(sel.st.out)} (${(sel.st.out - sel.st.in).toFixed(2)} s)${changed(sel) ? ' <em>changed</em>' : ''}`; }
  function resetClip(c) { undo.push({ c, st: { ...c.st } }); c.st = { in: c.o.in, out: c.o.out, off: 0 }; apply(c); commit(c); }
  box.querySelector('.tlReset').onclick = () => { if (sel) { resetClip(sel); pv.refresh(); draw(); showSel(); } };
  box.querySelector('.tlResetAll').onclick = () => { clips.filter(changed).forEach(resetClip); pv.refresh(); draw(); showSel(); };
  function doUndo() { if (onUndo) { onUndo(); return; } const u = undo.pop(); if (!u) return; u.c.st = u.st; apply(u.c); commit(u.c); pv.refresh(); draw(); select(u.c); }
  box.querySelector('.tlUndo').onclick = doUndo;
  function onKey(ev) { const tg = ev.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (document.querySelector('.ideasWin')) return;   // a window (Brand, Suggestions, progress) is open
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { if (sel) { ev.preventDefault(); moveLayer(ev.key === 'ArrowUp' ? 1 : -1); } return; }
    if (ev.shiftKey && ev.key.toLowerCase() === 'e' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); muteSel(); return; }
    if (ev.key.toLowerCase() === 'm' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); addMark(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && !ev.ctrlKey && !ev.metaKey) { if (sel || msel) { ev.preventDefault(); deleteSel(); } else if (kSel !== null) { ev.preventDefault(); delKey(); } return; }
    if (ev.key === 'Escape' && kSel !== null) { kSel = null; drawCam(); showKf(); return; }
    if (ev.key.toLowerCase() === 'g' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { setGuides(!guides); return; }
    if (ev.code === 'Space') { ev.preventDefault(); togglePlay(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seek(Math.round(now() * FPS - (ev.shiftKey ? FPS : 1)) / FPS); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); seek(Math.round(now() * FPS + (ev.shiftKey ? FPS : 1)) / FPS); }
    else if (ev.key === 'Home') seek(0); else if (ev.key === 'End') seek(DUR);
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { if (!onUndo) { ev.preventDefault(); doUndo(); } }
    else if (ev.key.toLowerCase() === 's' && !ev.ctrlKey && !ev.metaKey) setSnap(!snap);
    else if (ev.key === '=' || ev.key === '+') { zoomIn.value = Math.min(100, +zoomIn.value + 10); setZoom(+zoomIn.value); }
    else if (ev.key === '-') { zoomIn.value = Math.max(0, +zoomIn.value - 10); setZoom(+zoomIn.value); } }
  document.addEventListener('keydown', onKey);

  const changesText = bid => { const ch = clips.filter(c => c.beat === bid && !c.user && changed(c)); if (!ch.length) return '';
    return ' · timeline (apply exactly): ' + ch.map(c => `el#${c.i} “${c.label}” in ${c.o.in.toFixed(2)}→${c.st.in.toFixed(2)} s, out ${c.o.out.toFixed(2)}→${c.st.out.toFixed(2)} s${Math.abs(c.st.off) > .004 ? ' (whole clip moved)' : ''}`).join('; '); };
  /* your photos / videos (suggestions for Claude): one lane, drag to move, drag the edges to trim */
  function drawMine() { const L = lane('mine'); if (!L) return;
    L.innerHTML = mineList().map(m => `<div class="clip cM${msel === m.id ? ' sel' : ''}${m.off ? ' off' : ''}" data-m="${esc(m.id)}" style="left:${m.t0 * pps}px;width:${Math.max(4, (m.t1 - m.t0) * pps)}px" title="${esc(m.name || '')} · ${fmtS(m.t0)} → ${fmtS(m.t1)}"><i class="hl"></i><span>${m.off ? '⊘ ' : ''}${m.type === 'video' ? '🎞' : '🖼'} ${esc(m.name || 'media')}</span><i class="hr"></i></div>`).join(''); }
  inner.addEventListener('pointerdown', ev => { const el = ev.target.closest('.clip.cM'); if (!el) return; ev.preventDefault(); const m = mineList().find(x => x.id === el.dataset.m); if (!m) return;
    msel = m.id; select(null); onMedia && onMedia('select', m); mdr = { m, mode: ev.target.classList.contains('hl') ? 'l' : ev.target.classList.contains('hr') ? 'r' : 'm', x0: ev.clientX, a: m.t0, b: m.t1, moved: false }; inner.setPointerCapture(ev.pointerId); drawMine(); });
  inner.addEventListener('pointermove', ev => { if (!mdr) return; const dt = (ev.clientX - mdr.x0) / pps; if (!mdr.moved && Math.abs(ev.clientX - mdr.x0) < 3) return; mdr.moved = true;
    const m = mdr.m, len = mdr.b - mdr.a;
    if (mdr.mode === 'm') { const a = Math.max(0, Math.min(DUR - len, snapT(mdr.a + dt))); m.t0 = +a.toFixed(3); m.t1 = +(a + len).toFixed(3); }
    else if (mdr.mode === 'l') m.t0 = +Math.max(0, Math.min(mdr.b - 0.1, snapT(mdr.a + dt))).toFixed(3);
    else m.t1 = +Math.min(DUR, Math.max(mdr.a + 0.1, snapT(mdr.b + dt))).toFixed(3);
    drawMine(); seek(mdr.mode === 'r' ? Math.max(0, m.t1 - 0.04) : m.t0 + 0.02); onMedia && onMedia('move', m); });
  inner.addEventListener('pointerup', () => { if (mdr && mdr.moved) onChange && onChange(); mdr = null; });
  /* ---------- layers: up / down, delete, add ---------- */
  const upB = box.querySelector('.tlUp'), downB = box.querySelector('.tlDown'), delB = box.querySelector('.tlDel'), muteB = box.querySelector('.tlMute');
  const say = m => { if (status) status(m); else selEl.textContent = m; };
  function moveLayer(dir) { if (!sel || !onLayers) return; if (isLocked(sel.k)) { say('That track is locked'); return; }
    const L = zList(sel.bg), i = L.indexOf(sel);
    const others = dir > 0 ? L.slice(i + 1).filter(c => overlap(c, sel)) : L.slice(0, i).filter(c => overlap(c, sel)).reverse();
    const n = others.find(c => !isLocked(c.k)) || others[0];
    if (!n) { say(dir > 0 ? `“${sel.label}” is already on top` : `“${sel.label}” is already at the bottom`); return; }
    const rest = L.filter(c => c !== sel), j = rest.indexOf(n); rest.splice(dir > 0 ? j + 1 : j, 0, sel);
    const other = zList(!sel.bg), bgL = sel.bg ? rest : other, fgL = sel.bg ? other : rest;
    onLayers([...bgL, ...fgL].map(c => c.k), sel.k); }
  function deleteSel() { if (!onDelete) return;
    if (sels.size) { const ks = [...sels].filter(c => !isLocked(c.k)).map(c => c.k); if (!ks.length) { say('That track is locked'); return; } select(null); onDelete(ks); return; }
    if (msel) { if (locks.has('mine')) { say('That track is locked'); return; } const k = 'm:' + msel; msel = null; onDelete(k); } }
  if (!onLayers) [upB, downB, delB, muteB, box.querySelector('.tlAddWrap')].forEach(x => { if (x) x.hidden = true; });
  if (readOnly) box.querySelector('.tlMark').hidden = true;
  /* Mute (Shift+E): the layer stays in the plan but is switched off, like Premiere's Enable */
  function muteSel() { if (!onMute) return; const ks = [...sels].filter(c => !isLocked(c.k)).map(c => c.k);
    if (msel && !locks.has('mine')) ks.push('m:' + msel);
    if (!ks.length) { say(sels.size || msel ? 'That track is locked' : 'Select a layer first, then Shift+E'); return; } onMute(ks); }
  muteB.onclick = muteSel;
  upB.onclick = () => moveLayer(1); downB.onclick = () => moveLayer(-1); delB.onclick = deleteSel;
  const addB = box.querySelector('.tlAdd'), addM = box.querySelector('.tlAddMenu'), addT = box.querySelector('.tlAddText'), addI = addT.querySelector('input');
  const closeAdd = () => { addM.hidden = true; addT.hidden = true; addI.value = ''; };
  addB.onclick = () => { if (addM.hidden) { addM.hidden = false; addT.hidden = true; } else closeAdd(); };
  addM.addEventListener('click', ev => { const a = ev.target.closest('[data-add]'); if (!a) return; const k = a.dataset.add;
    if (k === 'text') { addT.hidden = false; addI.focus(); return; }
    if (k === 'media') { closeAdd(); onAddLayer && onAddLayer('media', null, now()); return; }
    if (k === 'ok') { const t = addI.value.trim(); if (!t) { addI.focus(); return; } closeAdd(); onAddLayer && onAddLayer('text', t, now()); } });
  addI.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') addM.querySelector('[data-add="ok"]').click(); else if (ev.key === 'Escape') closeAdd(); });
  const onDocDown = ev => { if (!addM.hidden && !ev.target.closest('.tlAddWrap')) closeAdd(); }; document.addEventListener('pointerdown', onDocDown);
  /* ---------- safe margins + center (Premiere's safe margins) ---------- */
  const GKEY = 'planner-guides'; let guides = false; const gBtn = box.querySelector('.tlGuide');
  const gRoot = pv.frame.getRootNode(), gEl = document.createElement('div'); gEl.className = 'pa-guides'; gEl.innerHTML = '<i class="gA"></i><i class="gT"></i><i class="gH"></i><i class="gV"></i>';
  if (gRoot && gRoot.querySelector && !gRoot.querySelector('style.pa-gst')) { const gs = document.createElement('style'); gs.className = 'pa-gst';
    gs.textContent = `.pa-guides{position:absolute;inset:0;z-index:60;pointer-events:none;display:none}.pa-guides.on{display:block}
    .pa-guides i{position:absolute;box-sizing:border-box}.pa-guides .gA{inset:5%;border:1px solid rgba(255,255,255,.75)}.pa-guides .gT{inset:10%;border:1px solid rgba(255,255,255,.55)}
    .pa-guides .gH{left:47%;right:47%;top:50%;height:0;border-top:1px solid rgba(255,255,255,.85)}.pa-guides .gV{top:46.5%;bottom:46.5%;left:50%;width:0;border-left:1px solid rgba(255,255,255,.85)}
    .pa-guides i{filter:drop-shadow(0 0 1px rgba(0,0,0,.9))}`; gRoot.appendChild(gs); }
  pv.frame.appendChild(gEl);
  function setGuides(on) { guides = on; gEl.classList.toggle('on', on); gBtn.classList.toggle('on', on); gBtn.setAttribute('aria-pressed', on); try { localStorage.setItem(GKEY, on ? '1' : ''); } catch (e) {} }
  gBtn.onclick = () => setGuides(!guides);
  setGuides((() => { try { return localStorage.getItem(GKEY) === '1'; } catch (e) { return false; } })());


  /* ---------- camera keyframes (Cam track) ----------
     Claude's keys are orange, yours are green. Editing one of Claude's keys first copies that beat's camera into your keys
     (your keys replace Claude's camera inside their beat), so nothing else in the beat changes. */
  const R_ = () => (project.review ||= {});
  const ukeys = () => (R_().cams ||= []);
  const camsAll = () => pv.camsNow ? pv.camsNow() : BEATS.flatMap(b => b.cam || []);
  const beatOf = t => BEATS.find(b => t >= b.t0 - 1e-6 && t < b.t1 - 1e-6) || BEATS[BEATS.length - 1];
  const r3 = x => Math.round(x * 1000) / 1000;
  const ukeyAt = t => ukeys().find(k => Math.abs(k.t - t) < 0.5 / FPS);
  const easeOf = c => c[5] ? 'cut' : c[6] === 'e' ? 'smooth' : 'lin';
  function own(t) { const b = beatOf(t); if (!b) return; if (ukeys().some(k => k.t >= b.t0 && k.t < b.t1)) return;
    camsAll().filter(c => c[0] >= b.t0 - 1e-6 && c[0] < b.t1 - 1e-6).forEach(c => { const e = easeOf(c);
      ukeys().push({ t: r3(c[0]), s: +(+c[1]).toFixed(3), x: +(+c[2]).toFixed(2), y: +(+(c[7] || 0)).toFixed(2), ...(e !== 'smooth' ? { ease: e } : {}) }); });
    ukeys().sort((a, b2) => a.t - b2.t); }
  let zTop = 2;
  const yOf = s => { const H = camH(); return camX ? (H - 10) - (Math.min(zTop, Math.max(1, s)) - 1) / (zTop - 1) * (H - 24) : 20 - Math.min(18, (s - 1) * 60); };
  function drawCam() { const L = lane('cam'); if (!L) return; L.classList.toggle('big', camX); const cams = camsAll(), H = camH(), user = ukeys();
    if (!kdr) zTop = Math.max(2, Math.ceil(Math.max(1, ...cams.map(c => +c[1] || 1)) * 2 + .2) / 2);
    const mine = t => user.some(k => Math.abs(k.t - t) < 0.5 / FPS);
    let pts = ''; if (cams.length) { const W = Math.round(DUR * pps); for (let px = 0; px <= W; px += 3) { const c = camAt(cams, px / pps); pts += `${px},${yOf(+c[1]).toFixed(1)} `; } }
    const grid = camX ? [1, (1 + zTop) / 2, zTop].map(z => `<i class="kfGrid" style="top:${yOf(z)}px"><b>${Math.round(z * 100)}%</b></i>`).join('') : '';
    L.innerHTML = grid + (pts ? `<svg class="camLine" width="${DUR * pps}" height="${H}"><polyline fill="none" points="${pts}"/></svg>` : '') +
      cams.map(c => `<i class="kf${mine(c[0]) ? ' mine' : ''}${kSel !== null && Math.abs(c[0] - kSel) < 0.5 / FPS ? ' sel' : ''}" data-t="${c[0]}" style="left:${c[0] * pps}px;top:${yOf(+c[1]) - (camX ? 6 : 4.5)}px" title="${fmtS(c[0])} · zoom ${Math.round(c[1] * 100)}%${mine(c[0]) ? ' · yours' : ' · Claude'}"></i>`).join(''); }
  const kfEd = box.querySelector('.kfEd');
  function showKf() { if (kSel === null) { kfEd.hidden = true; kfEd.innerHTML = ''; return; }
    const c = camsAll().find(x => Math.abs(x[0] - kSel) < 0.5 / FPS); if (!c) { kSel = null; kfEd.hidden = true; return; }
    const isMine = !!ukeyAt(kSel), e = easeOf(c), b = beatOf(kSel);
    const f = (k, val, step, w) => `<label>${k === 't' ? 'Time' : k === 's' ? 'Zoom' : k.toUpperCase()} <input type="number" data-kf="${k}" value="${val}" step="${step}" style="width:${w}px">${k === 't' ? ' s' : '%'}</label>`;
    kfEd.hidden = false;
    kfEd.innerHTML = `<b class="${isMine ? 'mine' : ''}">◆ Key ${b ? b.id : ''}</b>${f('t', (+c[0]).toFixed(2), 0.03, 70)}${f('s', Math.round(c[1] * 100), 1, 62)}${f('x', (+c[2]).toFixed(1), 0.5, 62)}${f('y', (+(c[7] || 0)).toFixed(1), 0.5, 62)}
      <label>Get here <select data-kf="ease"><option value="smooth"${e === 'smooth' ? ' selected' : ''}>Smooth</option><option value="lin"${e === 'lin' ? ' selected' : ''}>Linear</option><option value="cut"${e === 'cut' ? ' selected' : ''}>Cut (jump)</option></select></label>
      <span class="kfWho">${isMine ? 'Yours' : 'Claude’s'} · ${readOnly ? 'view only' : 'drag it on the Cam track, or type here'}</span><span class="tlGrow"></span>${readOnly ? '' : '<button type="button" class="tlBtn" data-kf="add" title="Add a key at the playhead">＋ Key here</button><button type="button" class="tlBtn" data-kf="del" title="Delete this key (Delete)">🗑 Delete key</button>'}<button type="button" class="tlBtn" data-kf="x" title="Close (Esc)">✕</button>`;
    kfEd.querySelectorAll('input,select').forEach(x => { x.disabled = !!readOnly; }); }
  function camChanged() { pv.render(now()); drawCam(); showKf(); onChange && onChange(); }
  function editKey(field, val) { if (readOnly || kSel === null) return; own(kSel); const k = ukeyAt(kSel); if (!k) return;
    if (field === 't') { const b = beatOf(k.t); let t = Math.round(+val * FPS) / FPS; if (!Number.isFinite(t)) return; t = Math.max(b.t0, Math.min(Math.min(b.t1, DUR) - 1 / FPS, t));
      R_().cams = ukeys().filter(x => x === k || Math.abs(x.t - t) >= 0.5 / FPS); k.t = r3(t); ukeys().sort((a, b2) => a.t - b2.t); kSel = k.t; seek(k.t); }
    else if (field === 's') { const z = +val / 100; if (Number.isFinite(z)) k.s = +Math.max(1, Math.min(4, z)).toFixed(3); }
    else if (field === 'x' || field === 'y') { const n = +val; if (Number.isFinite(n)) k[field] = +n.toFixed(2); }
    else if (field === 'ease') { if (val === 'smooth') delete k.ease; else k.ease = val; }
    camChanged(); }
  function addKey(t) { if (readOnly) return; t = Math.max(0, Math.min(DUR - 1 / FPS, Math.round(t * FPS) / FPS)); own(t); let k = ukeyAt(t);
    if (!k) { const c = camAt(camsAll(), t); k = { t: r3(t), s: +(+c[1]).toFixed(3), x: +(+c[2]).toFixed(2), y: +(+(c[7] || 0)).toFixed(2) }; ukeys().push(k); ukeys().sort((a, b2) => a.t - b2.t); }
    kSel = k.t; seek(k.t); camChanged(); say('Key added · drag it, or type the zoom / position'); }
  function delKey() { if (readOnly || kSel === null) return; own(kSel); R_().cams = ukeys().filter(x => Math.abs(x.t - kSel) >= 0.5 / FPS); kSel = null; camChanged(); say('Key deleted · Ctrl+Z to undo'); }
  kfEd.addEventListener('change', ev => { const f = ev.target.dataset.kf; if (f) editKey(f, ev.target.value); });
  kfEd.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' && ev.target.dataset.kf) { editKey(ev.target.dataset.kf, ev.target.value); } else if (ev.key === 'Escape') { kSel = null; drawCam(); showKf(); } });
  kfEd.addEventListener('click', ev => { const a = ev.target.dataset.kf; if (a === 'del') delKey(); else if (a === 'add') addKey(now()); else if (a === 'x') { kSel = null; drawCam(); showKf(); } });
  inner.addEventListener('pointerdown', ev => { const el = ev.target.closest('.trC .kf'); if (!el) return; ev.preventDefault(); ev.stopPropagation();
    const t0 = +el.dataset.t; if (sels.size || msel) { sels = new Set(); sel = null; msel = null; paintSel(); drawMine(); onSelect && onSelect([], null); }
    kSel = t0; seek(t0); drawCam(); showKf();
    if (readOnly) return; const c = camsAll().find(x => Math.abs(x[0] - t0) < 0.5 / FPS);
    kdr = { t0, s0: c ? +c[1] : 1, x0: ev.clientX, y0: ev.clientY, moved: false, k: null }; inner.setPointerCapture(ev.pointerId); });
  inner.addEventListener('pointermove', ev => { if (!kdr) return; const dx = ev.clientX - kdr.x0, dy = ev.clientY - kdr.y0;
    if (!kdr.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!kdr.moved) { kdr.moved = true; own(kdr.t0); kdr.k = ukeyAt(kdr.t0); if (!kdr.k) { kdr = null; return; } kdr.b = beatOf(kdr.k.t); }
    const k = kdr.k, lockY = ev.shiftKey && Math.abs(dx) > Math.abs(dy), lockX = ev.shiftKey && !lockY;
    if (!lockX) { const t = Math.max(kdr.b.t0, Math.min(Math.min(kdr.b.t1, DUR) - 1 / FPS, Math.round((kdr.t0 + dx / pps) * FPS) / FPS)); k.t = r3(t); }
    if (camX && !lockY) k.s = +Math.max(1, Math.min(4, kdr.s0 - dy / (camH() - 24) * (zTop - 1))).toFixed(3);
    kSel = k.t; pv.seek(k.t); movePH(); pv.render(k.t); drawCam(); showKf(); });
  inner.addEventListener('pointerup', () => { if (!kdr) return; const d = kdr; kdr = null;
    if (d.moved && d.k) { R_().cams = ukeys().filter(x => x === d.k || Math.abs(x.t - d.k.t) >= 0.5 / FPS); ukeys().sort((a, b2) => a.t - b2.t); kSel = d.k.t; camChanged(); say('Key moved · Ctrl+Z to undo'); } });
  inner.addEventListener('dblclick', ev => { if (readOnly || !ev.target.closest('.trC') || ev.target.closest('.kf')) return; addKey(tAt(ev.clientX)); });
  inner.addEventListener('pointerdown', ev => { if (!camX || ev.target.closest('.kf') || !ev.target.closest('.trC')) return; seek(tAt(ev.clientX)); if (kSel !== null) { kSel = null; drawCam(); showKf(); } });

  /* ---------- markers (M): a comment for Claude at an exact time; Claude removes it when it's done ---------- */
  const marks = () => (R_().marks ||= []);
  const mkPop = box.querySelector('.mkPop');
  function drawMarks() { const list = marks().slice().sort((a, b2) => a.t - b2.t);
    ruler.querySelectorAll('.mk').forEach(x => x.remove()); inner.querySelectorAll('.mkLine').forEach(x => x.remove());
    list.forEach((m, i) => { const has = !!(m.note || '').trim();
      ruler.insertAdjacentHTML('beforeend', `<b class="mk${has ? ' has' : ''}${mkOpen === m.id ? ' open' : ''}" data-mk="${esc(m.id)}" style="left:${m.t * pps}px" title="${esc(fmtS(m.t))}${has ? ' · ' + esc(m.note.trim().slice(0, 120)) : ' · click to write what Claude should do'}">${i + 1}</b>`);
      inner.insertAdjacentHTML('beforeend', `<i class="mkLine${has ? ' has' : ''}" style="left:${m.t * pps}px"></i>`); }); }
  function addMark() { if (readOnly) return; const t = Math.round(now() * FPS) / FPS; let m = marks().find(x => Math.abs(x.t - t) < 0.5 / FPS);
    if (!m) { m = { id: 'k' + Date.now().toString(36), t: r3(t), note: '' }; marks().push(m); marks().sort((a, b2) => a.t - b2.t); onChange && onChange(); }
    openMark(m.id); }
  function openMark(id) { const m = marks().find(x => x.id === id); if (!m) { closeMark(); return; } mkOpen = id; drawMarks();
    const i = marks().slice().sort((a, b2) => a.t - b2.t).indexOf(m) + 1, b = beatOf(m.t);
    mkPop.hidden = false;
    mkPop.innerHTML = `<header><b>📍 Marker ${i}</b><span>${fmtTC(m.t).slice(6)} · ${b ? esc(b.id) : ''}</span><button type="button" class="tlBtn" data-mk="x" title="Close (Esc)">✕</button></header>
      <div class="noteRow"><textarea rows="3" placeholder="Ano gagawin ni Claude dito? (e.g. zoom in sa mukha, lagay ng text na …)"${readOnly ? ' readonly' : ''}></textarea><button type="button" class="mic" title="Dictate">🎤</button></div>
      <footer><small>Claude does this at exactly ${m.t.toFixed(2)} s on your next Revise / Apply all, then removes the marker.</small>${readOnly ? '' : '<button type="button" class="tlBtn" data-mk="del">🗑 Delete</button>'}<button type="button" class="tlBtn mkOk" data-mk="x">Done</button></footer>`;
    const ta = mkPop.querySelector('textarea'); ta.value = m.note || ''; wireMic(mkPop.querySelector('.mic'), ta);
    ta.addEventListener('input', () => { m.note = ta.value; drawMarks(); });
    ta.addEventListener('change', () => { onChange && onChange(); });
    ta.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Escape') closeMark(); });
    placeMark(); if (!readOnly) setTimeout(() => ta.focus(), 0); }
  function placeMark() { if (!mkOpen || mkPop.hidden) return; const m = marks().find(x => x.id === mkOpen); if (!m) return;
    const bx = box.getBoundingClientRect(), sx = scroll.getBoundingClientRect(), x = sx.left - bx.left + m.t * pps - scroll.scrollLeft;
    mkPop.style.left = Math.max(6, Math.min(bx.width - 336, x - 40)) + 'px'; mkPop.style.top = (sx.top - bx.top + RULER + 4) + 'px'; }
  function closeMark() { if (!mkOpen) { mkPop.hidden = true; return; } const m = marks().find(x => x.id === mkOpen); mkOpen = null; mkPop.hidden = true; mkPop.innerHTML = '';
    if (m && !readOnly) onChange && onChange(); drawMarks(); }
  mkPop.addEventListener('click', ev => { const a = ev.target.dataset.mk; if (a === 'x') closeMark();
    else if (a === 'del' && mkOpen) { R_().marks = marks().filter(x => x.id !== mkOpen); mkOpen = null; mkPop.hidden = true; onChange && onChange(); drawMarks(); say('Marker deleted · Ctrl+Z to undo'); } });
  scroll.addEventListener('scroll', placeMark);
  inner.addEventListener('pointerdown', ev => { const el = ev.target.closest('.mk'); if (!el) return; ev.preventDefault(); ev.stopPropagation(); const m = marks().find(x => x.id === el.dataset.mk); if (!m) return;
    seek(m.t); mkdr = { m, x0: ev.clientX, t0: m.t, moved: false }; if (!readOnly) inner.setPointerCapture(ev.pointerId); });
  inner.addEventListener('pointermove', ev => { if (!mkdr || readOnly) return; const dx = ev.clientX - mkdr.x0; if (!mkdr.moved && Math.abs(dx) < 3) return; mkdr.moved = true;
    mkdr.m.t = r3(Math.max(0, Math.min(DUR - 1 / FPS, snapT(mkdr.t0 + dx / pps)))); seek(mkdr.m.t); drawMarks(); placeMark(); });
  inner.addEventListener('pointerup', () => { if (!mkdr) return; const d = mkdr; mkdr = null; if (d.moved) { marks().sort((a, b2) => a.t - b2.t); onChange && onChange(); drawMarks(); if (mkOpen) openMark(mkOpen); } else openMark(d.m.id); });
  box.querySelector('.tlMark').onclick = addMark;
  const onDocDown2 = ev => { if (mkOpen && !ev.target.closest('.mkPop,.mk,.tlMark')) closeMark(); }; document.addEventListener('pointerdown', onDocDown2);

  /* re-read your timeline edits after an undo */
  function sync() { if (mkOpen && !marks().some(x => x.id === mkOpen)) closeMark(); clips.forEach(c => { const s = project.timeline[c.k]; c.st = s ? { in: +s.in, out: +s.out, off: +(s.off || 0) } : { in: c.o.in, out: c.o.out, off: 0 }; apply(c); }); pv.refresh(); draw(); showSel(); showKf(); }
  const ro = new ResizeObserver(() => setZoom(+zoomIn.value)); ro.observe(scroll);
  setZoom(0); pv.refresh();
  return { seek, togglePlay, changesText, sync, redraw: () => draw(), now, isLocked, deleteSel, addMark,
    markSel: keys => { sels = new Set(clips.filter(c => keys.includes(c.k))); sel = sels.size ? [...sels].pop() : null; if (sel) msel = null; paintSel(); },
    selectKey: k => { const c = clips.find(x => x.k === k); if (c) { select(c); const el = inner.querySelector(`.clip[data-k="${CSS.escape(k)}"]`); if (el) { const x = el.offsetLeft; if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - 60; el.scrollIntoView({ block: 'nearest' }); } } },
    selectMedia: id => { msel = id; if (id) { sels = new Set(); sel = null; paintSel(); } drawMine(); showSel(); }, destroy() { alive = false; closeMark(); document.removeEventListener('pointerdown', onDocDown2); document.removeEventListener('keydown', onKey); ro.disconnect(); gEl.remove(); document.removeEventListener('pointerdown', onDocDown); } };
}
