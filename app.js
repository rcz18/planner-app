import { createPreview } from './engine.js';
import { createTimeline, fmtTC } from './timeline.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TYPES = [{ description: 'Planner project', accept: { 'application/json': ['.planner'] } }];
const VIDEO_TYPES = [{ description: 'Video', accept: { 'video/*': ['.mp4', '.mov', '.m4v', '.webm'] } }];
const canFS = 'showOpenFilePicker' in window;

/* ---------- tiny IndexedDB store: recent projects, linked media ---------- */
const idb = () => new Promise((r, j) => { const q = indexedDB.open('planner-app', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
async function kvGet(k) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); }); } catch (e) { return undefined; } }
async function kvSet(k, v) { try { const d = await idb(); await new Promise(r => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = r; t.onerror = r; }); } catch (e) {} }

/* ---------- state ---------- */
let P = null;            // open project (parsed)
let orig = null;         // Claude's plan as loaded (beats are saved back unchanged)
let fh = null;           // file handle of the open .planner
let savedSig = '';       // to show "not saved"
let pv = null, tl = null, mediaURL = null;

const sig = () => P ? JSON.stringify([P.review, P.timeline]) : '';
const dirty = () => P && sig() !== savedSig;
function status(t) { $('#msg').textContent = t || ''; clearTimeout(status._t); if (t) status._t = setTimeout(() => $('#msg').textContent = '', 7000); }
function paintTitle() {
  const name = fh ? fh.name : (P ? (P.name || 'Untitled') + '.planner' : '');
  $('#fileName').innerHTML = P ? `${esc(name)} ${dirty() ? '<span class="dirty">● not saved</span>' : '<span class="ok">saved</span>'}` : '';
  document.title = P ? `${dirty() ? '● ' : ''}${name} · Planner` : 'Planner';
}
setInterval(paintTitle, 700);

