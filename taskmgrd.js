#!/usr/bin/env node
// taskmgrd: the sync daemon. It watches taskmgr.json and the tasks folder of every work and
// repository listed there, and pushes what changes to a remote tm server with push.js (what `tm push`
// runs once by hand; it has the .env settings and what a push sends).
//
//   node taskmgrd.js          ./start.sh runs it under pm2 with the web UI (ecosystem.config.cjs),
//                             when SYNC_SERVER is set in .env; pm2 logs taskmgrd follows its log
//
// taskmgr.json is pushed when it changes; an invalid one is not pushed, and the folders of the last
// good one stay watched. A tasks folder is pushed whenever anything in it changes. A tasks folder that
// does not exist is looked for until it appears. At startup taskmgr.json is pushed once; then, and
// every few minutes after that, the daemon asks the server what it has and pushes what differs; so a
// change missed by the file system, or a server that lost its data, is put right. A push that fails
// is retried, with growing waits, until the server answers again.
//
// .env says what the daemon does. PUSHING=1 (the default) is all of the above; PUSHING=0 turns it
// off. With POLLING=1 the daemon also pulls: once when it starts, before its first push, and then
// every POLLING_INTERVAL seconds (600, ten minutes, when not set), it runs pull.js as `tm pull`
// does, so a change made on the server, or pushed to it by another machine, comes here. With
// AI_RUNNER=1 it also runs Claude Code for the server: a task pushed from here can be run from the
// server's web UI, and runs here, where the tasks, the source code and the claude login are (see
// ai/runner.js); with AI_RUNNER_WINDOW=1 as well, each of those runs opens a terminal window here
// that shows it as it goes (ai/window.js; on macOS Terminal.app, or iTerm2 with AI_RUNNER_TERMINAL=iterm)
// and closes by itself AI_RUNNER_WINDOW_CLOSE seconds after the run (10 when not set; 0 keeps it until
// Enter). With all three off, or without SYNC_SERVER, it has nothing to do, and with a
// POLLING_INTERVAL that is not a number of seconds it cannot poll: it says so and exits with 0 (pm2
// then leaves it stopped rather than starting it again and again, see ecosystem.config.cjs).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { spaceKey } = require('./server/sync');
const { loadDotenv, POLL_STATE_PATH } = require('./server/config');
const { trimLogs } = require('./utils/logfile');

// What .env turns on, looked at before push.js is loaded (it exits with an error when the server is
// not set): whether the daemon pushes (on unless PUSHING is 0), whether it pulls too (off unless
// POLLING is 1), and how often, in seconds.
loadDotenv();
const isOn = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const PUSHING = String(process.env.PUSHING || '').trim() === '' || isOn(process.env.PUSHING);
const POLLING = isOn(process.env.POLLING);
const AI_RUNNER = isOn(process.env.AI_RUNNER);
const AI_RUNNER_WINDOW = AI_RUNNER && isOn(process.env.AI_RUNNER_WINDOW);
// Which terminal that window is, on macOS (Terminal.app unless AI_RUNNER_TERMINAL says iterm), and
// how many seconds it stays after the run before closing by itself (10; 0 keeps it until Enter).
const terminalSetting = String(process.env.AI_RUNNER_TERMINAL || '').trim().toLowerCase();
const AI_RUNNER_TERMINAL = /^iterm2?$/.test(terminalSetting) ? 'iterm' : 'terminal';
const closeSetting = String(process.env.AI_RUNNER_WINDOW_CLOSE ?? '').trim();
const AI_RUNNER_WINDOW_CLOSE = closeSetting !== '' && Number(closeSetting) >= 0 ? Number(closeSetting) : 10;
function notRunning(why) {
  console.log(`taskmgrd: ${why}; not running.`);
  process.exit(0);
}
if (!String(process.env.SYNC_SERVER || '').trim()) notRunning('SYNC_SERVER is not set in .env, no server to sync with');
if (!PUSHING && !POLLING && !AI_RUNNER) notRunning('PUSHING=0, POLLING=0 and no AI_RUNNER=1 in .env, nothing to do');

const { SERVER, TOKEN, MACHINE_ID, CONFIG_PATH, log, warn, die, syncLog, logTo, readConfig, spacesOf, label, snapshot, isDir, serverState, pushConfig, pushSpace } = require('./push');
const { startRunner } = require('./ai/runner');

