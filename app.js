import { createPreview } from './engine.js?v=8';
import { createTimeline, fmtTC } from './timeline.js?v=14';
import { attachTools, wireMic } from './tools.js?v=14';

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

const sig = () => P ? JSON.stringify(P.sequences.filter(s => !s.mirror).map(s => [s.review, s.timeline])) : '';
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
  data.sequences.forEach(s => { s.review ||= {}; s.review.picks ||= {}; s.review.notes ||= {}; s.review.general ||= ''; s.review.moves ||= {}; s.review.cams ||= []; s.review.drawings ||= []; s.review.media ||= []; s.timeline ||= {}; });
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
  $('#start').hidden = true; $('#work').hidden = false; $('#renderBtn').hidden = false; $('#applyAllBtn').hidden = false;
  Object.keys(hist).forEach(k => delete hist[k]); Object.keys(redo).forEach(k => delete redo[k]); Object.keys(last).forEach(k => delete last[k]);
  paintTitle();
  await switchSeq((P.current && P.sequences.find(s => s.id === P.current)) ? P.current : P.sequences[0].id);
  try { lastFileStamp = fh ? (await fh.getFile()).lastModified : 0; } catch (e) {}
  Object.keys(jobs).forEach(k => delete jobs[k]); firstPoll = true; pollSoon(500);
}
async function switchSeq(id) {
  const seq = P.sequences.find(s => s.id === id); if (!seq) return;
  if (pv) pv.video.pause();
  tl && tl.destroy(); tools && tools.destroy(); tl = tools = null;
  S = seq; P.current = id;
  if (S.mirror) deriveMirror(S); else if (!(S.id in last)) last[S.id] = snap(S);
  $('#reviseBtn').disabled = $('#approveBtn').disabled = !!S.mirror; $('.side').classList.toggle('ro', !!S.mirror); paintApprove();
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
  tl = createTimeline($('#timeline'), S, pv, { onChange: changedNow, onUndo: undo, onMedia: (k, m) => { if (k === 'move' && tools) tools.sync(); } });
  tools = attachTools({ P: S, pv, tl, host: $('#monitor'), bar: $('#tools'), hint: $('#toolHint'), onChange: changedNow, onAddMedia: addMedia, mediaSrc });
  $('#tools').hidden = !!S.mirror; if (S.mirror) $('#toolHint').textContent = 'View only: this tab shows P1–P8 back to back, with every change you make in those tabs.';
  pv.video.addEventListener('timeupdate', markBeat); pv.video.addEventListener('seeked', markBeat);
}
function markBeat() { const t = pv.time(); document.querySelectorAll('.beat').forEach(c => c.classList.toggle('live', t >= +c.dataset.t0 && t < +c.dataset.t1)); }

