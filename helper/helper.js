#!/usr/bin/env node
/* Planner Helper: lets the Planner app (https://rcz18.github.io/planner-app) run Claude Code on this computer.
   It only listens on 127.0.0.1, only answers the Planner app, and only runs "/planner …" requests
   for .planner files inside the projects folder you picked. No dependencies. */
'use strict';
const http = require('http'), fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), { spawn } = require('child_process');

const VERSION = '1.0.0';
const DIR = __dirname;
const CFG_FILE = path.join(DIR, 'config.json');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (e) {}
const PORT = +cfg.port || 47321;
const ROOT = path.resolve(cfg.root || os.homedir());
const ORIGINS = ['https://rcz18.github.io'].concat(cfg.origins || []);
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
const SKIP = new Set(['node_modules', '.git', '.backups', 'Assets', 'Export', 'Adobe Premiere Pro Auto-Save', 'Adobe Premiere Pro Video Previews', 'Adobe Premiere Pro Audio Previews', '$RECYCLE.BIN', 'System Volume Information']);
const known = new Map(); // "name|id" → path
async function findPlanner(name, id) {
  const key = name + '|' + id, hit = known.get(key);
  if (hit && await matches(hit, id)) return hit;
  const found = [];
  async function walk(d, depth) {
    if (depth > 7 || found.length > 20) return;
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.name === name) found.push(p);
    }
  }
  await walk(ROOT, 0);
  let best = null, bestT = 0;
  for (const p of found) { if (!(await matches(p, id))) continue; const t = (await fsp.stat(p)).mtimeMs; if (t > bestT) { best = p; bestT = t; } }
  if (best) known.set(key, best);
  return best;
}
async function matches(p, id) {
  try { const fd = await fsp.open(p, 'r'); const b = Buffer.alloc(4096); await fd.read(b, 0, 4096, 0); await fd.close();
    const m = /"id"\s*:\s*"([^"]*)"/.exec(b.toString('utf8')); return !id || (m && m[1] === id); } catch (e) { return false; }
}
function projectRoot(file) { const d = path.dirname(file); return path.basename(d).toLowerCase() === 'planner app' ? path.dirname(d) : d; }

/* ---------- the job: one at a time ---------- */
let job = null, child = null, seq = 0;
function stepFrom(ev) {
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content.slice().reverse()) {
      if (c.type === 'tool_use') {
        const i = c.input || {};
        const what = i.description || (i.file_path && path.basename(i.file_path)) || i.pattern || i.skill || i.command || '';
        return (c.name + (what ? ': ' + String(what) : '')).slice(0, 90);
      }
      if (c.type === 'text' && c.text && c.text.trim()) return c.text.trim().split('\n')[0].slice(0, 90);
    }
  }
  return null;
}
async function startJob({ file, project, command }) {
  if (child) throw Object.assign(new Error('Claude Code is still working on the last request.'), { code: 409 });
  if (!/^\/planner(\s+[\w .,#&()'-]{1,80})?$/.test(command || '')) throw Object.assign(new Error('Only /planner requests can be run.'), { code: 400 });
  if (!/\.planner$/i.test(file || '') || /[\\/]/.test(file)) throw Object.assign(new Error('Bad project file name.'), { code: 400 });
  const claude = findClaude(); if (!claude) throw Object.assign(new Error('Claude Code is not installed on this computer. Run the Planner Helper setup again.'), { code: 412 });
  const pf = await findPlanner(file, project);
  if (!pf) throw Object.assign(new Error(`Could not find "${file}" inside ${ROOT}. Is it in your projects folder?`), { code: 404 });
  const cwd = projectRoot(pf);
  const prompt = `Use the planner skill.\nProject file: ${pf}\nRequest: ${command}\nDo the request now, from start to finish, without asking questions. Reply to the user in short, simple Taglish at the end.`;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Write,Edit,MultiEdit,Glob,Grep,Bash,PowerShell,WebFetch,WebSearch,TodoWrite,Skill,Task'];
  if (cfg.model) args.push('--model', cfg.model);
  const id = ++seq, logFile = path.join(LOGS, `job-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  job = { id, state: 'running', step: 'Starting Claude Code…', file: pf, command, started: new Date().toISOString(), lines: [], result: null };
  log('job', id, command, pf);
  const isCmd = /\.(cmd|bat)$/i.test(claude);
  child = spawn(claude, args, { cwd, windowsHide: true, shell: isCmd, env: { ...process.env, PLANNER_FILE: pf } });
  child.stdin.end(prompt);
  const out = fs.createWriteStream(logFile);
  let buf = '';
  child.stdout.on('data', d => { out.write(d); buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
      const s = stepFrom(ev); if (s) { job.step = s; job.lines.push(s); if (job.lines.length > 40) job.lines.shift(); }
      if (ev.type === 'result') { job.result = { ok: !ev.is_error, text: String(ev.result || '').slice(0, 2000), turns: ev.num_turns, seconds: Math.round((ev.duration_ms || 0) / 1000) }; }
    } });
  let err = ''; child.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); out.write(d); });
  child.on('error', e => { job.state = 'error'; job.step = 'Could not start Claude Code: ' + e.message; child = null; log('spawn error', e.message); });
  child.on('close', code => {
    out.end();
    if (job.state === 'running') {
      const ok = code === 0 && (!job.result || job.result.ok);
      job.state = ok ? 'done' : 'error';
      job.step = ok ? 'Done' : (/login|log in|authenticat/i.test(err + (job.result && job.result.text || '')) ? 'Claude Code is not logged in. Open a terminal, type claude, and log in.' : (job.result && job.result.text || err.trim().split('\n').pop() || 'Claude Code stopped (code ' + code + ')').slice(0, 200));
    }
    job.ended = new Date().toISOString(); child = null; log('job', id, job.state, job.step);
  });
  return { id, file: pf };
}

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
      return reply(res, origin, 200, { ok: true, helper: VERSION, claude: !!claude, root: ROOT, busy: !!child, platform: process.platform,
        loggedIn: fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')) || process.platform === 'darwin' ? true : null });
    }
    if (req.method === 'GET' && url.pathname === '/job') return reply(res, origin, 200, { job });
    if (!origin) return reply(res, null, 403, { error: 'Only the Planner app can do that' });
    if (req.method === 'POST' && url.pathname === '/run') {
      let body = ''; for await (const c of req) { body += c; if (body.length > 10000) break; }
      const r = await startJob(JSON.parse(body || '{}'));
      return reply(res, origin, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      if (child) { job.state = 'error'; job.step = 'Stopped'; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }); else child.kill('SIGTERM'); }
      return reply(res, origin, 200, { ok: true });
    }
    reply(res, origin, 404, { error: 'Not found' });
  } catch (e) { reply(res, origin, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); }
});
server.on('error', e => { log('server error', e.code || e.message); if (e.code === 'EADDRINUSE') process.exit(0); });
server.listen(PORT, '127.0.0.1', () => log(`Planner Helper ${VERSION} on http://127.0.0.1:${PORT} · projects: ${ROOT} · claude: ${findClaude() || 'not found'}`));