/* ---------- open / save ---------- */
function serialize(request) {
  const out = JSON.parse(JSON.stringify({ ...P, beats: orig }));
  out.savedAt = new Date().toISOString();
  if (request) out.request = request;
  return JSON.stringify(out, null, 2);
}
async function writeFile(handle, text) {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('No permission to save this file');
  const w = await handle.createWritable(); await w.write(text); await w.close();
}
async function save(request) {
  if (!P) return false;
  try {
    if (!fh) return await saveAs(request);
    await writeFile(fh, serialize(request)); savedSig = sig(); paintTitle(); status('Saved ' + fh.name + ' ✓'); return true;
  } catch (e) { if (e?.name !== 'AbortError') status('Could not save: ' + (e?.message || e)); return false; }
}
async function saveAs(request) {
  if (!P) return false;
  try {
    const h = await window.showSaveFilePicker({ id: 'planner', suggestedName: (P.name || 'project').replace(/[\\/:*?"<>|·]+/g, '-').replace(/\s+/g, ' ').trim() + '.planner', types: TYPES });
    fh = h; await writeFile(h, serialize(request)); savedSig = sig(); await addRecent(h); paintTitle(); status('Saved ' + h.name + ' ✓'); return true;
  } catch (e) { if (e?.name !== 'AbortError') status('Could not save: ' + (e?.message || e)); return false; }
}
async function openPicker() {
  if (!canFS) { $('#fileInput').click(); return; }
  try { const [h] = await window.showOpenFilePicker({ id: 'planner', types: TYPES }); await openHandle(h); }
  catch (e) { if (e?.name !== 'AbortError') status('Could not open: ' + (e?.message || e)); }
}
async function openHandle(h) {
  if ((await h.queryPermission?.({ mode: 'readwrite' })) !== 'granted') await h.requestPermission?.({ mode: 'readwrite' });
  const f = await h.getFile(); const data = JSON.parse(await f.text());
  if (!(await confirmDiscard())) return;
  fh = h; await addRecent(h); load(data);
}
async function confirmDiscard() { if (!dirty()) return true; return await ask('This project has changes that are not saved. Open anyway and lose them?', 'Discard changes', 'Cancel'); }
async function addRecent(h) { const list = (await kvGet('recent')) || []; const rest = []; for (const r of list) { try { if (!(await r.h.isSameEntry(h))) rest.push(r); } catch (e) {} } rest.unshift({ h, name: h.name, at: Date.now() }); await kvSet('recent', rest.slice(0, 12)); }

/* ---------- media (the project's video) ---------- */
async function linkMedia(pick) {
  const key = 'media:' + (P.id || P.name);
  let h = pick ? null : await kvGet(key);
  if (h) { try { if ((await h.queryPermission({ mode: 'read' })) !== 'granted') { showLink(true); return null; } return await h.getFile(); } catch (e) { h = null; } }
  if (!pick) { showLink(false); return null; }
  try { const [nh] = await window.showOpenFilePicker({ id: 'planner-media', types: VIDEO_TYPES }); await kvSet(key, nh); return await nh.getFile(); }
  catch (e) { return null; }
}
function showLink(reauth) {
  const want = P.media?.video || 'the preview video';
  $('#linkMedia').hidden = false;
  $('#linkMedia').innerHTML = `<div><b>${reauth ? 'Allow the video again' : 'Link this project’s video'}</b><p>${esc(want)}</p><button type="button" class="btn primary" id="linkBtn">${reauth ? 'Allow' : 'Choose video…'}</button></div>`;
  $('#linkBtn').onclick = async () => { const key = 'media:' + (P.id || P.name); let file = null;
    if (reauth) { const h = await kvGet(key); try { if ((await h.requestPermission({ mode: 'read' })) === 'granted') file = await h.getFile(); } catch (e) {} }
    if (!file) file = await linkMedia(true);
    if (file) { $('#linkMedia').hidden = true; mount(file); } };
}

/* ---------- load a project into the app ---------- */
async function load(data) {
  if (!data || !Array.isArray(data.beats)) { status('That is not a planner project'); return; }
  tl && tl.destroy(); tl = null;
  P = data; P.review = P.review || { picks: {}, notes: {}, general: '' }; P.review.picks ||= {}; P.review.notes ||= {}; P.timeline = P.timeline || {};
  orig = JSON.parse(JSON.stringify(data.beats));
  savedSig = sig();
  $('#start').hidden = true; $('#work').hidden = false;
  $('#projTitle').textContent = P.name || 'Untitled';
  $('#projBadge').textContent = P.badge || P.version || '';
  $('#projBadge').hidden = !(P.badge || P.version);
  paintBeats(); paintTitle();
  const file = await linkMedia(false);
  mount(file);
}
function mount(file) {
  if (file) $('#linkMedia').hidden = true;
  if (mediaURL) URL.revokeObjectURL(mediaURL);
  mediaURL = file ? URL.createObjectURL(file) : '';
  tl && tl.destroy();
  P.beats = JSON.parse(JSON.stringify(orig));
  pv = createPreview($('#monitor'), P, mediaURL);
  tl = createTimeline($('#timeline'), P, pv, { onChange: paintTitle });
  pv.video.addEventListener('timeupdate', markBeat); pv.video.addEventListener('seeked', markBeat);
}
function markBeat() { const t = pv.video.currentTime; document.querySelectorAll('.beat').forEach(c => c.classList.toggle('live', t >= +c.dataset.t0 && t < +c.dataset.t1)); }

/* ---------- beats panel ---------- */
function paintBeats() {
  $('#beats').innerHTML = orig.map(b => `
    <article class="beat" data-id="${b.id}" data-t0="${b.t0}" data-t1="${b.t1}">
      <header><button type="button" class="playBeat" title="Play this beat">▶</button><span class="tc">${fmtTC(b.t0).slice(6)}</span><b>${esc(b.id)}</b><span class="kind ${esc(b.kind)}">${esc(b.kind || '')}</span></header>
      <h4>${esc(b.title)}</h4>
      ${b.what ? `<p class="what">${esc(b.what)}</p>` : ''}
      <div class="picks" role="group" aria-label="Your pick">
        <button type="button" data-c="approve">Approve</button><button type="button" data-c="other">Make something else</button><button type="button" data-c="none">No graphic</button>
      </div>
      <textarea data-note="${b.id}" rows="2" placeholder="Notes for this beat"></textarea>
    </article>`).join('');
  $('#general').value = P.review.general || '';
  document.querySelectorAll('.beat').forEach(c => {
    const id = c.dataset.id;
    c.querySelector('textarea').value = P.review.notes[id] || '';
    c.querySelectorAll('.picks button').forEach(b => { b.setAttribute('aria-pressed', P.review.picks[id] === b.dataset.c ? 'true' : 'false');
      b.onclick = () => { P.review.picks[id] = P.review.picks[id] === b.dataset.c ? '' : b.dataset.c; c.querySelectorAll('.picks button').forEach(x => x.setAttribute('aria-pressed', P.review.picks[id] === x.dataset.c ? 'true' : 'false')); paintTitle(); }; });
    c.querySelector('.playBeat').onclick = () => pv && pv.playFrom(+c.dataset.t0, Math.min(P.duration, +c.dataset.t1 + 0.8));
    c.querySelector('h4').onclick = () => tl && tl.seek(+c.dataset.t0 + 0.02);
  });
}
document.addEventListener('input', e => { if (!P) return; const t = e.target;
  if (t.dataset.note) { P.review.notes[t.dataset.note] = t.value; paintTitle(); }
  if (t.id === 'general') { P.review.general = t.value; paintTitle(); } });

/* ---------- Revise / Apply: saved into the project file, one line for the Claude chat ---------- */
function summary(kind) {
  const L = [`${kind === 'apply' ? 'Apply' : 'Revise'} ${P.name || ''} (${P.version || ''}). My picks and notes:`];
  orig.forEach(b => L.push(`${b.id} (${b.title}): ${P.review.picks[b.id] || 'no pick'}${P.review.notes[b.id] ? ' · note: ' + P.review.notes[b.id].trim() : ''}${tl ? tl.changesText(b.id) : ''}`));
  if ((P.review.general || '').trim()) L.push('General: ' + P.review.general.trim());
  return L.join('\n');
}
async function send(kind) {
  if (!P) return;
  const ok = await save({ kind, at: new Date().toISOString(), summary: summary(kind) });
  if (!ok) return;
  const line = `${kind === 'apply' ? 'Apply' : 'Revise'} · ${fh.name}`;
  let copied = false; try { await navigator.clipboard.writeText(line); copied = true; } catch (e) {}
  $('#sendMsg').innerHTML = `Saved in <b>${esc(fh.name)}</b> ✓ ${copied ? 'Now paste in the Claude chat (Ctrl+V) and send.' : 'Now type in the Claude chat: <b>' + esc(line) + '</b>'}`;
}
$('#reviseBtn').onclick = () => send('revise');
$('#applyBtn').onclick = () => send('apply');

/* ---------- small dialog ---------- */
function ask(text, yes, no) { return new Promise(r => { const d = $('#dlg'); d.querySelector('p').textContent = text; d.querySelector('.yes').textContent = yes; d.querySelector('.no').textContent = no;
  d.querySelector('.yes').onclick = () => { d.close(); r(true); }; d.querySelector('.no').onclick = () => { d.close(); r(false); }; d.showModal(); }); }

/* ---------- start screen ---------- */
async function paintRecent() {
  const list = (await kvGet('recent')) || [];
  $('#recent').innerHTML = list.length ? list.map((r, i) => `<li><button type="button" data-i="${i}">📄 <b>${esc(r.name)}</b><small>${new Date(r.at).toLocaleString()}</small></button></li>`).join('') : '<li class="none">No projects yet. Open a .planner file to start.</li>';
  $('#recent').querySelectorAll('button').forEach(b => b.onclick = async () => { try { await openHandle(list[+b.dataset.i].h); } catch (e) { status('Could not open: ' + (e?.message || e)); } });
}
async function goStart() { if (!(await confirmDiscard())) return; tl && tl.destroy(); tl = null; P = null; fh = null; $('#work').hidden = true; $('#start').hidden = false; paintRecent(); paintTitle(); }

/* ---------- menu + keys ---------- */
document.addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  if (a === 'open') openPicker(); else if (a === 'save') save(); else if (a === 'saveas') saveAs(); else if (a === 'home') goStart(); });
document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); } else if (k === 'o') { e.preventDefault(); openPicker(); } }, true);
window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
$('#fileInput').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { fh = null; load(JSON.parse(await f.text())); } catch (err) { status('Could not open: ' + err.message); } };

/* open a .planner straight from the OS (installed app + file handler) */
if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files && p.files[0]) { try { await openHandle(p.files[0]); } catch (e) { status('Could not open: ' + e.message); } } });
if (!canFS) $('#fsNote').hidden = false;
paintRecent();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__planner = { load: d => { fh = null; return load(d); }, mountFile: f => mount(f) };
