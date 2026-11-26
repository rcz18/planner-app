import { createPreview } from './engine.js?v=17.9';
import { createTimeline, fmtTC } from './timeline.js?v=17.9';
import { attachTools, wireMic } from './tools.js?v=17.9';
import { openBrand, brandText, brandCount } from './brand.js?v=17.9';
import { wireRefs, refsText } from './refs.js?v=17.9';
import { openDirect, directOf, directText, lookText, directCount } from './direct.js?v=17.2';
import { openIdeas, ideaText, ideaBeats } from './ideas.js?v=17.2';
import { openProgress, sound, kindName } from './progress.js?v=17.9';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = [{ description: 'Planner project', accept: { 'application/json': ['.planner'] } }];
const VIDEO_TYPES = [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] } }];
const canFS = 'showOpenFilePicker' in window;

/* ---------- tiny IndexedDB store: recent projects, linked folders ---------- */
const idb = () => new Promise((r, j) => { const q = indexedDB.open('planner-app', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
async function kvGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); } catch (e) { return undefined; } }
async function kvSet(k, v) { try { const d = await idb(); await new Promise(r => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = r; t.onerror = r; }); } catch (e) {} }

/* ---------- state ----------
   A project holds one or more sequences (e.g. H1…H13). Each sequence has its own video, plan, review and timeline edits. */
let P = null;            // open project
let S = null;            // current sequence
const orig = {};         // Claude's plan per sequence, saved back unchanged
let fh = null, savedSig = '';
let pv = null, tl = null, tools = null, mediaURL = null, refs = null;

const sig = () => P ? JSON.stringify([P.sequences.filter(s => !s.mirror).map(s => [s.review, s.timeline]), P.brand || null]) : '';
let brandBase = 'null';   // the brand as it was last read from / written to the file (so Claude's brand updates come in when you haven't edited it)
const dirty = () => P && sig() !== savedSig;
function status(t) { if (t) console.log('[Planner]', t); $('#msg').textContent = t || ''; clearTimeout(status._t); if (t) status._t = setTimeout(() => $('#msg').textContent = '', 7000); }
function paintTitle() {
  const name = fh ? fh.name : (P ? (P.name || 'Untitled') + '.planner' : '');
  $('#fileName').innerHTML = P ? `${esc(name)} ${dirty() ? '<span class="dirty">● not saved</span>' : '<span class="ok">saved</span>'}` : '';
  document.title = P ? `${dirty() ? '● ' : ''}${name} · Planner` : 'Planner';
  if (P) paintTabs();
}
setInterval(paintTitle, 800);

function normalize(data) {
  if (!data) return null;
  if (data.brand !== undefined && (typeof data.brand !== 'object' || Array.isArray(data.brand))) delete data.brand;
  if (!Array.isArray(data.sequences)) {           // single-sequence file (planner/1)
    if (!Array.isArray(data.beats)) return null;
    const { format, id, name, client, ...seq } = data;
    data = { format: 'planner/2', id: id || 'project', name, client, sequences: [{ id: seq.seq || 'seq1', label: seq.label || name, ...seq }] };
  }
  data.sequences.forEach(s => { s.review ||= {}; s.review.picks ||= {}; s.review.notes ||= {}; s.review.general ||= ''; s.review.moves ||= {}; s.review.cams ||= []; s.review.drawings ||= []; s.review.media ||= []; directOf(s.review); s.review.looks ||= {}; s.timeline ||= {}; });
  return data;
}

/* ---------- open / save ---------- */
function serialize(request) {
  const out = JSON.parse(JSON.stringify({ ...P, sequences: P.sequences.map(s => ({ ...s, beats: orig[s.id] })) }));
  out.sequences.forEach(s => Object.entries(s.review?.moves || {}).forEach(([k, m]) => { if (!m || m.x == null || m.y == null) { if (m && Math.abs((m.s || 1) - 1) > .001) { m.x = m.x ?? 0; m.y = m.y ?? 0; } else delete s.review.moves[k]; } }));
  out.current = S && S.id; out.savedAt = new Date().toISOString();
  if (request) out.request = request; else delete out.request;
  return JSON.stringify(out, null, 1);
}
async function writeFile(handle, text) {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('No permission to save this file');
  const w = await handle.createWritable(); await w.write(text); await w.close();
}
const seqKey = s => JSON.stringify([s.version, s.badge, s.beats, s.css, s.media, s.suggest || null, s.ideas || null, s.mirror || null]);
let lastRequest = null;
/* before writing: take every tab Claude changed on disk since we read it (keep your fresh edits only for the tab(s) in this request) */
async function mergeDisk(request) {
  let data; try { const f = await withTimeout(fh.getFile(), 15000, 'Reading the file'); data = normalize(JSON.parse(await f.text())); } catch (e) { return false; }
  if (!data) return false; let cur = false;
  takeBrand(data);
  const mine = new Set(request ? [request.sequence].concat(request.sequences || []) : []);
  data.sequences.forEach(ds => { const i = P.sequences.findIndex(x => x.id === ds.id);
    if (i < 0) { orig[ds.id] = JSON.parse(JSON.stringify(ds.beats)); P.sequences.push(ds); return; }
    const x = P.sequences[i]; if (x.mirror || seqKey({ ...x, beats: orig[x.id] }) === seqKey(ds)) return;
    if (mine.has(x.id) || editCount(x)) { ds.review = x.review; ds.timeline = x.timeline; }
    if (x.history && x.history.length && !(ds.history && ds.history.length >= x.history.length)) ds.history = x.history;
    orig[ds.id] = JSON.parse(JSON.stringify(ds.beats)); P.sequences[i] = ds; delete last[ds.id]; if (x === S) { S = ds; cur = true; } });
  return cur;
}
async function save(request) {
  if (!P) return false;
  try { if (!fh) return await saveAs(request);
    const cur = await mergeDisk(request);
    if (request) lastRequest = request;
    await writeFile(fh, serialize(request)); savedSig = sig(); brandBase = JSON.stringify(P.brand || null); paintTitle(); status('Saved ' + fh.name + ' ✓');
    try { lastFileStamp = (await fh.getFile()).lastModified; } catch (e) {}
    if (cur) await switchSeq(S.id);
    return true;
  } catch (e) { if (e?.name !== 'AbortError') status('Could not save: ' + (e?.message || e)); return false; }
}
async function saveAs(request) {
  if (!P) return false;
  try { const h = await window.showSaveFilePicker({ id: 'planner', suggestedName: (P.name || 'project').replace(/[\\/:*?"<>|·]+/g, '-').replace(/\s+/g, ' ').trim() + '.planner', types: TYPES });
    fh = h; if (request) lastRequest = request; await writeFile(h, serialize(request)); savedSig = sig(); brandBase = JSON.stringify(P.brand || null); await addRecent(h); paintTitle(); status('Saved ' + h.name + ' ✓'); return true;
  } catch (e) { if (e?.name !== 'AbortError') status('Could not save: ' + (e?.message || e)); return false; }
}
async function openPicker() {
  if (!canFS) { $('#fileInput').click(); return; }
  try { const [h] = await window.showOpenFilePicker({ id: 'planner', types: TYPES }); await openHandle(h); }
  catch (e) { if (e?.name !== 'AbortError') status('Could not open: ' + (e?.message || e)); }
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' took too long')), ms))]);
async function openHandle(h) {
  const step = t => console.log('[Planner open]', t);
  try {
    step('permission'); let perm = 'granted';
    try { perm = await withTimeout(h.queryPermission?.({ mode: 'readwrite' }) ?? Promise.resolve('granted'), 5000, 'Checking permission');
      if (perm !== 'granted') perm = await h.requestPermission?.({ mode: 'readwrite' }); } catch (e) { step('permission: ' + e.message); }
    step('reading ' + h.name);
    const file = await withTimeout(h.getFile(), 20000, 'Reading the file');
    const text = await withTimeout(file.text(), 20000, 'Reading the file');
    let data; try { data = normalize(JSON.parse(text)); } catch (e) { throw new Error('The file is not a valid planner project (' + e.message + ')'); }
    if (!data) throw new Error('That is not a planner project');
    if (!(await confirmDiscard())) return;
    step('loading');
    fh = h;
    try { await withTimeout(addRecent(h), 3000, 'Updating Recent'); } catch (e) { step('recent: ' + e.message); }
    await load(data);
    step('done');
  } catch (e) {
    console.error('[Planner open] failed', e);
    if (await ask('Could not open the project: ' + (e?.message || e) + '\n\nTry the other way to open it?', 'Open another way', 'Close')) $('#fileInput').click();
  }
}
async function confirmDiscard() { if (!dirty()) return true; return await ask('This project has changes that are not saved. Continue and lose them?', 'Discard changes', 'Cancel'); }
async function addRecent(h) { const list = (await kvGet('recent')) || []; const rest = []; for (const r of list) { try { if (!(await r.h.isSameEntry(h))) rest.push(r); } catch (e) {} } rest.unshift({ h, name: h.name, at: Date.now() }); await kvSet('recent', rest.slice(0, 12)); }

