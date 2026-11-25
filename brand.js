/* 🎨 Brand: the project's brand guidelines in one window (colors, fonts, logos, rules, links).
   Saved in the project file as the top-level "brand"; every request to Claude carries it. */
import { wireMic } from './tools.js?v=17.7';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'];
const hexOf = v => { let h = String(v || '').trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join(''); return /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h) ? '#' + h.toUpperCase() : null; };

export function brandCount(b) { if (!b) return 0; return (b.colors || []).length + (b.fonts || []).length + (b.logos || []).length + ((b.rules || '').trim() ? 1 : 0) + ((b.links || '').trim() ? 1 : 0); }
export function brandText(P) { const b = P && P.brand; if (!brandCount(b)) return '';
  const L = [];
  if ((b.colors || []).length) L.push('Colors: ' + b.colors.map(c => `${c.name || 'color'} ${c.hex}${c.use ? ' (' + c.use + ')' : ''}`).join(', '));
  if ((b.fonts || []).length) L.push('Fonts: ' + b.fonts.map(f => `${f.role || 'text'}: ${f.family} ${f.weight || ''}${f.use ? ' (' + f.use + ')' : ''}`.trim()).join(', '));
  if ((b.logos || []).length) L.push('Logos: ' + b.logos.map(l => `${l.name || 'logo'}${l.file ? ' = ' + l.file : ' (embedded in the project file)'}`).join(', '));
  if ((b.rules || '').trim()) L.push('Rules: ' + b.rules.trim().replace(/\s*\n\s*/g, ' / '));
  if ((b.links || '').trim()) L.push('Links: ' + b.links.trim());
  return 'Brand guidelines (project "brand" from the Brand window, follow them for every graphic): ' + L.join(' · '); }

