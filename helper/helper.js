#!/usr/bin/env node
/* Planner Helper: lets the Planner app (https://rcz18.github.io/planner-app) run Claude Code on this computer.
   It only listens on 127.0.0.1, only answers the Planner app, and only runs "/planner …" requests
   for .planner files inside the projects folder you picked. No dependencies. */
'use strict';
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), { spawn, spawnSync } = require('child_process');

const VERSION = '1.3.0';
const DIR = __dirname;
const CFG_FILE = path.join(DIR, 'config.json');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch (e) {}
const PORT = +cfg.port || 47321;
const ROOT = path.resolve(cfg.root || os.homedir());
const ORIGINS = ['https://rcz18.github.io'].concat(cfg.origins || []);
if (process.platform !== 'win32') {
  const extra = [cfg.claude && path.dirname(cfg.claude), path.dirname(process.execPath), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean);
  process.env.PATH = [...new Set(extra.concat(String(process.env.PATH || '').split(':')).filter(Boolean))].join(':');
}
const LOGS = path.join(DIR, 'logs'); try { fs.mkdirSync(LOGS, { recursive: true }); } catch (e) {}
const log = (...a) => { const line = new Date().toISOString() + ' ' + a.join(' '); try { fs.appendFileSync(path.join(LOGS, 'helper.log'), line + '\n'); } catch (e) {} if (process.stdout.isTTY) console.log(line); };

/* ---------- find Claude Code ---------- */
function findClaude() {
  const cands = [cfg.claude,
    path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
    process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'npm', 'claude.cmd') : '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch (e) {} }
  return null;
}

/* ---------- find the project file the app has open (the browser does not tell us its full path) ---------- */
const SKIP = new Set(['Adobe Premiere Pro Captured and Generated', 'Motion Graphics Template Media', 'Animation Composer', 'Downloads', 'Mogrts', 'media', 'Library', 'node_modules', '.git', '.backups', 'Assets', 'Export', 'Adobe Premiere Pro Auto-Save', 'Adobe Premiere Pro Video Previews', 'Adobe Premiere Pro Audio Previews', '$RECYCLE.BIN', 'System Volume Information']);
const KNOWN_FILE = path.join(DIR, 'known.json');   // remembers where each project file lives, so a big Google Drive folder is not searched every time
const known = new Map(Object.entries((() => { try { return JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return {}; } })())); // "name|id" → path
const saveKnown = () => { try { fs.writeFileSync(KNOWN_FILE, JSON.stringify(Object.fromEntries(known), null, 1)); } catch (e) {} };
async function findPlanner(name, id) {
  const key = name + '|' + id, hit = known.get(key);
  if (hit && await matches(hit, id)) return hit;
  const found = [], t0 = Date.now(); let slow = false;
  async function walk(d, depth) {
    if (depth > 7 || found.length > 20) return;
    if (Date.now() - t0 > 90000) { slow = true; return; }
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name === name) found.push(p);
    }
  }
  log('searching for', name, 'in', ROOT);
  await walk(ROOT, 0);
  log('search done', name, found.length, 'found', Math.round((Date.now() - t0) / 1000) + 's');
  let best = null, bestT = 0;
  for (const p of found) { if (!(await matches(p, id))) continue; const t = (await fsp.stat(p)).mtimeMs; if (t > bestT) { best = p; bestT = t; } }
  if (best) { known.set(key, best); saveKnown(); }
  else if (slow) throw Object.assign(new Error(`Searching ${ROOT} took too long and "${name}" was not found yet. Open the project file once more, then try again.`), { code: 504 });
  return best;
}
async function matches(p, id) {
  try { const fd = await fsp.open(p, 'r'); const b = Buffer.alloc(4096); await fd.read(b, 0, 4096, 0); await fd.close();
    const m = /"id"\s*:\s*"([^"]*)"/.exec(b.toString('utf8')); return !id || (m && m[1] === id); } catch (e) { return false; }
}
function projectRoot(file) { const d = path.dirname(file); return path.basename(d).toLowerCase() === 'planner app' ? path.dirname(d) : d; }

