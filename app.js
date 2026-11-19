import { createPreview } from './engine.js?v=8';
import { createTimeline, fmtTC } from './timeline.js?v=8';
import { attachTools, wireMic } from './tools.js?v=8';

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
let pv = null, tl = null, tools = null, mediaURL = null;

const sig = () => P ? JSON.stringify(P.sequences.map(s => [s.review, s.timeline])) : '';
const dirty = () => P && sig() !== savedSig;
function status(t) { $('#msg').textContent = t || ''; clearTimeout(status._t); if (t) status._t = setTimeout(() => $('#msg').textContent = '', 7000); }
function paintTitle() {
  const name = fh ? fh.name : (P ? (P.name || 'Untitled') + '.planner' : '');
  $('#fileName').innerHTML = P ? `${esc(name)} ${dirty() ? '<span class="dirty">● not saved</span>' : '<span class="ok">saved</span>'}` : '';
  document.title = P ? `${dirty() ? '● ' : ''}${name} · Planner` : 'Planner';
  if (P) paintTabs();
}
setInterval(paintTitle, 800);

function normalize(data) {
  if (!data) return null;
  if (!Array.isArray(data.sequences)) {           // single-sequence file (planner/1)
    if (!Array.isArray(data.beats)) return null;
    const { format, id, name, client, ...seq } = data;
    data = { format: 'planner/2', id: id || 'project', name, client, sequences: [{ id: seq.seq || 'seq1', label: seq.label || name, ...seq }] };
  }
  data.sequences.forEach(s => { s.review ||= {}; s.review.picks ||= {}; s.review.notes ||= {}; s.review.general ||= ''; s.review.moves ||= {}; s.review.cams ||= []; s.review.drawings ||= []; s.timeline ||= {}; });
  return data;
}

