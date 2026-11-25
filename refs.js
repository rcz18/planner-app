/* 📎 Inspiration on every note box (beat notes, Direct, Marker, "Anything else"): paste a screenshot (Ctrl+V),
   drop images / videos on the box, or click 📎. Files go to "Planner App/refs/" in the linked project folder and are
   listed in review.refs = { "<slot>": [{ id, type: "image" | "video", name, file | data }] }, so Claude can open them. */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const slotOf = ta => { if (!ta || ta.tagName !== 'TEXTAREA') return null; if (ta.dataset.slot) return ta.dataset.slot;
  if (ta.dataset.note) return 'beat:' + ta.dataset.note; if (ta.id === 'general') return 'general'; if (ta.classList.contains('dNote')) return 'direct'; return null; };
export function wireRefs({ getS, saveFile, srcOf, onChange, status }) {
  const list = slot => { const S = getS(); if (!S) return []; const R = S.review ||= {}; return ((R.refs ||= {})[slot] ||= []); };
  const clean = () => { const S = getS(); const R = S && S.review; if (!R || !R.refs) return; Object.keys(R.refs).forEach(k => { if (!R.refs[k].length) delete R.refs[k]; }); if (!Object.keys(R.refs).length) delete R.refs; };
  const ok = f => f && /^(image|video)\//.test(f.type || '');
  async function add(slot, files) { files = [...files].filter(ok); if (!files.length || !getS()) return;
    for (const f of files) { const isV = f.type.startsWith('video'), id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${id}.png`; const r = { id, type: isV ? 'video' : 'image', name };
      const rel = await saveFile(f, `${(getS().name || getS().id)}-${slot.replace(/[:]/g, '-')}-${id}-${name}`, 'refs');
      if (rel) r.file = rel; else if (!isV && f.size < 2.5e6) r.data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      else { status && status('Link the project folder (with save permission) to keep videos for Claude.'); continue; }
      list(slot).push(r); }
    onChange && onChange(); paintAll(); status && status(`📎 Added ${files.length} inspiration file${files.length > 1 ? 's' : ''} · Claude looks at them on your next Revise`); }
  function remove(slot, id) { const L = list(slot), i = L.findIndex(x => x.id === id); if (i >= 0) L.splice(i, 1); clean(); onChange && onChange(); paintAll(); }
  async function paint(strip) { const slot = strip.dataset.slot, S = getS(), L = (S && S.review && S.review.refs && S.review.refs[slot]) || [];
    strip.innerHTML = L.map(r => `<span class="ref" data-id="${r.id}" title="${esc(r.name)}">${r.type === 'video' ? '<video muted preload="metadata"></video><i>▶</i>' : '<img alt="">'}<button type="button" data-rx="${r.id}" title="Remove">×</button></span>`).join('') +
      `<button type="button" class="refAdd" title="Add inspiration: paste (Ctrl+V), drop an image / video here, or pick a file">📎 ${L.length ? '' : 'Paste / drop inspiration'}</button>`;
    for (const r of L) { const u = await srcOf(r); const el = strip.querySelector(`.ref[data-id="${r.id}"] ${r.type === 'video' ? 'video' : 'img'}`); if (el && u) el.src = u; } }
  function stripFor(row) { const ta = row.querySelector('textarea'), slot = slotOf(ta); if (!slot) return null; let s = row.nextElementSibling;
    if (!s || !s.classList.contains('refStrip') || s.dataset.slot !== slot) { if (s && s.classList.contains('refStrip')) s.remove(); s = document.createElement('div'); s.className = 'refStrip'; s.dataset.slot = slot; row.after(s); paint(s); }
    return s; }
  function paintAll() { document.querySelectorAll('.noteRow').forEach(row => { const s = stripFor(row); if (s) paint(s); }); }
  const mo = new MutationObserver(() => document.querySelectorAll('.noteRow').forEach(stripFor)); mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('paste', ev => { const slot = slotOf(ev.target); if (!slot) return; const fs = [...(ev.clipboardData && ev.clipboardData.files || [])].filter(ok); if (!fs.length) return; ev.preventDefault(); add(slot, fs); }, true);
  const slotAt = t => { const st = t.closest && t.closest('.refStrip'); if (st) return st.dataset.slot; const row = t.closest && t.closest('.noteRow'); return row ? slotOf(row.querySelector('textarea')) : null; };
  document.addEventListener('dragover', ev => { if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return; const slot = slotAt(ev.target); document.querySelectorAll('.refDrop').forEach(x => x.classList.remove('refDrop'));
    if (!slot) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; (ev.target.closest('.refStrip') || ev.target.closest('.noteRow')).classList.add('refDrop'); }, true);
  document.addEventListener('drop', ev => { document.querySelectorAll('.refDrop').forEach(x => x.classList.remove('refDrop')); const slot = slotAt(ev.target); if (!slot || !ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); ev.stopPropagation(); add(slot, ev.dataTransfer.files); }, true);
  document.addEventListener('click', async ev => { const x = ev.target.closest && ev.target.closest('[data-rx]'); if (x) { remove(x.closest('.refStrip').dataset.slot, x.dataset.rx); return; }
    const a = ev.target.closest && ev.target.closest('.refAdd'); if (a) { const slot = a.closest('.refStrip').dataset.slot; let fs = [];
      try { const hs = await window.showOpenFilePicker({ id: 'planner-refs', multiple: true, types: [{ description: 'Images or videos', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'], 'video/*': ['.mp4', '.mov', '.webm', '.m4v'] } }] }); fs = await Promise.all(hs.map(h => h.getFile())); } catch (e) { return; }
      add(slot, fs); return; }
    const r = ev.target.closest && ev.target.closest('.refStrip .ref'); if (r) { const S = getS(); const ref = (((S.review || {}).refs || {})[r.closest('.refStrip').dataset.slot] || []).find(x => x.id === r.dataset.id); const u = ref && await srcOf(ref); if (u) window.open(u, '_blank'); } });
  return { refresh: paintAll };
}
/* one line per box for Claude */
export function refsText(s, beats) { const R = (s.review || {}).refs; if (!R) return [];
  const where = slot => { const [k, id] = slot.split(':'); if (k === 'beat') { const b = (beats || []).find(x => x.id === id); return `beat ${id}${b ? ' (' + b.title + ')' : ''}`; }
    if (k === 'mark') { const m = ((s.review || {}).marks || []).find(x => x.id === id); return `marker ${id}${m ? ' at ' + (+m.t).toFixed(2) + ' s' : ''}`; }
    if (k === 'shot') return `Direct screenshot ${id}`; if (k === 'direct') return 'Direct (whole part)'; return 'the whole sequence'; };
  const L = Object.entries(R).filter(([, v]) => v && v.length).map(([slot, v]) => `${where(slot)}: ` + v.map(r => `${r.type} “${r.name}” (${r.file ? 'file: ' + r.file : 'embedded in the project file'})`).join(', '));
  return L.length ? ['Inspiration I attached (open and look at each one before designing; for a video, pull a few frames with ffmpeg and look at them; copy the look, motion and layout, not logos or someone else\'s content): ' + L.join(' | ')] : []; }