const loadedFonts = new Set();
function loadFont(family) { const f = String(family || '').trim(); if (!f || loadedFonts.has(f)) return; loadedFonts.add(f);
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800;900&display=swap`; document.head.appendChild(l); }

/* o: { P, onChange(), onAsk(note), busy(), saveImage(name, dataURL, folder), loadImage(rel), status(t), onClose() } */
export function openBrand(o) {
  const P = o.P;
  const B = () => (P.brand ||= {});
  const w = document.createElement('div'); w.className = 'ideasWin brWin';
  w.innerHTML = `<div class="iwBox brBox" role="dialog" aria-label="Brand guidelines"><header><b>🎨 Brand · ${esc(P.name || 'this project')}</b><span class="brSub">Claude uses this in every request</span><button type="button" class="btn iwX" title="Close (Esc)">✕</button></header>
    <main class="iwBody brBody"></main>
    <footer><input type="text" class="brNote" placeholder="Optional: what Claude should look at (website, PDF, notes)…"><button type="button" class="btn brAsk">✨ Ask Claude to fill / update</button><span class="brSaved"></span></footer></div>`;
  document.body.appendChild(w);
  const body = w.querySelector('.brBody'), askB = w.querySelector('.brAsk');
  const changed = () => { const b = P.brand; if (b && !brandCount(b)) delete P.brand; o.onChange && o.onChange(); paintSaved(); };
  const paintSaved = () => { w.querySelector('.brSaved').textContent = 'Saved with the project (Ctrl+S, or with your next Revise)'; };
  function paint() {
    const b = P.brand || {}, colors = b.colors || [], fonts = b.fonts || [], logos = b.logos || [];
    fonts.forEach(f => loadFont(f.family));
    body.innerHTML = `
    <section class="brSec"><h4>Colors <button type="button" class="btn sm" data-a="addColor">＋ Color</button></h4>
      ${colors.length ? `<div class="brColors">${colors.map((c, i) => `<div class="brColor" data-i="${i}">
          <label class="brSw" style="background:${esc(c.hex)}" title="Pick a color"><input type="color" data-f="pick" value="${esc((hexOf(c.hex) || '#000000').slice(0, 7))}"></label>
          <input type="text" data-f="hex" value="${esc(c.hex)}" class="mono" title="Hex">
          <input type="text" data-f="name" value="${esc(c.name || '')}" placeholder="Name (e.g. Orange)">
          <input type="text" data-f="use" value="${esc(c.use || '')}" placeholder="Use (e.g. text, accent)">
          <span class="brRow"><button type="button" class="btn sm" data-a="copy" title="Copy the hex">⧉</button><button type="button" class="btn sm" data-a="delColor" title="Delete">✕</button></span></div>`).join('')}</div>`
        : '<p class="brEmpty">No colors yet.</p>'}</section>
    <section class="brSec"><h4>Fonts <button type="button" class="btn sm" data-a="addFont">＋ Font</button></h4>
      ${fonts.length ? fonts.map((f, i) => `<div class="brFont" data-i="${i}">
          <input type="text" data-f="role" value="${esc(f.role || '')}" placeholder="Role (Headline, Body…)" class="brRole">
          <input type="text" data-f="family" value="${esc(f.family || '')}" placeholder="Font (e.g. Roboto Condensed)">
          <select data-f="weight">${WEIGHTS.map(x => `<option${String(f.weight || '700') === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
          <input type="text" data-f="use" value="${esc(f.use || '')}" placeholder="Use (titles, captions…)">
          <button type="button" class="btn sm" data-a="delFont" title="Delete">✕</button>
          <div class="brPrev" style="font-family:'${esc(f.family || 'Roboto')}',sans-serif;font-weight:${esc(f.weight || '700')}">Aa · THE QUICK BROWN FOX · 0123456789</div></div>`).join('')
        : '<p class="brEmpty">No fonts yet.</p>'}</section>
    <section class="brSec"><h4>Logos &amp; images <button type="button" class="btn sm" data-a="addLogo">＋ Logo / image</button></h4>
      ${logos.length ? `<div class="brLogos">${logos.map((l, i) => `<figure class="brLogo" data-i="${i}"><div class="brImg"><img alt="" data-src="${esc(l.file || '')}"${l.data ? ` src="${esc(l.data)}"` : ''}></div>
          <input type="text" data-f="name" value="${esc(l.name || '')}" placeholder="Name"><small title="${esc(l.file || '')}">${esc(l.file ? l.file.split('/').pop() : 'in the project file')}</small><button type="button" class="btn sm" data-a="delLogo" title="Delete">✕</button></figure>`).join('')}</div>`
        : '<p class="brEmpty">No logos yet.</p>'}</section>
    <section class="brSec"><h4>Rules &amp; text style</h4>
      <div class="noteRow"><textarea data-f="rules" rows="5" placeholder="e.g. Text: Roboto Condensed Black Italic, white with orange gradient · Never cover the face · Captions orange rounded block, normal case…">${esc(b.rules || '')}</textarea><button type="button" class="mic" title="Dictate">🎤</button></div></section>
    <section class="brSec"><h4>Links</h4><input type="text" data-f="links" class="brLinks" value="${esc(b.links || '')}" placeholder="Brand website / guideline links (e.g. go.impactclients.co)"></section>`;
    wireMic(body.querySelector('.mic'), body.querySelector('textarea[data-f="rules"]'));
    body.querySelectorAll('img[data-src]').forEach(async im => { const rel = im.dataset.src; if (!rel || im.getAttribute('src')) return; try { const u = await o.loadImage(rel); if (u) im.src = u; else im.closest('.brImg').classList.add('miss'); } catch (e) {} });
    paintAsk();
  }
  function paintAsk() { const busy = o.busy && o.busy(); askB.disabled = !!busy; askB.textContent = busy ? '⏳ Claude is filling it…' : '✨ Ask Claude to fill / update'; }
  const at = el => { const r = el.closest('[data-i]'); return r ? +r.dataset.i : -1; };
  body.addEventListener('input', e => { const t = e.target, f = t.dataset.f; if (!f) return; const b = B();
    if (t.closest('.brColor')) { const c = b.colors[at(t)]; if (!c) return;
      if (f === 'pick') { c.hex = t.value.toUpperCase(); const hx = t.closest('.brColor').querySelector('[data-f="hex"]'); hx.value = c.hex; t.parentElement.style.background = c.hex; }
      else if (f === 'hex') { const h = hexOf(t.value); t.classList.toggle('bad', !h); if (h) { c.hex = h; const sw = t.closest('.brColor').querySelector('.brSw'); sw.style.background = h; sw.querySelector('input').value = h.slice(0, 7); } }
      else c[f] = t.value; }
    else if (t.closest('.brFont')) { const fo = b.fonts[at(t)]; if (!fo) return; fo[f] = t.value; const pv = t.closest('.brFont').querySelector('.brPrev');
      if (f === 'family') { pv.style.fontFamily = `'${t.value}',sans-serif`; clearTimeout(t._lf); t._lf = setTimeout(() => loadFont(t.value), 600); } if (f === 'weight') pv.style.fontWeight = t.value; }
    else if (t.closest('.brLogo')) { const l = b.logos[at(t)]; if (l) l[f] = t.value; }
    else if (f === 'rules' || f === 'links') b[f] = t.value;
    changed(); });
  body.addEventListener('change', e => { if (e.target.dataset.f === 'hex') { const c = (B().colors || [])[at(e.target)]; if (c) e.target.value = c.hex; e.target.classList.remove('bad'); } });
  body.addEventListener('click', async e => { const a = e.target.dataset.a; if (!a) return; const b = B();
    if (a === 'addColor') { (b.colors ||= []).push({ name: '', hex: '#FF7A1A', use: '' }); changed(); paint(); body.querySelector('.brColor:last-child [data-f="name"]')?.focus(); }
    else if (a === 'delColor') { b.colors.splice(at(e.target), 1); changed(); paint(); }
    else if (a === 'copy') { const c = b.colors[at(e.target)]; try { await navigator.clipboard.writeText(c.hex); o.status && o.status('Copied ' + c.hex); } catch (err) {} }
    else if (a === 'addFont') { (b.fonts ||= []).push({ role: '', family: '', weight: '700', use: '' }); changed(); paint(); body.querySelector('.brFont:last-of-type [data-f="role"]')?.focus(); }
    else if (a === 'delFont') { b.fonts.splice(at(e.target), 1); changed(); paint(); }
    else if (a === 'delLogo') { b.logos.splice(at(e.target), 1); changed(); paint(); }
    else if (a === 'addLogo') addLogo(); });
  async function addLogo() {
    let file; try { const [h] = await window.showOpenFilePicker({ id: 'planner-brand', types: [{ description: 'Logo or image', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'] } }] }); file = await h.getFile(); } catch (e) { return; }
    const dataURL = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const l = { name: file.name.replace(/\.[^.]+$/, '') };
    const rel = o.saveImage ? await o.saveImage(file.name, dataURL, 'brand') : null;
    if (rel) l.file = rel; else if (file.size < 1.5e6) l.data = dataURL; else { o.status && o.status('Link the project folder (with save permission) to add big images'); return; }
    (B().logos ||= []).push(l); changed(); paint(); o.status && o.status('Added ' + file.name + (rel ? ' to ' + rel : ''));
  }
  askB.onclick = async () => { const note = w.querySelector('.brNote').value.trim(); askB.disabled = true; await o.onAsk(note); paintAsk(); };
  const keys = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', keys, true);
  w.addEventListener('pointerdown', e => { if (e.target === w) close(); });
  w.querySelector('.iwX').onclick = () => close();
  const tick = setInterval(paintAsk, 1500);
  function close() { clearInterval(tick); document.removeEventListener('keydown', keys, true); w.remove(); o.onClose && o.onClose(); }
  paint();
  return { close, refresh: () => { const a = document.activeElement; if (a && w.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return; paint(); } };
}