/* ---------- media: link the project folder once, every sequence finds its video inside it ---------- */
async function fileFromFolder(dir, rel) {
  const parts = String(rel || '').split(/[\\/]+/).filter(Boolean); if (!parts.length) return null;
  /* works whether you picked the project folder or the media folder itself */
  for (let start = 0; start < parts.length; start++) {
    try { let d = dir; for (let i = start; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
      return await (await d.getFileHandle(parts[parts.length - 1])).getFile(); } catch (e) {}
  }
  return null;
}
async function findMedia(seq, interactive) {
  const rel = seq.media && seq.media.video; const fkey = 'folder:' + P.id, vkey = 'media:' + P.id + ':' + seq.id;
  const dir = await kvGet(fkey);
  if (dir) { try { let p = await dir.queryPermission({ mode: 'read' }); if (p !== 'granted' && interactive) p = await dir.requestPermission({ mode: 'read' });
      if (p === 'granted') { const f = await fileFromFolder(dir, rel); if (f) return f; } else return { need: 'allow' }; } catch (e) {} }
  const vh = await kvGet(vkey);
  if (vh) { try { let p = await vh.queryPermission({ mode: 'read' }); if (p !== 'granted' && interactive) p = await vh.requestPermission({ mode: 'read' }); if (p === 'granted') return await vh.getFile(); return { need: 'allow' }; } catch (e) {} }
  return { need: 'link' };
}
function showLink(seq, need) {
  const box = $('#linkMedia'); box.hidden = false;
  box.innerHTML = `<div><b>${need === 'allow' ? 'Allow the project folder again' : need === 'slow' ? 'The video folder is not answering' : 'Link the project folder'}</b>${need === 'slow' ? '<p>Google Drive (J:) did not answer in time. Restart Google Drive, then reopen the project, or choose the video below.</p>' : ''}
    <p>Choose the <b>Planner App</b> folder (or its <b>media</b> folder). It holds <b>${esc(seq.media?.video || 'the video')}</b>${P.sequences.length > 1 ? ' (one time for all ' + P.sequences.length + ' sequences)' : ''}.</p>
    <button type="button" class="btn primary" id="linkFolder">${need === 'allow' ? 'Allow' : need === 'slow' ? 'Try again' : 'Choose folder…'}</button> <button type="button" class="btn" id="linkFile">Choose just this video…</button></div>`;
  $('#linkFolder').onclick = async () => {
    try { if (need !== 'allow' && need !== 'slow') { const d = await window.showDirectoryPicker({ id: 'planner-folder', mode: 'read' }); await kvSet('folder:' + P.id, d); }
      const f = await findMedia(seq, true); if (f instanceof File) mount(f); else if (need !== 'allow') status('Could not find ' + (seq.media?.video || 'the video') + ' in that folder. Pick the folder that has the “media” folder in it.');
    } catch (e) { if (e?.name !== 'AbortError') status('Could not link: ' + (e?.message || e)); } };
  $('#linkFile').onclick = async () => { try { const [h] = await window.showOpenFilePicker({ id: 'planner-media', types: VIDEO_TYPES }); await kvSet('media:' + P.id + ':' + seq.id, h); mount(await h.getFile()); } catch (e) {} };
}

/* ---------- load a project / switch sequence ---------- */
async function load(data) {
  tl && tl.destroy(); tools && tools.destroy(); tl = tools = null;
  P = data; Object.keys(orig).forEach(k => delete orig[k]); brandBase = JSON.stringify(P.brand || null); closeBrand();
  P.sequences.forEach(s => { orig[s.id] = JSON.parse(JSON.stringify(s.beats)); });
  savedSig = sig();
  $('#start').hidden = true; $('#work').hidden = false; $('#renderBtn').hidden = false; $('#applyAllBtn').hidden = false; $('#brandBtn').hidden = false; paintBrandBtn(); helperPing();
  Object.keys(hist).forEach(k => delete hist[k]); Object.keys(redo).forEach(k => delete redo[k]); Object.keys(last).forEach(k => delete last[k]);
  paintTitle();
  await switchSeq((P.current && P.sequences.find(s => s.id === P.current)) ? P.current : P.sequences[0].id);
  try { lastFileStamp = fh ? (await fh.getFile()).lastModified : 0; } catch (e) {}
  Object.keys(jobs).forEach(k => delete jobs[k]); firstPoll = true; pollSoon(500);
}
async function switchSeq(id) {
  const seq = P.sequences.find(s => s.id === id); if (!seq) return;
  closeDirect(); closeIdeas(); if (trying && trying.seq !== id) endTry(false);
  if (pv) pv.video.pause();
  tl && tl.destroy(); tools && tools.destroy(); tl = tools = null;
  S = seq; P.current = id;
  if (S.mirror) deriveMirror(S); else if (!(S.id in last)) last[S.id] = snap(S);
  $('#reviseBtn').disabled = $('#approveBtn').disabled = !!S.mirror; $('.side').classList.toggle('ro', !!S.mirror); paintApprove();
  $('#projTitle').textContent = `${P.name || ''}${P.sequences.length > 1 ? ' · ' + (S.name || S.id.toUpperCase()) : ''}`;
  $('#projBadge').textContent = S.badge || S.version || ''; $('#projBadge').hidden = !(S.badge || S.version); paintPrev();
  $('#sendMsg').textContent = '';
  paintTabs(); paintBeats();
  const mine = S; let f;
  try { f = await withTimeout(findMedia(S, false), 8000, 'Finding the video'); } catch (e) { console.warn('[Planner] video:', e.message); f = { need: 'slow' }; }
  if (S !== mine) return;
  if (f instanceof File) mount(f); else { mount(null); showLink(S, f.need); }
}
const KEEP = Symbol('keep video');
function mount(file) {
  closeDirect();
  if (file !== KEEP) {
    if (file) $('#linkMedia').hidden = true;
    if (mediaURL) URL.revokeObjectURL(mediaURL);
    mediaURL = file ? URL.createObjectURL(file) : '';
  }
  tl && tl.destroy(); tools && tools.destroy(); tools = null;
  S.beats = JSON.parse(JSON.stringify(orig[S.id]));
  let proj = S; const tr = trying && trying.seq === S.id ? trying : null;
  if (tr) { const t = ideaBeats(orig[S.id], tr.idea); S.beats = t.beats; proj = { ...S, css: (S.css || '') + '\n' + t.css }; }
  if (!tr) applyLayers(S.beats, S.review.layers);
  paintTry();
  if (pv && pv.dispose) pv.dispose();
  pv = createPreview($('#monitor'), proj, mediaURL);
  const ro = !!S.mirror;
  tl = createTimeline($('#timeline'), S, pv, { onChange: changedNow, onUndo: undo, status,
    onMedia: (k, m) => { if (!tools) return; if (k === 'move') tools.sync(); else if (k === 'select' && !ro) { tools.use('move'); tools.pick('m:' + m.id); } },
    onSelect: (keys, main) => { if (!tools || ro) return; if (keys.length) tools.use('move'); tools.selectKeys(keys, main); },
    onLayers: ro ? null : setLayerOrder, onDelete: ro ? null : deleteLayer, onAddLayer: ro ? null : addLayer, onMute: ro ? null : muteLayers, ro });
  tools = attachTools({ P: S, pv, tl, host: $('#monitor'), bar: $('#tools'), hint: $('#toolHint'), onChange: changedNow, onAddMedia: addMedia, mediaSrc, onDelete: ro ? null : deleteLayer });
  $('#tools').hidden = !!S.mirror; if (S.mirror) $('#toolHint').textContent = 'View only: this tab shows P1–P8 back to back, with every change you make in those tabs.';
  pv.video.addEventListener('timeupdate', markBeat); pv.video.addEventListener('seeked', markBeat);
  if (S.mirror) { const pb = $('#timeline .tlPlay'); if (pb) { const b = document.createElement('button'); b.type = 'button'; b.className = 'tlBtn tlRefresh'; b.textContent = '⟳ Refresh FULL'; b.title = 'Get the newest P tabs into FULL'; b.onclick = refreshFull; pb.after(b); } }
}
/* ---------- layers (timeline): your order, deleted layers and new text layers, kept in review.layers ---------- */
function applyLayers(beats, L) { if (!L) return beats;
  const del = new Set(L.deleted || []), mute = new Set(L.mute || []);
  beats.forEach(b => b.els.forEach((e, i) => { if (del.has(b.id + ':' + i)) e._del = true; }));
  (L.added || []).forEach(a => { const b = beats.find(x => a.t0 >= x.t0 && a.t0 < x.t1) || beats[beats.length - 1]; if (!b) return;
    b.els.push({ _uid: a.id, in: a.t0, out: a.t1, cls: 'uLayer', pos: 'left:0;right:0;top:62%;display:flex;justify-content:center', html: `<div class="uTxt">${esc(a.text)}</div>` }); });
  /* Mute (Shift+E): every key in L.mute is switched the other way from the plan (off ↔ on) */
  if (mute.size) beats.forEach(b => b.els.forEach((e, i) => { const k = e._uid ? 'u:' + e._uid : b.id + ':' + i; if (mute.has(k)) e._off = !e.off; }));
  return beats; }
const cleanLayers = R => { const L = R.layers; if (!L) return; ['deleted', 'added', 'order', 'mute'].forEach(x => { if (L[x] && !L[x].length) delete L[x]; }); if (!Object.keys(L).length) delete R.layers; };
/* rebuild the preview + timeline, keeping the time, the tool and the selection */
function remount(k) { if (!S || !pv) return; const t = pv.time(), m = tools && tools.mode ? tools.mode() : '';
  mount(KEEP); const go = () => pv.seek(t);
  go(); if (pv.video.readyState < 1) pv.video.addEventListener('loadedmetadata', go, { once: true });
  if (m && tools) tools.use(m); if (k) { tl.selectKey && tl.selectKey(k); if (m === 'move' && tools) tools.pick(k); } }
function setLayerOrder(order, k) { if (!S || S.mirror) return; (S.review.layers ||= {}).order = order; changedNow(); remount(k); status('Layer moved · Ctrl+Z to undo'); }
function deleteLayer(ks) { if (!S || S.mirror || !ks) return; const R = S.review; ks = [].concat(ks); let n = 0;
  ks.forEach(k => {
    if (k.startsWith('m:')) { const i = (R.media || []).findIndex(x => 'm:' + x.id === k); if (i >= 0) { R.media.splice(i, 1); n++; } return; }
    const L = R.layers ||= {};
    if (k.startsWith('u:')) L.added = (L.added || []).filter(a => 'u:' + a.id !== k); else { L.deleted ||= []; if (!L.deleted.includes(k)) L.deleted.push(k); }
    delete S.timeline[k]; if (R.moves) delete R.moves[k]; if (L.order) L.order = L.order.filter(x => x !== k); n++; });
  cleanLayers(R); changedNow(); remount(); status((n > 1 ? n + ' layers' : 'Layer') + ' deleted · Ctrl+Z to undo'); }
function addLayer(kind, text, t) { if (!S || S.mirror) return;
  if (kind === 'media') { $('#tools .addMedia')?.click(); return; }
  t = Math.max(0, Math.min(S.duration - 0.2, +t || 0)); const id = 't' + Date.now().toString(36);
  ((S.review.layers ||= {}).added ||= []).push({ id, text, t0: +t.toFixed(3), t1: +Math.min(S.duration, t + 2).toFixed(3) });
  changedNow(); if (tools) tools.use('move'); remount('u:' + id); status('Text layer added · drag it, resize it, trim it on the timeline'); }
function muteLayers(ks) { if (!S || S.mirror || !ks || !ks.length) return; const R = S.review; let nowOff = null;
  const elOf = k => { if (k.startsWith('u:')) { for (const b of S.beats) { const e = b.els.find(x => 'u:' + x._uid === k); if (e) return e; } return null; } const [bid, i] = k.split(':'); const b = S.beats.find(x => x.id === bid); return b && b.els[+i]; };
  ks.forEach(k => {
    if (k.startsWith('m:')) { const m = (R.media || []).find(x => 'm:' + x.id === k); if (!m) return; m.off = !m.off; if (!m.off) delete m.off; if (nowOff === null) nowOff = !!m.off; return; }
    const e = elOf(k), wasOff = e ? (e._off !== undefined ? !!e._off : !!e.off) : false; if (nowOff === null) nowOff = !wasOff;
    const L = R.layers ||= {}; L.mute ||= []; const i = L.mute.indexOf(k); if (i >= 0) L.mute.splice(i, 1); else L.mute.push(k); });
  cleanLayers(R); changedNow(); remount(ks[0]); status((ks.length > 1 ? ks.length + ' layers ' : 'Layer ') + (nowOff ? 'muted (off)' : 'on again') + ' · Shift+E to switch back'); }
const plainLabel = e => { if (e.three) return '3D ' + (e.three.scene || 'scene') + ((e.three.opts || {}).half ? ' ' + e.three.opts.half : ''); const t = document.createElement('div'); t.innerHTML = e.html || ''; t.querySelectorAll('[aria-hidden="true"],style,script,svg').forEach(x => x.remove()); const s2 = (t.textContent || '').replace(/\s+/g, ' ').trim(); return s2 ? s2.slice(0, 40) : 'graphic ' + ((e.cls || '').split(' ')[0] || ''); };
function layersText(s) { const L = s.review.layers; if (!L) return []; const out = [], base = orig[s.id] || [], del = L.deleted || [];
  const elAt = k => { const [bid, i] = k.split(':'); const b = base.find(x => x.id === bid); return b && b.els[+i]; };
  const added = k => (L.added || []).find(x => 'u:' + x.id === k);
  const name = k => k.startsWith('u:') ? `my text “${(added(k) || {}).text || ''}”` : `${k.split(':')[0]} el#${k.split(':')[1]} “${elAt(k) ? plainLabel(elAt(k)) : '?'}”`;
  if (del.length) out.push('Deleted layers (remove them from the plan): ' + del.map(name).join('; '));
  (L.added || []).forEach(a => { const k = 'u:' + a.id, tm = (s.timeline || {})[k], mv = (s.review.moves || {})[k];
    out.push(`My new text layer “${a.text}”: show ${(tm ? +tm.in : a.t0).toFixed(2)}–${(tm ? +tm.out : a.t1).toFixed(2)} s, centered across the frame at 62% height${mv ? `, then moved x${mv.x >= 0 ? '+' : ''}${mv.x} y${mv.y >= 0 ? '+' : ''}${mv.y} (cqw of frame width)${Math.abs((mv.s || 1) - 1) > .001 ? ', size ' + Math.round(mv.s * 100) + '%' : ''}` : ''}. Build it in the brand text style at exactly that place and time.`); });
  if ((L.mute || []).length) { const isOffInPlan = k => { const e = elAt(k); return !!(e && e.off); };
    const off = L.mute.filter(k => !isOffInPlan(k)), on = L.mute.filter(isOffInPlan);
    if (off.length) out.push('Muted layers (Shift+E): keep them in the plan but switched off (set off: true on the element; never render them): ' + off.map(name).join('; '));
    if (on.length) out.push('Unmuted layers: switch them back on (remove off from the element): ' + on.map(name).join('; ')); }
  if ((L.order || []).length) out.push('Layer order I set (back → front, keep exactly; later = in front): ' + L.order.filter(k => !del.includes(k) && (!k.startsWith('u:') || added(k))).map(name).join(' · '));
  return out; }

/* Refresh FULL: read the newest P tabs from the project file (unless you have unsaved edits in a tab), then rebuild FULL */
async function refreshFull() {
  if (!S || !S.mirror) return; const id = S.id, t = pv ? pv.time() : 0, wasDirty = dirty(); let n = 0;
  status('Refreshing FULL…');
  if (fh) { try { const f = await withTimeout(fh.getFile(), 15000, 'Reading the file'); const data = normalize(JSON.parse(await f.text()));
      (data ? data.sequences : []).forEach(s => { if (s.mirror) return; const i = P.sequences.findIndex(x => x.id === s.id);
        if (i < 0) { orig[s.id] = JSON.parse(JSON.stringify(s.beats)); P.sequences.push(s); n++; return; }
        const x = P.sequences[i]; if (editCount(x) || JSON.stringify([x.version, orig[x.id]]) === JSON.stringify([s.version, s.beats])) return;
        orig[s.id] = JSON.parse(JSON.stringify(s.beats)); P.sequences[i] = s; delete last[s.id]; delete hist[s.id]; delete redo[s.id]; n++; });
      lastFileStamp = f.lastModified;
    } catch (e) { status('Could not read the project file: ' + e.message); } }
  if (!wasDirty) savedSig = sig();
  await switchSeq(id); paintTabs(); setTimeout(() => { try { tl && tl.seek(t); } catch (e) {} }, 300);
  status(n ? `FULL refreshed ✓ ${n} tab${n > 1 ? 's' : ''} updated` : 'FULL refreshed ✓ already up to date');
}
function markBeat() { const t = pv.time(); document.querySelectorAll('.beat').forEach(c => c.classList.toggle('live', t >= +c.dataset.t0 && t < +c.dataset.t1)); }

/* ---------- sequence tabs ---------- */
function paintTabs() {
  const bar = $('#seqTabs'); if (!P) { bar.hidden = true; paintJobBar(); return; } bar.hidden = false;
  const html = P.sequences.map(s => { const r = s.review, n = s.mirror ? 0 : editCount(s);
    return `<button type="button" class="seqTab${s === S ? ' cur' : ''}${r.approved ? ' appr' : ''}" data-seq="${esc(s.id)}" title="${esc(s.label || '')}"><b>${esc(s.name || s.id.toUpperCase())}${r.approved ? ' <i class="ok">✓</i>' : ''}</b><span>${esc(s.label || '')}</span>${n ? '<i class="edits" title="Has your edits"></i>' : ''}</button>`; }).join('');
  const pend = Object.values(jobs).filter(j => j.state !== 'done' && !P.sequences.some(s => (s.name || '').toLowerCase() === j.seq.toLowerCase())).map(j =>
    `<div class="seqTab pend" title="${esc(j.step || '')}"><b>${esc(j.seq)}</b><span>being made…</span></div>`).join('');
  const all = html + pend + `<button type="button" class="seqTab newSeq" data-new="1" title="Ask Claude to plan a new sequence"><b>＋ New</b><span>ask Claude</span></button>`;
  if (bar._h !== all) { bar.innerHTML = all; bar._h = all; }
  paintJobBar();
}
/* one progress bar for everything Claude is working on (next to Apply all changes) */
function paintJobBar() {
  const jb = $('#jobBar'); if (!jb) return;
  const hcur = hq && hq.job && hq.job.state === 'running' ? hq.job : null;
  if (P && hq && (hcur || hq.queue.length)) {   // the helper's queue knows exactly what runs now and what waits
    const lp = hcur ? Math.round(+hcur.pct || 0) : 0, n = hq.queue.length;
    jb.hidden = false; jb.className = 'jobBar'; jb.querySelector('i').style.width = Math.max(3, lp) + '%';
    jb.querySelector('span').textContent = hcur ? `${hcur.seq === 'all' ? 'All' : hcur.seq} · ${kindName(hcur.kind)} · ${hcur.step || ''} · ${lp}%${n ? ` · +${n} in line` : ''}` : `Starting the next one… · ${n} in line`;
    jb.title = 'Click to see the progress and the queue'; return;
  }
  const act = Object.values(jobs).filter(j => j.state !== 'done' || j._fresh);
  if (!P || !act.length) { jb.hidden = true; return; }
  const pct = Math.round(act.reduce((a, j) => a + Math.max(0, Math.min(100, +j.pct || 0)), 0) / act.length);
  const err = act.find(j => j.state === 'error'), busy = act.filter(j => j.state !== 'done'), done = !busy.length;
  const lead = err || busy.find(j => j.state === 'working') || busy[0] || act[0];
  const names = act.map(j => j.seq).join(', ');
  jb.hidden = false; jb.className = 'jobBar' + (err ? ' err' : done ? ' done' : '');
  jb.querySelector('i').style.width = (done ? 100 : pct) + '%';
  const waiting = busy.filter(j => j.state === 'waiting' && j !== lead).length, lp = Math.round(+lead.pct || 0);
  jb.querySelector('span').textContent = err ? `Problem: ${err.step || ''}` : done ? `Done ✓ ${names}` : `${lead.seq} · ${lead.step || 'Waiting…'} · ${lp}%${waiting ? ` · +${waiting} in line` : ''}`;
  jb.querySelector('i').style.width = (done ? 100 : Math.max(3, lp)) + '%';
  jb.title = act.map(j => `${j.seq}: ${j.step || ''} ${j.state === 'done' ? '✓' : (+j.pct || 0) + '%'}`).join('\n');
}
$('#seqTabs').onclick = e => { if (e.target.closest('[data-new]')) { newSeqDialog(); return; } const b = e.target.closest('[data-seq]'); if (b && P && b.dataset.seq !== S.id) switchSeq(b.dataset.seq); };


/* ---------- Claude Code on this computer (Planner Helper: helper/setup.ps1 on Windows, helper/setup-mac.sh on Mac) ---------- */
const HELPER = 'http://127.0.0.1:47321';
const IS_MAC = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
const SETUP_CMD = IS_MAC ? 'curl -fsSL https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup-mac.sh | bash'
  : 'irm https://raw.githubusercontent.com/rcz18/planner-app/main/helper/setup.ps1 | iex';
let helper = null, helperJobT = null;
const hfetch = (p, o = {}) => fetch(HELPER + p, { cache: 'no-store', targetAddressSpace: 'loopback', ...o });
async function helperPing() {
  try { const r = await hfetch('/status'); helper = r.ok ? await r.json() : null; } catch (e) { helper = null; }
  if (helper && helper.queue && !hqT) watchQueue();
  paintHelper(); return helper;
}
function paintHelper() {
  const b = $('#ccBadge'); if (!b) return; const on = !!(helper && helper.claude);
  b.hidden = !P; b.className = 'ccBadge' + (on ? ' on' : '') + (helperOld() ? ' old' : '');
  b.textContent = on ? (helper.busy ? '● Claude Code · working' : helperOld() ? '● Claude Code · update' : '● Claude Code') : '○ Claude chat';
  b.title = helperOld() ? `Planner Helper ${helper.helper} is old: it can't use the model and effort you pick beside Revise. Click to copy the update command.`
    : on ? `Claude Code on this computer does your requests (Planner Helper ${helper.helper}). Projects folder: ${helper.root}`
    : helper ? 'The Planner Helper is running but Claude Code is not installed. Click to copy the setup command again.'
    : 'Requests are copied for the Claude chat. Click to copy the setup command that lets Claude Code on this computer do them.';
}
/* Revise: which Claude does it. Claude Code on this computer runs with this model and effort (Planner Helper 1.3+); remembered on this computer */
const CC_MODELS = { 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-2': 'Fable 5.2' };
const CC_EFFORTS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
const CC_MIN = '1.3.0';
const ccGet = (k, list, def) => { let v = null; try { v = localStorage.getItem(k); } catch (e) {} return v && list[v] ? v : def; };
const ccSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
$('#ccModel').value = ccGet('planner.ccModel', CC_MODELS, 'claude-opus-5-5');
$('#ccEffort').value = ccGet('planner.ccEffort', CC_EFFORTS, 'xhigh');
$('#ccModel').onchange = () => ccSet('planner.ccModel', $('#ccModel').value);
$('#ccEffort').onchange = () => ccSet('planner.ccEffort', $('#ccEffort').value);
const ccChoice = () => ({ model: $('#ccModel').value, effort: $('#ccEffort').value });
const ccLabel = c => `${CC_MODELS[c.model] || c.model} · ${CC_EFFORTS[c.effort] || c.effort}`;
const verAtLeast = (v, min) => { const a = String(v || '0').split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return true; };
const helperOld = () => !!(helper && helper.claude && !verAtLeast(helper.helper, CC_MIN));
/* send a saved request: straight to Claude Code when the helper runs, otherwise copy it for the Claude chat */
async function dispatch(line, names, cc) {
  if ((helper && helper.claude) || (await helperPing())?.claude) {
    try {
      const r = await hfetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: fh.name, project: P.id, command: line, request: lastRequest, ...(cc || {}) }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      names.forEach(n => { const k = n.toLowerCase(); jobs[k] = { ...(jobs[k] || { seq: n }), seq: n, pct: 0, state: 'waiting', step: j.position > 1 ? `In line #${j.position}` : 'Starting…', hid: j.id, since: new Date().toISOString() }; });
      watchQueue(); return 'code';
    } catch (e) { status('Claude Code: ' + e.message + ' (copied for the chat instead)'); }
  }
  try { await navigator.clipboard.writeText(line); return 'copied'; } catch (e) { return 'type'; }
}
function sentText(mode, line, extra = '', cc = null) {
  if (mode === 'code') return `Claude Code${cc ? ' (' + esc(ccLabel(cc)) + ')' : ''} is on it ✓ ${extra} Watch the progress bar at the top; the tab updates by itself.`
    + (cc && helperOld() ? `<br>⚠ Your Planner Helper (${esc(helper.helper)}) is old, so it used its own model and effort. Click the yellow <b>● Claude Code · update</b> badge at the top to update it.` : '');
  return (mode === 'copied' ? 'Now paste in the Claude chat (' + (IS_MAC ? 'Cmd+V' : 'Ctrl+V') + ') and send.' : 'Now type in the Claude chat: <b>' + esc(line) + '</b>') + ' ' + extra
    + (cc ? ` In the chat, pick <b>${esc(CC_MODELS[cc.model] || cc.model)}</b> and effort <b>${esc(CC_EFFORTS[cc.effort] || cc.effort)}</b> first.` : '');
}
/* ---------- the helper's queue: one request after another, a sound when each is done ---------- */
let hq = null, hqT = null, doneSeen = null, hadWork = false, progWin = null;
async function fetchQueue() { try { const r = await hfetch('/queue'); if (!r.ok) return null; const d = await r.json(); return d && d.history ? d : null; } catch (e) { return null; } }
function watchQueue() { clearTimeout(hqT); hqT = setTimeout(tickQueue, 600); }
async function tickQueue() {
  const d = await fetchQueue(); hq = d;
  if (!d) { hqT = setTimeout(tickQueue, 5000); return; }
  if (!doneSeen) doneSeen = new Set(d.history.map(h => h.id));
  const cur = d.job && d.job.state === 'running' ? d.job : null, label = j => (j.seq === 'all' ? 'All' : j.seq);
  const touch = (j, o) => { const k = String(label(j)).toLowerCase(); jobs[k] = { ...(jobs[k] || {}), seq: label(j), hid: j.id, ...o }; };
  if (cur) { hadWork = true; touch(cur, { state: 'working', pct: cur.pct, step: `${kindName(cur.kind)} · ${cur.step || ''}`, since: cur.started }); }
  d.queue.forEach((j, i) => { hadWork = true; touch(j, { state: 'waiting', pct: 0, step: `${kindName(j.kind)} · in line #${i + (cur ? 2 : 1)}`, since: j.queuedAt }); });
  let newDone = false;
  for (const h of d.history) { if (doneSeen.has(h.id)) continue; doneSeen.add(h.id);
    if (h.state === 'cancelled') { const k = String(label(h)).toLowerCase(); if (jobs[k] && jobs[k].hid === h.id) delete jobs[k]; continue; }
    newDone = true; const ok = h.state === 'done';
    touch(h, ok ? { state: 'done', pct: 100, step: 'Done', at: h.ended, _fresh: true, _doneAt: Date.now() } : { state: 'error', step: h.step });
    ok ? sound.ding() : sound.err();
    if (h.result && h.result.text) status('Claude Code: ' + h.result.text.split('\n')[0].slice(0, 160)); }
  if (newDone && fh) { lastFileStamp = 0; try { await pullNewSequences(); } catch (e) {} }
  const busy = !!cur || d.queue.length > 0;
  if (!busy && hadWork && newDone) { hadWork = false; setTimeout(() => sound.all(), 700); }
  paintTabs();
  hqT = setTimeout(tickQueue, busy ? 1500 : 6000);
}
$('#jobBar').onclick = () => { if (progWin) return;
  progWin = openProgress({ get: () => hq, jobsFallback: () => Object.values(jobs),
    cancel: async id => { try { await hfetch('/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); } catch (e) {} tickQueue(); },
    stop: async () => { try { await hfetch('/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) {} tickQueue(); },
    onClose: () => { progWin = null; } }); };

/* ---------- progress from Claude: Claude writes "Planner App/planner-status.json" while it works ---------- */
const jobs = {};             // seq name (lower case) → { seq, pct, step, state }
let pollT = null, lastFileStamp = 0, firstPoll = true;
function pollSoon(ms = 1500) { clearTimeout(pollT); pollT = setTimeout(poll, ms); }
async function poll() {
  if (!P) return;
  try {
    const dir = await kvGet('folder:' + P.id);
    if (dir && (await dir.queryPermission({ mode: 'read' })) === 'granted') {
      const f = await fileFromFolder(dir, 'Planner App/planner-status.json');
      if (f) { const st = JSON.parse(await f.text()); (st.jobs || []).filter(j => !j.project || j.project === P.id).forEach(j => { const k = String(j.seq).toLowerCase(), was = jobs[k];
        /* a job we asked for (waiting) must not be closed by an old "done" line from an earlier request */
        if (was && was.state === 'waiting' && j.state === 'done' && (!j.at || j.at < was.since)) return;
        if (j.state === 'done' && !firstPoll && (!was || was.state !== 'done')) { j._fresh = true; j._doneAt = Date.now(); }
        jobs[k] = { ...was, ...j }; }); }
    }
    firstPoll = false;
    Object.values(jobs).forEach(j => { if (j._fresh && Date.now() - j._doneAt > 12000) j._fresh = false; });
    if (fh && Object.values(jobs).some(j => j.state === 'done')) await pullNewSequences();
  } catch (e) {}
  paintTabs();
  const busy = Object.values(jobs).some(j => (j.state !== 'done' && j.state !== 'error') || j._fresh);
  pollSoon(busy ? 2000 : 15000);
}
/* add sequences Claude put in the file, without touching your unsaved edits */
async function pullNewSequences() {
  const f = await fh.getFile(); if (f.lastModified === lastFileStamp) return; lastFileStamp = f.lastModified;
  const data = normalize(JSON.parse(await f.text())); if (!data) return;
  { const was = dirty(); if (takeBrand(data)) { if (!was) savedSig = sig(); status('Brand updated ✓'); } }
  const added = data.sequences.filter(s => !P.sequences.some(x => x.id === s.id));
  const key = s => JSON.stringify([s.version, s.badge, s.beats, s.css, s.media, s.suggest || null, s.ideas || null, s.mirror || null]);
  const done = s => { const j = jobs[(s.name || s.id).toLowerCase()]; return j && j.state === 'done'; };
  const updated = data.sequences.filter(s => { const x = P.sequences.find(y => y.id === s.id); return x && (done(s) || x.mirror || s.mirror || !editCount(x)) && key({ ...x, beats: orig[x.id] }) !== key(s); });
  updated.forEach(s => { const i = P.sequences.findIndex(x => x.id === s.id); orig[s.id] = JSON.parse(JSON.stringify(s.beats)); P.sequences[i] = s; delete last[s.id]; delete hist[s.id]; delete redo[s.id]; });
  const ik = pendingIdeas && updated.find(s => s.id === pendingIdeas);
  if (ik) { pendingIdeas = null; savedSig = sig(); await switchSeq(ik.id); setTimeout(() => startIdeas(), 300);
    const n = ik.name || ik.id.toUpperCase(); status(`4 suggestions for ${n} are ready ✓`); $('#sendMsg').innerHTML = `<b>4 suggestions for ${esc(n)}</b> are ready ✓`; }
  const lk = !ik && pendingLook && updated.find(s => s.id === pendingLook.seq);
  if (ik) {} else if (lk) { const want = pendingLook; pendingLook = null; savedSig = sig(); await switchSeq(lk.id); const b = orig[lk.id].find(x => x.id === want.beat);
    if (b) setTimeout(() => startDirect(b.id), 300);
    const n = lk.name || lk.id.toUpperCase(); status(`Looks for ${n} ${want.beat} are ready ✓`); $('#sendMsg').innerHTML = `<b>Looks for ${esc(n)} ${esc(want.beat)}</b> are ready ✓`; }
  else if (updated.length) { savedSig = sig(); const u = updated.find(s => s.id === S.id) || updated[0];
    await switchSeq(u.id); setTimeout(() => pv && pv.playFrom(0), 400);
    const n = u.name || u.id.toUpperCase(); status(`${n} ${u.version || ''} is ready ✓`);
    $('#sendMsg').innerHTML = `<b>${esc(n)} ${esc(u.version || '')}</b> is ready ✓ playing it now.`; }
  if (!added.length) return;
  added.forEach(s => { orig[s.id] = JSON.parse(JSON.stringify(s.beats)); P.sequences.push(s); });
  savedSig = sig();   // the new tabs come from the file, so they are not unsaved changes
  paintTabs();
  const n = added.map(s => s.name || s.id.toUpperCase()).join(', ');
  status(n + ' is ready ✓'); $('#sendMsg').innerHTML = `<b>${esc(n)}</b> is ready ✓ <button type="button" class="btn" id="openNew">Open ${esc(added[0].name || added[0].id)}</button>`;
  $('#openNew').onclick = () => switchSeq(added[0].id);
}

/* ---------- ask Claude for a new sequence (e.g. H14) ---------- */
function newSeqDialog() {
  const d = $('#newDlg'); const nums = P.sequences.map(s => +((s.name || '').match(/^H(\d+)$/i) || [])[1] || 0).concat(Object.values(jobs).map(j => +(j.seq.match(/^H(\d+)$/i) || [])[1] || 0)); const next = 'H' + (Math.max(0, ...nums) + 1);
  d.querySelector('[name=sname]').value = /^H\d+$/.test(S?.name || '') ? next : ''; d.querySelector('[name=snote]').value = '';
  wireMic(d.querySelector('.mic'), d.querySelector('[name=snote]'));
  d.querySelector('.no').onclick = () => d.close();
  d.querySelector('.yes').onclick = async () => {
    const name = d.querySelector('[name=sname]').value.trim(); if (!name) return;
    const note = d.querySelector('[name=snote]').value.trim(); d.close();
    const ok = await save({ kind: 'new', sequence: name, at: new Date().toISOString(), summary: `New sequence ${name} for ${P.name}. ${note ? 'Notes: ' + note : ''}`.trim() });
    if (!ok) return;
    const line = `/planner new ${name}`;
    jobs[name.toLowerCase()] = { seq: name, pct: 0, step: 'Waiting for Claude', state: 'waiting', since: new Date().toISOString() };
    const mode = await dispatch(line, [name]);
    $('#sendMsg').innerHTML = `Request for <b>${esc(name)}</b> saved in <b>${esc(fh.name)}</b> ✓ ` + sentText(mode, line, 'The new tab opens by itself when it’s ready.');
    status(mode === 'code' ? 'Claude Code is making ' + name : 'Request saved: paste it in the Claude chat');
    if (mode !== 'code') jobs[name.toLowerCase()].step = 'Paste the line in the Claude chat';
    paintTabs(); pollSoon();
  };
  d.showModal();
}

/* ---------- Direct: screenshots + drawings + comments for a whole beat, and Claude's looks ---------- */
let direct = null, pendingLook = null;
function paintDirectBtn() { const btn = $('#directBtn'); if (!btn || !S) return; const d = S.review.direct || {}, n = (d.shots || []).length;
  btn.disabled = !!S.mirror; btn.textContent = `🎬 Direct ${S.name || S.id.toUpperCase()}` + (n ? ` · ${n}` : (d.note || '').trim() ? ' ✓' : ''); }
function closeDirect() { if (direct) { const d = direct; direct = null; d.close(); } }
function startDirect(lookBeat) {
  if (!S || S.mirror || !pv) return; closeDirect();
  $('.side').classList.add('directing');
  direct = openDirect({ S, beats: orig[S.id], lookBeat, pv, tools, mediaURL, pane: $('#directPane'), monBox: $('.monitor'), monitor: $('#monitor'),
    seek: t => tl ? tl.seek(t) : pv.seek(t), status,
    onChange: () => { changedNow(); },
    onSend: () => { closeDirect(); send('revise'); },
    onAskLooks: askLooks,
    busy: bid => { const j = jobs[seqName().toLowerCase()]; return !!(pendingLook && pendingLook.seq === S.id && pendingLook.beat === bid && j && j.state !== 'done' && j.state !== 'error'); },
    saveImage, loadImage: rel => mediaSrc({ id: rel, file: rel }),
    onClose: () => { $('.side').classList.remove('directing'); direct = null; paintBeats(); } });
}
$('#directBtn').onclick = () => startDirect();

/* ---------- ▶ Try a suggestion in the live preview (nothing is saved), then Apply it or go back ---------- */
let trying = null, trySnap = null;
function paintTry() { const b = $('#tryBar'); if (!b) return; const on = !!(trying && S && trying.seq === S.id);
  b.hidden = !on; if (on) b.querySelector('b').textContent = `Trying suggestion ${trying.idea.id} · ${trying.idea.title || ''}`; }
function tryIdea(it) { if (!S) return; closeIdeas(); if (!trying) trySnap = snap(S); trying = { seq: S.id, idea: it }; mount(KEEP);
  setTimeout(() => { const sh = (it.shots || [])[0]; pv && pv.playFrom(sh != null ? Math.max(0, +sh - 1.5) : 0); }, 400);
  status(`Trying ${it.id} “${it.title || ''}”: nothing is saved until you press Apply`); }
function endTry(remount = true) { if (!trying) return; const sid = trying.seq; trying = null;
  if (S && S.id === sid && trySnap) restore(trySnap); trySnap = null; paintTry(); if (remount && S && S.id === sid) mount(KEEP); }
$('#tryBack').onclick = () => { endTry(); status('Back to the original ✓'); };
$('#tryApply').onclick = () => { if (!trying) return; const id = trying.idea.id; endTry(); S.review.idea = id; changedNow(); send('revise'); };
$('#tryMore').onclick = () => { endTry(); startIdeas(); };

/* ---------- ↩ previous version: the app keeps the last 5 versions of each part ---------- */
function remember(list) { const at = new Date().toISOString();
  list.forEach(s => { if (s.mirror) return; const v = { version: s.version || '', badge: s.badge || '', beats: JSON.parse(JSON.stringify(orig[s.id] || s.beats)), css: s.css || '', at };
    const h = (s.history || []).filter(x => x.version !== v.version || x.badge !== v.badge); s.history = [v].concat(h).slice(0, 5); }); }
function paintPrev() { const b = $('#prevBtn'); if (!b || !S) return; const p = (S.history || [])[0]; b.hidden = !p || !!S.mirror; if (p) { b.textContent = `↩ ${p.version || 'previous'}`; b.title = `Go back to ${p.version || 'the previous version'} (${S.version || 'this one'} stays in history so you can come back)`; } }
$('#prevBtn').onclick = async () => {
  const p = (S.history || [])[0]; if (!p) return;
  const j = jobs[seqName().toLowerCase()]; if (j && (j.state === 'working' || j.state === 'waiting') && !/Paste/.test(j.step || '')) { status(`Wait: Claude is still working on ${seqName()}`); return; }
  if (!(await ask(`Go back to ${p.version || 'the previous version'}? ${S.version || 'This version'} stays in history, so you can come back with the same button.`, 'Go back', 'Cancel'))) return;
  endTry(false);
  const cur = { version: S.version || '', badge: S.badge || '', beats: JSON.parse(JSON.stringify(orig[S.id])), css: S.css || '', at: new Date().toISOString() };
  S.history = [cur].concat(S.history.slice(1)); S.version = p.version; S.badge = p.badge; S.css = p.css; orig[S.id] = JSON.parse(JSON.stringify(p.beats));
  P.sequences.filter(x => x.mirror).forEach(F => deriveMirror(F));
  await save(); await switchSeq(S.id); status(`Back to ${p.version} ✓`);
};

/* ---------- 💡 Suggestions from Claude: 4 looks for the whole part, Liked list for every project ---------- */
let ideasWin = null, pendingIdeas = null, likesMem = null;
kvGet('likes').then(v => { likesMem = Array.isArray(v) ? v : []; });
function closeIdeas() { if (ideasWin) { const w = ideasWin; ideasWin = null; w.close(); } }
function paintIdeasBtn() { const b = $('#ideasBtn'); if (!b || !S) return; const n = ((S.ideas || {}).list || []).length; b.disabled = !!S.mirror; b.textContent = '💡 Suggestions' + (n ? ' · ' + n : ''); }
async function setLikes(list, item, added) {
  likesMem = list; await kvSet('likes', list);
  /* the project file keeps the names of what you liked, so Claude learns your taste */
  P.likes ||= []; const k = item && item.key;
  if (k) { P.likes = P.likes.filter(x => x.key !== k); if (added) P.likes.unshift({ key: k, seq: item.seq, id: item.id, title: item.title, skill: item.skill, read: item.read, at: item.at }); }
  P.likes = P.likes.slice(0, 40);   // saved with the next Save / request
}
function startIdeas() {
  if (!S || S.mirror) return; closeIdeas();
  ideasWin = openIdeas({ P, S, beats: orig[S.id], mediaURL, status,
    getLikes: () => likesMem || [], setLikes,
    onGenerate: askIdeas, onApply: () => send('revise'), onChange: changedNow, onTry: tryIdea,
    busy: () => { const j = jobs[seqName().toLowerCase()]; return !!(pendingIdeas === S.id && j && j.state !== 'done' && j.state !== 'error'); },
    onClose: () => { ideasWin = null; paintIdeasBtn(); } });
}
$('#ideasBtn').onclick = () => startIdeas();
async function askIdeas(note) {
  if (!P || !S) return;
  const prev = ((S.ideas || {}).list || []).map(x => x.title).filter(Boolean);
  const ok = await save({ kind: 'ideas', sequence: S.id, at: new Date().toISOString(),
    summary: `Make 4 new suggestions for the whole ${seqName()} (${(S.duration || 0).toFixed(2)} s), clearly different from each other, each with the skill that fits it best. Only write them into ideas; do not change the beats.${note ? ' What I want: ' + note : ''}${prev.length ? ' Not again: ' + prev.join(', ') + '.' : ''}${directText(S).length ? ' My direction for this part: ' + directText(S).join(' · ') : ''}` });
  if (!ok) return;
  pendingIdeas = S.id;
  const line = `/planner ideas ${seqName()}`;
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Making 4 suggestions', state: 'waiting', since: new Date().toISOString() };
  const mode = await dispatch(line, [seqName()]);
  if (mode !== 'code') jobs[seqName().toLowerCase()].step = 'Paste the line in the Claude chat';
  $('#sendMsg').innerHTML = `Suggestions for <b>${esc(seqName())}</b> asked ✓ ` + sentText(mode, line, 'They show in the Suggestions window when ready.');
  status(mode === 'code' ? `Claude Code is making 4 suggestions for ${seqName()}` : mode === 'copied' ? 'Copied: ' + line : 'Saved');
  paintTabs(); pollSoon();
}
/* any file (inspiration images / videos) into "Planner App/<folder>/" of the linked project folder */
async function saveFile(file, name, folder = 'refs') {
  const dir = await projectDir('readwrite'); if (!dir) return null;
  try { let base = dir, pre = ''; try { base = await dir.getDirectoryHandle('Planner App'); pre = 'Planner App/'; } catch (e) {}
    const sub = await base.getDirectoryHandle(folder, { create: true }); const fname = name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 140);
    const w = await (await sub.getFileHandle(fname, { create: true })).createWritable(); await w.write(file); await w.close();
    const rel = pre + folder + '/' + fname; mediaCache.set(rel, URL.createObjectURL(file)); return rel; } catch (e) { return null; }
}
/* screenshots go into "Planner App/direct/" (Claude reads them there); without the folder they stay inside the project file */
async function saveImage(name, dataURL, folder = 'direct') {
  const dir = await projectDir('readwrite'); if (!dir) return null;
  try { let base = dir, pre = ''; try { base = await dir.getDirectoryHandle('Planner App'); pre = 'Planner App/'; } catch (e) {}
    const sub = await base.getDirectoryHandle(folder, { create: true }); const fname = name.replace(/[\\/:*?"<>|]+/g, '-');
    const blob = await (await fetch(dataURL)).blob(); const w = await (await sub.getFileHandle(fname, { create: true })).createWritable(); await w.write(blob); await w.close();
    const rel = pre + folder + '/' + fname; mediaCache.set(rel, URL.createObjectURL(blob)); return rel; } catch (e) { return null; }
}
async function askLooks(b, note) {
  if (!P || !S) return;
  const ok = await save({ kind: 'suggest', sequence: S.id, beat: b.id, at: new Date().toISOString(),
    summary: `Suggest 3 different looks for ${seqName()} ${b.id} (“${b.title || ''}”, ${b.t0.toFixed(2)}–${b.t1.toFixed(2)} s). Only write them into suggest.${b.id}; do not change the beats.${note ? ' What I want: ' + note : ''}${directText(S).length ? ' My direction for this part: ' + directText(S).join(' · ') : ''}` });
  if (!ok) return;
  pendingLook = { seq: S.id, beat: b.id };
  const line = `/planner suggest ${seqName()} ${b.id}`;
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Making looks for ' + b.id, state: 'waiting', since: new Date().toISOString() };
  const mode = await dispatch(line, [seqName()]);
  if (mode !== 'code') jobs[seqName().toLowerCase()].step = 'Paste the line in the Claude chat';
  $('#sendMsg').innerHTML = `Looks for <b>${esc(seqName())} ${esc(b.id)}</b> asked ✓ ` + sentText(mode, line, 'They show in the Direct panel when ready.');
  status(mode === 'code' ? `Claude Code is making looks for ${b.id}` : mode === 'copied' ? 'Copied: ' + line : 'Saved');
  paintTabs(); pollSoon();
}

/* ---------- 🎨 Brand: the project's brand guidelines (colors, fonts, logos, rules), saved in the project file ---------- */
let brandWin = null;
function closeBrand() { if (brandWin) { const w = brandWin; brandWin = null; w.close(); } }
function paintBrandBtn() { const b = $('#brandBtn'); if (!b) return; const n = P ? brandCount(P.brand) : 0; b.classList.toggle('has', !!n); b.title = n ? 'Brand guidelines of this project (Claude uses them in every request)' : 'No brand yet: click to add colors, fonts, logos and rules'; }
/* take Claude's brand from the file when you haven't changed yours since it was read */
function takeBrand(data) { const disk = JSON.stringify(data.brand || null), mine = JSON.stringify(P.brand || null);
  if (disk === mine || mine !== brandBase) { if (disk === mine) brandBase = disk; return false; }
  P.brand = data.brand ? JSON.parse(disk) : undefined; if (!P.brand) delete P.brand; brandBase = disk; paintBrandBtn(); if (brandWin) brandWin.refresh(); return true; }
$('#brandBtn').onclick = () => { if (!P) return; if (brandWin) { closeBrand(); return; }
  brandWin = openBrand({ P, status, saveImage, loadImage: rel => mediaSrc({ id: rel, file: rel }),
    onChange: () => { paintBrandBtn(); paintTitle(); },
    onAsk: askBrand, busy: () => { const j = jobs.brand; return !!(j && j.state !== 'done' && j.state !== 'error'); },
    onClose: () => { brandWin = null; paintBrandBtn(); } }); };
async function askBrand(note) {
  if (!P) return;
  const ok = await save({ kind: 'brand', sequence: 'brand', at: new Date().toISOString(),
    summary: `Fill in / update the project's brand guidelines in the top-level "brand" field of the project file (the Planner's 🎨 Brand window). Take them from the project's CLAUDE.md brand rules${(P.brand && P.brand.links) ? ', the brand links (' + P.brand.links + ')' : ''} and what the existing graphics use. Format: brand = { colors: [{ name, hex, use }], fonts: [{ role, family, weight, use }], logos: [{ name, file }] (file = path relative to the project folder; copy logo files into "Planner App/brand/"), rules: "short lines: text style, caption style, do's and don'ts", links: "brand website / guideline links" }. Keep what I already wrote unless it is wrong; add what is missing. Do not change any sequence.${note ? ' What I want: ' + note : ''}` });
  if (!ok) return;
  const line = '/planner brand';
  jobs.brand = { seq: 'Brand', pct: 0, step: 'Filling the brand', state: 'waiting', since: new Date().toISOString() };
  const mode = await dispatch(line, ['Brand']);
  if (mode !== 'code') jobs.brand.step = 'Paste the line in the Claude chat';
  status(mode === 'code' ? 'Claude Code is filling the brand' : mode === 'copied' ? 'Copied: ' + line : 'Saved');
  paintTabs(); pollSoon();
}

/* ---------- beats panel ---------- */
function paintBeats() {
  setTimeout(() => refs && refs.refresh(), 0);
  const R = S.review; paintDirectBtn(); paintIdeasBtn();
  $('#beats').innerHTML = orig[S.id].map(b => `
    <article class="beat" data-id="${b.id}" data-t0="${b.t0}" data-t1="${b.t1}">
      <header><button type="button" class="playBeat" title="Play this beat">▶</button><span class="tc">${fmtTC(b.t0).slice(6)}</span><b>${esc(b.id)}</b><span class="kind ${esc(b.kind)}">${esc(b.kind || '')}</span></header>
      <h4>${esc(b.title)}</h4>
      ${b.what ? `<p class="what">${esc(b.what)}</p>` : ''}
      <div class="picks" role="group" aria-label="Your pick">
        <button type="button" data-c="approve">Approve</button><button type="button" data-c="other">Make something else</button><button type="button" data-c="none">No graphic</button>
      </div>
      <div class="noteRow"><textarea data-note="${b.id}" rows="2" placeholder="Notes for this beat"></textarea><button type="button" class="mic" title="Dictate">🎤</button></div>
    </article>`).join('');
  $('#general').value = R.general || ''; wireMic($('#genMic'), $('#general'));
  document.querySelectorAll('.beat').forEach(c => {
    const id = c.dataset.id;
    c.querySelector('textarea').value = R.notes[id] || '';
    wireMic(c.querySelector('.mic'), c.querySelector('textarea'));
    const paintPick = () => c.querySelectorAll('.picks button').forEach(x => x.setAttribute('aria-pressed', R.picks[id] === x.dataset.c ? 'true' : 'false'));
    c.querySelectorAll('.picks button').forEach(b => b.onclick = () => { R.picks[id] = R.picks[id] === b.dataset.c ? '' : b.dataset.c; paintPick(); changedNow(); });
    paintPick();
    c.querySelector('.playBeat').onclick = () => pv && pv.playFrom(+c.dataset.t0, Math.min(S.duration, +c.dataset.t1 + 0.8));
    c.querySelector('h4').onclick = () => tl && tl.seek(+c.dataset.t0 + 0.02);
  });
}
document.addEventListener('input', e => { if (!S) return; const t = e.target;
  if (t.dataset.note) { S.review.notes[t.dataset.note] = t.value; paintTitle(); }
  if (t.id === 'general') { S.review.general = t.value; paintTitle(); } });

/* ---------- Revise / Apply: saved into the project file, one line for the Claude chat ---------- */
const seqName = () => S.name || S.id.toUpperCase();
function summary(kind) {
  const R = S.review;
  const L = [`${kind === 'apply' ? `Apply ${seqName()} to sequence (this version is approved).` : `Revise ${seqName()} plan.`} (${S.version || ''}) My picks and notes:`];
  orig[S.id].forEach(b => L.push(`${b.id} (${b.title}): ${R.picks[b.id] || 'no pick'}${R.notes[b.id] ? ' · note: ' + R.notes[b.id].trim() : ''}${tl ? tl.changesText(b.id) : ''}${tools ? tools.text(b.id) : ''}${lookText(S, b.id)}`));
  directText(S).forEach(x => L.push(x));
  if (ideaText(S)) L.push(ideaText(S));
  mediaText(S).forEach(x => L.push(x));
  layersText(S).forEach(x => L.push(x));
  marksText(S).forEach(x => L.push(x));
  vcutLines(S).forEach(x => L.push(x));
  refsText(S, orig[S.id]).forEach(x => L.push(x));
  if ((R.general || '').trim()) L.push('General: ' + R.general.trim());
  if (brandText(P)) L.push(brandText(P));
  return L.join('\n');
}
async function send(kind) {
  if (!P) return; endTry();
  if (kind === 'revise') { remember([S]); paintPrev(); }
  const cc = kind === 'revise' ? ccChoice() : null;
  const ok = await save({ kind, sequence: S.id, at: new Date().toISOString(), summary: summary(kind), ...(cc || {}) });
  if (!ok) return;
  const line = `/planner ${kind === 'apply' ? 'apply' : 'revise'} ${seqName()}`;
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Waiting for Claude', state: 'waiting', since: new Date().toISOString() };
  const mode = await dispatch(line, [seqName()], cc);
  if (mode !== 'code') jobs[seqName().toLowerCase()].step = 'Paste the line in the Claude chat';
  $('#sendMsg').innerHTML = `Saved in <b>${esc(fh.name)}</b> ✓ ` + sentText(mode, line, `The ${esc(seqName())} tab plays the result when it’s ready.`, cc);
  paintTabs(); pollSoon();
}
$('#reviseBtn').onclick = () => send('revise');
/* one button: render this exact version and apply it to its Premiere sequence (no plan changes) */
$('#renderBtn').onclick = async () => {
  if (!P || !S) return;
  const R = S.review, edits = Object.values(R.picks).filter(Boolean).length + Object.values(R.notes).filter(x => x && x.trim()).length + Object.keys(S.timeline).length + Object.keys(R.moves || {}).length + (R.cams || []).length + (R.drawings || []).length + ((R.general || '').trim() ? 1 : 0) + layerCount(R) + markCount(R);
  if (edits && !(await ask(`${seqName()} has notes or edits that Claude hasn't done yet. Export ${S.version || 'this version'} as it is now (your notes are ignored)?`, 'Export as is', 'Cancel'))) return;
  const ok = await save({ kind: 'apply', sequence: S.id, at: new Date().toISOString(), summary: `Export ${seqName()} ${S.version || ''}: render exactly as it is in the planner and apply it to its Premiere sequence. No plan changes.${muteText(S)}` });
  if (!ok) return;
  const line = `/planner export ${seqName()}`;
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Waiting for Claude', state: 'waiting', since: new Date().toISOString() };
  /* Export goes to Claude Code on this computer (Planner Helper) like Revise; without the helper it is copied for the Claude chat */
  const mode = await dispatch(line, [seqName()]);
  if (mode !== 'code') jobs[seqName().toLowerCase()].step = 'Paste the line in the Claude chat';
  $('#sendMsg').innerHTML = `Export for <b>${esc(seqName())} ${esc(S.version || '')}</b> saved ✓ ` + sentText(mode, line, 'Keep Premiere open with the Claude Apply panel.');
  status(mode === 'code' ? 'Claude Code is exporting ' + seqName() : mode === 'copied' ? 'Copied: ' + line : 'Saved');
  paintTabs(); pollSoon();
};


function muteText(s) { const L = (s.review || {}).layers, off = []; (orig[s.id] || []).forEach(b => b.els.forEach((e, i) => { const k = b.id + ':' + i, m = L && (L.mute || []).includes(k); if (m ? !e.off : e.off) off.push(k); }));
  return off.length ? ` Muted layers (switched off, do not render them): ${off.join(', ')}.` : ''; }
/* ---------- edits: count, undo / redo (Ctrl+Z / Ctrl+Y) ---------- */
function editCount(s) { const r = s.review; return Object.values(r.picks).filter(Boolean).length + Object.values(r.notes).filter(x => x && x.trim()).length + Object.keys(s.timeline || {}).length + Object.keys(r.moves || {}).length + (r.cams || []).length + (r.drawings || []).length + (r.media || []).length + directCount(r) + (r.idea ? 1 : 0) + ((r.general || '').trim() ? 1 : 0) + layerCount(r) + markCount(r); }
const layerCount = r => r.layers ? (r.layers.deleted || []).length + (r.layers.added || []).length + (r.layers.mute || []).length + ((r.layers.order || []).length ? 1 : 0) : 0;
const markCount = r => (r.marks || []).filter(m => (m.note || '').trim()).length + vcutCount(r);
/* ✂ your cuts on V1 (S in the timeline): review.vcut = { splits, off } */
const vcutCount = r => (r.vcut ? (r.vcut.splits || []).length + (r.vcut.off || []).length : 0) + (r.refs ? Object.values(r.refs).reduce((n, v) => n + (v || []).length, 0) : 0);
function vcutLines(s) { const o = (s.review || {}).vcut; if (!o || !vcutCount(s.review)) return [];
  const seq = (s.place && s.place.sequence) || 'the Premiere sequence of this tab', off = o.off || [], sp = o.splits || [];
  const L = [];
  if (off.length) L.push(`My cuts (✂ S): REMOVE these parts of ${seq} (plan seconds = sequence seconds from the start of this tab), ripple delete so no gap is left, on every track (Cam A, Cam B, Zoom layers, audio): ${off.map(r => r[0].toFixed(2) + '–' + r[1].toFixed(2) + ' s').join(', ')}. Then move every later graphic, camera key and word earlier by the removed time, update media/cuts, words and duration of this tab, and re-export its preview video.`);
  if (sp.length) L.push(`My cut points (✂ S) in ${seq}: ${sp.map(t => t.toFixed(2) + ' s').join(', ')}. Razor there on every track; where I only cut (nothing removed), change the angle at that cut (Cam B, or the Zoom layer on Cam A).`);
  return L; }
/* markers with a comment: Claude does each one at its exact time, then the marker goes away (empty markers are only your bookmarks) */
function marksText(s) { const list = ((s.review || {}).marks || []).filter(m => (m.note || '').trim()); if (!list.length) return [];
  const bs = orig[s.id] || s.beats || [];
  return ['Markers (do each one at exactly its time, then remove that marker from review.marks; keep markers that have no note): ' + list.map(m => { const b = bs.find(x => m.t >= x.t0 && m.t < x.t1); return `[marker ${m.id}] ${m.t.toFixed(2)} s${b ? ' (' + b.id + ')' : ''}: ${m.note.trim()}`; }).join(' | ')]; }
const hist = {}, redo = {}, last = {};
const snap = s => JSON.stringify({ review: s.review, timeline: s.timeline });
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|)$/.test(a.type || ''))); };
function checkpoint(force) {
  if (!S || S.mirror || (!force && typing())) return;
  const now = snap(S); if (last[S.id] === undefined) { last[S.id] = now; return; }
  if (now === last[S.id]) return;
  (hist[S.id] ||= []).push(last[S.id]); if (hist[S.id].length > 200) hist[S.id].shift();
  redo[S.id] = []; last[S.id] = now;
}
function changedNow() { checkpoint(true); paintTitle(); }
setInterval(() => checkpoint(false), 700);
function restore(str) {
  const o = JSON.parse(str), lay0 = JSON.stringify(S.review.layers || null);
  Object.keys(S.timeline).forEach(k => delete S.timeline[k]); Object.assign(S.timeline, o.timeline);
  Object.keys(S.review).forEach(k => delete S.review[k]); Object.assign(S.review, o.review);
  last[S.id] = str; refs && refs.refresh(); if (JSON.stringify(S.review.layers || null) !== lay0) remount(); else { tl && tl.sync && tl.sync(); tools && tools.sync && tools.sync(); } paintBeats(); paintApprove(); paintTitle();
}
function undo() { if (!S || S.mirror) return; checkpoint(true); const h = hist[S.id] || []; if (!h.length) { status('Nothing to undo'); return; }
  (redo[S.id] ||= []).push(last[S.id]); restore(h.pop()); status('Undo ✓'); }
function redoFn() { if (!S || S.mirror) return; const r = redo[S.id] || []; if (!r.length) { status('Nothing to redo'); return; }
  (hist[S.id] ||= []).push(last[S.id]); restore(r.pop()); status('Redo ✓'); }
document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey) || !P || typing()) return; const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); redoFn(); } }, true);
document.addEventListener('change', e => { if (e.target.matches && e.target.matches('textarea,input[type=text]')) setTimeout(() => checkpoint(true), 0); });