/* ---------- the queue: one job runs at a time, the rest wait their turn ---------- */
let job = null, child = null, seq = 0;
const queue = [], history = [];
function stepFrom(ev) {
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content.slice().reverse()) {
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const what = i.description || (i.file_path && path.basename(i.file_path)) || i.pattern || i.skill || i.command || '';
        return { tool: true, text: (c.name + (what ? ': ' + String(what) : '')).slice(0, 90) };
      }
      if (c.type === 'text' && c.text && c.text.trim()) return { tool: false, text: c.text.trim().split('\n')[0].slice(0, 140) };
    }
  }
  return null;
}
function parse(command) {   // "/planner revise P2" → { kind: 'revise', seq: 'P2' }
  const w = String(command || '').replace(/^\/planner\s*/, '').trim().split(/\s+/);
  const kind = (w[0] || 'request').toLowerCase();
  if (kind === 'apply' && /^all$/i.test(w[1] || '')) return { kind: 'apply all changes', seq: 'all' };
  return { kind, seq: w[1] || '', beat: w[2] || '' };
}
/* model / effort for one job (the app's pickers beside Revise); anything unexpected is ignored */
const MODEL_RE = /^[A-Za-z0-9._:\[\]-]{1,80}$/, EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const pickModel = m => typeof m === 'string' && MODEL_RE.test(m) ? m : '';
const pickEffort = e => EFFORTS.includes(e) ? e : '';
let effortCheck = { at: 0, ok: false };
function effortOk(claude) {   // older Claude Code has no --effort: ask its --help once in a while instead of failing the job
  if (Date.now() - effortCheck.at < 10 * 60 * 1000) return effortCheck.ok;
  let ok = false;
  try { const r = spawnSync(claude, ['--help'], { encoding: 'utf8', timeout: 30000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(claude) }); ok = /--effort\b/.test(String(r.stdout || '') + String(r.stderr || '')); } catch (e) {}
  effortCheck = { at: Date.now(), ok }; log('claude --effort', ok ? 'supported' : 'not supported (update Claude Code to use it)'); return ok;
}
const pub = j => j && { id: j.id, seq: j.seq, kind: j.kind, beat: j.beat, command: j.command, model: j.model || '', effort: j.effort || '', file: path.basename(j.file || ''), state: j.state, step: j.step, pct: j.pct, steps: j.steps.slice(-8),
  queuedAt: j.queuedAt, started: j.started, ended: j.ended, result: j.result };
