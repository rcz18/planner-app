/* Direct: give Claude your direction for one whole beat.
   📸 screenshot the preview as it is → draw on it (pen, line, arrow, box, circle) → comment or dictate.
   💡 Looks: Claude writes a few looks for the beat; this app takes their screenshots itself (no renders, few tokens). */
import { snapshot, wireMic } from './tools.js?v=16.7';
import { createPreview } from './engine.js?v=16.5';

const W = 960, H = 540;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const COLORS = ['#FF7A1A', '#ffffff', '#ef4444', '#22c55e', '#38bdf8', '#facc15'];
const TOOLS = [['pen', '✏️', 'Pen'], ['line', '╱', 'Line'], ['arrow', '➜', 'Arrow'], ['rect', '▭', 'Box'], ['ellipse', '◯', 'Circle']];

export function directOf(R, bid, make) { R.directs ||= {}; if (!R.directs[bid] && make) R.directs[bid] = { note: '', shots: [] }; return R.directs[bid]; }
export function directCount(R) { return Object.values(R.directs || {}).reduce((n, d) => n + (d.shots || []).length + ((d.note || '').trim() ? 1 : 0), 0) + Object.values(R.looks || {}).filter(Boolean).length; }

/* the lines Claude reads in the request */
export function directText(s, bid) {
  const R = s.review, d = (R.directs || {})[bid], L = [];
  if (d && (d.note || '').trim()) L.push(`DIRECTION for the whole beat: ${d.note.trim()}`);
  if (d && d.shots && d.shots.length) L.push(`my screenshots (look at each picture, follow the drawings and comments): ` + d.shots.map((x, i) => `#${i + 1} at ${tc(x.t)}${x.look ? ` (on your look ${x.look})` : ''}${(x.marks || []).length ? ` with ${x.marks.length} drawing${x.marks.length > 1 ? 's' : ''}` : ''}${x.note ? ': ' + x.note : ''} [${x.file ? 'file: ' + x.file : 'review.directs.' + bid + '.shots[' + i + '].img'}]`).join('; '));
  const lk = (R.looks || {})[bid], look = lk && ((s.suggest || {})[bid] || []).find(x => x.id === lk);
  if (look) L.push(`USE YOUR LOOK ${look.id} “${look.title || ''}” (suggest.${bid}.${look.id} in the project file): build this beat from it`);
  return L.length ? ' · ' + L.join(' · ') : '';
}

/* ---------- a look's screenshot, made here in the app from Claude's design (cached) ---------- */
const lookCache = new Map();
export async function lookShot(S, beats, bid, look, src) {
  const key = [S.id, bid, look.id, JSON.stringify([look.els, look.css, look.cam, look.fx, look.t])].join('|');
  if (lookCache.has(key)) return lookCache.get(key);
  const job = (async () => {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:${H}px;overflow:hidden;background:#000;pointer-events:none`;
    document.body.appendChild(host);
    try {
      const b0 = beats.find(b => b.id === bid);
      const nb = JSON.parse(JSON.stringify(beats)).map(b => b.id !== bid ? b : { ...b, els: JSON.parse(JSON.stringify(look.els || [])), ...(look.cam ? { cam: look.cam } : {}), ...(look.fx ? { fx: look.fx } : {}) });
      const proj = { ...S, beats: nb, css: (S.css || '') + '\n' + (look.css || ''), review: { moves: {}, cams: [], drawings: [], media: [] } };
      const pv = createPreview(host, proj, src || ''), v = pv.video;
      const t = Math.min(b0.t1 - 0.02, Math.max(b0.t0, look.t != null ? +look.t : b0.hero != null && b0.hero !== '' ? +b0.hero : (b0.t0 + b0.t1) / 2));
      const once = (ev, ms) => new Promise(r => { const f = () => r(true); v.addEventListener(ev, f, { once: true }); setTimeout(() => { v.removeEventListener(ev, f); r(false); }, ms); });
      if (src) {
        if (v.readyState < 1) await once('loadedmetadata', 6000);
        if (v.seeking) await once('seeked', 3000);
        const s2 = once('seeked', 5000); pv.seek(t); await s2;
        await new Promise(r => { if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(() => r()); setTimeout(r, 400); } else setTimeout(r, 150); });
      }
      pv.render(t); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); pv.render(t);
      const img = await snapshot(pv.frame, host.shadowRoot, v);
      try { v.removeAttribute('src'); v.load(); } catch (e) {}
      return img;
    } finally { host.remove(); }
  })();
  lookCache.set(key, job);
  job.catch(() => lookCache.delete(key));
  return job;
}

