#!/usr/bin/env node
// tm pull: fetch taskmgr.json and the task folders of every tasks folder, whole (every task.txt and
// every other file: attachments, files in folders), from the server taskmgrd pushes to (what `tm push`
// sends, and only that: a file right in a tasks folder, or a folder there not named by a task id, is
// not pulled either; see taskEntries in utils/task.js), and put them here. Nothing local is
// deleted unless it is a task the server deleted since the last sync (see server/syncstate.js): a file or folder
// that exists is updated when it differs, one that does not is added.
//
// What is here wins: nothing is pulled while a change made here since the last sync is not pushed
// yet. Every tasks folder is compared with what was last synced first (see changesHere); one that
// differs (a task added, changed, deleted, renamed or moved, an attachment added, changed or deleted),
// or was never synced and is not empty, is told, with its changes, and the pull stops with an error:
// push first (`tm push`, or taskmgrd does), which overwrites the server's copy. A change made here
// while the pull runs is left as it is, told the same way, and counted as failed.
//
//   node pull.js      (what `tm pull` runs; SYNC_SERVER and SYNC_SERVER_TOKEN in .env, as for taskmgrd)
//
// taskmgr.json is merged, not replaced, and only for what is already here: an origin, work or
// repository here keeps its own tasks_path and source_path (the server's are folders on the server)
// and takes the server's other fields; one only on the server is not pulled, nor its files; one only
// here stays. Then the tasks folder of every work and repository here that the server also has is filled.
// More threads for the file system calls, which go out side by side (see pullSpace), as in push.js.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '32';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const syncState = require('./server/syncstate');
const { spaceKey, moveTasks } = require('./server/sync');
const { taskEntries } = require('./utils/task');
const { loadDotenv, parseConfig, upgradeRaw, DEFAULT_CONFIG_PATH } = require('./server/config');

const REQUEST_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // one attachment
const DOWNLOADS_AT_ONCE = 8;

loadDotenv();
const SERVER = String(process.env.SYNC_SERVER || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.SYNC_SERVER_TOKEN || '').trim();
// Sent with every request (X-Machine-Id), so the server shows this machine as in touch (see push.js).
const MACHINE_ID = String(process.env.MACHINE_ID || '').trim() || os.hostname();

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!SERVER) die('SYNC_SERVER is not set in .env (the tm server to pull from, e.g. https://tm.example.com).');
if (!/^https?:\/\//.test(SERVER)) die(`SYNC_SERVER must be an http(s) URL, not "${SERVER}".`);
if (!TOKEN) die('SYNC_SERVER_TOKEN is not set in .env (the same value as in the remote server\'s .env).');
// The sha1 of a file here, remembered by size and mtime in push's .tm-hash-cache.json, so an
// attachment is only read again once it is modified. Required after the checks above: push.js has its own.
// syncLog is the sync log of a run by hand, logs/taskmgr.log: the start and the end of the pull go there,
// and each file that could not be pulled.
const { fileHash, saveHashCache, syncLog, snapshot, isDir } = require('./push');

// Exit with an error, logged as the end of the run.
function fail(message) {
  syncLog(false, `tm pull failed: ${message}`);
  die(message);
}

// A file that could not be pulled: told, and logged.
function report(message) {
  console.error(message);
  syncLog(false, message);
}

// One GET; `raw` answers the body as a Buffer, otherwise the JSON.
async function get(route, query, { raw = false, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  let res;
  try {
    res = await fetch(`${SERVER}/api/sync/pull/${route}${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Machine-Id': encodeURIComponent(MACHINE_ID) },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.cause?.message || e.message;
    throw new Error(`cannot reach ${SERVER} (${why})`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`${SERVER} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
const label = (s) => `${s.origin ? `${s.origin} / ` : ''}${s.work}${s.repository ? ` / ${s.repository}` : ''}`;

// taskmgr.json here (raw, "origins" form) with the server's fields merged into what is already
// here: an origin, work or repository only on the server is not added, and nothing here is removed.
// A work or repository keeps its own tasks_path and source_path (the server's are folders there).
function mergeFromServer(here, server) {
  const merged = { ...here, origins: (here.origins || []).map(g => ({ ...g, works: (g.works || []).map(w => ({ ...w })) })) };
  for (const g of server.origins || []) {
    const origin = name(g, 'origin');
    const target = merged.origins.find(o => name(o, 'origin') === origin);
    if (target) {
      const { works, ...rest } = g;
      Object.assign(target, rest);
    }
    for (const w of g.works || []) {
      // Work names are unique across origins: a work here stays in its own origin.
      const work = name(w, 'work');
      const mine = merged.origins.flatMap(o => o.works).find(x => name(x, 'work') === work);
      if (!mine) continue;
      const { tasks_path, repositories, ...fields } = w;
      Object.assign(mine, fields);
      for (const p of repositories || []) {
        const mineRepo = (mine.repositories || []).find(x => name(x, 'repository') === name(p, 'repository'));
        if (!mineRepo) continue;
        const { tasks_path: _t, source_path: _s, ...pf } = p;
        Object.assign(mineRepo, pf);
      }
    }
  }
  return merged;
}

// One path of the server's listing, checked: plain names only, so nothing lands outside the folder.
function safeJoin(root, rel) {
  const parts = String(rel).split('/');
  if (!rel || parts.some(s => !s || s === '.' || s === '..' || s.includes('\0') || /[\\:]/.test(s))) throw new Error(`invalid path "${rel}"`);
  const abs = path.resolve(root, ...parts);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`path "${rel}" leaves the folder`);
  return abs;
}

async function writeFileAtomic(abs, data) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, abs);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

const statOf = async (abs) => {
  try {
    return await fsp.stat(abs);
  } catch (e) {
    return null;
  }
};

// `run` called with at most `n` of them running at once.
function limiter(n) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= n || !queue.length) return;
    running++;
    const { run, resolve, reject } = queue.shift();
    run().then(resolve, reject).finally(() => { running--; next(); });
  };
  return (run) => new Promise((resolve, reject) => { queue.push({ run, resolve, reject }); next(); });
}

