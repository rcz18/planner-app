/* 💡 Suggestions from Claude: 4 looks for a whole part (e.g. P2), each with screenshots made here in the app
   (no renders, few tokens), a short read and the skill that fits it best.
   ☆ Like keeps one in your Liked list (all projects); Choose + Apply has Claude build the part from it;
   🔄 Generate 4 new asks for a fresh batch. */
import { snapshot } from './tools.js?v=17.0';
import { createPreview } from './engine.js?v=16.5';

const W = 960, H = 540;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = t => `${Math.floor(t / 60)}:${(+t % 60).toFixed(1).padStart(4, '0')}`;
export const SKILLS = {
  'planner-css': 'Planner animation (fastest)',
  'video-shotcraft': 'Shotcraft · cinematic shot recipes',
  'remotion-video': 'Remotion · motion graphics',
  'lemo-opuscar': 'Lemo-Opuscar · art styles',
  'pixel2motion': 'Pixel2Motion · logo reveal',
};
const skillName = s => SKILLS[s] || s || 'Planner animation';

/* the request line Claude reads */
export function ideaText(s) {
  const id = s.review.idea, it = id && ((s.ideas || {}).list || []).find(x => x.id === id);
  return it ? `USE SUGGESTION ${it.id} “${it.title || ''}” (ideas.list in the project file) with skill ${(it.skill || {}).name || 'planner-css'}: rebuild this part from it, keep my direct notes on top` : '';
}

/* a part's beats with one suggestion put in (for screenshots and for ▶ Try) */
export function ideaBeats(beats, idea) {
  const over = idea.beats || {};
  const nb = JSON.parse(JSON.stringify(beats)).map(b => { const o = over[b.id]; if (!o) return b;
    return { ...b, ...(o.els ? { els: JSON.parse(JSON.stringify(o.els)) } : {}), ...(o.cam ? { cam: o.cam } : {}), ...(o.fx ? { fx: o.fx } : {}) }; });
  return { beats: nb, css: (idea.css || '') + '\n' + Object.values(over).map(o => o.css || '').join('\n') };
}

