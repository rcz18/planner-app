/* Direct: your direction for one whole part (e.g. P2): where to go close-up, where to zoom out, the camera moves
   and the feel of the animations.
   📸 screenshot the preview anywhere in the part (as many as you want) → comment + camera tags on each →
   double-click a screenshot to draw on it (pen, line, arrow, box, circle).
   💡 Looks: Claude writes a few looks for one beat; this app takes their screenshots itself (no renders, few tokens). */
import { snapshot, wireMic } from './tools.js?v=16.8';
import { createPreview } from './engine.js?v=16.5';

const W = 960, H = 540;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const COLORS = ['#FF7A1A', '#ffffff', '#ef4444', '#22c55e', '#38bdf8', '#facc15'];
const TOOLS = [['pen', '✏️', 'Pen'], ['line', '╱', 'Line'], ['arrow', '➜', 'Arrow'], ['rect', '▭', 'Box'], ['ellipse', '◯', 'Circle']];
export const CAMS = ['Close-up', 'Zoom in', 'Zoom out', 'Wide', 'Pan ←', 'Pan →', 'Impact'];

/* one direction per part: review.direct = { note, shots: [{ id, t, beat, cam: [...], note, marks, base, file | img, look? }] } */
export function directOf(R) {
  R.direct ||= { note: '', shots: [] }; R.direct.shots ||= [];
  if (R.directs) { Object.entries(R.directs).forEach(([bid, d]) => {        // older files: one direction per beat
      if ((d.note || '').trim()) R.direct.note = (R.direct.note ? R.direct.note + '\n' : '') + `${bid}: ${d.note.trim()}`;
      (d.shots || []).forEach(x => R.direct.shots.push({ cam: [], ...x, beat: x.beat || bid })); });
    delete R.directs; }
  return R.direct;
}
export function directCount(R) { const d = R.direct || {}; return (d.shots || []).length + ((d.note || '').trim() ? 1 : 0) + Object.values(R.looks || {}).filter(Boolean).length; }

