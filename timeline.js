/* Premiere-style timeline: ruler, beats, words, V tracks (text / animation / scene), V1 video,
   camera keyframes and A1 audio. Drag a clip to move it, drag its edges to trim. */
const FPS = 30;
export const fmtTC = t => { t = Math.max(0, t); const f = Math.round(t * FPS), s = Math.floor(f / FPS), fr = f % FPS; return '00:00:' + String(s).padStart(2, '0') + ':' + String(fr).padStart(2, '0'); };
const fmtS = t => t.toFixed(2) + ' s';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createTimeline(box, project, pv, { onChange, onSelect } = {}) {
  const v = pv.video, BEATS = project.beats, W = project.words || [], DUR = project.duration;
  project.timeline = project.timeline || {};
  box.innerHTML = `
  <div class="tlBar">
    <button type="button" class="tlBtn tlPlay" title="Play / pause (Space)">▶</button>
    <button type="button" class="tlBtn tlStep" data-d="-1" title="1 frame back (←)">◀︎|</button>
    <button type="button" class="tlBtn tlStep" data-d="1" title="1 frame forward (→)">|▶︎</button>
    <span class="tlTC">00:00:00:00</span><span class="tlDur">/ ${fmtTC(DUR)}</span>
    <span class="tlSep"></span>
    <button type="button" class="tlBtn tlSnap on" title="Snapping (S)">🧲 Snap</button>
    <button type="button" class="tlBtn tlUndo" title="Undo (Ctrl+Z)">↶ Undo</button>
    <button type="button" class="tlBtn tlReset" disabled title="Put the selected clip back where Claude had it">Reset clip</button>
    <button type="button" class="tlBtn tlResetAll" title="Undo every timing change">Reset all</button>
    <span class="tlSel"></span><span class="tlGrow"></span>
    <label class="tlZoom">− <input type="range" min="0" max="100" value="0" aria-label="Timeline zoom"> +</label>
  </div>
  <div class="tlBody"><div class="tlHeads"></div><div class="tlScroll"><div class="tlInner"><div class="tlPH"><i></i></div></div></div></div>`;
  const heads = box.querySelector('.tlHeads'), scroll = box.querySelector('.tlScroll'), inner = box.querySelector('.tlInner'), ph = box.querySelector('.tlPH');
  const tcEl = box.querySelector('.tlTC'), selEl = box.querySelector('.tlSel'), zoomIn = box.querySelector('.tlZoom input');

  const labelOf = e => { const t = document.createElement('div'); t.innerHTML = e.html || ''; t.querySelectorAll('[aria-hidden="true"],style,script,svg').forEach(x => x.remove()); let s = (t.textContent || '').replace(/\s+/g, ' ').trim(); if (!s) s = 'FX · ' + ((e.cls || 'graphic').split(' ')[0]); return s.length > 34 ? s.slice(0, 33) + '…' : s; };
  const clips = [];
  BEATS.forEach(b => b.els.forEach((e, i) => {
    if (e.in === undefined || e.out === undefined) return;
    const d = pv.byK[e._k];
    const inner_ = d ? [...d.querySelectorAll('[data-show],[data-glow]')].map(n => ({ n, show: n.dataset.show, glow: n.dataset.glow })) : [];
    const o = { in: e.in, out: Math.min(e.out, DUR), fly: e.fly };
    const c = { k: e._k, beat: b.id, i, e, d, bg: !!e.bg, label: labelOf(e), o, inner: inner_, st: { in: o.in, out: o.out, off: 0 } };
    const saved = project.timeline[e._k]; if (saved) c.st = { in: +saved.in, out: +saved.out, off: +(saved.off || 0) };
    clips.push(c); apply(c);
  }));
  function apply(c) { const e = c.e; e.in = c.st.in; e.out = c.st.out; if (c.o.fly !== undefined) e.fly = c.o.fly + c.st.off;
    c.inner.forEach(x => { if (x.show !== undefined) x.n.dataset.show = String(+x.show + c.st.off); if (x.glow !== undefined) x.n.dataset.glow = String(+x.glow + c.st.off); }); }
  const changed = c => Math.abs(c.st.in - c.o.in) > .004 || Math.abs(c.st.out - c.o.out) > .004;
  function commit(c) { if (changed(c)) project.timeline[c.k] = { in: +c.st.in.toFixed(3), out: +c.st.out.toFixed(3), off: +c.st.off.toFixed(3) }; else delete project.timeline[c.k]; onChange && onChange(); }

  function pack(list) { const lanes = []; list.slice().sort((a, b) => a.o.in - b.o.in).forEach(c => { let L = lanes.find(l => l.end <= c.o.in + 1e-3); if (!L) { L = { end: 0, clips: [] }; lanes.push(L); } L.clips.push(c); L.end = c.o.out; }); return lanes; }
  const gL = pack(clips.filter(c => !c.bg)), sL = pack(clips.filter(c => c.bg));
  const TR = [{ id: 'beats', name: 'Beats', cls: 'trBeats', h: 22 }, { id: 'words', name: 'Words', cls: 'trWords', h: 20 }];
  const nV = gL.length + sL.length + 1;
  gL.slice().reverse().forEach((L, j) => TR.push({ id: 'g' + j, name: 'V' + (nV - j), sub: 'Text / anim', cls: 'trG', h: 24, lane: L }));
  sL.slice().reverse().forEach((L, j) => TR.push({ id: 's' + j, name: 'V' + (sL.length - j + 1), sub: 'Scene', cls: 'trS', h: 24, lane: L }));
  TR.push({ id: 'video', name: 'V1', sub: 'Video', cls: 'trV', h: 42 }, { id: 'cam', name: 'Cam', sub: 'Zoom / pan', cls: 'trC', h: 22 }, { id: 'audio', name: 'A1', sub: 'Audio', cls: 'trA', h: 38 });
  const RULER = 24;
  heads.innerHTML = `<div class="thd thRuler" style="height:${RULER}px"></div>` + TR.map(t => `<div class="thd ${t.cls}" style="height:${t.h}px"><b>${t.name}</b>${t.sub ? `<small>${t.sub}</small>` : ''}</div>`).join('');
  inner.insertAdjacentHTML('afterbegin', `<div class="tlRuler" style="height:${RULER}px"></div>` + TR.map(t => `<div class="tlLane ${t.cls}" data-tr="${t.id}" style="height:${t.h}px"></div>`).join(''));
  const ruler = inner.querySelector('.tlRuler'), lane = id => inner.querySelector(`.tlLane[data-tr="${id}"]`);

  let pps = 100, sel = null;
  const fitPPS = () => Math.max(30, (scroll.clientWidth - 8) / DUR);
  const setZoom = z => { pps = fitPPS() * Math.pow(8, z / 100); draw(); };
  zoomIn.oninput = () => setZoom(+zoomIn.value);
  scroll.addEventListener('wheel', ev => { if (!(ev.ctrlKey || ev.metaKey)) return; ev.preventDefault(); const x = ev.clientX - scroll.getBoundingClientRect().left, t = (x + scroll.scrollLeft) / pps; zoomIn.value = Math.max(0, Math.min(100, +zoomIn.value - (ev.deltaY > 0 ? 6 : -6))); setZoom(+zoomIn.value); scroll.scrollLeft = t * pps - x; }, { passive: false });

  function drawRuler() { const steps = [0.1, 0.2, 0.5, 1, 2, 5]; const step = steps.find(s => s * pps >= 46) || 5, minor = step / 5; let h = '';
    for (let k = 0; k * minor <= DUR + 1e-6; k++) { const t = k * minor, maj = k % 5 === 0; h += `<i class="${maj ? 'maj' : ''}" style="left:${t * pps}px"></i>`; if (maj) h += `<span style="left:${t * pps}px">${fmtTC(t).slice(6)}</span>`; }
    ruler.innerHTML = h; }
  const clipHTML = c => `<div class="clip ${c.bg ? 'cS' : 'cG'}${sel === c ? ' sel' : ''}${changed(c) ? ' moved' : ''}" data-k="${c.k}" style="left:${c.st.in * pps}px;width:${Math.max(4, (c.st.out - c.st.in) * pps)}px" title="${esc(c.label)} · ${c.beat} · ${fmtS(c.st.in)} → ${fmtS(c.st.out)}"><i class="hl"></i><span>${esc(c.label)}</span><i class="hr"></i></div>`;
  function draw() {
    inner.style.width = (DUR * pps + 40) + 'px'; drawRuler();
    lane('beats').innerHTML = BEATS.map((b, j) => `<div class="bt b${j % 4}" style="left:${b.t0 * pps}px;width:${(Math.min(b.t1, DUR) - b.t0) * pps}px" title="${esc(b.title)}"><span>${b.id} · ${b.kind || ''}</span></div>`).join('');
    lane('words').innerHTML = W.map(w => `<span class="wd" style="left:${w[0] * pps}px;width:${Math.max(6, (w[1] - w[0]) * pps)}px">${esc(w[2])}</span>`).join('');
    TR.filter(t => t.lane).forEach(t => { lane(t.id).innerHTML = t.lane.clips.map(clipHTML).join(''); });
    const cuts = BEATS.filter(b => b.cut).map(b => b.t0);
    lane('video').innerHTML = `<div class="clip cV" style="left:0;width:${DUR * pps}px"><canvas class="thumbs" width="${Math.round(DUR * pps)}" height="40"></canvas><span>${esc(project.media?.video?.split('/').pop() || 'Video')}</span>${cuts.map(t => `<i class="cut" style="left:${t * pps}px"></i>`).join('')}</div>`;
    paintThumbs();
    const cams = pv.camsNow ? pv.camsNow() : BEATS.flatMap(b => b.cam || []); const userT = new Set(((project.review || {}).cams || []).map(k => k.t));
    lane('cam').innerHTML = cams.map(c => `<i class="kf${userT.has(c[0]) ? ' mine' : ''}" style="left:${c[0] * pps}px" title="${fmtS(c[0])} · zoom ${Math.round(c[1] * 100)}%"></i>`).join('') + (cams.length > 1 ? `<svg class="camLine" width="${DUR * pps}" height="22"><polyline fill="none" points="${cams.map(c => `${c[0] * pps},${20 - Math.min(18, (c[1] - 1) * 60)}`).join(' ')}"/></svg>` : '');
    lane('audio').innerHTML = `<div class="clip cA" style="left:0;width:${DUR * pps}px"><canvas class="wave" width="${Math.round(DUR * pps)}" height="36"></canvas></div>`;
    paintWave(); movePH();
  }

  /* thumbnails + waveform from the linked video */
  const thumbs = []; let thumbsOK = false, peaks = null;
  async function makeThumbs() { try {
    const tv = document.createElement('video'); tv.src = v.src; tv.muted = true; tv.preload = 'auto';
    await new Promise(r => { tv.onloadeddata = r; tv.onerror = r; setTimeout(r, 8000); });
    for (let k = 0; k <= Math.ceil(DUR / 0.5); k++) { const t = Math.min(DUR - 0.05, k * 0.5); await new Promise(r => { tv.onseeked = r; tv.currentTime = t; setTimeout(r, 1500); });
      const c = document.createElement('canvas'); c.width = 72; c.height = 40; c.getContext('2d').drawImage(tv, 0, 0, 72, 40); thumbs.push({ t, c }); }
    thumbsOK = true; paintThumbs(); } catch (e) {} }
  async function makeWave() { try {
    const buf = await (await fetch(v.src)).arrayBuffer(); const ac = new OfflineAudioContext(1, 44100, 44100); const ab = await ac.decodeAudioData(buf);
    const ch = ab.getChannelData(0), per = Math.floor(ab.sampleRate / 200); peaks = new Float32Array(Math.ceil(ch.length / per));
    for (let i = 0; i < peaks.length; i++) { let m = 0; for (let j = i * per; j < Math.min(ch.length, (i + 1) * per); j++) { const a = Math.abs(ch[j]); if (a > m) m = a; } peaks[i] = m; }
    paintWave(); } catch (e) {} }
  function paintThumbs() { const cv = lane('video')?.querySelector('canvas.thumbs'); if (!cv || !thumbsOK) return; const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height);
    for (let px = 0; px < cv.width; px += 72) { const t = px / pps; const th = thumbs.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a, thumbs[0]); x.globalAlpha = .85; x.drawImage(th.c, px, 0); } }
  function paintWave() { const cv = lane('audio')?.querySelector('canvas.wave'); if (!cv || !peaks) return; const x = cv.getContext('2d'), H = cv.height; x.clearRect(0, 0, cv.width, H); x.fillStyle = 'rgba(170,255,190,.9)';
    let mx = 0; peaks.forEach(p => { if (p > mx) mx = p; }); mx = mx || 1; for (let px = 0; px < cv.width; px++) { const p = (peaks[Math.floor(px / pps * 200)] || 0) / mx * (H / 2 - 2); x.fillRect(px, H / 2 - p, 1, Math.max(1, p * 2)); } }
  if (v.src) { makeThumbs(); makeWave(); }

  /* playhead + transport */
  const now = () => v.currentTime || 0;
  function movePH() { ph.style.left = (now() * pps) + 'px'; tcEl.textContent = fmtTC(now()); }
  let alive = true; (function loop() { if (!alive) return; movePH(); if (!v.paused) { const x = now() * pps; if (x > scroll.scrollLeft + scroll.clientWidth - 30 || x < scroll.scrollLeft) scroll.scrollLeft = x - 60; } requestAnimationFrame(loop); })();
  const playBtn = box.querySelector('.tlPlay'); const setIcon = () => { playBtn.textContent = v.paused ? '▶' : '❚❚'; };
  v.addEventListener('play', setIcon); v.addEventListener('pause', setIcon);
  function togglePlay() { if (v.paused) { const t = now(); pv.playFrom(t >= DUR - 0.05 ? 0 : t); } else v.pause(); }
  playBtn.onclick = togglePlay;
  function seek(t) { t = Math.max(0, Math.min(DUR, t)); v.pause(); v.currentTime = t; pv.render(t); movePH(); }
  box.querySelectorAll('.tlStep').forEach(b => b.onclick = () => seek(Math.round(now() * FPS + +b.dataset.d) / FPS));
  let scrub = false; const tAt = cx => (cx - inner.getBoundingClientRect().left) / pps;
  inner.addEventListener('pointerdown', ev => { if (ev.target.closest('.clip.cG,.clip.cS')) return; scrub = true; inner.setPointerCapture(ev.pointerId); seek(tAt(ev.clientX)); });
  inner.addEventListener('pointermove', ev => { if (scrub) seek(tAt(ev.clientX)); });
  inner.addEventListener('pointerup', () => { scrub = false; });

  /* edit */
  let snap = true; const snapBtn = box.querySelector('.tlSnap'); const setSnap = on => { snap = on; snapBtn.classList.toggle('on', on); }; snapBtn.onclick = () => setSnap(!snap);
  const undo = [];
  const snapPts = skip => { const p = [now(), 0, DUR]; BEATS.forEach(b => p.push(b.t0, Math.min(b.t1, DUR))); W.forEach(w => p.push(w[0], w[1])); clips.forEach(c => { if (c !== skip) p.push(c.st.in, c.st.out); }); return p; };
  function snapT(t, skip) { if (!snap) return Math.round(t * FPS) / FPS; const th = 7 / pps; let best = null; snapPts(skip).forEach(p => { if (Math.abs(p - t) < th && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p; }); return best !== null ? best : Math.round(t * FPS) / FPS; }
  let drag = null;
  inner.addEventListener('pointerdown', ev => { const el = ev.target.closest('.clip.cG,.clip.cS'); if (!el) return; ev.preventDefault(); const c = clips.find(x => x.k === el.dataset.k); select(c);
    drag = { c, mode: ev.target.classList.contains('hl') ? 'l' : ev.target.classList.contains('hr') ? 'r' : 'm', x0: ev.clientX, st0: { ...c.st }, moved: false }; inner.setPointerCapture(ev.pointerId); });
  inner.addEventListener('pointermove', ev => {
    if (!drag) return; const c = drag.c, dt = (ev.clientX - drag.x0) / pps; if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 3) return;
    if (!drag.moved) { undo.push({ c, st: { ...drag.st0 } }); drag.moved = true; }
    const s0 = drag.st0, len = s0.out - s0.in, MIN = 0.1;
    if (drag.mode === 'm') { let a = s0.in + dt; const sa = snapT(a, c), sb = snapT(a + len, c); a = (snap && Math.abs(sb - (a + len)) < Math.abs(sa - a)) ? sb - len : sa; a = Math.max(0, Math.min(DUR - len, a)); c.st.in = a; c.st.out = a + len; c.st.off = s0.off + (a - s0.in); }
    else if (drag.mode === 'l') c.st.in = Math.max(0, Math.min(s0.out - MIN, snapT(s0.in + dt, c)));
    else c.st.out = Math.min(DUR, Math.max(s0.in + MIN, snapT(s0.out + dt, c)));
    apply(c); const el = inner.querySelector(`.clip[data-k="${c.k}"]`); if (el) { el.style.left = (c.st.in * pps) + 'px'; el.style.width = Math.max(4, (c.st.out - c.st.in) * pps) + 'px'; }
    if (drag.mode === 'l') seek(c.st.in + 0.02); else if (drag.mode === 'r') seek(Math.max(0, c.st.out - 0.04)); else pv.refresh();
    showSel(); });
  inner.addEventListener('pointerup', () => { if (drag && drag.moved) { pv.refresh(); draw(); commit(drag.c); } drag = null; });
  function select(c) { sel = c; Object.values(pv.byK).forEach(d => d.classList.remove('pa-sel')); if (c && c.d) c.d.classList.add('pa-sel'); inner.querySelectorAll('.clip.sel').forEach(x => x.classList.remove('sel')); if (c) inner.querySelector(`.clip[data-k="${c.k}"]`)?.classList.add('sel'); showSel(); onSelect && onSelect(c); }
  function showSel() { const r = box.querySelector('.tlReset'); if (!sel) { selEl.textContent = ''; r.disabled = true; return; } r.disabled = false;
    selEl.innerHTML = `<b>${esc(sel.label)}</b> · ${sel.beat} · ${fmtS(sel.st.in)} → ${fmtS(sel.st.out)} (${(sel.st.out - sel.st.in).toFixed(2)} s)${changed(sel) ? ' <em>changed</em>' : ''}`; }
  function resetClip(c) { undo.push({ c, st: { ...c.st } }); c.st = { in: c.o.in, out: c.o.out, off: 0 }; apply(c); commit(c); }
  box.querySelector('.tlReset').onclick = () => { if (sel) { resetClip(sel); pv.refresh(); draw(); showSel(); } };
  box.querySelector('.tlResetAll').onclick = () => { clips.filter(changed).forEach(resetClip); pv.refresh(); draw(); showSel(); };
  function doUndo() { const u = undo.pop(); if (!u) return; u.c.st = u.st; apply(u.c); commit(u.c); pv.refresh(); draw(); select(u.c); }
  box.querySelector('.tlUndo').onclick = doUndo;
  function onKey(ev) { const tg = ev.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (ev.code === 'Space') { ev.preventDefault(); togglePlay(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seek(Math.round(now() * FPS - (ev.shiftKey ? FPS : 1)) / FPS); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); seek(Math.round(now() * FPS + (ev.shiftKey ? FPS : 1)) / FPS); }
    else if (ev.key === 'Home') seek(0); else if (ev.key === 'End') seek(DUR);
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); }
    else if (ev.key.toLowerCase() === 's' && !ev.ctrlKey && !ev.metaKey) setSnap(!snap);
    else if (ev.key === '=' || ev.key === '+') { zoomIn.value = Math.min(100, +zoomIn.value + 10); setZoom(+zoomIn.value); }
    else if (ev.key === '-') { zoomIn.value = Math.max(0, +zoomIn.value - 10); setZoom(+zoomIn.value); } }
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => setZoom(+zoomIn.value)); ro.observe(scroll);
  setZoom(0); pv.refresh();

  const changesText = bid => { const ch = clips.filter(c => c.beat === bid && changed(c)); if (!ch.length) return '';
    return ' · timeline (apply exactly): ' + ch.map(c => `el#${c.i} “${c.label}” in ${c.o.in.toFixed(2)}→${c.st.in.toFixed(2)} s, out ${c.o.out.toFixed(2)}→${c.st.out.toFixed(2)} s${Math.abs(c.st.off) > .004 ? ' (whole clip moved)' : ''}`).join('; '); };
  return { seek, togglePlay, changesText, redraw: () => draw(), now, destroy() { alive = false; document.removeEventListener('keydown', onKey); ro.disconnect(); } };
}
