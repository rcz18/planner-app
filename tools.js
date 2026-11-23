/* Preview tools: Move / Resize, Zoom / Pan (your camera keys), Draw (+ comment), Dictate. */
import { camAt } from './engine.js?v=17.2';
const FPS = 30;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function attachTools({ P, pv, tl, host, bar, hint, onChange, onAddMedia, mediaSrc, onDelete }) {
  const R = P.review; R.moves ||= {}; R.cams ||= []; R.drawings ||= []; R.media ||= [];
  const root = host.shadowRoot, fr = pv.frame, v = pv.video;
  const st = document.createElement('style');
  st.textContent = `.frame.pa-move .ov.on{pointer-events:auto;cursor:move}.frame.pa-move .ov.on:hover{outline:1px dashed rgba(255,255,255,.6);outline-offset:3px}
  .frame.pa-cam{cursor:grab}.frame.pa-cam:active{cursor:grabbing}
  .pa-box{position:absolute;z-index:50;pointer-events:none;border:1.5px solid rgba(255,224,138,.95);box-shadow:0 0 0 1px rgba(0,0,0,.45)}
  .pa-box[hidden]{display:none}
  .pa-box i{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;background:#FF7A1A;border:2px solid #fff;border-radius:3px;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.6)}
  .pa-box i[data-c="nw"]{left:0;top:0;cursor:nwse-resize}.pa-box i[data-c="ne"]{left:100%;top:0;cursor:nesw-resize}
  .pa-box i[data-c="sw"]{left:0;top:100%;cursor:nesw-resize}.pa-box i[data-c="se"]{left:100%;top:100%;cursor:nwse-resize}
  .pa-media{position:absolute;z-index:8;pointer-events:none;opacity:0;outline:2px dashed rgba(74,222,128,.9);outline-offset:2px}.pa-media.on{opacity:1}
  .pa-media img,.pa-media video{display:block;width:100%;height:auto;border-radius:4px}
  .pa-media em{position:absolute;left:0;top:-20px;background:#16a34a;color:#fff;font:700 10px/1 Roboto,sans-serif;padding:3px 6px;border-radius:4px;font-style:normal;white-space:nowrap}
  .frame.pa-move .pa-media.on{pointer-events:auto;cursor:move}
  .pa-box b{position:absolute;left:50%;top:-26px;transform:translateX(-50%);background:#FF7A1A;color:#fff;font:700 11px/1 Roboto,sans-serif;padding:4px 7px;border-radius:5px;white-space:nowrap}`;
  root.appendChild(st);
  let mode = '';
  bar.innerHTML = `<button type="button" class="tool" data-m="move" title="Move / resize text and animations (M)">⤧ Move</button><button type="button" class="tool" data-m="cam" title="Zoom / pan the camera here (Z)">⌖ Zoom/Pan</button><button type="button" class="tool" data-m="draw" title="Draw on this frame and comment (D)">✎ Draw</button><button type="button" class="tool addMedia" title="Add your own photo or video here as a suggestion for Claude">＋ Photo/Video</button>`;
  const btns = [...bar.querySelectorAll('.tool[data-m]')];
  bar.querySelector('.addMedia').onclick = async () => { if (!onAddMedia) return; v.pause(); const m = await onAddMedia(+pv.time().toFixed(3)); if (!m) return; renderMedia(); if (mode !== 'move') setMode('move'); pick('m:' + m.id); changed(); };
  function setMode(m) {
    if (mode === 'draw' && m !== 'draw') closeDraw();
    mode = mode === m ? '' : m;
    btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.m === mode ? 'true' : 'false'));
    fr.classList.toggle('pa-move', mode === 'move'); fr.classList.toggle('pa-cam', mode === 'cam');
    if (mode) v.pause();
    if (mode === 'draw') openDraw();
    paintHint(); placeBox();
  }
  btns.forEach(b => b.onclick = () => setMode(b.dataset.m));
  const changed = () => { onChange && onChange(); };
  const fw = () => fr.clientWidth || fr.getBoundingClientRect().width || host.getBoundingClientRect().width || 1000;
  const cqw = px => { const v = px * 100 / fw(); return Number.isFinite(v) ? v : 0; };

  /* ---------- Move / Resize (Claude's graphics and your own photos/videos) ---------- */
  let sel = null, mdrag = null, rdrag = null;
  const box = document.createElement('div'); box.className = 'pa-box'; box.hidden = true;
  box.innerHTML = '<i data-c="nw"></i><i data-c="ne"></i><i data-c="sw"></i><i data-c="se"></i><b></b>'; fr.appendChild(box);
  const isM = k => !!k && k.startsWith('m:');
  const mEntry = k => R.media.find(x => 'm:' + x.id === k);
  const mediaEls = new Map();
  const elOf = k => isM(k) ? mediaEls.get(k.slice(2)) : pv.byK[k];
  const scaleOf = k => { if (isM(k)) { const m = mEntry(k); return m ? m.w / (m.w0 || m.w) : 1; } return (R.moves[k] || { s: 1 }).s; };
  function renderMedia() {
    const ids = new Set(R.media.map(m => m.id));
    [...mediaEls.keys()].forEach(id => { if (!ids.has(id)) { mediaEls.get(id).remove(); mediaEls.delete(id); } });
    R.media.forEach(m => { let d = mediaEls.get(m.id);
      if (!d) { d = document.createElement('div'); d.className = 'pa-media'; d.dataset.m = m.id; d.innerHTML = (m.type === 'video' ? '<video muted loop playsinline></video>' : '<img alt="">') + '<em>Yours</em>'; fr.appendChild(d); mediaEls.set(m.id, d);
        if (mediaSrc) mediaSrc(m).then(u => { if (u) d.querySelector('img,video').src = u; }); }
      d.style.left = m.x + 'cqw'; d.style.top = m.y + 'cqw'; d.style.width = m.w + 'cqw'; });
    tickMedia();
  }
  function tickMedia() { const t = pv.time();
    R.media.forEach(m => { const d = mediaEls.get(m.id); if (!d) return; const on = t >= m.t0 && t < m.t1; d.classList.toggle('on', on);
      const vid = d.querySelector('video'); if (vid && vid.readyState >= 1) { if (on && !v.paused) { if (vid.paused) { vid.currentTime = (t - m.t0) % (vid.duration || 1e9); vid.play().catch(() => {}); } } else { if (!vid.paused) vid.pause(); if (on) { const want = (t - m.t0) % (vid.duration || 1e9); if (Math.abs(vid.currentTime - want) > 0.1) vid.currentTime = want; } } } }); }
  let mAlive = true; (function loop() { if (!mAlive) return; tickMedia(); if (mode === 'move' && sel) placeBox(); requestAnimationFrame(loop); })();
  function placeBox() {
    const el = sel && elOf(sel);
    if (mode !== 'move' || !el || !el.classList.contains('on')) { box.hidden = true; return; }
    const r = el.getBoundingClientRect(), f = fr.getBoundingClientRect();
    if (!r.width || !r.height) { box.hidden = true; return; }
    box.hidden = false; box.style.left = (r.left - f.left) + 'px'; box.style.top = (r.top - f.top) + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    box.querySelector('b').textContent = Math.round(scaleOf(sel) * 100) + '%';
  }
  function setScale(s) { if (!sel) return; s = Math.max(0.2, Math.min(5, s));
    if (isM(sel)) { const m = mEntry(sel), el = elOf(sel); if (!m) return; const w0 = m.w0 || m.w, nw = +(w0 * s).toFixed(2); const hq = el ? el.getBoundingClientRect().height * 100 / fw() : 0; const k = nw / m.w;
      m.x = +(m.x + m.w / 2 - nw / 2).toFixed(2); m.y = +(m.y + hq / 2 - hq * k / 2).toFixed(2); m.w = nw; renderMedia(); }
    else { const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; m.s = +s.toFixed(3); R.moves[sel] = m; pv.applyMoves(); }
    placeBox(); paintHint(); }
  function nudge(dx, dy) { if (!sel || bar.hidden) return; if (isM(sel)) { const m = mEntry(sel); m.x = +(m.x + dx).toFixed(2); m.y = +(m.y + dy).toFixed(2); renderMedia(); } else { const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; m.x = +(m.x + dx).toFixed(2); m.y = +(m.y + dy).toFixed(2); R.moves[sel] = m; pv.applyMoves(); } placeBox(); paintHint(); }
  /* center the selected text / popup in the frame (left-right, top-bottom or both) */
  function centerSel(h, vv) { if (!sel || bar.hidden) return; const el = elOf(sel); if (!el) return; const f = fr.getBoundingClientRect();
    const rs = (isM(sel) ? [] : [...el.children].filter(n => n.getAttribute('aria-hidden') !== 'true' && n.tagName !== 'STYLE')).map(n => n.getBoundingClientRect()).filter(q => q.width && q.height);
    const r = rs.length ? { l: Math.min(...rs.map(q => q.left)), r: Math.max(...rs.map(q => q.right)), t: Math.min(...rs.map(q => q.top)), b: Math.max(...rs.map(q => q.bottom)) }
      : (q => ({ l: q.left, r: q.right, t: q.top, b: q.bottom }))(el.getBoundingClientRect());
    const dx = h ? (f.left + f.width / 2) - (r.l + r.r) / 2 : 0, dy = vv ? (f.top + f.height / 2) - (r.t + r.b) / 2 : 0;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return; nudge(cqw(dx), cqw(dy)); changed(); }
  const label = k => { if (isM(k)) { const m = mEntry(k); return 'your ' + (m && m.type === 'video' ? 'video' : 'photo') + (m && m.name ? ' ' + m.name : ''); } const d = pv.byK[k]; const c = d.cloneNode(true); c.querySelectorAll('[aria-hidden="true"],svg').forEach(x => x.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'graphic'; };
  function pick(k) { Object.values(pv.byK).forEach(d => d.classList.remove('pa-sel')); sel = k; if (k && !isM(k) && pv.byK[k]) pv.byK[k].classList.add('pa-sel'); if (isM(k)) tl.selectMedia && tl.selectMedia(k.slice(2)); paintHint(); placeBox(); }
  root.addEventListener('pointerdown', ev => {
    if (bar.hidden) return;   // FULL tab is view only
    if (mode === 'move') { const path = ev.composedPath(); const hnd = path.find(n => n.dataset && n.dataset.c && n.parentNode === box);
      if (hnd && sel) { ev.preventDefault(); const r = elOf(sel).getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        rdrag = { cx, cy, d0: Math.max(4, Math.hypot(ev.clientX - cx, ev.clientY - cy)), s0: scaleOf(sel) }; hnd.setPointerCapture(ev.pointerId); return; }
      /* topmost text / animation / photo under the pointer that is not on a locked track */
      const unlocked = k => !(tl && tl.isLocked && tl.isLocked(k)); let md = null, d = null;
      const stack = root.elementsFromPoint ? root.elementsFromPoint(ev.clientX, ev.clientY) : path;
      for (const n of stack) { if (!n || !n.closest) continue; const mm = n.closest('.pa-media'); if (mm) { if (mm.classList.contains('on') && unlocked('m:' + mm.dataset.m)) { md = mm; break; } continue; }
        const o = n.closest('.ov'); if (o && o.classList.contains('on') && unlocked(o.dataset.k)) { d = o; break; } }
      if (md) { ev.preventDefault(); pick('m:' + md.dataset.m); const m = mEntry(sel); mdrag = { x0: ev.clientX, y0: ev.clientY, m0: { x: m.x, y: m.y } }; md.setPointerCapture(ev.pointerId); return; }
      if (!d) { pick(null); return; }
      ev.preventDefault(); pick(d.dataset.k); const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; mdrag = { x0: ev.clientX, y0: ev.clientY, m0: { x: Number.isFinite(+m.x) ? +m.x : 0, y: Number.isFinite(+m.y) ? +m.y : 0, s: Number.isFinite(+m.s) && m.s > 0 ? +m.s : 1 } }; d.setPointerCapture(ev.pointerId); }
    else if (mode === 'cam') { ev.preventDefault(); const k = camKey(); cdrag = { x0: ev.clientX, y0: ev.clientY, k0: { ...k }, k }; fr.setPointerCapture(ev.pointerId); }
  });
  root.addEventListener('pointermove', ev => {
    if (mode === 'move' && rdrag && sel) { setScale(rdrag.s0 * Math.hypot(ev.clientX - rdrag.cx, ev.clientY - rdrag.cy) / rdrag.d0); return; }
    if (mode === 'move' && mdrag && sel) { const x = +(mdrag.m0.x + cqw(ev.clientX - mdrag.x0)).toFixed(2), y = +(mdrag.m0.y + cqw(ev.clientY - mdrag.y0)).toFixed(2); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (isM(sel)) { const m = mEntry(sel); m.x = x; m.y = y; renderMedia(); } else { R.moves[sel] = { x, y, s: mdrag.m0.s }; pv.applyMoves(); } placeBox(); paintHint(); }
    else if (mode === 'cam' && cdrag) { cdrag.k.x = +(cdrag.k0.x + (ev.clientX - cdrag.x0) * 100 / fr.clientWidth).toFixed(2); cdrag.k.y = +(cdrag.k0.y + (ev.clientY - cdrag.y0) * 100 / fr.clientHeight).toFixed(2); pv.render(pv.time()); paintHint(); }
  });
  root.addEventListener('pointerup', () => { if (rdrag) { rdrag = null; changed(); } if (mdrag) { mdrag = null; changed(); } if (cdrag) { cdrag = null; changed(); tl.redraw(); } });
  root.addEventListener('wheel', ev => {
    if (mode === 'move' && sel) { ev.preventDefault(); setScale(scaleOf(sel) * (ev.deltaY < 0 ? 1.05 : 1 / 1.05)); changed(); }
    else if (mode === 'cam') { ev.preventDefault(); const k = camKey(); k.s = +Math.max(1, Math.min(4, k.s * (ev.deltaY < 0 ? 1.04 : 1 / 1.04))).toFixed(3); pv.render(pv.time()); paintHint(); changed(); tl.redraw(); }
  }, { passive: false });

  /* ---------- Zoom / Pan: one key per frame time ---------- */
  let cdrag = null;
  const tNow = () => Math.round(pv.time() * FPS) / FPS;
  function camKey() { const t = tNow(); let k = R.cams.find(x => Math.abs(x.t - t) < 0.5 / FPS);
    if (!k) { const c = camAt(pv.camsNow(), t); k = { t, s: +(+c[1]).toFixed(3), x: +(+c[2]).toFixed(2), y: +(+(c[7] || 0)).toFixed(2) }; R.cams.push(k); R.cams.sort((a, b) => a.t - b.t); }
    return k; }
  const beatAt = t => P.beats.find(b => t >= b.t0 && t < b.t1) || P.beats[P.beats.length - 1];

  /* ---------- hint line ---------- */
  function paintHint() {
    if (mode === 'move') {
      if (!sel) { hint.textContent = 'Click a text, animation or your photo/video on the paused frame to move or resize it.'; return; }
      const pct = Math.round(scaleOf(sel) * 100);
      if (hint._sel === sel && hint.contains(document.activeElement)) { const bb = hint.querySelector('.szc b'); if (bb) bb.textContent = pct + '%'; const rg = hint.querySelector('.szc input'); if (rg && document.activeElement !== rg) rg.value = pct; return; }
      hint._sel = sel; const aln = `<span class="aln" title="Center in the frame"><button type="button" data-h="cx" title="Center left-right">⇔ Center</button><button type="button" data-h="cy" title="Center top-bottom">⇕ Middle</button><button type="button" data-h="cc" title="Center both ways">✛ Both</button></span>`;
      const szc = `<span class="szc"><button type="button" data-h="mdown" title="Smaller (−)">−</button><input type="range" data-h="mrange" min="20" max="500" step="1" value="${pct}"><button type="button" data-h="mup" title="Bigger (+)">+</button><b>${pct}%</b></span>`;
      if (isM(sel)) { const m = mEntry(sel); if (!m) { sel = null; hint.textContent = ''; return; }
        hint.innerHTML = `<b>${esc(label(sel))}</b> ${m.t0.toFixed(2)}–${m.t1.toFixed(2)} s: drag to move · corners resize · trim it on the “Yours” track ${szc}${aln}
          <input type="text" class="mnote" data-h="mnote" placeholder="What should Claude do with it?" value="${esc(m.note || '')}"> <button type="button" data-h="mdel">Delete</button>`; return; }
      const m = R.moves[sel];
      hint.innerHTML = `Moving <b>${esc(label(sel))}</b>: drag to move · drag an orange corner to resize · arrows nudge · + / − size ${szc}${aln}${m ? ` · x ${m.x >= 0 ? '+' : ''}${m.x} y ${m.y >= 0 ? '+' : ''}${m.y} <button type="button" data-h="mreset">Reset</button>` : ''}`; }
    else if (mode === 'cam') { hint._sel = null; const t = tNow(), k = R.cams.find(x => Math.abs(x.t - t) < 0.5 / FPS), b = beatAt(t), n = R.cams.filter(x => x.t >= b.t0 && x.t < b.t1).length;
      hint.innerHTML = `Camera at ${t.toFixed(2)} s: scroll to zoom · drag to pan${k ? ` · zoom ${Math.round(k.s * 100)}% <button type="button" data-h="cdel">Remove this key</button>` : ''}${n ? ` · ${n} key${n > 1 ? 's' : ''} in ${b.id} (yours replace Claude’s camera there) <button type="button" data-h="cclear">Clear ${b.id}</button>` : ''}`; }
    else if (mode === 'draw') { hint._sel = null; hint.textContent = 'Draw on the frame, write what you want, then Save.'; }
    else { hint._sel = null; hint.textContent = ''; }
  }
  hint.onclick = e => { const a = e.target.dataset && e.target.dataset.h; if (!a) return;
    if (a === 'mrange' || a === 'mnote') return;
    if (a === 'cx' || a === 'cy' || a === 'cc') { centerSel(a !== 'cy', a !== 'cx'); return; }
    if (a === 'mup' && sel) { setScale(scaleOf(sel) * 1.1); changed(); return; }
    if (a === 'mdown' && sel) { setScale(scaleOf(sel) / 1.1); changed(); return; }
    if (a === 'mdel' && isM(sel)) { const k = sel; sel = null; hint._sel = null; if (onDelete) { onDelete(k); return; } R.media.splice(R.media.indexOf(mEntry(k)), 1); renderMedia(); tl.redraw(); placeBox(); paintHint(); changed(); return; }
    if (a === 'mreset' && sel && !isM(sel)) { delete R.moves[sel]; pv.applyMoves(); placeBox(); }
    if (a === 'cdel') { const t = tNow(); R.cams = R.cams.filter(x => Math.abs(x.t - t) >= 0.5 / FPS); P.review.cams = R.cams; }
    if (a === 'cclear') { const b = beatAt(tNow()); R.cams = R.cams.filter(x => !(x.t >= b.t0 && x.t < b.t1)); P.review.cams = R.cams; }
    pv.render(pv.time()); tl.redraw(); paintHint(); changed(); };
  hint.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.h === 'mrange' && sel) { setScale(+e.target.value / 100); const b = hint.querySelector('.szc b'); if (b) b.textContent = e.target.value + '%'; } });
  hint.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.h === 'mrange') changed(); });
  hint.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.h === 'mnote' && isM(sel)) { mEntry(sel).note = e.target.value; } });
  hint.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.h === 'mnote') changed(); });
  v.addEventListener('seeked', () => { if (mode) paintHint(); placeBox(); });
  window.addEventListener('resize', placeBox);

  /* ---------- Draw ---------- */
  let canvas = null, dbar = null, color = '#FF7A1A';
  function openDraw() {
    const box = host.parentElement; const r = host.getBoundingClientRect(), pr = box.getBoundingClientRect();
    canvas = document.createElement('canvas'); canvas.className = 'drawLayer'; canvas.width = 960; canvas.height = 540;
    Object.assign(canvas.style, { left: (r.left - pr.left) + 'px', top: (r.top - pr.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
    box.appendChild(canvas); const x = canvas.getContext('2d'); x.lineCap = x.lineJoin = 'round';
    let drawing = false;
    const pos = e => { const b = canvas.getBoundingClientRect(); return [(e.clientX - b.left) * 960 / b.width, (e.clientY - b.top) * 540 / b.height]; };
    canvas.onpointerdown = e => { drawing = true; canvas.setPointerCapture(e.pointerId); x.strokeStyle = color; x.lineWidth = 5; x.beginPath(); x.moveTo(...pos(e)); };
    canvas.onpointermove = e => { if (!drawing) return; x.lineTo(...pos(e)); x.stroke(); };
    canvas.onpointerup = () => { drawing = false; };
    dbar = document.createElement('div'); dbar.className = 'drawBar';
    dbar.innerHTML = ['#FF7A1A', '#ffffff', '#ef4444', '#22c55e'].map(c => `<span class="sw${c === color ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('') +
      `<input type="text" placeholder="Comment on this exact shot"><button type="button" class="mic" title="Dictate">🎤</button><button type="button" class="btn" data-a="clear">Clear</button><button type="button" class="btn primary" data-a="save">Save</button>`;
    box.appendChild(dbar); wireMic(dbar.querySelector('.mic'), dbar.querySelector('input'));
    dbar.onclick = e => { const c = e.target.dataset.c; if (c) { color = c; dbar.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.dataset.c === c)); }
      const a = e.target.dataset.a; if (a === 'clear') x.clearRect(0, 0, 960, 540);
      if (a === 'save') { const t = tNow(), b = beatAt(t), note = dbar.querySelector('input').value.trim(), png = canvas.toDataURL('image/png'), sk = canvas;
        e.target.disabled = true; e.target.textContent = 'Saving…';
        shotOf(sk).then(shot => { R.drawings.push({ t, beat: b.id, note, png, shot }); changed(); paintDrawings(); setMode(''); }); } };
  }
  const shotOf = sk => snapshot(fr, root, v, sk);
  function closeDraw() { canvas && canvas.remove(); dbar && dbar.remove(); canvas = dbar = null; }
  function paintDrawings() {
    document.querySelectorAll('.beat').forEach(card => { const id = card.dataset.id, list = R.drawings.map((d, i) => [d, i]).filter(([d]) => d.beat === id);
      let box = card.querySelector('.drawings'); if (!box) { box = document.createElement('div'); box.className = 'drawings'; card.appendChild(box); }
      box.innerHTML = list.map(([d, i]) => `<figure><img src="${d.shot || d.png}" alt="drawing at ${d.t.toFixed(1)} s" title="Go to ${d.t.toFixed(2)} s" data-t="${d.t}"><figcaption>${d.t.toFixed(1)} s · ${esc(d.note || 'no comment')}</figcaption><button type="button" data-del="${i}" title="Delete">✕</button></figure>`).join('');
      box.onclick = e => { if (e.target.dataset.del !== undefined) { R.drawings.splice(+e.target.dataset.del, 1); changed(); paintDrawings(); } else if (e.target.dataset.t) tl.seek(+e.target.dataset.t); }; });
  }
  paintDrawings();

  /* keys */
  function onKey(e) { const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return; if (e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'm') setMode('move'); else if (k === 'z') setMode('cam'); else if (k === 'd') setMode('draw'); else if (k === 'escape' && mode) setMode(mode);
    else if (mode === 'move' && sel && (e.key === 'Delete' || e.key === 'Backspace') && onDelete) { e.preventDefault(); e.stopImmediatePropagation(); const k = sel; pick(null); onDelete(k); }
    else if (mode === 'move' && sel && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) { e.preventDefault(); e.stopImmediatePropagation(); setScale(scaleOf(sel) * (e.key === '-' || e.key === '_' ? 1 / 1.1 : 1.1)); changed(); }
    else if (mode === 'move' && sel && e.key.startsWith('Arrow')) { e.preventDefault(); e.stopImmediatePropagation(); const st = e.shiftKey ? 1 : 0.2;
      nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0); changed(); } }
  document.addEventListener('keydown', onKey, true);

  const text = bid => { let s = ''; const mv = Object.keys(R.moves).filter(k => k.startsWith(bid + ':'));
    if (mv.length) s += ' · moved (apply exactly, cqw of frame width): ' + mv.map(k => { const m = R.moves[k]; return `el#${k.split(':')[1]} “${label(k)}” x${m.x >= 0 ? '+' : ''}${m.x} y${m.y >= 0 ? '+' : ''}${m.y}${Math.abs(m.s - 1) > .001 ? ' size ' + Math.round(m.s * 100) + '%' : ''}`; }).join('; ');
    const b = P.beats.find(x => x.id === bid), ks = b ? R.cams.filter(k => k.t >= b.t0 && k.t < b.t1) : [];
    if (ks.length) s += ' · my zoom/pan (use exactly, replaces your camera in this beat, keep it smooth): ' + ks.map(k => `${k.t.toFixed(2)} s zoom ${Math.round(k.s * 100)}% x ${k.x}% y ${k.y}%`).join('; ');
    R.drawings.filter(d => d.beat === bid).forEach(d => { s += ` · drawing at 0:${d.t.toFixed(1)}${d.note ? ': ' + d.note : ''} (sketch in project file)`; });
    return s; };
  renderMedia();
  return { text, mode: () => mode, use(m) { if (mode !== m) setMode(m); }, pick(k) { if (k && elOf(k)) pick(k); }, shot() { v.pause(); return snapshot(fr, root, v); }, idle() { if (mode) setMode(mode); }, sync() { pv.applyMoves(); renderMedia(); if (sel && !elOf(sel)) sel = null; hint._sel = null; placeBox(); paintHint(); pv.render(pv.time()); }, destroy() { mAlive = false; mediaEls.forEach(d => d.remove()); closeDraw(); box.remove(); window.removeEventListener('resize', placeBox); document.removeEventListener('keydown', onKey, true); bar.innerHTML = ''; hint.textContent = ''; } };
}

/* a picture of the exact shot (video + graphics + your drawing), so Claude sees what you saw */
let fontCSS = null;
async function fonts() {
  if (fontCSS !== null) return fontCSS;
  try { const href = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).find(h => h.includes('fonts.googleapis.com'));
    let css = href ? await (await fetch(href)).text() : '';
    const urls = [...new Set(css.match(/https:[^)'"]+\.woff2/g) || [])];
    const data = await Promise.all(urls.map(async u => { const b = await (await fetch(u)).blob(); return await new Promise(r => { const fr2 = new FileReader(); fr2.onload = () => r(fr2.result); fr2.readAsDataURL(b); }); }));
    urls.forEach((u, i) => { css = css.split(u).join(data[i]); }); fontCSS = css; } catch (e) { fontCSS = ''; }
  return fontCSS;
}
export async function snapshot(fr, root, v, sketch) {
  const W = 960, H = 540, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rect = fr.getBoundingClientRect();
  try {
    const clone = fr.cloneNode(true), O = [fr, ...fr.querySelectorAll('*')], C = [clone, ...clone.querySelectorAll('*')];
    const P = ['transform', 'translate', 'scale', 'rotate', 'opacity', 'filter', 'clip-path', 'transform-origin', 'visibility', 'left', 'top', 'width', 'height'];
    O.forEach((o, i) => { const k = C[i]; if (!k || !k.style) return; const cs = getComputedStyle(o);
      P.forEach(p => k.style.setProperty(p, cs.getPropertyValue(p), 'important'));
      k.style.setProperty('animation', 'none', 'important'); k.style.setProperty('transition', 'none', 'important');
      if (o.tagName === 'VIDEO' || o.tagName === 'CANVAS') { let url = '';
        try { if (o.tagName === 'VIDEO') { const vc = document.createElement('canvas'); vc.width = o.videoWidth || 1280; vc.height = o.videoHeight || 720; vc.getContext('2d').drawImage(o, 0, 0, vc.width, vc.height); url = vc.toDataURL('image/jpeg', 0.85); } else url = o.toDataURL('image/png'); } catch (e) {}
        const im = document.createElement('img'); im.setAttribute('src', url); im.setAttribute('style', k.getAttribute('style') || ''); im.className = o.className;
        ['position', 'inset', 'object-fit', 'z-index', 'border-radius', 'box-shadow', 'display'].forEach(p => im.style.setProperty(p, cs.getPropertyValue(p), 'important'));
        if (!url) im.style.setProperty('display', 'none', 'important'); k.replaceWith(im); } });
    clone.querySelectorAll('.pa-box,.pa-guides,.pa-media .pa-h').forEach(x => x.remove()); clone.querySelectorAll('.pa-sel').forEach(x => x.classList.remove('pa-sel'));
    clone.style.setProperty('width', rect.width + 'px', 'important'); clone.style.setProperty('height', rect.height + 'px', 'important');
    const css = [...root.querySelectorAll('style')].map(x => x.textContent).join('\n').replace(/:host\b/g, '.shotRoot');
    const wrap = document.createElement('div'); wrap.className = 'shotRoot'; wrap.setAttribute('style', `width:${rect.width}px;height:${rect.height}px;transform:scale(${W / rect.width});transform-origin:0 0;position:relative;overflow:hidden`);
    const sty = document.createElement('style'); sty.textContent = (await fonts()) + '\n' + css; wrap.appendChild(sty); wrap.appendChild(clone);
    const xml = new XMLSerializer().serializeToString(wrap);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode(); g.drawImage(img, 0, 0, W, H);
    c.toDataURL('image/jpeg', 0.5);   // throws if the picture could not be used
  } catch (e) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); try { g.drawImage(v, 0, 0, W, H); } catch (e2) {} }
  if (sketch) g.drawImage(sketch, 0, 0, W, H);
  try { return c.toDataURL('image/jpeg', 0.82); } catch (e) { return ''; }
}

/* ---------- Dictate (Chrome speech recognition) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let active = null;
export function wireMic(btn, field) {
  if (!SR) { btn.hidden = true; return; }
  btn.onclick = () => {
    if (active) { const was = active.btn; active.rec.stop(); active = null; if (was === btn) return; }
    const rec = new SR(); rec.lang = localStorage.getItem('planner-dictate-lang') || 'fil-PH'; rec.continuous = true; rec.interimResults = false;
    const start = field.value;
    let said = '';
    rec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += (said ? ' ' : '') + e.results[i][0].transcript.trim();
      field.value = (start ? start.replace(/\s*$/, ' ') : '') + said; field.dispatchEvent(new Event('input', { bubbles: true })); };
    rec.onend = () => { btn.classList.remove('on'); if (active && active.rec === rec) active = null; };
    rec.onerror = () => { btn.classList.remove('on'); };
    btn.classList.add('on'); active = { rec, btn }; try { rec.start(); } catch (e) { btn.classList.remove('on'); }
  };
}