// The daemon's pushes (and the pulls it runs) are logged apart from those made by hand (`tm push`,
// `tm pull`: logs/taskmgr.log).
const DAEMON_LOG = path.join(__dirname, 'logs', 'taskmgrd.log');
logTo(DAEMON_LOG);
trimLogs(path.dirname(DAEMON_LOG));  // every log in logs/ kept under 10 MB (see utils/logfile.js)

const DEBOUNCE_MS = 10 * 1000;          // a change waits this long, and each new one restarts the wait
const RESCAN_MS = 5 * 60 * 1000;        // how often the server is asked what it has, and everything compared
const MISSING_POLL_MS = 30 * 1000;      // how often a missing tasks folder is looked for
const RETRY_MS = [5000, 15000, 60000];  // waits before retrying after a failed push, the last one repeating

const POLLING_INTERVAL_S = POLLING ? pollingInterval() : 0;
function pollingInterval() {
  const raw = String(process.env.POLLING_INTERVAL || '').trim();
  if (!raw) return 600;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) notRunning(`POLLING_INTERVAL in .env must be a whole number of seconds, 1 or more, not "${raw}"`);
  return n;
}

// What the server has: the hash of its config and of each space's snapshot. Kept up to date with
// every push, and asked again at each rescan.
let onServer = { config: null, spaces: {} };

// ---------- the push queue ----------

// One job per key ("config", or a space's key), the latest replacing an older one still waiting.
// Jobs go out one at a time, the config first since the server prunes by it. After a failure the
// queue waits and tries again from the start.
const queue = new Map();
let drainPromise = null;   // the drain under way, if one is
let failures = 0;
let retryTimer = null;

function enqueue(job) {
  queue.delete(job.key);
  queue.set(job.key, job);
}

// Push one job; resolves to the line to log about it.
async function pushJob(job) {
  if (job.key === 'config') {
    const done = await pushConfig(job.text);
    onServer.config = job.hash;
    return done;
  }
  const done = await pushSpace(job.space, job);
  onServer.spaces[job.key] = job.hash;
  return done;
}

// Push what is queued; resolves once the queue is empty, or a failed push has scheduled a retry.
// Nothing is pushed while a pull runs (see poll): the folders are scanned again when it is through.
function drain() {
  if (pulling) return Promise.resolve();
  if (!drainPromise) drainPromise = drainQueue().finally(() => { drainPromise = null; });
  return drainPromise;
}

async function drainQueue() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const name = (job) => (job.key === 'config' ? 'taskmgr.json' : label(job.space));
  let pushed = 0;
  if (queue.size) syncLog('info', `pushing ${[...queue.values()].map(name).join(', ')}`);
  while (queue.size) {
    const job = queue.has('config') ? queue.get('config') : queue.values().next().value;
    let done;
    try {
      done = await pushJob(job);
    } catch (e) {
      failures++;
      const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
      syncLog(false, `${name(job)}: ${e.message}; trying again in ${wait / 1000}s`);
      warn(`${name(job)}: ${e.message}; trying again in ${wait / 1000}s`);
      retryTimer = setTimeout(() => { retryTimer = null; drain(); }, wait);
      return;
    }
    if (failures) log(`${SERVER} answers again`);
    failures = 0;
    log(done);
    syncLog(true, done);
    pushed++;
    if (queue.get(job.key) === job) queue.delete(job.key);  // a newer one may have replaced it meanwhile
  }
  if (pushed) syncLog('info', 'push finished');
}

// ---------- watching ----------

let current = null;        // the last good config: { text, hash, works }
const roots = new Map();   // tasks folder -> { root, spaces, watcher, timer, pollTimer, missing, scanning }

// Compare a tasks folder with what the server has and queue the spaces that differ. A folder that
// is not there is looked for from time to time instead. `why` says what brought it on, for the log:
// 'changed' (something in the folder did) or 'rescan' (the server was polled). The scan under way
// is kept in r.scanning, so a pull can wait for it (see flushChanges).
function scanRoot(root, why = 'changed') {
  const r = roots.get(root);
  if (!r) return Promise.resolve();
  const scan = scanRootNow(r, why).finally(() => { if (r.scanning === scan) r.scanning = null; });
  r.scanning = scan;
  return scan;
}