/* ---------- FULL tab: shows every P tab's edits live (view only) ---------- */
/* FULL = the P tabs back to back: rebuild its beats from theirs, so every new version of a P tab shows in FULL too */
const r3 = x => Math.round((+x + 1e-9) * 1000) / 1000;
const tcShift = (str, off) => String(str).replace(/\b(\d+):(\d{2}(?:\.\d+)?)\b/g, (m, mm, ss) => { const t = +mm * 60 + +ss + off; return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); });
function shiftBeat(b, off, pre) {
  const n = JSON.parse(JSON.stringify(b)); n.id = pre + b.id;
  ['t0', 't1', 'hero'].forEach(k => { if (n[k] !== undefined && n[k] !== null && n[k] !== '') n[k] = r3(+n[k] + off); });
  (n.els || []).forEach(e => { ['in', 'out'].forEach(k => { if (e[k] !== undefined && e[k] !== '') e[k] = r3(+e[k] + off); });
    if (e.html) e.html = e.html.replace(/(data-(?:show|glow)=")([\d.]+)(")/g, (m, a, v, z) => a + (+v + off).toFixed(3) + z); });
  if (Array.isArray(n.cam)) n.cam = n.cam.map(c => [r3(c[0] + off), ...c.slice(1)]);
  if (Array.isArray(n.fx)) n.fx = n.fx.map(f => Array.isArray(f) ? [r3(+f[0] + off), r3(+f[1] + off), ...f.slice(2)] : f);
  if (n.scene && typeof n.scene === 'object') ['t0', 't1'].forEach(k => { if (n.scene[k] !== undefined) n.scene[k] = r3(+n.scene[k] + off); });
  if (Array.isArray(n.cues)) n.cues = n.cues.map(c => tcShift(c, off));
  return n;
}
function deriveBeats(F) {
  let off = 0; const beats = [];
  for (const m of (F.mirror || [])) { const src = P.sequences.find(s => s.id === m.seq); if (!src) return null;
    (orig[src.id] || src.beats || []).forEach(b => beats.push(shiftBeat(b, off, m.prefix || ''))); off += +src.duration || 0; }
  return beats.length ? beats : null;
}
function deriveMirror(F) {
  const nb = deriveBeats(F); if (nb) { F.beats = nb; orig[F.id] = JSON.parse(JSON.stringify(nb)); }
  const R = F.review; R.moves = {}; R.cams = []; R.media = []; R.picks = {}; R.notes = {}; R.drawings = []; R.direct = { note: '', shots: [] }; R.looks = {}; R.idea = ''; R.general = ''; R.marks = []; R.layers = {}; F.timeline = {};
  (F.mirror || []).forEach(m => { const src = P.sequences.find(s => s.id === m.seq); if (!src) return; const off = +m.offset || 0, pre = m.prefix || '';
    Object.entries(src.review.moves || {}).forEach(([k, v]) => { R.moves[pre + k] = { ...v }; });
    Object.entries(src.timeline || {}).forEach(([k, v]) => { F.timeline[pre + k] = { in: +(v.in + off).toFixed(3), out: +(v.out + off).toFixed(3), off: v.off || 0 }; });
    (src.review.cams || []).forEach(c => R.cams.push({ ...c, t: +(c.t + off).toFixed(3) }));
    (src.review.media || []).forEach(x => R.media.push({ ...x, id: pre + x.id, t0: +(x.t0 + off).toFixed(3), t1: +(x.t1 + off).toFixed(3) }));
    Object.entries(src.review.picks || {}).forEach(([k, v]) => { if (v) R.picks[pre + k] = v; });
    (src.review.marks || []).forEach(x => R.marks.push({ ...x, id: pre + x.id, t: +(x.t + off).toFixed(3) }));
    const SL = src.review.layers || {}; ['deleted', 'mute'].forEach(f => (SL[f] || []).forEach(k => { if (!k.startsWith('u:')) (R.layers[f] ||= []).push(pre + k); })); });
  R.cams.sort((a, b) => a.t - b.t);
}