/* ---------- the Direct panel ----------
   ctx: { S, beat, beats, pv, tools, seek, monBox, monitor, pane, mediaURL, onChange, onSend, onAskLooks, saveImage, loadImage, onClose, busy } */
export function openDirect(ctx) {
  const { S, beat: b, pv, pane } = ctx, R = S.review;
  R.looks ||= {};
  const D = () => directOf(R, b.id, true);
  let annot = null;
  pv.video.pause(); ctx.tools && ctx.tools.idle && ctx.tools.idle();
  ctx.seek(Math.max(b.t0, Math.min(b.t1 - 0.02, pv.time() >= b.t0 && pv.time() < b.t1 ? pv.time() : b.t0 + 0.02)));

  pane.innerHTML = `
    <div class="dHead"><button type="button" class="btn dBack" title="Back to the beats (Esc)">← Beats</button><div><b>🎬 Direct · ${esc(b.id)}</b><span>${esc(b.title || '')}</span></div></div>
    <div class="dScrub"><button type="button" class="playBeat dPlay" title="Play this beat">▶</button><input type="range" class="dRange" min="${b.t0}" max="${Math.max(b.t0, b.t1 - 0.02)}" step="0.0333"><span class="dTc"></span></div>
    <button type="button" class="btn primary dShot" title="Take a picture of the preview as it is now (S)">📸 Screenshot this frame</button>
    <p class="dHint">Move to any moment in the beat, take a screenshot, then draw and comment on it.</p>
    <label class="dLbl">Your direction for this whole beat</label>
    <div class="noteRow"><textarea class="dNote" rows="3" placeholder="e.g. Make this feel bigger: the number slams in, the camera pushes in, and the logo comes in last."></textarea><button type="button" class="mic dMic" title="Dictate">🎤</button></div>
    <div class="dShots"></div>
    <div class="dLooksHead"><b>💡 Looks from Claude</b><span class="dim">Just screenshots, fast and light</span></div>
    <div class="noteRow"><input type="text" class="dAskNote" placeholder="What kind of looks? (optional, e.g. bolder, more 3D, minimal)"><button type="button" class="btn dAsk">Show me 3 looks</button></div>
    <div class="dLooks"></div>
    <div class="dFoot"><button type="button" class="btn primary dSend">Send to Claude (Revise)</button></div>`;
  const $p = sel => pane.querySelector(sel);
  const range = $p('.dRange'), tcEl = $p('.dTc'), note = $p('.dNote');
  note.value = (R.directs?.[b.id]?.note) || '';
  wireMic($p('.dMic'), note);
  note.addEventListener('input', () => { D().note = note.value; ctx.onChange(); });

  /* scrub inside the beat */
  const paintT = () => { const t = pv.time(); if (t >= b.t0 - 0.01 && t <= b.t1 + 0.01 && document.activeElement !== range) range.value = t; tcEl.textContent = tc(Math.min(Math.max(t, b.t0), b.t1)); };
  range.addEventListener('input', () => { ctx.seek(+range.value); tcEl.textContent = tc(+range.value); });
  ['timeupdate', 'seeked', 'pause'].forEach(e => pv.video.addEventListener(e, paintT)); paintT();
  $p('.dPlay').onclick = () => pv.playFrom(Math.max(b.t0, Math.min(+range.value, b.t1 - 0.1)) >= b.t1 - 0.15 ? b.t0 : +range.value, Math.min(S.duration, b.t1 + 0.3));

  /* screenshots */
  async function addShot() {
    const btn = $p('.dShot'); btn.disabled = true; btn.textContent = '📸 Taking it…';
    try { const v = pv.video; v.pause();
      if (v.seeking) await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); });
      await new Promise(r => { if (v.requestVideoFrameCallback && v.readyState >= 2) { v.requestVideoFrameCallback(() => r()); setTimeout(r, 250); } else setTimeout(r, 120); });
      const t = +pv.time().toFixed(3), base = await ctx.tools.shot();
      if (!base) throw new Error('no picture');
      const sh = { id: uid(), t, base, img: base, marks: [], note: '' }; D().shots.push(sh); ctx.onChange(); paintShots(); edit(sh);
    } catch (e) { ctx.status && ctx.status('Could not take the screenshot: ' + e.message); }
    btn.disabled = false; btn.textContent = '📸 Screenshot this frame';
  }
  $p('.dShot').onclick = addShot;
  const src = async x => x && /^data:|^blob:/.test(x) ? x : (x ? await ctx.loadImage(x) : '');
  async function paintShots() {
    const d = R.directs?.[b.id], box = $p('.dShots'); if (!box) return;
    const list = d ? d.shots : [];
    box.innerHTML = list.length ? list.map((x, i) => `<figure data-i="${i}"><img alt="screenshot ${i + 1}" data-a="edit" title="Draw / comment"><figcaption><b>#${i + 1}</b> ${tc(x.t)}${x.look ? ' · look ' + esc(x.look) : ''}<span>${esc(x.note || 'No comment yet')}</span></figcaption><div><button type="button" class="btn sm" data-a="edit">✏️ Draw</button><button type="button" class="btn sm" data-a="go" title="Go to this moment">⏵</button><button type="button" class="btn sm" data-a="del" title="Delete">✕</button></div></figure>`).join('') : '<p class="dEmpty">No screenshots yet.</p>';
    list.forEach(async (x, i) => { const im = box.querySelector(`figure[data-i="${i}"] img`); if (im) im.src = await src(x.file || x.img); });
  }
  $p('.dShots').onclick = async e => { const a = e.target.dataset.a; const fig = e.target.closest('figure'); if (!a || !fig) return; const d = D(), sh = d.shots[+fig.dataset.i]; if (!sh) return;
    if (a === 'edit') edit(sh); else if (a === 'go') ctx.seek(sh.t); else if (a === 'del') { d.shots.splice(+fig.dataset.i, 1); ctx.onChange(); paintShots(); } };

  /* ---------- draw + comment on a screenshot (over the monitor) ---------- */
  function edit(sh, opts = {}) {
    closeAnnot();
    const box = ctx.monBox, mr = ctx.monitor.getBoundingClientRect(), br = box.getBoundingClientRect();
    const ov = document.createElement('div'); ov.className = 'annot';
    const place = () => { const mr2 = ctx.monitor.getBoundingClientRect(), br2 = box.getBoundingClientRect(); Object.assign(ov.style, { left: (mr2.left - br2.left) + 'px', top: (mr2.top - br2.top) + 'px', width: mr2.width + 'px', height: mr2.height + 'px' }); };
    Object.assign(ov.style, { left: (mr.left - br.left) + 'px', top: (mr.top - br.top) + 'px', width: mr.width + 'px', height: mr.height + 'px' });
    ov.innerHTML = `<img alt=""><canvas width="${W}" height="${H}"></canvas>`;
    const bar = document.createElement('div'); bar.className = 'annBar';
    if (opts.view) {
      bar.innerHTML = `<b class="annT">${esc(opts.title || '')}</b>${opts.actions || ''}<button type="button" class="btn" data-a="close">Close</button>`;
    } else {
      bar.innerHTML = `<span class="annTools">${TOOLS.map(([k, i, n]) => `<button type="button" class="tool" data-tool="${k}" title="${n}">${i}</button>`).join('')}</span>
        <span class="annSw">${COLORS.map(c => `<span class="sw" data-c="${c}" style="background:${c}"></span>`).join('')}</span>
        <button type="button" class="btn sm" data-a="undo" title="Undo (Ctrl+Z)">↶</button><button type="button" class="btn sm" data-a="clear">Clear</button>
        <input type="text" class="annNote" placeholder="Comment on this screenshot (what you want here)"><button type="button" class="mic" title="Dictate">🎤</button>
        <button type="button" class="btn" data-a="close">Cancel</button><button type="button" class="btn primary" data-a="save">Save</button>`;
    }
    box.appendChild(ov); box.appendChild(bar); window.addEventListener('resize', place);
    const im = ov.querySelector('img'), cv = ov.querySelector('canvas'), g = cv.getContext('2d');
    (async () => { im.src = opts.view ? opts.src : await src(sh.base || sh.img); })();
    let marks = JSON.parse(JSON.stringify(sh?.marks || [])), tool = localStorage.getItem('planner-dtool') || 'arrow', color = localStorage.getItem('planner-dcolor') || '#FF7A1A', cur = null;
    const paintBar = () => { bar.querySelectorAll('[data-tool]').forEach(x => x.setAttribute('aria-pressed', x.dataset.tool === tool ? 'true' : 'false')); bar.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x.dataset.c === color)); };
    const redraw = () => { g.clearRect(0, 0, W, H); marks.concat(cur ? [cur] : []).forEach(m => drawMark(g, m)); };
    if (!opts.view) {
      const nt = bar.querySelector('.annNote'); nt.value = sh.note || ''; wireMic(bar.querySelector('.mic'), nt); paintBar(); redraw();
      const pos = e => { const r = cv.getBoundingClientRect(); return [+((e.clientX - r.left) * W / r.width).toFixed(1), +((e.clientY - r.top) * H / r.height).toFixed(1)]; };
      cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); const p = pos(e); cur = { k: tool, c: color, w: 5, pts: [p, p] }; };
      cv.onpointermove = e => { if (!cur) return; const p = pos(e); if (cur.k === 'pen') cur.pts.push(p); else cur.pts[1] = p; redraw(); };
      cv.onpointerup = () => { if (!cur) return; const [a, z] = [cur.pts[0], cur.pts[cur.pts.length - 1]]; if (cur.k === 'pen' ? cur.pts.length > 2 : Math.hypot(z[0] - a[0], z[1] - a[1]) > 4) marks.push(cur); cur = null; redraw(); };
    } else { cv.style.pointerEvents = 'none'; }
    bar.onclick = async e => { const t = e.target.closest('[data-tool],[data-c],[data-a]'); if (!t) return;
      if (t.dataset.tool) { tool = t.dataset.tool; localStorage.setItem('planner-dtool', tool); paintBar(); return; }
      if (t.dataset.c) { color = t.dataset.c; localStorage.setItem('planner-dcolor', color); paintBar(); return; }
      const a = t.dataset.a;
      if (a === 'undo') { marks.pop(); redraw(); } else if (a === 'clear') { marks = []; redraw(); }
      else if (a === 'close') closeAnnot();
      else if (a === 'save') { t.disabled = true; t.textContent = 'Saving…';
        sh.marks = marks; sh.note = bar.querySelector('.annNote').value.trim();
        try { if (!im.complete) await im.decode(); } catch (err) {}
        const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
        try { x.drawImage(im, 0, 0, W, H); } catch (err) {} marks.forEach(m => drawMark(x, m));
        let img = ''; try { img = c.toDataURL('image/jpeg', 0.82); } catch (err) {}
        if (img) { sh.img = img; const name = `${S.name || S.id}-${b.id}-${sh.id}`;
          const f = await ctx.saveImage(name + '.jpg', img); if (f) { sh.file = f; delete sh.img; }
          if (f && /^data:/.test(sh.base || '')) { const fb = await ctx.saveImage(name + '-base.jpg', sh.base); if (fb) sh.base = fb; } }
        ctx.onChange(); closeAnnot(); paintShots(); }
      else if (opts.onAction) opts.onAction(a); };
    annot = { ov, bar, place, keys: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeAnnot(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !opts.view) { e.preventDefault(); e.stopImmediatePropagation(); marks.pop(); redraw(); } } };
    document.addEventListener('keydown', annot.keys, true);
  }
  function closeAnnot() { if (!annot) return; annot.ov.remove(); annot.bar.remove(); window.removeEventListener('resize', annot.place); document.removeEventListener('keydown', annot.keys, true); annot = null; }

  /* ---------- Looks ---------- */
  async function paintLooks() {
    const box = $p('.dLooks'); if (!box) return;
    const list = (S.suggest || {})[b.id] || [];
    const busy = ctx.busy && ctx.busy();
    if (!list.length) { box.innerHTML = busy ? '<p class="dEmpty">Claude is making looks… they show here when ready.</p>' : '<p class="dEmpty">No looks yet. Press “Show me 3 looks”.</p>'; return; }
    box.innerHTML = (busy ? '<p class="dEmpty">Claude is making new looks…</p>' : '') + list.map((l, i) => `<figure class="look${R.looks[b.id] === l.id ? ' on' : ''}" data-i="${i}"><div class="lookPic"><span class="spin">Making the screenshot…</span></div>
      <figcaption><b>${esc(l.id)} · ${esc(l.title || '')}</b>${l.why ? `<span>${esc(l.why)}</span>` : ''}</figcaption>
      <div><button type="button" class="btn sm${R.looks[b.id] === l.id ? ' primary' : ''}" data-a="use">${R.looks[b.id] === l.id ? '✓ Using this' : 'Use this'}</button><button type="button" class="btn sm" data-a="draw">✏️ Draw on it</button></div></figure>`).join('');
    for (let i = 0; i < list.length; i++) {
      const fig = box.querySelector(`figure[data-i="${i}"] .lookPic`); if (!fig) continue;
      try { const u = await lookShot(S, ctx.beats, b.id, list[i], ctx.mediaURL); if (!fig.isConnected) return; fig.innerHTML = `<img alt="look ${esc(list[i].id)}" data-a="view" title="View big">`; fig.querySelector('img').src = u; }
      catch (e) { if (fig.isConnected) fig.innerHTML = '<span class="spin">Could not make this screenshot</span>'; }
    }
  }
  $p('.dLooks').onclick = async e => { const a = e.target.dataset.a; const fig = e.target.closest('figure'); if (!a || !fig) return;
    const list = (S.suggest || {})[b.id] || [], l = list[+fig.dataset.i]; if (!l) return;
    const pic = await lookShot(S, ctx.beats, b.id, l, ctx.mediaURL).catch(() => '');
    if (a === 'use') { R.looks[b.id] = R.looks[b.id] === l.id ? '' : l.id; ctx.onChange(); paintLooks(); }
    else if (a === 'draw' && pic) { const sh = { id: uid(), t: +(l.t ?? (b.t0 + b.t1) / 2), base: pic, img: pic, marks: [], note: '', look: l.id }; D().shots.push(sh); ctx.onChange(); paintShots(); edit(sh); }
    else if (a === 'view' && pic) edit(null, { view: true, src: pic, title: `${l.id} · ${l.title || ''}`,
      actions: `<button type="button" class="btn${R.looks[b.id] === l.id ? ' primary' : ''}" data-a="vuse">${R.looks[b.id] === l.id ? '✓ Using this' : 'Use this'}</button><button type="button" class="btn" data-a="vdraw">✏️ Draw on it</button>`,
      onAction: act => { closeAnnot(); if (act === 'vuse') { R.looks[b.id] = R.looks[b.id] === l.id ? '' : l.id; ctx.onChange(); paintLooks(); }
        if (act === 'vdraw') { const sh = { id: uid(), t: +(l.t ?? (b.t0 + b.t1) / 2), base: pic, img: pic, marks: [], note: '', look: l.id }; D().shots.push(sh); ctx.onChange(); paintShots(); edit(sh); } } }); };
  $p('.dAsk').onclick = async () => { const n = $p('.dAskNote').value.trim(); await ctx.onAskLooks(b, n); paintLooks(); };
  $p('.dSend').onclick = () => { closeAnnot(); ctx.onSend(); };
  $p('.dBack').onclick = () => api.close();
  const keys = e => { const tg = e.target; if (annot || (tg && /^(INPUT|TEXTAREA)$/.test(tg.tagName))) return; if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); api.close(); } else if (e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); addShot(); } };
  document.addEventListener('keydown', keys, true);

  paintShots(); paintLooks();
  const api = {
    beat: b.id, edit, paintLooks, paintShots,
    close() { closeAnnot(); document.removeEventListener('keydown', keys, true); ['timeupdate', 'seeked', 'pause'].forEach(e => pv.video.removeEventListener(e, paintT)); pane.innerHTML = ''; ctx.onClose && ctx.onClose(); }
  };
  return api;
}