async function scanRootNow(r, why) {
  const root = r.root;
  if (pulling) return;  // the pull is writing here; every folder is scanned again once it is through (see poll)
  if (!isDir(root)) {
    if (!r.missing) {
      warn(`${root}: folder not found (${r.spaces.map(label).join(', ')}); waiting for it`);
      r.missing = true;
    }
    stopWatching(r);
    if (!r.pollTimer) r.pollTimer = setTimeout(() => { r.pollTimer = null; scanRoot(root, why); }, MISSING_POLL_MS);
    return;
  }
  if (r.missing) {
    log(`${root}: folder found`);
    r.missing = false;
  }
  if (!r.watcher) watchRoot(r);
  syncLog('info', why === 'changed' ? `${root} changed: checking it` : `checking ${root}`);
  // A newer scan of the same folder started meanwhile, or the folder was dropped: this one's result
  // is left out.
  const seq = r.scanSeq = (r.scanSeq || 0) + 1;
  let snap;
  try {
    snap = await snapshot(root);
  } catch (e) {
    warn(`${root}: ${e.message}`);
    return;
  }
  if (roots.get(root) !== r || r.scanSeq !== seq) return;
  if (pulling) return;  // a pull began while the snapshot was taken: it is of the folder before the pull
  const { entries, blobs, hash } = snap;
  let queued = 0;
  for (const s of r.spaces) {
    const key = spaceKey(s);
    if (onServer.spaces[key] !== hash) { enqueue({ key, space: s, entries, blobs, hash }); queued++; }
    else queue.delete(key);  // a push still waiting is of an older state of the folder: no longer wanted
  }
  syncLog('info', `checked ${root}: ${queued ? `${queued === r.spaces.length ? '' : `${queued} of ${r.spaces.length} `}to push` : 'same as on the server'}`);
  drain();
}

function scheduleScan(root) {
  const r = roots.get(root);
  if (!r) return;
  if (r.timer) clearTimeout(r.timer);
  r.timer = setTimeout(() => { r.timer = null; scanRoot(root); }, DEBOUNCE_MS);
}

function watchRoot(r) {
  try {
    r.watcher = fs.watch(r.root, { recursive: true }, () => scheduleScan(r.root));
  } catch (e) {
    // No recursive watching here (an older Linux): look at the folder every so often instead.
    r.watcher = { close() { clearInterval(this.id); }, id: setInterval(() => scheduleScan(r.root), MISSING_POLL_MS) };
    warn(`${r.root}: cannot watch (${e.code || e.message}); checking it every ${MISSING_POLL_MS / 1000}s instead`);
    return;
  }
  // The folder went away, or was replaced: the next scan finds out and watches again.
  r.watcher.on('error', () => { stopWatching(r); scheduleScan(r.root); });
}

function stopWatching(r) {
  if (r.watcher) {
    try { r.watcher.close(); } catch (e) { /* already closed */ }
    r.watcher = null;
  }
}

function forgetRoot(r) {
  stopWatching(r);
  if (r.timer) clearTimeout(r.timer);
  if (r.pollTimer) clearTimeout(r.pollTimer);
  roots.delete(r.root);
}

// Read taskmgr.json again: push it when the server has another one, watch the tasks folders it
// lists (and no longer the ones gone), and compare every folder with the server.
function reconcile() {
  const c = readConfig();
  if (c) {
    if (current && c.hash !== current.hash) log('taskmgr.json changed');
    current = c;
  }
  if (!current) return;  // nothing good read yet
  if (onServer.config !== current.hash) enqueue({ key: 'config', text: current.text, hash: current.hash });
  else queue.delete('config');

  const byRoot = new Map();
  for (const s of spacesOf(current.works)) {
    if (!byRoot.has(s.root)) byRoot.set(s.root, []);
    byRoot.get(s.root).push(s);
  }
  for (const r of [...roots.values()]) if (!byRoot.has(r.root)) forgetRoot(r);
  for (const [root, spaces] of byRoot) {
    const r = roots.get(root);
    if (r) r.spaces = spaces;
    else roots.set(root, { root, spaces, watcher: null, timer: null, pollTimer: null, missing: false, scanning: null });
  }
  // Spaces no longer in the file are pruned by the server when the config arrives.
  const keys = new Set([...byRoot.values()].flat().map(spaceKey));
  for (const k of Object.keys(onServer.spaces)) if (!keys.has(k)) delete onServer.spaces[k];
  for (const root of byRoot.keys()) scanRoot(root, 'rescan');
  drain();
}