/* ---------- open / save ---------- */
function serialize(request) {
  const out = JSON.parse(JSON.stringify({ ...P, sequences: P.sequences.map(s => ({ ...s, beats: orig[s.id] })) }));
  out.current = S && S.id; out.savedAt = new Date().toISOString();
  if (request) out.request = request; else delete out.request;
  return JSON.stringify(out, null, 1);
}
async function writeFile(handle, text) {
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('No permission to save this file');
  const w = await handle.createWritable(); await w.write(text); await w.close();
}
async function save(request) {
  if (!P) return false;
  try { if (!fh) return await saveAs(request);
    await writeFile(fh, serialize(request)); savedSig = sig(); paintTitle(); status('Saved ' + fh.name + ' ✓'); return true;
  } catch (e) { if (e?.name !== 'AbortError') status('Could not save: ' + (e?.message || e)); return false; }
}
async function saveAs(request) {
  if (!P) return false;
  try { const h = await window.showSaveFilePicker({ id: 'planner', suggestedName: (P.name || 'project').replace(/[\\/:*?"<>|·]+/g, '-').replace(/\s+/g, ' ').trim() + '.planner', types: TYPES });
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
  const data = normalize(JSON.parse(await (await h.getFile()).text()));
  if (!data) { status('That is not a planner project'); return; }
  if (!(await confirmDiscard())) return;
  fh = h; await addRecent(h); load(data);
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
  box.innerHTML = `<div><b>${need === 'allow' ? 'Allow the project folder again' : 'Link the project folder'}</b>
    <p>Choose the <b>Planner App</b> folder (or its <b>media</b> folder). It holds <b>${esc(seq.media?.video || 'the video')}</b>${P.sequences.length > 1 ? ' (one time for all ' + P.sequences.length + ' sequences)' : ''}.</p>
    <button type="button" class="btn primary" id="linkFolder">${need === 'allow' ? 'Allow' : 'Choose folder…'}</button> <button type="button" class="btn" id="linkFile">Choose just this video…</button></div>`;
  $('#linkFolder').onclick = async () => {
    try { if (need !== 'allow') { const d = await window.showDirectoryPicker({ id: 'planner-folder', mode: 'read' }); await kvSet('folder:' + P.id, d); }
      const f = await findMedia(seq, true); if (f instanceof File) mount(f); else if (need !== 'allow') status('Could not find ' + (seq.media?.video || 'the video') + ' in that folder. Pick the folder that has the “media” folder in it.');
    } catch (e) { if (e?.name !== 'AbortError') status('Could not link: ' + (e?.message || e)); } };
  $('#linkFile').onclick = async () => { try { const [h] = await window.showOpenFilePicker({ id: 'planner-media', types: VIDEO_TYPES }); await kvSet('media:' + P.id + ':' + seq.id, h); mount(await h.getFile()); } catch (e) {} };
}

/* ---------- load a project / switch sequence ---------- */
async function load(data) {
  tl && tl.destroy(); tools && tools.destroy(); tl = tools = null;
  P = data; Object.keys(orig).forEach(k => delete orig[k]);
  P.sequences.forEach(s => { orig[s.id] = JSON.parse(JSON.stringify(s.beats)); });
  savedSig = sig();
  $('#start').hidden = true; $('#work').hidden = false;
  paintTitle();
  await switchSeq((P.current && P.sequences.find(s => s.id === P.current)) ? P.current : P.sequences[0].id);
  try { lastFileStamp = fh ? (await fh.getFile()).lastModified : 0; } catch (e) {}
  Object.keys(jobs).forEach(k => delete jobs[k]); pollSoon(500);
}
async function switchSeq(id) {
  const seq = P.sequences.find(s => s.id === id); if (!seq) return;
  if (pv) pv.video.pause();
  tl && tl.destroy(); tools && tools.destroy(); tl = tools = null;
  S = seq; P.current = id;
  $('#projTitle').textContent = `${P.name || ''}${P.sequences.length > 1 ? ' · ' + (S.name || S.id.toUpperCase()) : ''}`;
  $('#projBadge').textContent = S.badge || S.version || ''; $('#projBadge').hidden = !(S.badge || S.version);
  $('#sendMsg').textContent = '';
  paintTabs(); paintBeats();
  const f = await findMedia(S, false);
  if (f instanceof File) mount(f); else { mount(null); showLink(S, f.need); }
}
function mount(file) {
  if (file) $('#linkMedia').hidden = true;
  if (mediaURL) URL.revokeObjectURL(mediaURL);
  mediaURL = file ? URL.createObjectURL(file) : '';
  tl && tl.destroy(); tools && tools.destroy(); tools = null;
  S.beats = JSON.parse(JSON.stringify(orig[S.id]));
  pv = createPreview($('#monitor'), S, mediaURL);
  tl = createTimeline($('#timeline'), S, pv, { onChange: paintTitle });
  tools = attachTools({ P: S, pv, tl, host: $('#monitor'), bar: $('#tools'), hint: $('#toolHint'), onChange: paintTitle });
  pv.video.addEventListener('timeupdate', markBeat); pv.video.addEventListener('seeked', markBeat);
}
function markBeat() { const t = pv.time(); document.querySelectorAll('.beat').forEach(c => c.classList.toggle('live', t >= +c.dataset.t0 && t < +c.dataset.t1)); }

/* ---------- sequence tabs ---------- */
function paintTabs() {
  const bar = $('#seqTabs'); if (!P) { bar.hidden = true; return; } bar.hidden = false;
  const html = P.sequences.map(s => { const r = s.review, n = Object.values(r.picks).filter(Boolean).length + Object.values(r.notes).filter(x => x && x.trim()).length + Object.keys(s.timeline).length + Object.keys(r.moves || {}).length + (r.cams || []).length + (r.drawings || []).length + (r.general.trim() ? 1 : 0);
    return `<button type="button" class="seqTab${s === S ? ' cur' : ''}" data-seq="${esc(s.id)}" title="${esc(s.label || '')}"><b>${esc(s.name || s.id.toUpperCase())}</b><span>${esc(s.label || '')}</span>${n ? '<i class="edits" title="Has your edits"></i>' : ''}</button>`; }).join('');
  const pend = Object.values(jobs).filter(j => !P.sequences.some(s => (s.name || '').toLowerCase() === j.seq.toLowerCase())).map(j => {
    const pct = Math.max(0, Math.min(100, +j.pct || 0)), st = j.state === 'error' ? 'err' : j.state === 'done' ? 'done' : '';
    return `<div class="seqTab pend ${st}" title="${esc(j.step || '')}"><b>${esc(j.seq)}</b><span>${esc(j.step || 'Waiting for Claude…')}</span><div class="pbar"><i style="width:${pct}%"></i></div><em>${pct}%</em></div>`; }).join('');
  const all = html + pend + `<button type="button" class="seqTab newSeq" data-new="1" title="Ask Claude to plan a new sequence"><b>＋ New</b><span>ask Claude</span></button>`;
  if (bar._h !== all) { bar.innerHTML = all; bar._h = all; }
}
$('#seqTabs').onclick = e => { if (e.target.closest('[data-new]')) { newSeqDialog(); return; } const b = e.target.closest('[data-seq]'); if (b && P && b.dataset.seq !== S.id) switchSeq(b.dataset.seq); };

/* ---------- progress from Claude: Claude writes "Planner App/planner-status.json" while it works ---------- */
const jobs = {};             // seq name (lower case) → { seq, pct, step, state }
let pollT = null, lastFileStamp = 0;
function pollSoon(ms = 1500) { clearTimeout(pollT); pollT = setTimeout(poll, ms); }
async function poll() {
  if (!P) return;
  try {
    const dir = await kvGet('folder:' + P.id);
    if (dir && (await dir.queryPermission({ mode: 'read' })) === 'granted') {
      const f = await fileFromFolder(dir, 'Planner App/planner-status.json');
      if (f) { const st = JSON.parse(await f.text()); (st.jobs || []).filter(j => !j.project || j.project === P.id).forEach(j => { jobs[String(j.seq).toLowerCase()] = { ...jobs[String(j.seq).toLowerCase()], ...j }; }); }
    }
    if (fh && Object.values(jobs).some(j => j.state === 'done')) await pullNewSequences();
  } catch (e) {}
  paintTabs();
  const busy = Object.values(jobs).some(j => j.state !== 'done' && j.state !== 'error' && !P.sequences.some(s => (s.name || '').toLowerCase() === j.seq.toLowerCase()));
  pollSoon(busy ? 3000 : 15000);
}
/* add sequences Claude put in the file, without touching your unsaved edits */
async function pullNewSequences() {
  const f = await fh.getFile(); if (f.lastModified === lastFileStamp) return; lastFileStamp = f.lastModified;
  const data = normalize(JSON.parse(await f.text())); if (!data) return;
  const added = data.sequences.filter(s => !P.sequences.some(x => x.id === s.id));
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
    const line = `/planner new ${name}`; let copied = false; try { await navigator.clipboard.writeText(line); copied = true; } catch (e) {}
    $('#sendMsg').innerHTML = `Request for <b>${esc(name)}</b> saved in <b>${esc(fh.name)}</b> ✓ ${copied ? 'Paste it in the Claude chat (Ctrl+V).' : 'Type in the Claude chat: <b>' + esc(line) + '</b>'} The new tab shows Claude’s progress and opens by itself when it’s ready.`;
    status('Request saved: paste it in the Claude chat');
    jobs[name.toLowerCase()] = { seq: name, pct: 0, step: 'Paste the line in the Claude chat', state: 'waiting' }; paintTabs(); pollSoon();
  };
  d.showModal();
}

/* ---------- beats panel ---------- */
function paintBeats() {
  const R = S.review;
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
    c.querySelectorAll('.picks button').forEach(b => b.onclick = () => { R.picks[id] = R.picks[id] === b.dataset.c ? '' : b.dataset.c; paintPick(); paintTitle(); });
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
  orig[S.id].forEach(b => L.push(`${b.id} (${b.title}): ${R.picks[b.id] || 'no pick'}${R.notes[b.id] ? ' · note: ' + R.notes[b.id].trim() : ''}${tl ? tl.changesText(b.id) : ''}${tools ? tools.text(b.id) : ''}`));
  if ((R.general || '').trim()) L.push('General: ' + R.general.trim());
  return L.join('\n');
}
async function send(kind) {
  if (!P) return;
  const ok = await save({ kind, sequence: S.id, at: new Date().toISOString(), summary: summary(kind) });
  if (!ok) return;
  const line = `/planner ${kind === 'apply' ? 'apply' : 'revise'} ${seqName()}`;
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
async function goStart() { if (!(await confirmDiscard())) return; tl && tl.destroy(); tools && tools.destroy(); tl = tools = null; P = S = null; fh = null; $('#work').hidden = true; $('#start').hidden = false; paintRecent(); paintTitle(); }

/* ---------- menu + keys ---------- */
document.addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
  if (a === 'open') openPicker(); else if (a === 'save') save(); else if (a === 'saveas') saveAs(); else if (a === 'home') goStart(); });
document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : save(); } else if (k === 'o') { e.preventDefault(); openPicker(); }
  else if (P && P.sequences.length > 1 && (e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); const i = P.sequences.indexOf(S) + (e.key === 'PageDown' ? 1 : -1); if (P.sequences[i]) switchSeq(P.sequences[i].id); } }, true);
window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
$('#fileInput').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = normalize(JSON.parse(await f.text())); if (!d) throw new Error('not a planner project'); fh = null; load(d); } catch (err) { status('Could not open: ' + err.message); } };

if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files && p.files[0]) { try { await openHandle(p.files[0]); } catch (e) { status('Could not open: ' + e.message); } } });
if (!canFS) $('#fsNote').hidden = false;
paintRecent();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__planner = { load: d => { fh = null; return load(normalize(d)); }, mountFile: f => mount(f), switchSeq: id => switchSeq(id), seek: t => tl && tl.seek(t) };