const readIf = (abs) => {
  try {
    return fs.statSync(abs).isFile() ? fs.readFileSync(abs) : null;
  } catch (e) {
    return null;
  }
};

// What was last synced of a space (see server/syncstate.js), the tasks only: a state written when the
// whole folder was synced, files right in it included, must not make those files changes here, nor
// tasks the server deleted (see taskEntries in utils/task.js). null when never synced.
function knownOf(key) {
  const known = syncState.get(key);
  if (!known) return null;
  const kept = {};
  for (const e of taskEntries(Object.keys(known).map(p => ({ path: p, dir: known[p] === '' })))) kept[e.path] = known[e.path];
  return kept;
}

// Every file here is looked at side by side (on a Windows drive under WSL each call costs
// milliseconds, most of it waiting), an attachment by its size first and then its cached sha1, and
// the downloads go DOWNLOADS_AT_ONCE at a time.
async function pullSpace(s, root, stats) {
  const query = { origin: s.origin, work: s.work, repository: s.repository };
  const key = spaceKey(s);
  // What both sides had at the last push or pull, which is what is here now: the folder was compared
  // with it before anything was pulled (see changesHere, in main). So a path here that is not what was
  // synced was changed meanwhile.
  const known = knownOf(key) || {};
  // The tasks only, as a push sends them: a server from before that rule lists the whole folder.
  const entries = taskEntries((await get('space', query)).entries);
  const onServer = syncState.manifestOf(entries);
  fs.mkdirSync(root, { recursive: true });
  // A change made here while this runs: a path no longer what was synced, gone, or new. It is left as
  // it is (what is here wins), told, and counted as failed: the next push mirrors it on the server,
  // and the pull after that is whole.
  const changedMeanwhile = (p) => { stats.failed++; report(`${label(s)}: ${p}: changed here while pulling, left as it is`); };
  // A task the server has under another status folder than here is moved, not pulled as a second copy;
  // only a task.txt not here can be one.
  const tasks = entries.filter(e => typeof e.content === 'string' && e.path.split('/').pop() === 'task.txt');
  const here = await Promise.all(tasks.map(async (e) => {
    try {
      return await statOf(safeJoin(root, e.path));
    } catch (err) {
      return true;  // an invalid path: told below
    }
  }));
  moveTasks(root, tasks.filter((e, i) => !here[i]), {
    onMove: () => { stats.updated++; },
    onError: (p, err) => { stats.failed++; report(`${label(s)}: ${p}: ${err.message}`); }
  });

  // A task deleted on the server since the last sync (its task.txt known, now gone there) is deleted
  // here too, with its folder, unless a subtask is still in it. Any other file missing on the server is
  // left alone: it may only be one taskmgrd did not push (too large), not a deleted one.
  const hasTask = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some(d => d.isDirectory() ? hasTask(path.join(dir, d.name)) : d.name === 'task.txt');
  const gone = Object.keys(known).filter(p => !(p in onServer) && p.split('/').pop() === 'task.txt').sort((a, b) => b.length - a.length);
  for (const p of gone) {
    try {
      const abs = safeJoin(root, p);
      const have = readIf(abs);
      if (!have) continue;
      if (sha1(have) !== known[p]) { changedMeanwhile(p); continue; }
      const dir = path.dirname(abs);
      if (dir === path.resolve(root)) fs.rmSync(abs);
      else if (fs.readdirSync(dir, { withFileTypes: true }).some(d => d.isDirectory() && hasTask(path.join(dir, d.name)))) fs.rmSync(abs);  // a subtask stays
      else fs.rmSync(dir, { recursive: true, force: true });
      stats.updated++;
    } catch (err) {
      stats.failed++;
      report(`${label(s)}: ${p}: ${err.message}`);
    }
  }

  const download = limiter(DOWNLOADS_AT_ONCE);
  await Promise.all(entries.map(async (e) => {
    try {
      const abs = safeJoin(root, e.path);
      const stat = await statOf(abs);
      if (e.dir === true) {
        if (!stat) { await fsp.mkdir(abs, { recursive: true }); stats.added++; }
        return;
      }
      const have = stat && stat.isFile();
      if (!have && e.path in known) return changedMeanwhile(e.path);  // deleted here meanwhile
      // A file here that is neither the server's nor what was synced was changed (or added) here meanwhile.
      if (typeof e.content === 'string') {
        if (have) {
          const text = await fsp.readFile(abs, 'utf8');
          if (text === e.content) return;
          if (known[e.path] !== sha1(Buffer.from(text, 'utf8'))) return changedMeanwhile(e.path);
        }
        await writeFileAtomic(abs, e.content);
      } else if (typeof e.blob === 'string') {
        if (have) {
          const hash = await fileHash(abs, stat);
          if (hash === e.blob) return;
          if (known[e.path] !== hash) return changedMeanwhile(e.path);
        }
        const data = await download(() => get('file', { ...query, path: e.path }, { raw: true, timeout: DOWNLOAD_TIMEOUT_MS }));
        if (sha1(data) !== e.blob) throw new Error('the download does not match its sha1');
        await writeFileAtomic(abs, data);
      } else {
        return;
      }
      stats[have ? 'updated' : 'added']++;
    } catch (err) {
      stats.failed++;
      report(`${label(s)}: ${e.path}: ${err.message}`);
    }
  }));
  // Remembered only when the whole space went through; what was left out stays as it was known.
  if (!stats.failed) {
    for (const p of Object.keys(known)) if (!(p in onServer) && fs.existsSync(safeJoin(root, p))) onServer[p] = known[p];  // kept here: still known
    syncState.set(key, onServer);
  }
}