let configTimer = null;
function watchConfig() {
  // The file itself is often replaced by an editor, so its folder is watched. Hash comparison
  // (onServer.config) stops a change from being pushed twice.
  const dir = path.dirname(CONFIG_PATH);
  const name = path.basename(CONFIG_PATH);
  fs.watch(dir, (eventType, filename) => {
    if (filename && filename !== name) return;
    if (configTimer) clearTimeout(configTimer);
    configTimer = setTimeout(() => { configTimer = null; reconcile(); }, DEBOUNCE_MS);
  });
}

// Ask the server what it has, then compare everything with it. Run at startup and every RESCAN_MS.
// The first time, taskmgr.json is pushed whatever the server has.
let startup = true;
let rescanRetry = null;  // the retry of a failed rescan, if one is waiting: a new rescan replaces it
async function rescan() {
  if (rescanRetry) { clearTimeout(rescanRetry); rescanRetry = null; }
  syncLog('info', `polling ${SERVER}`);
  try {
    const state = await serverState();
    onServer = { config: startup ? null : state.config, spaces: state.spaces };
    startup = false;
    if (failures) log(`${SERVER} answers again`);
    failures = 0;
    syncLog('info', `polled ${SERVER}: ${Object.keys(state.spaces).length} tasks folder${Object.keys(state.spaces).length === 1 ? '' : 's'} there`);
  } catch (e) {
    failures++;
    const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
    syncLog(false, `${e.message}; trying again in ${wait / 1000}s`);
    warn(`${e.message}; trying again in ${wait / 1000}s`);
    rescanRetry = setTimeout(() => { rescanRetry = null; rescan(); }, wait);
    return;
  }
  reconcile();
}

// ---------- polling: tm pull ----------

let pulling = false;
let pollTimer = null;

// Run pull.js in its own process, as `tm pull` does, its output going to this log and its sync log
// lines to the daemon's. Resolves to null, or to what went wrong: the last line pull.js wrote to
// stderr (its error, without the "Error: "), which is passed through to this log as it comes.
function runPull() {
  return new Promise((resolve) => {
    let child;
    let tail = '';  // the end of what pull.js wrote to stderr
    try {
      child = spawn(process.execPath, [path.join(__dirname, 'pull.js')], {
        stdio: ['ignore', 'inherit', 'pipe'],
        env: { ...process.env, TASKMGRD_SYNC_LOG: DAEMON_LOG },
        // Under pm2 on Windows the daemon has no console, so a child would open one: a black window
        // flashing up at every poll.
        windowsHide: true,
      });
    } catch (e) {
      resolve(`cannot run pull.js: ${e.message}`);
      return;
    }
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      tail = (tail + chunk).slice(-4000);
    });
    child.on('error', (e) => resolve(`cannot run pull.js: ${e.message}`));
    child.on('exit', (code, signal) => {
      if (code === 0) return resolve(null);
      if (signal) return resolve(`tm pull was stopped by ${signal}`);
      const last = tail.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '';
      resolve(last.replace(/^Error:\s*/, '') || `tm pull exited with code ${code}`);
    });
  });
}