/* ---------- approve this tab ---------- */
function paintApprove() { const b = $('#approveBtn'); if (!b || !S) return; const on = !!S.review.approved; b.classList.toggle('on', on); b.textContent = on ? '✓ Approved' : '✓ Approve'; }
$('#approveBtn').onclick = () => { if (!S || S.mirror) return; S.review.approved = !S.review.approved; paintApprove(); changedNow(); status(S.review.approved ? `${seqName()} approved ✓ (Save to keep it)` : `${seqName()} not approved`); };

/* ---------- your photos / videos as suggestions ---------- */
const MEDIA_TYPES = [{ description: 'Photo or video', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'], 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] } }];
const mediaCache = new Map();
async function projectDir(mode) { const dir = await kvGet('folder:' + P.id); if (!dir) return null;
  try { let p = await dir.queryPermission({ mode }); if (p !== 'granted') p = await dir.requestPermission({ mode }); return p === 'granted' ? dir : null; } catch (e) { return null; } }
async function addMedia(t) {
  let file; try { const [h] = await window.showOpenFilePicker({ id: 'planner-suggest', types: MEDIA_TYPES }); file = await h.getFile(); } catch (e) { return null; }
  const isVid = file.type.startsWith('video'), id = 'u' + Date.now().toString(36);
  const m = { id, type: isVid ? 'video' : 'image', name: file.name, t0: t, t1: +Math.min(S.duration, t + 3).toFixed(3), x: 35, y: 8, w: 30, w0: 30, note: '' };
  if (isVid) { try { const d = await new Promise(r => { const vv = document.createElement('video'); vv.preload = 'metadata'; vv.onloadedmetadata = () => r(vv.duration); vv.onerror = () => r(3); vv.src = URL.createObjectURL(file); setTimeout(() => r(3), 4000); }); m.t1 = +Math.min(S.duration, t + Math.max(0.5, d || 3)).toFixed(3); } catch (e) {} }
  mediaCache.set(id, URL.createObjectURL(file));
  const dir = await projectDir('readwrite'); let saved = false;
  if (dir) { try { let base = dir, pre = ''; try { base = await dir.getDirectoryHandle('Planner App'); pre = 'Planner App/'; } catch (e) {}
      const sub = await base.getDirectoryHandle('suggestions', { create: true }); const fname = `${(S.name || S.id)}-${id}-${file.name}`.replace(/[\\/:*?"<>|]+/g, '-');
      const w = await (await sub.getFileHandle(fname, { create: true })).createWritable(); await w.write(file); await w.close(); m.file = pre + 'suggestions/' + fname; saved = true; } catch (e) {} }
  if (!saved && !isVid && file.size < 2.5e6) { m.data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); }); saved = true; }
  if (!saved) status('Link the project folder (with save permission) so Claude can get this file. It shows here for now.');
  S.review.media.push(m); tl && tl.redraw(); status(`Added ${file.name} at ${t.toFixed(2)} s · drag it, resize it, and write a note for Claude`);
  return m;
}
async function mediaSrc(m) { const key = m.file || m.id; if (m.data) return m.data; if (mediaCache.has(key)) return mediaCache.get(key); if (mediaCache.has(m.id)) return mediaCache.get(m.id);
  const baseId = String(m.id).replace(/^p\d+/, ''); if (mediaCache.has(baseId)) return mediaCache.get(baseId);
  if (!m.file) return ''; const dir = await kvGet('folder:' + P.id); if (!dir) return '';
  try { if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') return ''; const f = await fileFromFolder(dir, m.file); if (!f) return ''; const u = URL.createObjectURL(f); mediaCache.set(key, u); return u; } catch (e) { return ''; } }
function mediaText(s) { return (s.review.media || []).map(m => `My ${m.type === 'video' ? 'video' : 'photo'} suggestion “${m.name}” (${m.file ? 'file: ' + m.file : m.data ? 'image embedded in the project file' : 'not saved to the folder'}): show it ${m.t0.toFixed(2)}–${m.t1.toFixed(2)} s at x ${m.x} y ${m.y} width ${m.w} (cqw of frame width)${m.note ? ' · note: ' + m.note : ''}`); }

/* ---------- Apply all changes: every tab's notes and edits in one request ---------- */
function seqText(s) {
  const r = s.review, L = [`== ${s.name || s.id.toUpperCase()} (${s.version || ''})${r.approved ? ' · APPROVED' : ''}`];
  (orig[s.id] || []).forEach(b => { const bits = [];
    if (r.picks[b.id]) bits.push(r.picks[b.id]); if ((r.notes[b.id] || '').trim()) bits.push('note: ' + r.notes[b.id].trim());
    const mv = Object.entries(r.moves || {}).filter(([k]) => k.startsWith(b.id + ':') && !/\bguide\b/.test((b.els[+k.split(':')[1]] || {}).cls || '')); if (mv.length) bits.push('moved (apply exactly, cqw of frame width): ' + mv.map(([k, m]) => `el#${k.split(':')[1]} x${m.x >= 0 ? '+' : ''}${m.x} y${m.y >= 0 ? '+' : ''}${m.y}${Math.abs((m.s || 1) - 1) > .001 ? ' size ' + Math.round(m.s * 100) + '%' : ''}`).join('; '));
    const tm = Object.entries(s.timeline || {}).filter(([k]) => k.startsWith(b.id + ':')); if (tm.length) bits.push('timeline (apply exactly): ' + tm.map(([k, v]) => `el#${k.split(':')[1]} in ${(+v.in).toFixed(2)} s, out ${(+v.out).toFixed(2)} s${Math.abs(v.off || 0) > .004 ? ' (whole clip moved)' : ''}`).join('; '));
    const ks = (r.cams || []).filter(k => k.t >= b.t0 && k.t < b.t1); if (ks.length) bits.push('my zoom/pan (use exactly): ' + ks.map(k => `${k.t.toFixed(2)} s zoom ${Math.round(k.s * 100)}% x ${k.x}% y ${k.y || 0}%${k.ease === 'cut' ? ' (cut / jump to it)' : k.ease === 'lin' ? ' (linear into it)' : ''}`).join('; '));
    (r.drawings || []).filter(d => d.beat === b.id).forEach(d => bits.push(`drawing at 0:${d.t.toFixed(1)}${d.note ? ': ' + d.note : ''} (sketch in project file)`));
    { const lt = lookText(s, b.id); if (lt) bits.push(lt.slice(3)); }
    if (bits.length) L.push(`${b.id} (${b.title}): ${bits.join(' · ')}`); });
  directText(s).forEach(x => L.push(x));
  if (ideaText(s)) L.push(ideaText(s));
  mediaText(s).forEach(x => L.push(x));
  layersText(s).forEach(x => L.push(x));
  marksText(s).forEach(x => L.push(x));
  vcutLines(s).forEach(x => L.push(x));
  refsText(s, orig[s.id] || s.beats).forEach(x => L.push(x));
  if ((r.general || '').trim()) L.push('General: ' + r.general.trim());
  return L;
}
$('#ccBadge').onclick = async () => {
  await helperPing();
  if (helper && helper.claude && !helperOld()) { status(`Claude Code is connected (Planner Helper ${helper.helper}). Projects folder: ${helper.root}`); return; }
  let copied = false; try { await navigator.clipboard.writeText(SETUP_CMD); copied = true; } catch (e) {}
  await ask((copied ? (helperOld() ? 'Update command copied. ' : 'Setup command copied. ') : '') + (helperOld() ? 'To update the Planner Helper (so Revise uses the model and effort you pick): ' : 'To let Claude Code on this computer do your requests: ') + (IS_MAC ? 'open Terminal (Cmd+Space → type Terminal), paste the command (Cmd+V)' : 'open PowerShell (Start → type PowerShell), paste the command (right-click)') + ' and press Enter. Then reload this page.\n\n' + SETUP_CMD, 'OK', 'Close');
};
$('#applyAllBtn').onclick = async () => {
  if (!P) return; checkpoint(true);
  const list = P.sequences.filter(s => !s.mirror && (editCount(s) || s.review.approved));
  if (!list.length) { status('No changes yet in any tab'); return; }
  const summary = ['Apply all my changes (revise every tab listed; tabs marked APPROVED need no changes unless they have notes):'].concat(...list.map(seqText), brandText(P) ? [brandText(P)] : []).join('\n');
  remember(list.filter(s => !s.review.approved || editCount(s)));
  const ok = await save({ kind: 'revise-all', sequence: 'all', sequences: list.map(s => s.id), at: new Date().toISOString(), summary });
  if (!ok) return;
  const line = '/planner apply all changes';
  const names = [];
  list.forEach(s => { const n = s.name || s.id.toUpperCase(); if (!s.review.approved || editCount(s)) { names.push(n); jobs[n.toLowerCase()] = { seq: n, pct: 0, step: 'Waiting for Claude', state: 'waiting', since: new Date().toISOString() }; } });
  const mode = await dispatch(line, names);
  $('#sendMsg').innerHTML = `All changes (${list.map(s => esc(s.name || s.id)).join(', ')}) saved in <b>${esc(fh.name)}</b> ✓ ` + sentText(mode, line);
  status(mode === 'code' ? 'Claude Code is applying all changes' : mode === 'copied' ? 'Copied: ' + line : 'Saved');
  paintTabs(); pollSoon();
};

/* ---------- notes grow while you type ---------- */
const grow = t => { t.style.height = 'auto'; t.style.height = Math.min(window.innerHeight * 0.45, Math.max(130, t.scrollHeight + 4)) + 'px'; };
document.addEventListener('focusin', e => { const t = e.target; if (t.tagName === 'TEXTAREA' && t.closest('.side')) { t.classList.add('big'); grow(t); } });
document.addEventListener('input', e => { const t = e.target; if (t.tagName === 'TEXTAREA' && t.classList.contains('big')) grow(t); });
document.addEventListener('focusout', e => { const t = e.target; if (t.tagName === 'TEXTAREA' && t.classList.contains('big')) { t.classList.remove('big'); t.style.height = ''; } });

/* ---------- timeline height: drag the bar above it (like Premiere) ---------- */
(() => { const sp = $('#tlSplit'); if (!sp) return; const setH = h => { h = Math.max(150, Math.min(window.innerHeight - 260, h)); document.documentElement.style.setProperty('--tlh', h + 'px'); return h; };
  const saved = +localStorage.getItem('planner-tlh'); if (saved) setH(saved);
  let d = null; sp.addEventListener('pointerdown', e => { e.preventDefault(); d = { y: e.clientY, h: $('#timeline').getBoundingClientRect().height }; sp.setPointerCapture(e.pointerId); sp.classList.add('on'); });
  sp.addEventListener('pointermove', e => { if (d) setH(d.h - (e.clientY - d.y)); });
  sp.addEventListener('pointerup', () => { if (!d) return; d = null; sp.classList.remove('on'); localStorage.setItem('planner-tlh', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tlh')) || 300); window.dispatchEvent(new Event('resize')); });
  window.addEventListener('resize', () => { const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tlh')); if (v) setH(v); }); })();

/* ---------- small dialog ---------- */
function ask(text, yes, no) { return new Promise(r => { const d = $('#dlg'); d.querySelector('p').textContent = text; d.querySelector('.yes').textContent = yes; d.querySelector('.no').textContent = no;
  d.querySelector('.yes').onclick = () => { d.close(); r(true); }; d.querySelector('.no').onclick = () => { d.close(); r(false); }; d.showModal(); }); }

/* ---------- start screen ---------- */
async function paintRecent() {
  const list = (await kvGet('recent')) || [];
  $('#recent').innerHTML = list.length ? list.map((r, i) => `<li><button type="button" data-i="${i}">📄 <b>${esc(r.name)}</b><small>${new Date(r.at).toLocaleString()}</small></button></li>`).join('') : '<li class="none">No projects yet. Open a .planner file to start.</li>';
  $('#recent').querySelectorAll('button').forEach(b => b.onclick = async () => { try { await openHandle(list[+b.dataset.i].h); } catch (e) { status('Could not open: ' + (e?.message || e)); } });
}
async function goStart() { if (!(await confirmDiscard())) return; tl && tl.destroy(); tools && tools.destroy(); tl = tools = null; P = S = null; fh = null; $('#work').hidden = true; $('#start').hidden = false; paintRecent(); paintTitle(); }

/* ---------- menu + keys ---------- */
document.addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  if (a === 'open') openPicker(); else if (a === 'save') save(); else if (a === 'saveas') saveAs(); else if (a === 'home') goStart(); });
document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); } else if (k === 'o') { e.preventDefault(); openPicker(); }
  else if (P && P.sequences.length > 1 && (e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); const i = P.sequences.indexOf(S) + (e.key === 'PageDown' ? 1 : -1); if (P.sequences[i]) switchSeq(P.sequences[i].id); } }, true);
window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
$('#fileInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const d = normalize(JSON.parse(await f.text())); if (!d) throw new Error('not a planner project'); fh = null; await load(d); status('Opened ' + f.name + ' · use Save As… once to choose where it saves'); } catch (err) { console.error(err); await ask('Could not open: ' + err.message, 'OK', 'Close'); } };
window.addEventListener('unhandledrejection', e => console.error('[Planner] error', e.reason));

if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files && p.files[0]) { try { await openHandle(p.files[0]); } catch (e) { status('Could not open: ' + e.message); } } });
if (!canFS) $('#fsNote').hidden = false;
paintRecent();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__planner = { load: d => { fh = null; return load(normalize(d)); }, peek: () => ({ S, summary: S ? summary('revise') : '', seq: S ? seqText(S).join('\n') : '' }), mountFile: f => mount(f), switchSeq: id => switchSeq(id), seek: t => tl && tl.seek(t), dispatch: (l, n) => dispatch(l, n), _fh: h => { fh = h; } };

/* 📎 inspiration on every note box (paste / drop / pick images and videos) */
refs = wireRefs({ getS: () => S, saveFile, srcOf: r => mediaSrc({ id: r.id, file: r.file, data: r.data }), onChange: () => { changedNow(); }, status });