/* ---------- sequence tabs ---------- */
function paintTabs() {
  const bar = $('#seqTabs'); if (!P) { bar.hidden = true; return; } bar.hidden = false;
  const html = P.sequences.map(s => { const r = s.review, n = s.mirror ? 0 : editCount(s);
    const j = jobs[(s.name || s.id).toLowerCase()], show = j && (j.state !== 'done' || j._fresh);
    const pct = j ? Math.max(0, Math.min(100, +j.pct || 0)) : 0, st = j ? (j.state === 'error' ? 'err' : j.state === 'done' ? 'done' : '') : '';
    const prog = show ? `<div class="pbar"><i style="width:${pct}%"></i></div><em>${pct}%</em>` : '';
    return `<button type="button" class="seqTab${s === S ? ' cur' : ''}${show ? ' work ' + st : ''}${r.approved ? ' appr' : ''}" data-seq="${esc(s.id)}" title="${esc(show ? (j.step || '') : (s.label || ''))}"><b>${esc(s.name || s.id.toUpperCase())}${r.approved ? ' <i class="ok">✓</i>' : ''}</b><span>${esc(show ? (j.step || 'Waiting for Claude…') : (s.label || ''))}</span>${n && !show ? '<i class="edits" title="Has your edits"></i>' : ''}${prog}</button>`; }).join('');
  const pend = Object.values(jobs).filter(j => !P.sequences.some(s => (s.name || '').toLowerCase() === j.seq.toLowerCase())).map(j => {
    const pct = Math.max(0, Math.min(100, +j.pct || 0)), st = j.state === 'error' ? 'err' : j.state === 'done' ? 'done' : '';
    return `<div class="seqTab pend ${st}" title="${esc(j.step || '')}"><b>${esc(j.seq)}</b><span>${esc(j.step || 'Waiting for Claude…')}</span><div class="pbar"><i style="width:${pct}%"></i></div><em>${pct}%</em></div>`; }).join('');
  const all = html + pend + `<button type="button" class="seqTab newSeq" data-new="1" title="Ask Claude to plan a new sequence"><b>＋ New</b><span>ask Claude</span></button>`;
  if (bar._h !== all) { bar.innerHTML = all; bar._h = all; }
}
$('#seqTabs').onclick = e => { if (e.target.closest('[data-new]')) { newSeqDialog(); return; } const b = e.target.closest('[data-seq]'); if (b && P && b.dataset.seq !== S.id) switchSeq(b.dataset.seq); };

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
  const added = data.sequences.filter(s => !P.sequences.some(x => x.id === s.id));
  const key = s => JSON.stringify([s.version, s.badge, s.beats, s.css, s.media, s.mirror || null]);
  const done = s => { const j = jobs[(s.name || s.id).toLowerCase()]; return j && j.state === 'done'; };
  const updated = data.sequences.filter(s => { const x = P.sequences.find(y => y.id === s.id); return x && (done(s) || x.mirror || s.mirror || !editCount(x)) && key({ ...x, beats: orig[x.id] }) !== key(s); });
  updated.forEach(s => { const i = P.sequences.findIndex(x => x.id === s.id); orig[s.id] = JSON.parse(JSON.stringify(s.beats)); P.sequences[i] = s; delete last[s.id]; delete hist[s.id]; delete redo[s.id]; });
  if (updated.length) { savedSig = sig(); const u = updated.find(s => s.id === S.id) || updated[0];
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
  orig[S.id].forEach(b => L.push(`${b.id} (${b.title}): ${R.picks[b.id] || 'no pick'}${R.notes[b.id] ? ' · note: ' + R.notes[b.id].trim() : ''}${tl ? tl.changesText(b.id) : ''}${tools ? tools.text(b.id) : ''}`));
  mediaText(S).forEach(x => L.push(x));
  if ((R.general || '').trim()) L.push('General: ' + R.general.trim());
  return L.join('\n');
}
async function send(kind) {
  if (!P) return;
  const ok = await save({ kind, sequence: S.id, at: new Date().toISOString(), summary: summary(kind) });
  if (!ok) return;
  const line = `/planner ${kind === 'apply' ? 'apply' : 'revise'} ${seqName()}`;
  let copied = false; try { await navigator.clipboard.writeText(line); copied = true; } catch (e) {}
  $('#sendMsg').innerHTML = `Saved in <b>${esc(fh.name)}</b> ✓ ${copied ? 'Now paste in the Claude chat (Ctrl+V) and send.' : 'Now type in the Claude chat: <b>' + esc(line) + '</b>'} The ${esc(seqName())} tab shows Claude’s progress and plays the result when it’s ready.`;
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Paste the line in the Claude chat', state: 'waiting', since: new Date().toISOString() };
  paintTabs(); pollSoon();
}
$('#reviseBtn').onclick = () => send('revise');
/* one button: render this exact version and apply it to its Premiere sequence (no plan changes) */
$('#renderBtn').onclick = async () => {
  if (!P || !S) return;
  const R = S.review, edits = Object.values(R.picks).filter(Boolean).length + Object.values(R.notes).filter(x => x && x.trim()).length + Object.keys(S.timeline).length + Object.keys(R.moves || {}).length + (R.cams || []).length + (R.drawings || []).length + ((R.general || '').trim() ? 1 : 0);
  if (edits && !(await ask(`${seqName()} has notes or edits that Claude hasn't done yet. Export ${S.version || 'this version'} as it is now (your notes are ignored)?`, 'Export as is', 'Cancel'))) return;
  const ok = await save({ kind: 'apply', sequence: S.id, at: new Date().toISOString(), summary: `Export ${seqName()} ${S.version || ''}: render exactly as it is in the planner and apply it to its Premiere sequence. No plan changes.` });
  if (!ok) return;
  const line = `/planner export ${seqName()}`;
  let copied = false; try { await navigator.clipboard.writeText(line); copied = true; } catch (e) {}
  $('#sendMsg').innerHTML = `Export for <b>${esc(seqName())} ${esc(S.version || '')}</b> saved ✓ ${copied ? 'Now paste in the Claude chat (Ctrl+V) and send.' : 'Now type in the Claude chat: <b>' + esc(line) + '</b>'} Keep Premiere open with the Claude Apply panel.`;
  status(copied ? 'Copied: ' + line : 'Saved');
  jobs[seqName().toLowerCase()] = { seq: seqName(), pct: 0, step: 'Paste the line in the Claude chat', state: 'waiting', since: new Date().toISOString() };
  paintTabs(); pollSoon();
};