// After each pull, how it went, for the web UI's status bar (GET /api/polling; see server/index.js):
// when it ended (ms), whether it went through, why not, and the interval, so the reader can tell a
// pull that is overdue. Written whole, then renamed into place, so a reader never sees half of it.
function writePollState(state) {
  const tmp = `${POLL_STATE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, POLL_STATE_PATH);
  } catch (e) {
    warn(`cannot write ${POLL_STATE_PATH}: ${e.message}`);
    fs.rmSync(tmp, { force: true });
  }
}

// Before a pull: a change here still waiting out its DEBOUNCE_MS (in a tasks folder, or to
// taskmgr.json) is looked at now, and every scan under way waited for, so that what changed here is
// queued, and goes out with the drain that follows, before the pull. (The pull itself leaves alone
// what changed here since the last sync, see pull.js; this gets it to the server sooner.)
async function flushChanges() {
  if (configTimer) {
    clearTimeout(configTimer);
    configTimer = null;
    reconcile();  // scans every folder
  } else {
    for (const r of roots.values()) {
      if (r.timer) { clearTimeout(r.timer); r.timer = null; scanRoot(r.root); }
    }
  }
  await Promise.all([...roots.values()].map(r => r.scanning).filter(Boolean));
}

// Pull from the server, then look at everything again. What changed here is pushed first (see
// flushChanges), so a change made here goes out before the server's copy of it comes back; nothing is
// pushed or scanned while the pull writes the folders (a push of a folder half pulled would send the
// old files back). After it, the server is asked what it has and every folder compared, as at a
// rescan. The next pull is POLLING_INTERVAL_S after this one ends, so they never overlap.
async function poll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (pulling) return;
  if (PUSHING) await flushChanges();
  await drain();
  pulling = true;
  log('polling: tm pull');
  syncLog('info', 'polling: running tm pull');
  let failed;
  try {
    failed = await runPull();
  } finally {
    pulling = false;
    // Whatever was queued was snapshotted before the pull and would send the old files back; the
    // rescan below queues again what still differs.
    queue.clear();
  }
  if (failed) {
    warn(`polling: ${failed}`);
    syncLog(false, `polling: ${failed}`);
  }
  writePollState({ at: Date.now(), ok: !failed, error: failed || null, interval: POLLING_INTERVAL_S });
  pollTimer = setTimeout(poll, POLLING_INTERVAL_S * 1000);
  if (PUSHING) await rescan();
}

// ---------- main ----------

log('taskmgrd');
syncLog('info', `taskmgrd started (server ${SERVER}, machine ${MACHINE_ID})`);
log(`  config     : ${CONFIG_PATH}`);
log(`  server     : ${SERVER}`);
log(`  machine    : ${MACHINE_ID}`);
log(`  pushing    : ${PUSHING ? 'on' : 'off (PUSHING=0 in .env)'}`);
log(`  polling    : ${POLLING ? `tm pull every ${POLLING_INTERVAL_S % 60 === 0 ? `${POLLING_INTERVAL_S / 60} min` : `${POLLING_INTERVAL_S}s`}` : 'off (POLLING=1 in .env turns it on)'}`);
const windowDesc = `each run in a terminal window here${process.platform === 'darwin' ? ` (${AI_RUNNER_TERMINAL === 'iterm' ? 'iTerm2' : 'Terminal.app'})` : ''}${AI_RUNNER_WINDOW_CLOSE ? `, closed ${AI_RUNNER_WINDOW_CLOSE}s after the run` : ', kept until Enter'}`;
log(`  ai runner  : ${AI_RUNNER ? `on: runs Claude Code here for the server${AI_RUNNER_WINDOW ? `, ${windowDesc}` : ' (AI_RUNNER_WINDOW=1 in .env opens a terminal window for each run)'}` : 'off (AI_RUNNER=1 in .env turns it on)'}`);
if (AI_RUNNER_WINDOW && terminalSetting && !['terminal', 'iterm', 'iterm2'].includes(terminalSetting)) warn(`AI_RUNNER_TERMINAL=${terminalSetting} is not "terminal" or "iterm"; using Terminal.app`);

const first = readConfig();
if (!first) die(`${CONFIG_PATH} could not be read, or is invalid (see above).`);
current = first;
for (const s of spacesOf(first.works)) log(`  ${s.repository ? 'repository' : 'work      '} : ${label(s)}  ${s.root}`);

// With pushing off, nothing is watched and the server is never asked what it has: the daemon only
// polls. With polling on, the first pull comes before the first push: what the server has (another
// machine's changes, say) is taken in first, and the push that follows sends the folders as merged.
if (PUSHING) watchConfig();
if (POLLING) poll();
else if (PUSHING) rescan();
if (PUSHING) setInterval(rescan, RESCAN_MS);

// The runner: Claude Code run here for the server (ai/runner.js), logging what claude writes to
// stderr where the web UI's runs do, and each run in a terminal window here when asked (which
// terminal on macOS, and how long it stays after the run; see ai/window.js).
const window = AI_RUNNER_WINDOW ? { terminal: AI_RUNNER_TERMINAL, closeAfter: AI_RUNNER_WINDOW_CLOSE } : false;
const runner = AI_RUNNER ? startRunner({ server: SERVER, token: TOKEN, machineId: MACHINE_ID, log, warn, logFile: path.join(__dirname, 'logs', 'ai.log'), window }) : null;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (runner) runner.stop();
    if (pollTimer) clearTimeout(pollTimer);
    if (rescanRetry) clearTimeout(rescanRetry);
    for (const r of [...roots.values()]) forgetRoot(r);
    log('taskmgrd stopped');
    syncLog('info', 'taskmgrd stopped');
    process.exit(0);
  });
}