/* ---------- a still of one suggestion at time t, made here in the app (cached) ---------- */
const cache = new Map();
export function ideaShot(S, beats, idea, t, src) {
  const key = [S.id, idea.id, t, JSON.stringify([idea.beats, idea.css])].join('|');
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:${H}px;overflow:hidden;background:#000;pointer-events:none`;
    document.body.appendChild(host);
    try {
      const ib = ideaBeats(beats, idea);
      const proj = { ...S, beats: ib.beats, css: (S.css || '') + '\n' + ib.css, review: { moves: {}, cams: [], drawings: [], media: [] } };
      const pv = createPreview(host, proj, src || ''), v = pv.video;
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
  cache.set(key, job); job.catch(() => cache.delete(key));
  return job;
}
async function small(dataURL) {   // a little picture for the Liked list
  const im = new Image(); im.src = dataURL; await im.decode();
  const c = document.createElement('canvas'); c.width = 480; c.height = 270; c.getContext('2d').drawImage(im, 0, 0, 480, 270); return c.toDataURL('image/jpeg', 0.72);
}

/* ---------- the window ----------
   ctx: { P, S, beats, mediaURL, getLikes, setLikes, onGenerate(note), onApply(id), onChange, busy(), status } */
export function openIdeas(ctx) {
  const { S, beats } = ctx, R = S.review, name = S.name || S.id.toUpperCase();
  let tab = 'ideas', chosen = R.idea || '', shotIx = {};
  const dlg = document.createElement('div'); dlg.className = 'ideasWin';
  dlg.innerHTML = `<div class="iwBox" role="dialog" aria-label="Suggestions from Claude">
    <header><b>💡 Suggestions from Claude · ${esc(name)}</b><nav><button type="button" class="iwTab" data-tab="ideas">Suggestions</button><button type="button" class="iwTab" data-tab="likes">⭐ Liked <span class="iwN"></span></button></nav><button type="button" class="btn iwX" title="Close (Esc)">✕</button></header>
    <main class="iwBody"></main>
    <footer><input type="text" class="iwNote" placeholder="What do you want? (optional, e.g. more cinematic, bolder text, 3D, clean)"><button type="button" class="btn iwGen">🔄 Generate 4 new</button><button type="button" class="btn primary iwApply" disabled>✓ Apply</button></footer></div>`;
  document.body.appendChild(dlg);
  const $d = s => dlg.querySelector(s), body = $d('.iwBody');
  const likes = () => ctx.getLikes() || [];
  const likeKey = it => `${ctx.P.id}|${S.id}|${it.id}|${(it.title || '').slice(0, 40)}|${(S.ideas || {}).at || ''}`;
  const isLiked = it => likes().some(l => l.key === likeKey(it));

  function paintTabs() { dlg.querySelectorAll('.iwTab').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab ? 'true' : 'false')); $d('.iwN').textContent = likes().length || '';
    $d('footer').hidden = tab !== 'ideas'; $d('.iwApply').disabled = !chosen; $d('.iwApply').textContent = chosen ? `✓ Apply ${chosen}` : '✓ Apply'; }
  function paint() { paintTabs(); tab === 'ideas' ? paintIdeas() : paintLikes(); }

  function paintIdeas() {
    const list = (S.ideas || {}).list || [], busy = ctx.busy();
    $d('.iwGen').disabled = busy; $d('.iwGen').textContent = busy ? 'Claude is making them…' : list.length ? '🔄 Generate 4 new' : '💡 Make 4 suggestions';
    if (!list.length) { body.innerHTML = `<div class="iwEmpty">${busy ? '<b>Claude is making 4 suggestions for ' + esc(name) + '…</b><p>They show here by themselves. You can close this window.</p>' : '<b>No suggestions yet for ' + esc(name) + '.</b><p>Write what you want below (optional) and press “Make 4 suggestions”.</p>'}</div>`; return; }
    body.innerHTML = (busy ? '<p class="iwBusy">Claude is making 4 new suggestions… the ones below stay until they are ready.</p>' : '') + `<div class="iwGrid">${list.map(it => {
      const shots = (it.shots && it.shots.length ? it.shots : [(beats[0].t0 + beats[beats.length - 1].t1) / 2]).slice(0, 3);
      return `<article class="iwCard${chosen === it.id ? ' on' : ''}" data-id="${esc(it.id)}">
        <div class="iwPic"><span class="spin">Making the screenshot…</span>${shots.length > 1 ? `<div class="iwDots">${shots.map((t, i) => `<button type="button" data-shot="${i}" title="${tc(t)}"${i === (shotIx[it.id] || 0) ? ' class="on"' : ''}>${tc(t)}</button>`).join('')}</div>` : ''}</div>
        <div class="iwTxt"><h4><span class="iwId">${esc(it.id)}</span> ${esc(it.title || '')}</h4>
          <p>${esc(it.read || it.why || '')}</p>
          <p class="iwSkill">🧰 <b>${esc(skillName((it.skill || {}).name))}</b>${(it.skill || {}).why ? ' · ' + esc(it.skill.why) : ''}</p></div>
        <div class="iwBtns"><button type="button" class="btn sm iwLike${isLiked(it) ? ' on' : ''}" data-a="like">${isLiked(it) ? '★ Liked' : '☆ Like'}</button><button type="button" class="btn sm" data-a="try" title="Play it in the preview first (nothing is saved)">▶ Try</button><button type="button" class="btn sm${chosen === it.id ? ' primary' : ''}" data-a="choose">${chosen === it.id ? '✓ Chosen' : 'Choose'}</button></div></article>`; }).join('')}</div>`;
    list.forEach(it => paintPic(it));
  }
  async function paintPic(it) {
    const card = body.querySelector(`.iwCard[data-id="${CSS.escape(it.id)}"] .iwPic`); if (!card) return;
    const shots = (it.shots && it.shots.length ? it.shots : [(beats[0].t0 + beats[beats.length - 1].t1) / 2]).slice(0, 3), i = shotIx[it.id] || 0;
    try { const u = await ideaShot(S, beats, it, +shots[i], ctx.mediaURL); if (!card.isConnected) return;
      let im = card.querySelector('img'); if (!im) { im = document.createElement('img'); im.alt = 'suggestion ' + it.id; im.title = 'View big'; card.prepend(im); card.querySelector('.spin')?.remove(); } im.src = u; }
    catch (e) { const s = card.querySelector('.spin'); if (s) s.textContent = 'Could not make this screenshot'; }
    card.querySelectorAll('.iwDots button').forEach((b, k) => b.classList.toggle('on', k === i));
  }
  function paintLikes() {
    const L = likes();
    body.innerHTML = L.length ? `<div class="iwGrid likes">${L.map((l, i) => `<article class="iwCard" data-i="${i}"><div class="iwPic">${l.img ? `<img src="${l.img}" alt="">` : ''}</div>
      <div class="iwTxt"><h4>${esc(l.title || '')}</h4><p>${esc(l.read || '')}</p><p class="iwSkill">🧰 <b>${esc(skillName(l.skill))}</b></p><p class="iwFrom">${esc(l.project || '')} · ${esc(l.seq || '')} · ${new Date(l.at).toLocaleDateString()}</p></div>
      <div class="iwBtns"><button type="button" class="btn sm" data-a="unlike">Remove</button></div></article>`).join('')}</div>`
      : '<div class="iwEmpty"><b>No liked suggestions yet.</b><p>Press ☆ Like on a suggestion you like but won’t use now. It stays here for every project, and Claude uses it to learn your taste.</p></div>';
  }

  body.onclick = async e => {
    const card = e.target.closest('.iwCard'); if (!card) return;
    if (tab === 'likes') { if (e.target.dataset.a === 'unlike') { const L = likes().slice(); const [gone] = L.splice(+card.dataset.i, 1); await ctx.setLikes(L, gone, false); paint(); } return; }
    const it = ((S.ideas || {}).list || []).find(x => x.id === card.dataset.id); if (!it) return;
    if (e.target.dataset.shot !== undefined) { shotIx[it.id] = +e.target.dataset.shot; paintPic(it); return; }
    const a = e.target.dataset.a;
    if (a === 'choose') { chosen = chosen === it.id ? '' : it.id; paint(); return; }
    if (a === 'try') { ctx.onTry && ctx.onTry(it); return; }
    if (a === 'like') {
      const L = likes().slice(), k = likeKey(it), at = L.findIndex(l => l.key === k);
      if (at >= 0) { const [gone] = L.splice(at, 1); await ctx.setLikes(L, gone, false); }
      else { let img = ''; try { const shots = it.shots && it.shots.length ? it.shots : [(beats[0].t0 + beats[beats.length - 1].t1) / 2]; img = await small(await ideaShot(S, beats, it, +shots[0], ctx.mediaURL)); } catch (err) {}
        const l = { key: k, project: ctx.P.name || ctx.P.id, seq: name, id: it.id, title: it.title, read: it.read || it.why || '', skill: (it.skill || {}).name || '', at: new Date().toISOString(), img, idea: it };
        L.unshift(l); await ctx.setLikes(L, l, true); }
      paint(); return; }
    if (e.target.tagName === 'IMG') { const big = document.createElement('div'); big.className = 'iwBig'; big.innerHTML = `<img src="${e.target.src}" alt=""><p>${esc(it.id)} · ${esc(it.title || '')} — click to close</p>`; big.onclick = () => big.remove(); dlg.appendChild(big); }
  };
  dlg.querySelectorAll('.iwTab').forEach(b => b.onclick = () => { tab = b.dataset.tab; paint(); });
  $d('.iwGen').onclick = async () => { await ctx.onGenerate($d('.iwNote').value.trim()); paint(); };
  $d('.iwApply').onclick = () => { if (!chosen) return; R.idea = chosen; ctx.onChange(); api.close(); ctx.onApply(chosen); };
  const close = () => api.close();
  $d('.iwX').onclick = close; dlg.addEventListener('mousedown', e => { if (e.target === dlg) close(); });
  const keys = e => { if (e.key === 'Escape') { const big = dlg.querySelector('.iwBig'); e.preventDefault(); e.stopImmediatePropagation(); big ? big.remove() : close(); } };
  document.addEventListener('keydown', keys, true);
  paint();
  const api = { refresh() { paint(); }, close() { document.removeEventListener('keydown', keys, true); dlg.remove(); ctx.onClose && ctx.onClose(); } };
  return api;
}
