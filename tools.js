/* Preview tools: Move / Resize, Zoom / Pan (your camera keys), Draw (+ comment), Dictate. */
import { camAt } from './engine.js?v=7';
const FPS = 30;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function attachTools({ P, pv, tl, host, bar, hint, onChange }) {
  const R = P.review; R.moves ||= {}; R.cams ||= []; R.drawings ||= [];
  const root = host.shadowRoot, fr = pv.frame, v = pv.video;
  const st = document.createElement('style');
  st.textContent = `.frame.pa-move .ov.on{pointer-events:auto;cursor:move}.frame.pa-move .ov.on:hover{outline:1px dashed rgba(255,255,255,.6);outline-offset:3px}
  .frame.pa-cam{cursor:grab}.frame.pa-cam:active{cursor:grabbing}`;
  root.appendChild(st);
  let mode = '';
  bar.innerHTML = `<button type="button" class="tool" data-m="move" title="Move / resize text and animations (M)">⤧ Move</button><button type="button" class="tool" data-m="cam" title="Zoom / pan the camera here (Z)">⌖ Zoom/Pan</button><button type="button" class="tool" data-m="draw" title="Draw on this frame and comment (D)">✎ Draw</button>`;
  const btns = [...bar.querySelectorAll('.tool')];
  function setMode(m) {
    if (mode === 'draw' && m !== 'draw') closeDraw();
    mode = mode === m ? '' : m;
    btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.m === mode ? 'true' : 'false'));
    fr.classList.toggle('pa-move', mode === 'move'); fr.classList.toggle('pa-cam', mode === 'cam');
    if (mode) v.pause();
    if (mode === 'draw') openDraw();
    paintHint();
  }
  btns.forEach(b => b.onclick = () => setMode(b.dataset.m));
  const changed = () => { onChange && onChange(); };
  const cqw = px => px * 100 / fr.clientWidth;

  /* ---------- Move / Resize ---------- */
  let sel = null, mdrag = null;
  const label = k => { const d = pv.byK[k]; const c = d.cloneNode(true); c.querySelectorAll('[aria-hidden="true"],svg').forEach(x => x.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'graphic'; };
  function pick(k) { Object.values(pv.byK).forEach(d => d.classList.remove('pa-sel')); sel = k; if (k) pv.byK[k].classList.add('pa-sel'); paintHint(); }
  root.addEventListener('pointerdown', ev => {
    if (mode === 'move') { const d = ev.composedPath().find(n => n.classList && n.classList.contains('ov')); if (!d) { pick(null); return; }
      ev.preventDefault(); pick(d.dataset.k); const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; mdrag = { x0: ev.clientX, y0: ev.clientY, m0: { ...m } }; d.setPointerCapture(ev.pointerId); }
    else if (mode === 'cam') { ev.preventDefault(); const k = camKey(); cdrag = { x0: ev.clientX, y0: ev.clientY, k0: { ...k }, k }; fr.setPointerCapture(ev.pointerId); }
  });
  root.addEventListener('pointermove', ev => {
    if (mode === 'move' && mdrag && sel) { R.moves[sel] = { x: +(mdrag.m0.x + cqw(ev.clientX - mdrag.x0)).toFixed(2), y: +(mdrag.m0.y + cqw(ev.clientY - mdrag.y0)).toFixed(2), s: mdrag.m0.s }; pv.applyMoves(); paintHint(); }
    else if (mode === 'cam' && cdrag) { cdrag.k.x = +(cdrag.k0.x + (ev.clientX - cdrag.x0) * 100 / fr.clientWidth).toFixed(2); cdrag.k.y = +(cdrag.k0.y + (ev.clientY - cdrag.y0) * 100 / fr.clientHeight).toFixed(2); pv.render(pv.time()); paintHint(); }
  });
  root.addEventListener('pointerup', () => { if (mdrag) { mdrag = null; changed(); } if (cdrag) { cdrag = null; changed(); tl.redraw(); } });
  root.addEventListener('wheel', ev => {
    if (mode === 'move' && sel) { ev.preventDefault(); const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; m.s = +Math.max(0.2, Math.min(5, m.s * (ev.deltaY < 0 ? 1.05 : 1 / 1.05))).toFixed(3); R.moves[sel] = m; pv.applyMoves(); paintHint(); changed(); }
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
    if (mode === 'move') { const m = sel && R.moves[sel];
      hint.innerHTML = sel ? `Moving <b>${esc(label(sel))}</b>: drag it · scroll to resize · arrows nudge${m ? ` · x ${m.x >= 0 ? '+' : ''}${m.x} y ${m.y >= 0 ? '+' : ''}${m.y} size ${Math.round(m.s * 100)}% <button type="button" data-h="mreset">Reset</button>` : ''}` : 'Click a text or animation on the paused frame to move it.'; }
    else if (mode === 'cam') { const t = tNow(), k = R.cams.find(x => Math.abs(x.t - t) < 0.5 / FPS), b = beatAt(t), n = R.cams.filter(x => x.t >= b.t0 && x.t < b.t1).length;
      hint.innerHTML = `Camera at ${t.toFixed(2)} s: scroll to zoom · drag to pan${k ? ` · zoom ${Math.round(k.s * 100)}% <button type="button" data-h="cdel">Remove this key</button>` : ''}${n ? ` · ${n} key${n > 1 ? 's' : ''} in ${b.id} (yours replace Claude’s camera there) <button type="button" data-h="cclear">Clear ${b.id}</button>` : ''}`; }
    else if (mode === 'draw') hint.textContent = 'Draw on the frame, write what you want, then Save.';
    else hint.textContent = '';
  }
  hint.onclick = e => { const a = e.target.dataset && e.target.dataset.h; if (!a) return;
    if (a === 'mreset' && sel) { delete R.moves[sel]; pv.applyMoves(); }
    if (a === 'cdel') { const t = tNow(); R.cams = R.cams.filter(x => Math.abs(x.t - t) >= 0.5 / FPS); P.review.cams = R.cams; }
    if (a === 'cclear') { const b = beatAt(tNow()); R.cams = R.cams.filter(x => !(x.t >= b.t0 && x.t < b.t1)); P.review.cams = R.cams; }
    pv.render(pv.time()); tl.redraw(); paintHint(); changed(); };
  v.addEventListener('seeked', () => { if (mode) paintHint(); });

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
      if (a === 'save') { const t = tNow(), b = beatAt(t); R.drawings.push({ t, beat: b.id, note: dbar.querySelector('input').value.trim(), png: canvas.toDataURL('image/png') }); changed(); paintDrawings(); setMode(''); } };
  }
  function closeDraw() { canvas && canvas.remove(); dbar && dbar.remove(); canvas = dbar = null; }
  function paintDrawings() {
    document.querySelectorAll('.beat').forEach(card => { const id = card.dataset.id, list = R.drawings.map((d, i) => [d, i]).filter(([d]) => d.beat === id);
      let box = card.querySelector('.drawings'); if (!box) { box = document.createElement('div'); box.className = 'drawings'; card.appendChild(box); }
      box.innerHTML = list.map(([d, i]) => `<figure><img src="${d.png}" alt="drawing at ${d.t.toFixed(1)} s" title="Go to ${d.t.toFixed(2)} s" data-t="${d.t}"><figcaption>${d.t.toFixed(1)} s · ${esc(d.note || 'no comment')}</figcaption><button type="button" data-del="${i}" title="Delete">✕</button></figure>`).join('');
      box.onclick = e => { if (e.target.dataset.del !== undefined) { R.drawings.splice(+e.target.dataset.del, 1); changed(); paintDrawings(); } else if (e.target.dataset.t) tl.seek(+e.target.dataset.t); }; });
  }
  paintDrawings();

  /* keys */
  function onKey(e) { const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return; if (e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'm') setMode('move'); else if (k === 'z') setMode('cam'); else if (k === 'd') setMode('draw'); else if (k === 'escape' && mode) setMode(mode);
    else if (mode === 'move' && sel && e.key.startsWith('Arrow')) { e.preventDefault(); e.stopImmediatePropagation(); const m = R.moves[sel] || { x: 0, y: 0, s: 1 }; const st = e.shiftKey ? 1 : 0.2;
      if (e.key === 'ArrowLeft') m.x -= st; if (e.key === 'ArrowRight') m.x += st; if (e.key === 'ArrowUp') m.y -= st; if (e.key === 'ArrowDown') m.y += st; m.x = +m.x.toFixed(2); m.y = +m.y.toFixed(2); R.moves[sel] = m; pv.applyMoves(); paintHint(); changed(); } }
  document.addEventListener('keydown', onKey, true);

  const text = bid => { let s = ''; const mv = Object.keys(R.moves).filter(k => k.startsWith(bid + ':'));
    if (mv.length) s += ' · moved (apply exactly, cqw of frame width): ' + mv.map(k => { const m = R.moves[k]; return `el#${k.split(':')[1]} “${label(k)}” x${m.x >= 0 ? '+' : ''}${m.x} y${m.y >= 0 ? '+' : ''}${m.y}${Math.abs(m.s - 1) > .001 ? ' size ' + Math.round(m.s * 100) + '%' : ''}`; }).join('; ');
    const b = P.beats.find(x => x.id === bid), ks = b ? R.cams.filter(k => k.t >= b.t0 && k.t < b.t1) : [];
    if (ks.length) s += ' · my zoom/pan (use exactly, replaces your camera in this beat, keep it smooth): ' + ks.map(k => `${k.t.toFixed(2)} s zoom ${Math.round(k.s * 100)}% x ${k.x}% y ${k.y}%`).join('; ');
    R.drawings.filter(d => d.beat === bid).forEach(d => { s += ` · drawing at 0:${d.t.toFixed(1)}${d.note ? ': ' + d.note : ''} (sketch in project file)`; });
    return s; };
  return { text, destroy() { closeDraw(); document.removeEventListener('keydown', onKey, true); bar.innerHTML = ''; hint.textContent = ''; } };
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