/* ---------- edits: count, undo / redo (Ctrl+Z / Ctrl+Y) ---------- */
function editCount(s) { const r = s.review; return Object.values(r.picks).filter(Boolean).length + Object.values(r.notes).filter(x => x && x.trim()).length + Object.keys(s.timeline || {}).length + Object.keys(r.moves || {}).length + (r.cams || []).length + (r.drawings || []).length + (r.media || []).length + ((r.general || '').trim() ? 1 : 0); }
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
  const o = JSON.parse(str);
  Object.keys(S.timeline).forEach(k => delete S.timeline[k]); Object.assign(S.timeline, o.timeline);
  Object.keys(S.review).forEach(k => delete S.review[k]); Object.assign(S.review, o.review);
  last[S.id] = str; tl && tl.sync && tl.sync(); tools && tools.sync && tools.sync(); paintBeats(); paintApprove(); paintTitle();
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
function deriveMirror(F) {
  const R = F.review; R.moves = {}; R.cams = []; R.media = []; R.picks = {}; R.notes = {}; R.drawings = []; R.general = ''; F.timeline = {};
  (F.mirror || []).forEach(m => { const src = P.sequences.find(s => s.id === m.seq); if (!src) return; const off = +m.offset || 0, pre = m.prefix || '';
    Object.entries(src.review.moves || {}).forEach(([k, v]) => { R.moves[pre + k] = { ...v }; });
    Object.entries(src.timeline || {}).forEach(([k, v]) => { F.timeline[pre + k] = { in: +(v.in + off).toFixed(3), out: +(v.out + off).toFixed(3), off: v.off || 0 }; });
    (src.review.cams || []).forEach(c => R.cams.push({ ...c, t: +(c.t + off).toFixed(3) }));
    (src.review.media || []).forEach(x => R.media.push({ ...x, id: pre + x.id, t0: +(x.t0 + off).toFixed(3), t1: +(x.t1 + off).toFixed(3) }));
    Object.entries(src.review.picks || {}).forEach(([k, v]) => { if (v) R.picks[pre + k] = v; }); });
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
    const mv = Object.entries(r.moves || {}).filter(([k]) => k.startsWith(b.id + ':')); if (mv.length) bits.push('moved (apply exactly, cqw of frame width): ' + mv.map(([k, m]) => `el#${k.split(':')[1]} x${m.x >= 0 ? '+' : ''}${m.x} y${m.y >= 0 ? '+' : ''}${m.y}${Math.abs((m.s || 1) - 1) > .001 ? ' size ' + Math.round(m.s * 100) + '%' : ''}`).join('; '));
    const tm = Object.entries(s.timeline || {}).filter(([k]) => k.startsWith(b.id + ':')); if (tm.length) bits.push('timeline (apply exactly): ' + tm.map(([k, v]) => `el#${k.split(':')[1]} in ${(+v.in).toFixed(2)} s, out ${(+v.out).toFixed(2)} s${Math.abs(v.off || 0) > .004 ? ' (whole clip moved)' : ''}`).join('; '));
    const ks = (r.cams || []).filter(k => k.t >= b.t0 && k.t < b.t1); if (ks.length) bits.push('my zoom/pan (use exactly): ' + ks.map(k => `${k.t.toFixed(2)} s zoom ${Math.round(k.s * 100)}% x ${k.x}% y ${k.y}%`).join('; '));
    (r.drawings || []).filter(d => d.beat === b.id).forEach(d => bits.push(`drawing at 0:${d.t.toFixed(1)}${d.note ? ': ' + d.note : ''} (sketch in project file)`));
    if (bits.length) L.push(`${b.id} (${b.title}): ${bits.join(' · ')}`); });
  mediaText(s).forEach(x => L.push(x));
  if ((r.general || '').trim()) L.push('General: ' + r.general.trim());
  return L;
}
$('#applyAllBtn').onclick = async () => {
  if (!P) return; checkpoint(true);
  const list = P.sequences.filter(s => !s.mirror && (editCount(s) || s.review.approved));
  if (!list.length) { status('No changes yet in any tab'); return; }
  const summary = ['Apply all my changes (revise every tab listed; tabs marked APPROVED need no changes unless they have notes):'].concat(...list.map(seqText)).join('\n');
  const ok = await save({ kind: 'revise-all', sequence: 'all', sequences: list.map(s => s.id), at: new Date().toISOString(), summary });
  if (!ok) return;
  const line = '/planner apply all changes'; let copied = false; try { await navigator.clipboard.writeText(line); copied = true; } catch (e) {}
  $('#sendMsg').innerHTML = `All changes (${list.map(s => esc(s.name || s.id)).join(', ')}) saved in <b>${esc(fh.name)}</b> ✓ ${copied ? 'Now paste in the Claude chat (Ctrl+V) and send.' : 'Now type in the Claude chat: <b>' + esc(line) + '</b>'}`;
  status(copied ? 'Copied: ' + line : 'Saved');
  list.forEach(s => { const n = s.name || s.id.toUpperCase(); if (!s.review.approved || editCount(s)) jobs[n.toLowerCase()] = { seq: n, pct: 0, step: 'Waiting for Claude', state: 'waiting', since: new Date().toISOString() }; });
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
$('#fileInput').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = normalize(JSON.parse(await f.text())); if (!d) throw new Error('not a planner project'); fh = null; load(d); } catch (err) { status('Could not open: ' + err.message); } };

if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files && p.files[0]) { try { await openHandle(p.files[0]); } catch (e) { status('Could not open: ' + e.message); } } });
if (!canFS) $('#fsNote').hidden = false;
paintRecent();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
window.__planner = { load: d => { fh = null; return load(normalize(d)); }, mountFile: f => mount(f), switchSeq: id => switchSeq(id), seek: t => tl && tl.seek(t) };