/* what Claude reads in the request */
export function directText(s) {
  const d = s.review.direct || {}, L = [];
  if ((d.note || '').trim()) L.push(`DIRECTION for this whole part (camera, close-ups / zoom-outs, cinematic feel, animation): ${d.note.trim()}`);
  (d.shots || []).slice().sort((a, b) => a.t - b.t).forEach((x, i) => L.push(`Direct shot #${i + 1} at ${tc(x.t)} (${x.beat || '?'})${x.look ? ` on your look ${x.look}` : ''}${(x.cam || []).length ? ' · camera: ' + x.cam.join(', ') : ''}${(x.marks || []).length ? ` · ${x.marks.length} drawing${x.marks.length > 1 ? 's' : ''}` : ''}${x.note ? ' · ' + x.note : ''} [${x.file ? 'file: ' + x.file : 'review.direct.shots id ' + x.id + ' img'}]`));
  return L;
}
export function lookText(s, bid) {
  const lk = (s.review.looks || {})[bid], look = lk && ((s.suggest || {})[bid] || []).find(x => x.id === lk);
  return look ? ` · USE YOUR LOOK ${look.id} “${look.title || ''}” (suggest.${bid}.${look.id} in the project file): build this beat from it` : '';
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

/* ---------- the Direct panel (whole part) ----------
   ctx: { S, beats, lookBeat, pv, tools, seek, monBox, monitor, pane, mediaURL, onChange, onSend, onAskLooks, saveImage, loadImage, onClose, busy, status } */
export function openDirect(ctx) {
  const { S, pv, pane, beats } = ctx, R = S.review, DUR = +S.duration || pv.video.duration || 0;
  R.looks ||= {}; const D = directOf(R);
  const beatAt = t => beats.find(b => t >= b.t0 && t < b.t1) || beats[beats.length - 1];
  let annot = null, lookBeat = ctx.lookBeat || beatAt(pv.time()).id;
  pv.video.pause(); ctx.tools && ctx.tools.idle && ctx.tools.idle();
  const name = S.name || S.id.toUpperCase();

  pane.innerHTML = `
    <div class="dHead"><button type="button" class="btn dBack" title="Back to the beats (Esc)">← Beats</button><div><b>🎬 Direct · ${esc(name)}</b><span>The whole part: close-ups, zoom-outs, camera moves, animation feel</span></div></div>
    <div class="dScrub"><button type="button" class="playBeat dPlay" title="Play / pause">▶</button><input type="range" class="dRange" min="0" max="${Math.max(0, DUR - 0.02)}" step="0.0333"><span class="dTc"></span><span class="dBeat"></span></div>
    <button type="button" class="btn primary dShot" title="Take a picture of the preview as it is now (S)">📸 Screenshot this frame</button>
    <p class="dHint">Take as many as you want, anywhere in ${esc(name)}. Write a comment and tap camera tags on each. <b>Double-click a screenshot to draw on it.</b></p>
    <label class="dLbl">Direction for the whole ${esc(name)}</label>
    <div class="noteRow"><textarea class="dNote" rows="3" placeholder="e.g. Start wide, push in to a close-up on “Deal!”, zoom out when the store builds. Keep the moves smooth and cinematic."></textarea><button type="button" class="mic dMic" title="Dictate">🎤</button></div>
    <div class="dShots"></div>
    <div class="dLooksHead"><b>💡 Looks from Claude</b><span class="dim">Just screenshots, fast and light</span></div>
    <div class="dLookRow"><label>Beat <select class="dLookBeat">${beats.map(b => `<option value="${esc(b.id)}">${esc(b.id)} · ${esc((b.title || '').slice(0, 40))}</option>`).join('')}</select></label></div>
    <div class="noteRow"><input type="text" class="dAskNote" placeholder="What kind of looks? (optional, e.g. bolder, more 3D, minimal)"><button type="button" class="btn dAsk">Show me 3 looks</button></div>
    <div class="dLooks"></div>
    <div class="dFoot"><button type="button" class="btn primary dSend">Send to Claude (Revise ${esc(name)})</button></div>`;
  const $p = sel => pane.querySelector(sel);
  const range = $p('.dRange'), tcEl = $p('.dTc'), bEl = $p('.dBeat'), note = $p('.dNote'), sel = $p('.dLookBeat');
  sel.value = lookBeat;
  note.value = D.note || ''; wireMic($p('.dMic'), note);
  note.addEventListener('input', () => { D.note = note.value; ctx.onChange(); });

  /* scrub the whole part */
  const paintT = () => { const t = pv.time(); if (document.activeElement !== range) range.value = t; tcEl.textContent = tc(t); bEl.textContent = beatAt(t).id; $p('.dPlay').textContent = pv.video.paused ? '▶' : '❚❚'; };
  range.addEventListener('input', () => { ctx.seek(+range.value); tcEl.textContent = tc(+range.value); bEl.textContent = beatAt(+range.value).id; });
  ['timeupdate', 'seeked', 'pause', 'play'].forEach(e => pv.video.addEventListener(e, paintT)); paintT();
  $p('.dPlay').onclick = () => { if (!pv.video.paused) { pv.video.pause(); return; } const t = pv.time(); pv.playFrom(t >= DUR - 0.1 ? 0 : t, DUR); };

  /* screenshots */
  async function addShot() {
    const btn = $p('.dShot'); btn.disabled = true; btn.textContent = '📸 Taking it…';
    try { const v = pv.video; v.pause();
      if (v.seeking) await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 3000); });
      await new Promise(r => { if (v.requestVideoFrameCallback && v.readyState >= 2) { v.requestVideoFrameCallback(() => r()); setTimeout(r, 250); } else setTimeout(r, 120); });
      const t = +pv.time().toFixed(3), base = await ctx.tools.shot();
      if (!base) throw new Error('no picture');
      const sh = { id: uid(), t, beat: beatAt(t).id, cam: [], base, img: base, marks: [], note: '' };
      D.shots.push(sh); D.shots.sort((a, b) => a.t - b.t); ctx.onChange(); paintShots();
      const ta = pane.querySelector(`.dShots figure[data-id="${sh.id}"] textarea`); if (ta) { ta.scrollIntoView({ block: 'nearest' }); ta.focus(); }
    } catch (e) { ctx.status && ctx.status('Could not take the screenshot: ' + e.message); }
    btn.disabled = false; btn.textContent = '📸 Screenshot this frame';
  }
  $p('.dShot').onclick = addShot;
  const src = async x => x && /^data:|^blob:/.test(x) ? x : (x ? await ctx.loadImage(x) : '');
  const byId = id => D.shots.find(x => x.id === id);
  function paintShots() {
    const box = $p('.dShots'); if (!box) return;
    box.innerHTML = D.shots.length ? D.shots.map((x, i) => `<figure data-id="${x.id}">
        <div class="dPic"><img alt="screenshot ${i + 1}" title="Click: go to this moment · Double-click: draw on it"><span class="dNum">#${i + 1}</span>${(x.marks || []).length ? '<span class="dDrawn">✏️ ' + x.marks.length + '</span>' : ''}</div>
        <div class="dSide"><div class="dMeta"><b>${tc(x.t)}</b> · ${esc(x.beat || '')}${x.look ? ' · look ' + esc(x.look) : ''}<span class="grow"></span><button type="button" class="btn sm" data-a="draw" title="Draw on it">✏️</button><button type="button" class="btn sm" data-a="del" title="Delete">✕</button></div>
          <div class="dCams">${CAMS.map(c => `<button type="button" class="chip${(x.cam || []).includes(c) ? ' on' : ''}" data-cam="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
        <div class="noteRow dCmt"><textarea rows="2" placeholder="Comment: what should happen here?">${esc(x.note || '')}</textarea><button type="button" class="mic" title="Dictate">🎤</button></div></figure>`).join('')
      : '<p class="dEmpty">No screenshots yet. Move to a moment and press 📸 (or S).</p>';
    D.shots.forEach(async x => { const fig = box.querySelector(`figure[data-id="${x.id}"]`); if (!fig) return;
      const ta = fig.querySelector('textarea'); wireMic(fig.querySelector('.mic'), ta);
      ta.addEventListener('input', () => { x.note = ta.value; ctx.onChange(); });
      const im = fig.querySelector('img'); im.src = await src(x.file || x.img); });
  }
  let clickT = null;
  $p('.dShots').onclick = e => { const fig = e.target.closest('figure'); if (!fig) return; const sh = byId(fig.dataset.id); if (!sh) return;
    const a = e.target.dataset.a, cam = e.target.dataset.cam;
    if (cam) { sh.cam ||= []; sh.cam = sh.cam.includes(cam) ? sh.cam.filter(c => c !== cam) : sh.cam.concat(cam); e.target.classList.toggle('on', sh.cam.includes(cam)); ctx.onChange(); return; }
    if (a === 'draw') { edit(sh); return; }
    if (a === 'del') { D.shots.splice(D.shots.indexOf(sh), 1); ctx.onChange(); paintShots(); return; }
    if (e.target.tagName === 'IMG') { clearTimeout(clickT); clickT = setTimeout(() => ctx.seek(sh.t), 230); } };
  $p('.dShots').ondblclick = e => { if (e.target.tagName !== 'IMG') return; clearTimeout(clickT); const fig = e.target.closest('figure'); const sh = fig && byId(fig.dataset.id); if (sh) edit(sh); };

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
        <input type="text" class="annNote" placeholder="Comment on this screenshot"><button type="button" class="mic" title="Dictate">🎤</button>
        <button type="button" class="btn" data-a="close">Cancel</button><button type="button" class="btn primary" data-a="save">Save</button>`;
    }
    box.appendChild(ov); box.appendChild(bar); window.addEventListener('resize', place);
    const im = ov.querySelector('img'), cv = ov.querySelector('canvas'), g = cv.getContext('2d');
    (async () => { im.src = opts.view ? opts.src : await src(sh.base || sh.file || sh.img); })();
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
        if (img) { sh.img = img; const nm = `${name}-${sh.beat || 'shot'}-${sh.id}`;
          const f = await ctx.saveImage(nm + '.jpg', img); if (f) { sh.file = f; delete sh.img; }
          if (f && /^data:/.test(sh.base || '')) { const fb = await ctx.saveImage(nm + '-base.jpg', sh.base); if (fb) sh.base = fb; } }
        ctx.onChange(); closeAnnot(); paintShots(); }
      else if (opts.onAction) opts.onAction(a); };
    annot = { ov, bar, place, keys: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeAnnot(); } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !opts.view) { e.preventDefault(); e.stopImmediatePropagation(); marks.pop(); redraw(); } } };
    document.addEventListener('keydown', annot.keys, true);
  }
  function closeAnnot() { if (!annot) return; annot.ov.remove(); annot.bar.remove(); window.removeEventListener('resize', annot.place); document.removeEventListener('keydown', annot.keys, true); annot = null; }

  /* ---------- Looks (for one beat) ---------- */
  sel.onchange = () => { lookBeat = sel.value; paintLooks(); };
  async function paintLooks() {
    const box = $p('.dLooks'); if (!box) return; const bid = lookBeat, b = beats.find(x => x.id === bid);
    const list = (S.suggest || {})[bid] || [];
    const busy = ctx.busy && ctx.busy(bid);
    if (!list.length) { box.innerHTML = busy ? `<p class="dEmpty">Claude is making looks for ${esc(bid)}… they show here when ready.</p>` : `<p class="dEmpty">No looks for ${esc(bid)} yet. Press “Show me 3 looks”.</p>`; return; }
    box.innerHTML = (busy ? '<p class="dEmpty">Claude is making new looks…</p>' : '') + list.map((l, i) => `<figure class="look${R.looks[bid] === l.id ? ' on' : ''}" data-i="${i}"><div class="lookPic"><span class="spin">Making the screenshot…</span></div>
      <figcaption><b>${esc(l.id)} · ${esc(l.title || '')}</b>${l.why ? `<span>${esc(l.why)}</span>` : ''}</figcaption>
      <div><button type="button" class="btn sm${R.looks[bid] === l.id ? ' primary' : ''}" data-a="use">${R.looks[bid] === l.id ? '✓ Using this' : 'Use this'}</button><button type="button" class="btn sm" data-a="draw">✏️ Draw on it</button></div></figure>`).join('');
    for (let i = 0; i < list.length; i++) {
      const fig = box.querySelector(`figure[data-i="${i}"] .lookPic`); if (!fig) continue;
      try { const u = await lookShot(S, beats, bid, list[i], ctx.mediaURL); if (!fig.isConnected || lookBeat !== bid) return; fig.innerHTML = `<img alt="look ${esc(list[i].id)}" data-a="view" title="View big">`; fig.querySelector('img').src = u; }
      catch (e) { if (fig.isConnected) fig.innerHTML = '<span class="spin">Could not make this screenshot</span>'; }
    }
  }
  const drawOnLook = (l, pic, bid) => { const b = beats.find(x => x.id === bid); const sh = { id: uid(), t: +(l.t ?? (b.t0 + b.t1) / 2), beat: bid, cam: [], base: pic, img: pic, marks: [], note: '', look: l.id }; D.shots.push(sh); D.shots.sort((a, c) => a.t - c.t); ctx.onChange(); paintShots(); edit(sh); };
  $p('.dLooks').onclick = async e => { const a = e.target.dataset.a; const fig = e.target.closest('figure'); if (!a || !fig) return; const bid = lookBeat;
    const list = (S.suggest || {})[bid] || [], l = list[+fig.dataset.i]; if (!l) return;
    const pic = await lookShot(S, beats, bid, l, ctx.mediaURL).catch(() => '');
    if (a === 'use') { R.looks[bid] = R.looks[bid] === l.id ? '' : l.id; ctx.onChange(); paintLooks(); }
    else if (a === 'draw' && pic) drawOnLook(l, pic, bid);
    else if (a === 'view' && pic) edit(null, { view: true, src: pic, title: `${bid} · ${l.id} · ${l.title || ''}`,
      actions: `<button type="button" class="btn${R.looks[bid] === l.id ? ' primary' : ''}" data-a="vuse">${R.looks[bid] === l.id ? '✓ Using this' : 'Use this'}</button><button type="button" class="btn" data-a="vdraw">✏️ Draw on it</button>`,
      onAction: act => { closeAnnot(); if (act === 'vuse') { R.looks[bid] = R.looks[bid] === l.id ? '' : l.id; ctx.onChange(); paintLooks(); } if (act === 'vdraw') drawOnLook(l, pic, bid); } }); };
  $p('.dAsk').onclick = async () => { const b = beats.find(x => x.id === lookBeat); if (!b) return; await ctx.onAskLooks(b, $p('.dAskNote').value.trim()); paintLooks(); };
  $p('.dSend').onclick = () => { closeAnnot(); ctx.onSend(); };
  $p('.dBack').onclick = () => api.close();
  const keys = e => { const tg = e.target; if (annot || (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return; if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); api.close(); } else if (e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); addShot(); } };
  document.addEventListener('keydown', keys, true);

  paintShots(); paintLooks();
  const api = {
    edit, paintLooks, paintShots, setLookBeat(bid) { if (beats.some(b => b.id === bid)) { lookBeat = bid; sel.value = bid; paintLooks(); } },
    close() { closeAnnot(); document.removeEventListener('keydown', keys, true); ['timeupdate', 'seeked', 'pause', 'play'].forEach(e => pv.video.removeEventListener(e, paintT)); pane.innerHTML = ''; ctx.onClose && ctx.onClose(); }
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