function snapshot() { return { job: pub(job && job.state === 'running' ? job : job), running: !!child, queue: queue.map(pub), history: history.slice(0, 15).map(pub), helper: VERSION }; }
async function readStatusPct(j) {   // the % Claude writes into planner-status.json (if any)
  for (const f of [path.join(path.dirname(j.file), 'planner-status.json'), path.join(path.dirname(j.file), 'Planner App', 'planner-status.json')]) {
    try { const st = JSON.parse(await fsp.readFile(f, 'utf8')); const it = (st.jobs || []).find(x => String(x.seq).toLowerCase() === String(j.seq).toLowerCase() && (!x.at || x.at >= j.started || x.state !== 'done'));
      if (it && +it.pct) return Math.min(99, +it.pct); } catch (e) {}
  }
  return 0;
}
async function enqueue({ file, project, command, request, model, effort }) {
  if (!/^\/planner(\s+[\w .,#&()'-]{1,80})?$/.test(command || '')) throw Object.assign(new Error('Only /planner requests can be run.'), { code: 400 });
  if (!/\.planner$/i.test(file || '') || /[\\/]/.test(file)) throw Object.assign(new Error('Bad project file name.'), { code: 400 });
  if (!findClaude()) throw Object.assign(new Error('Claude Code is not installed on this computer. Run the Planner Helper setup again.'), { code: 412 });
  const pf = await findPlanner(file, project);
  if (!pf) throw Object.assign(new Error(`Could not find "${file}" inside ${ROOT}. Is it in your projects folder?`), { code: 404 });
  const rq = request && typeof request === 'object' ? request : null;
  const jm = pickModel(model || (rq && rq.model)), je = pickEffort(effort || (rq && rq.effort));
  const same = queue.find(q => q.file === pf && q.command === command);
  if (same) { if (jm) same.model = jm; if (je) same.effort = je; if (rq) same.request = rq; return { id: same.id, file: pf, position: queue.indexOf(same) + 1 + (child ? 1 : 0), queued: true }; }
  const p = parse(command);
  const j = { id: ++seq, file: pf, command, request: rq, model: jm, effort: je, ...p, state: 'queued', step: 'Waiting in line', pct: 0, steps: [], lines: [], queuedAt: new Date().toISOString(), result: null };
  queue.push(j); log('queued', j.id, command, '(' + queue.length + ' waiting)');
  setImmediate(next);
  return { id: j.id, file: pf, position: queue.indexOf(j) + 1 + (child ? 1 : 0), queued: !!child };
}
function next() {
  if (child || !queue.length) return;
  const j = queue.shift(); job = j;
  const claude = findClaude(); if (!claude) { j.state = 'error'; j.step = 'Claude Code is not installed'; finish(j); return; }
  const cwd = projectRoot(j.file);
  const prompt = `Use the planner skill.\nProject file: ${j.file}\nComputer: ${process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows PC' : process.platform}\nRequest: ${j.command}\n${j.request ? 'Request details for THIS job (the project file\'s `request` field may already be a newer queued request, so use these): ' + JSON.stringify(j.request).slice(0, 60000) + '\n' : ''}Do the request now, from start to finish, without asking questions. Reply to the user in short, simple Taglish at the end.`;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Write,Edit,MultiEdit,Glob,Grep,Bash,' + (process.platform === 'win32' ? 'PowerShell,' : '') + 'WebFetch,WebSearch,TodoWrite,Skill,Task'];
  let model = cfg.model; try { model = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8').replace(/^\uFEFF/, '')).model; } catch (e) {}   // read fresh, so a fixed config works without a restart
  if (j.model) model = j.model;   // picked beside Revise in the app
  if (model && MODEL_RE.test(model)) args.push('--model', model);
  if (j.effort && effortOk(claude)) args.push('--effort', j.effort);
  const logFile = path.join(LOGS, `job-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  Object.assign(j, { state: 'running', step: 'Starting Claude Code…', pct: 3, started: new Date().toISOString() });
  log('job', j.id, j.command, j.file, (j.model || model || 'default model') + (j.effort ? ' · effort ' + j.effort : ''));
  const isCmd = /\.(cmd|bat)$/i.test(claude);
  try { child = spawn(claude, args, { cwd, windowsHide: true, shell: isCmd, env: { ...process.env, PLANNER_FILE: j.file } }); }
  catch (e) { j.state = 'error'; j.step = 'Could not start Claude Code: ' + e.message; finish(j); return; }
  child.stdin.end(prompt);
  const out = fs.createWriteStream(logFile);
  let buf = '', tools = 0;
  const tick = setInterval(async () => { if (j.state !== 'running') return clearInterval(tick);
    const mins = (Date.now() - Date.parse(j.started)) / 60000, est = Math.min(92, 5 + tools * 6 + mins * 4);
    j.pct = Math.round(Math.max(j.pct, est, await readStatusPct(j))); }, 2000);
  child.stdout.on('data', d => { out.write(d); buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      const s = stepFrom(ev); if (s) { if (s.tool) tools++; j.step = s.text; j.steps.push({ t: new Date().toISOString(), text: s.text, said: !s.tool }); if (j.steps.length > 60) j.steps.shift(); }
      if (ev.type === 'result') { j.result = { ok: !ev.is_error, text: String(ev.result || '').slice(0, 2000), turns: ev.num_turns, seconds: Math.round((ev.duration_ms || 0) / 1000) }; }
    } });
  let err = ''; child.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); out.write(d); });
  child.on('error', e => { j.state = 'error'; j.step = 'Could not start Claude Code: ' + e.message; });
  child.on('close', code => {
    out.end(); clearInterval(tick);
    if (j.state === 'running') {
      const ok = code === 0 && (!j.result || j.result.ok);
      j.state = ok ? 'done' : 'error';
      j.step = ok ? 'Done' : (/login|log in|authenticat/i.test(err + (j.result && j.result.text || '')) ? 'Claude Code is not logged in. Open a terminal, type claude, and log in.' : (j.result && j.result.text || err.trim().split('\n').pop() || 'Claude Code stopped (code ' + code + ')').slice(0, 200));
    }
    child = null; finish(j);
  });
}
function finish(j) {
  j.ended = new Date().toISOString(); if (j.state === 'done') j.pct = 100;
  history.unshift(j); if (history.length > 30) history.pop();
  log('job', j.id, j.state, j.step); child = null; setImmediate(next);
}
function cancel(id) {
  const i = queue.findIndex(q => q.id === +id);
  if (i >= 0) { const [j] = queue.splice(i, 1); j.state = 'cancelled'; j.step = 'Removed from the queue'; j.ended = new Date().toISOString(); history.unshift(j); return true; }
  if (job && job.id === +id && child) { job.state = 'cancelled'; job.step = 'Stopped'; killChild(); return true; }
  return false;
}
function killChild() { if (!child) return; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }); else child.kill('SIGTERM'); }

/* ---------- http ---------- */
function reply(res, origin, code, body) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) Object.assign(h, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
  res.writeHead(code, h); res.end(JSON.stringify(body));
}
const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.writeHead(403); return res.end(); }    // DNS-rebinding guard
  const origin = req.headers.origin && ORIGINS.includes(req.headers.origin) ? req.headers.origin : null;
  if (req.headers.origin && !origin) return reply(res, null, 403, { error: 'Not allowed' });
  if (req.method === 'OPTIONS') return reply(res, origin, 204, {});
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      const claude = findClaude();
      return reply(res, origin, 200, { ok: true, helper: VERSION, claude: !!claude, root: ROOT, busy: !!child, queued: queue.length, queue: true, platform: process.platform,
        loggedIn: (fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')) || process.platform === 'darwin') ? true : null });
    }
    if (req.method === 'GET' && url.pathname === '/job') return reply(res, origin, 200, snapshot());
    if (req.method === 'GET' && url.pathname === '/queue') return reply(res, origin, 200, snapshot());
    if (!origin) return reply(res, null, 403, { error: 'Only the Planner app can do that' });
    if (req.method === 'POST' && url.pathname === '/run') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 400000) break; }
      const r = await enqueue(JSON.parse(body || '{}'));
      return reply(res, origin, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && url.pathname === '/cancel') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 1000) break; }
      return reply(res, origin, 200, { ok: cancel((JSON.parse(body || '{}')).id) });
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      if (child && job) { job.state = 'cancelled'; job.step = 'Stopped'; killChild(); }
      return reply(res, origin, 200, { ok: true });
    }
    reply(res, origin, 404, { error: 'Not found' });
  } catch (e) { reply(res, origin, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); }
});
server.on('error', e => { log('server error', e.code || e.message); if (e.code === 'EADDRINUSE') process.exit(0); });
server.listen(PORT, '127.0.0.1', () => log(`Planner Helper ${VERSION} on http://127.0.0.1:${PORT} · projects: ${ROOT} · claude: ${findClaude() || 'not found'}`));