// The changes made here since the last sync, in the folder `root` of a space: every path whose content
// is not what was last pushed or pulled (`known`, see server/syncstate.js), gone, or new, each as
// "path (added|changed|deleted)". `entries` is the folder as a push sends it (see snapshot in push.js);
// a file that is here but left out of it (too large) is not a deletion.
function changesHere(root, known, entries) {
  const here = syncState.manifestOf(entries);
  const changes = [];
  for (const p of Object.keys(here)) {
    if (!(p in known)) changes.push(`${p} (added)`);
    else if (known[p] !== here[p]) changes.push(`${p} (changed)`);
  }
  for (const p of Object.keys(known)) {
    if (!(p in here) && !fs.existsSync(path.join(root, ...p.split('/')))) changes.push(`${p} (deleted)`);
  }
  return changes.sort();
}

(async () => {
  console.log('tm pull');
  console.log(`  server     : ${SERVER}`);
  syncLog('info', `tm pull started (server ${SERVER})`);
  let serverText;
  try {
    serverText = (await get('config')).text;
  } catch (e) {
    fail(e.message);
  }
  let serverRaw;
  let serverWorks;
  try {
    serverWorks = parseConfig(serverText, 'the server\'s taskmgr.json').works;
    serverRaw = upgradeRaw(JSON.parse(serverText));
  } catch (e) {
    fail(e.message);
  }
  const serverSpaces = new Set();
  for (const w of serverWorks) {
    if (w.root) serverSpaces.add([w.origin || '', w.work, ''].join('/'));
    for (const p of w.repositories) serverSpaces.add([w.origin || '', w.work, p.name].join('/'));
  }

  let here;
  let hereText;
  try {
    hereText = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
  } catch (e) {
    fail(e.code === 'ENOENT' ? `${DEFAULT_CONFIG_PATH} does not exist: tm pull only updates the origins, works and repositories listed there.` : `could not read ${DEFAULT_CONFIG_PATH}: ${e.message}`);
  }
  try {
    parseConfig(hereText, DEFAULT_CONFIG_PATH);
    here = upgradeRaw(JSON.parse(hereText));
  } catch (e) {
    fail(`${e.message} (fix it first; nothing was pulled)`);
  }
  const mergedText = JSON.stringify(mergeFromServer(here, serverRaw), null, 2) + '\n';
  let merged;
  try {
    merged = parseConfig(mergedText, 'the merged taskmgr.json');
  } catch (e) {
    fail(`cannot merge the server's taskmgr.json with the one here: ${e.message}`);
  }
  const changed = JSON.stringify(JSON.parse(hereText)) !== JSON.stringify(JSON.parse(mergedText));
  if (changed) {
    fs.writeFileSync(DEFAULT_CONFIG_PATH, mergedText);
    console.log(`pulled taskmgr.json`);
    syncLog(true, 'pulled taskmgr.json');
  }

  // The tasks folders are pulled side by side, those that share one folder one after the other.
  const byRoot = new Map();
  for (const w of merged.works) {
    const spaces = [];
    if (w.root) spaces.push({ origin: w.origin || '', work: w.work, repository: '', root: w.root });
    for (const p of w.repositories) spaces.push({ origin: w.origin || '', work: w.work, repository: p.name, root: p.root });
    for (const s of spaces) {
      if (!serverSpaces.has([s.origin, s.work, s.repository].join('/'))) continue;
      const key = path.resolve(s.root);
      if (!byRoot.has(key)) byRoot.set(key, []);
      byRoot.get(key).push(s);
    }
  }
  // What is here wins: nothing is pulled while a folder has a change not pushed yet. Each is compared
  // with what was last synced (a folder that is not there is left to the pull, as a push leaves it to
  // the server); when any differs, or was never synced and is not empty, every one that does is told
  // with its changes, and the pull stops.
  const notPushed = [];
  for (const [root, spaces] of byRoot) {
    if (!isDir(root)) continue;
    const { entries } = await snapshot(root, { warnings: false });
    for (const s of spaces) {
      const known = knownOf(spaceKey(s));
      const changes = known ? changesHere(root, known, entries) : entries.length ? ['never pushed'] : [];
      if (changes.length) notPushed.push({ s, changes });
    }
  }
  if (notPushed.length) {
    const shown = 10;
    for (const { s, changes } of notPushed) {
      console.error(`${label(s)}:`);
      for (const c of changes.slice(0, shown)) console.error(`  ${c}`);
      if (changes.length > shown) console.error(`  ... and ${changes.length - shown} more`);
    }
    fail(`changes here not pushed yet (${notPushed.map(({ s }) => label(s)).join(', ')}); nothing pulled. Push first: tm push, or wait for taskmgrd.`);
  }

  const stats = { added: 0, updated: 0, failed: 0 };
  await Promise.all([...byRoot.values()].map(async (spaces) => {
    for (const s of spaces) {
      const mine = { added: 0, updated: 0, failed: 0 };
      try {
        await pullSpace(s, s.root, mine);
      } catch (e) {
        mine.failed++;
        report(`${label(s)}: ${e.message}`);
      }
      for (const k of Object.keys(stats)) stats[k] += mine[k];
      if (mine.added || mine.updated) {
        console.log(`pulled ${label(s)} (${mine.added} added, ${mine.updated} updated)`);
        syncLog(true, `pulled ${label(s)} (${mine.added} added, ${mine.updated} updated)`);
      }
    }
  }));
  saveHashCache();
  const summary = stats.added || stats.updated || changed ? `${stats.added} added, ${stats.updated} updated${changed ? ', taskmgr.json merged' : ''}` : 'nothing to pull, everything is up to date';
  console.log(stats.added || stats.updated || changed ? `done: ${summary}` : summary);
  if (stats.failed) fail(`${stats.failed} file${stats.failed === 1 ? '' : 's'} could not be pulled (see above)`);
  syncLog('info', `tm pull finished (${summary})`);
})().catch((e) => fail(e.message));