/* one drawing mark: { k: pen|line|arrow|rect|ellipse, c: color, w: width, pts: [[x,y]…] } in a 960×540 frame */
export function drawMark(g, m) {
  const p = m.pts || []; if (!p.length) return;
  g.save(); g.strokeStyle = m.c || '#FF7A1A'; g.lineWidth = m.w || 5; g.lineCap = g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 3;
  const [a, z] = [p[0], p[p.length - 1]];
  g.beginPath();
  if (m.k === 'pen') { g.moveTo(...a); p.slice(1).forEach(q => g.lineTo(...q)); }
  else if (m.k === 'line' || m.k === 'arrow') { g.moveTo(...a); g.lineTo(...z);
    if (m.k === 'arrow') { const ang = Math.atan2(z[1] - a[1], z[0] - a[0]), L = Math.max(14, (m.w || 5) * 4);
      g.moveTo(...z); g.lineTo(z[0] - L * Math.cos(ang - 0.45), z[1] - L * Math.sin(ang - 0.45));
      g.moveTo(...z); g.lineTo(z[0] - L * Math.cos(ang + 0.45), z[1] - L * Math.sin(ang + 0.45)); } }
  else if (m.k === 'rect') g.rect(Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.abs(z[0] - a[0]), Math.abs(z[1] - a[1]));
  else if (m.k === 'ellipse') g.ellipse((a[0] + z[0]) / 2, (a[1] + z[1]) / 2, Math.abs(z[0] - a[0]) / 2, Math.abs(z[1] - a[1]) / 2, 0, 0, Math.PI * 2);
  g.stroke(); g.restore();
}
