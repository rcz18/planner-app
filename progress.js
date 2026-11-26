/* Progress: the queue of Claude Code requests (now / waiting / done) in a window, plus the sounds. */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const KIND = { revise: 'Revise', 'revise-all': 'Apply all changes', 'apply all changes': 'Apply all changes', ideas: 'Suggestions', suggest: 'Looks', apply: 'Apply', export: 'Export', new: 'New sequence', brand: 'Brand' };
export const kindName = k => KIND[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Request');
const MODEL = { 'claude-opus-5-5': 'Opus 5.5', 'claude-fable-5-2': 'Fable 5.2' }, EFFORT = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra', max: 'Max' };
const ccOf = j => j.model || j.effort ? ' · ' + [MODEL[j.model] || j.model, EFFORT[j.effort] || j.effort].filter(Boolean).join(' ') : '';
const ago = iso => { if (!iso) return ''; const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
const clock = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

/* ---------- sounds (Web Audio, no files) ---------- */
let ac = null;
const ctx = () => { try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {} return ac; };
document.addEventListener('pointerdown', () => ctx(), { once: true, capture: true });
function tone(f, t0, dur, vol = 0.16, type = 'sine') { const a = ctx(); if (!a) return; const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.0001, a.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, a.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + dur);
  o.connect(g); g.connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + dur + 0.05); }
export const sound = {
  on: () => localStorage.getItem('planner-sound') !== 'off',
  set: v => localStorage.setItem('planner-sound', v ? 'on' : 'off'),
  ding() { if (!sound.on()) return; tone(880, 0, 0.35); tone(1318.5, 0.09, 0.45, 0.12); },                                   // one request done
  all() { if (!sound.on()) return; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.6, 0.13)); },        // the whole queue is done
  err() { if (!sound.on()) return; tone(330, 0, 0.3, 0.14, 'triangle'); tone(262, 0.16, 0.4, 0.12, 'triangle'); },
};

/* ---------- the window ----------
   o: { get() → { job, queue, history, helper } | null, cancel(id), stop(), jobsFallback() } */
export function openProgress(o) {
  const w = document.createElement('div'); w.className = 'ideasWin progWin';
  w.innerHTML = `<div class="iwBox pgBox" role="dialog" aria-label="Claude progress"><header><b>⏳ Claude Code · progress</b><label class="pgSnd"><input type="checkbox" ${sound.on() ? 'checked' : ''}> 🔔 Sound when done</label><button type="button" class="btn iwX" title="Close (Esc)">✕</button></header><main class="iwBody pgBody"></main></div>`;
  document.body.appendChild(w);
  const body = w.querySelector('.pgBody');
  w.querySelector('.pgSnd input').onchange = e => { sound.set(e.target.checked); if (e.target.checked) sound.ding(); };
  const row = (j, i) => `<li data-id="${j.id}"><span class="pgNo">#${i}</span><b>${esc(j.seq || '')}</b><span class="pgKind">${esc(kindName(j.kind))}${j.beat ? ' · ' + esc(j.beat) : ''}${esc(ccOf(j))}</span><span class="pgWhen">waiting ${ago(j.queuedAt)}</span><button type="button" class="btn sm" data-cancel="${j.id}" title="Remove from the queue">✕</button></li>`;
  function paint() {
    const d = o.get();
    if (!d) { const J = o.jobsFallback(); body.innerHTML = `<p class="pgNote">Claude Code is not connected on this computer, so requests go to the Claude chat.</p>` + (J.length ? `<ul class="pgList">${J.map(j => `<li><b>${esc(j.seq)}</b><span class="pgKind">${esc(j.step || '')}</span><span class="pgWhen">${j.state === 'done' ? '✓ done' : (+j.pct || 0) + '%'}</span></li>`).join('')}</ul>` : ''); return; }
    const cur = d.job && d.job.state === 'running' ? d.job : null, q = d.queue || [], h = (d.history || []).filter(x => x.state !== 'queued');
    body.innerHTML = `
      <section><h4>Now</h4>${cur ? `<div class="pgNow"><div class="pgHead"><b>${esc(cur.seq)}</b><span class="pgKind">${esc(kindName(cur.kind))}${cur.beat ? ' · ' + esc(cur.beat) : ''}${esc(ccOf(cur))}</span><span class="pgWhen">${ago(cur.started)}</span><button type="button" class="btn sm" data-stop="1" title="Stop this request">■ Stop</button></div>
          <div class="pgBar"><i style="width:${Math.max(3, +cur.pct || 0)}%"></i></div><p class="pgStep">${esc(cur.step || '')} · <b>${+cur.pct || 0}%</b></p>
          ${(cur.steps || []).length ? `<ol class="pgSteps">${cur.steps.slice(-6).map(s => `<li class="${s.said ? 'said' : ''}">${esc(s.text)}</li>`).join('')}</ol>` : ''}</div>`
        : `<p class="pgNote">${q.length ? 'Starting the next one…' : 'Nothing running. Claude Code is free.'}</p>`}</section>
      <section><h4>Queue <span class="pgCount">${q.length || ''}</span></h4>${q.length ? `<ul class="pgList">${q.map((j, i) => row(j, i + 2)).join('')}</ul>` : '<p class="pgNote">No one waiting.</p>'}</section>
      <section><h4>Done</h4>${h.length ? `<ul class="pgList done">${h.slice(0, 12).map(j => `<li class="${j.state}"><span class="pgIcon">${j.state === 'done' ? '✓' : j.state === 'cancelled' ? '–' : '!'}</span><b>${esc(j.seq || '')}</b><span class="pgKind">${esc(kindName(j.kind))}${j.beat ? ' · ' + esc(j.beat) : ''}${esc(ccOf(j))}</span><span class="pgWhen">${clock(j.ended)}${j.started && j.ended ? ' · ' + Math.max(1, Math.round((Date.parse(j.ended) - Date.parse(j.started)) / 1000)) + 's' : ''}</span>${j.result && j.result.text ? `<p>${esc(j.result.text.split('\n')[0].slice(0, 220))}</p>` : j.state !== 'done' ? `<p>${esc(j.step || '')}</p>` : ''}</li>`).join('')}</ul>` : '<p class="pgNote">Nothing yet.</p>'}</section>`;
  }
  body.onclick = async e => { const c = e.target.dataset.cancel, s = e.target.dataset.stop; if (c) { await o.cancel(+c); paint(); } if (s) { await o.stop(); paint(); } };
  const close = () => api.close();
  w.querySelector('.iwX').onclick = close; w.addEventListener('mousedown', e => { if (e.target === w) close(); });
  const keys = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', keys, true);
  const t = setInterval(paint, 1000); paint();
  const api = { close() { clearInterval(t); document.removeEventListener('keydown', keys, true); w.remove(); o.onClose && o.onClose(); } };
  return api;
}
