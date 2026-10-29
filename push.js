#!/usr/bin/env node
// tm push: send taskmgr.json and the tasks folder of every work and repository listed there to a
// remote tm server, which keeps a copy under its data/ folder laid out like the origins tree
// (server/sync.js has the layout and the API). Run by hand it pushes what differs once and exits;
// taskmgrd.js, the sync daemon, uses the same functions to push whenever something changes.
//
//   node push.js      (what `tm push` runs)
//
// .env (next to this file):
//   SYNC_SERVER=https://tm.example.com   the server to push to: the URL of its web UI
//   SYNC_SERVER_TOKEN=...                 the same value as SYNC_SERVER_TOKEN in that server's .env
//   MACHINE_ID=...                        the name this machine's pushes are shown under on the server
//                                         (empty: the hostname); sent with every request, as X-Machine-Id,
//                                         so the server can show whether this machine is in touch
//
// taskmgr.json is pushed whole; an invalid one is not pushed. A tasks folder is pushed as a snapshot
// of its tasks: the task folders right in it and in its done, pending and aborted folders, told by
// their name alone (a task id, 12 digits, "202610191522", with or without a title after a space; see
// taskEntries in utils/taskUtils.js), each whole: every file in it (task.txt files as text, the
// others, attachments included, by the sha1 of their content, the server asked first which of them
// it does not have yet and those uploaded) and every empty folder. A task folder without a task.txt
// gets one first, with the title from its name as its text (empty for a bare id), so every task
// pushed has its text. A file right in the tasks folder, or in a status folder, and a folder there
// named some other way are not tasks: not pushed, not looked at. The server brings its copy to the
// snapshot, so after a push its copy is the tasks as they are here, and a renamed, moved or deleted
// task or attachment is mirrored too. Lock and cache files (.DS_Store, ~$ Office locks, ...; see isSyncSkipped) are left out, and files over 5 MB and
// folders over 10 MB or with more than 10 files (never a task folder itself) are not pushed. A tasks folder that does not exist
// is left as it is on the server.
// More threads for the file system calls, which go out side by side (see snapshot); must be set
// before the first one.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '32';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { loadDotenv, parseConfig, DEFAULT_CONFIG_PATH } = require('./server/config');
const { spaceKey } = require('./server/sync');
const syncState = require('./server/syncstate');
const {
  TASK_FILE, STATUS_DIRS, TASK_FOLDER_RE, ensureTaskFile,
  SYNC_MAX_FILE_BYTES: MAX_FILE_BYTES, SYNC_MAX_FOLDER_BYTES: MAX_FOLDER_BYTES,
  SYNC_MAX_FOLDER_FILES: MAX_FOLDER_FILES, isSyncSkipped
} = require('./utils/taskUtils');
const { appendLog } = require('./utils/logfile');

const REQUEST_TIMEOUT_MS = 30 * 1000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // one attachment

loadDotenv();
const SERVER = String(process.env.SYNC_SERVER || '').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.SYNC_SERVER_TOKEN || '').trim();
// What the server shows a folder pushed from here as coming from: MACHINE_ID, or the hostname.
const MACHINE_ID = String(process.env.MACHINE_ID || '').trim() || os.hostname();
const CONFIG_PATH = DEFAULT_CONFIG_PATH;

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const log = (...args) => console.log(...args);
const warn = (...args) => console.error(...args);

// One line per sync event, appended to the sync log: SUCCESS or FAILED for a push (or pull) of a file
// or folder, WARNING for something left out on purpose, INFO for a run starting and ending (success is
// true, false, 'warning' or 'info'). A run by hand (`tm push`, `tm pull`) logs to logs/taskmgr.log; the
// daemon, taskmgrd.js, switches to its own logs/taskmgrd.log with logTo(), so the two are told apart,
// and names that file in TASKMGRD_SYNC_LOG for the pull it runs in its own process (see its polling).
let SYNC_LOG = process.env.TASKMGRD_SYNC_LOG || path.join(__dirname, 'logs', 'taskmgr.log');
const logTo = (file) => { SYNC_LOG = file; };
function syncLog(success, message) {
  const level = success === 'warning' ? 'WARNING' : success === 'info' ? 'INFO   ' : success ? 'SUCCESS' : 'FAILED ';
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  try {
    appendLog(SYNC_LOG, line);  // kept under 10 MB (see utils/logfile.js)
  } catch (e) {
    console.error(`cannot write ${SYNC_LOG}: ${e.message}`);
  }
}

function die(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!SERVER) die('SYNC_SERVER is not set in .env (the tm server to push to, e.g. https://tm.example.com).');
if (!/^https?:\/\//.test(SERVER)) die(`SYNC_SERVER must be an http(s) URL, not "${SERVER}".`);
if (!TOKEN) die('SYNC_SERVER_TOKEN is not set in .env (the same value as in the remote server\'s .env).');

// ---------- what to push ----------

// taskmgr.json read and checked: { text, hash, works }, or null (with a warning) when it cannot be
// read or is invalid, in which case the caller keeps the last good one.
function readConfig() {
  let text;
  try {
    text = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    warn(`Warning: could not read ${CONFIG_PATH}: ${e.message}`);
    return null;
  }
  try {
    return { text, hash: sha1(text), works: parseConfig(text, CONFIG_PATH).works };
  } catch (e) {
    warn(`Warning: ${e.message} (not pushed; the previous configuration stays)`);
    return null;
  }
}

// Every folder of tasks in the config: a work's common tasks, and each of its repositories.
function spacesOf(works) {
  const spaces = [];
  for (const w of works) {
    if (w.root) spaces.push({ origin: w.origin, work: w.work, repository: '', root: w.root });
    for (const p of w.repositories) spaces.push({ origin: w.origin, work: w.work, repository: p.name, root: p.root });
  }
  return spaces;
}

const label = (s) => `${s.origin ? `${s.origin} / ` : ''}${s.work}${s.repository ? ` / ${s.repository}` : ''}`;

// The sha1 of a file's content, read in chunks; remembered by size and mtime, so a file is only read
// again once it is modified. Kept in .tm-hash-cache.json next to taskmgr.json, so that `tm push`, a
// new process each time, does not read every attachment at every run either.
const HASH_CACHE_PATH = path.join(path.dirname(CONFIG_PATH), '.tm-hash-cache.json');
const hashCache = new Map();  // abs -> { size, mtimeMs, sha1 }
let hashCacheDirty = false;
try {
  for (const [abs, [size, mtimeMs, sha]] of Object.entries(JSON.parse(fs.readFileSync(HASH_CACHE_PATH, 'utf8')))) {
    hashCache.set(abs, { size, mtimeMs, sha1: sha });
  }
} catch (e) { /* none yet, or unreadable: every file is hashed once more */ }

function saveHashCache() {
  if (!hashCacheDirty) return;
  const data = {};
  for (const [abs, c] of hashCache) data[abs] = [c.size, c.mtimeMs, c.sha1];
  const tmp = `${HASH_CACHE_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, HASH_CACHE_PATH);
    hashCacheDirty = false;
  } catch (e) {
    warn(`could not write ${HASH_CACHE_PATH}: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function fileHash(abs, stat) {
  const c = hashCache.get(abs);
  if (c && c.size === stat.size && c.mtimeMs === stat.mtimeMs) return c.sha1;
  const hash = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(abs, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  const sha = hash.digest('hex');
  hashCache.set(abs, { size: stat.size, mtimeMs: stat.mtimeMs, sha1: sha });
  hashCacheDirty = true;
  return sha;
}

// The tasks of a tasks folder, as the server mirrors them: every file of every task folder (see
// taskEntries in utils/taskUtils.js for which folders those are), relative to the tasks folder, a
// task.txt as text and any other file (attachments, whatever else is there) by the sha1 of its
// content, which the server fetches from its blob store (see pushSpace); an empty folder as a bare
// folder. Symbolic links are followed; lock and cache files are left out. Sorted, so the same folder
// always gives the same hash. `blobs` maps each sha1 to one file that has it, for the upload.
//
// The folder is read in one pass, each folder listed once and only files (and links) stat'ed, and
// the calls go out side by side: on a Windows drive under WSL every one costs milliseconds, most of
// it waiting. A folder's size and number of files come from that same pass, and files are read (task.txt) or hashed only
// once they are known to be kept. What is left out for its size goes to the sync log as a warning,
// unless `warnings` is false (the pull takes a snapshot too, to compare, and says nothing).
async function snapshot(root, { warnings = true } = {}) {
  // { files: [{ rel, abs, stat }], dirs: [rel], warnings: [message], size, fileCount, isTask }, or null when
  // `dir` cannot be listed. `task` says `dir` is a task folder of a listing (see below).
  const walk = async (dir, rel, inTask, task = false) => {
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return null;
    }
    const out = { files: [], dirs: [], warnings: [], size: 0, fileCount: 0, isTask: dirents.some(d => d.name === TASK_FILE) };
    // A task folder of a listing without a task file gets one, with the title from its name (what
    // follows the id; nothing for a bare id) as its text, as the web UI does when it opens one
    // (ensureTaskFile), so every task pushed has its text.
    if (task && !out.isTask) {
      try {
        ensureTaskFile(path.join(dir, TASK_FILE));
        dirents = await fsp.readdir(dir, { withFileTypes: true });
        out.isTask = true;
      } catch (e) {
        out.warnings.push(`cannot create ${path.join(dir, TASK_FILE)}: ${e.message}`);
      }
    }
    // Only a folder inside a task can be skipped for its size or number of files; the task's own folder (and done/,
    // pending/, aborted/ and the like around it) always goes, minus whatever is too large in it.
    inTask = inTask || out.isTask;
    // The tasks folder itself and its done, pending and aborted folders list tasks: only the task
    // folders in them go, told by their name alone (the rule of taskEntries, applied while walking,
    // so a file right there, or a folder named some other way, costs nothing). Inside a task,
    // everything goes.
    const listing = rel === '' || STATUS_DIRS.includes(rel);
    // Each entry looked at side by side: { sub } for a folder, { file } for a file, null for none.
    const found = await Promise.all(dirents.map(async (d) => {
      if (isSyncSkipped(d.name)) return null;
      const abs = path.join(dir, d.name);
      const entryRel = rel ? `${rel}/${d.name}` : d.name;
      let stat = null;
      let isFolder = d.isDirectory();
      let isFile = d.isFile();
      if (d.isSymbolicLink()) {
        try {
          stat = await fsp.stat(abs);  // through the link
        } catch (e) {
          return null;  // a broken link
        }
        isFolder = stat.isDirectory();
        isFile = stat.isFile();
      }
      if (isFolder) {
        // In a listing, a status folder at the root holds tasks and is walked as a listing itself;
        // any other folder goes only as a task, told by its name.
        const status = listing && !rel && STATUS_DIRS.includes(d.name);
        const asTask = listing && !status;
        if (asTask && !TASK_FOLDER_RE.test(d.name)) return null;
        const sub = await walk(abs, entryRel, inTask || asTask, asTask);
        return sub && { abs, sub };
      }
      if (listing || !isFile) return null;  // a file right among the tasks, or a socket, a device: not mirrored
      try {
        stat = stat || await fsp.stat(abs);
      } catch (e) {
        return null;  // gone meanwhile
      }
      return { abs, file: { rel: entryRel, abs, stat } };
    }));
    let count = 0;
    for (const f of found) {
      if (!f) continue;
      if (f.sub) {
        out.size += f.sub.size;
        out.fileCount += f.sub.fileCount;
        if (inTask && !f.sub.isTask && f.sub.size > MAX_FOLDER_BYTES) {
          out.warnings.push(`skipped folder ${f.abs}: larger than 10 MB`);
          continue;
        }
        if (inTask && !f.sub.isTask && f.sub.fileCount > MAX_FOLDER_FILES) {
          out.warnings.push(`skipped folder ${f.abs}: more than ${MAX_FOLDER_FILES} files`);
          continue;
        }
        out.files.push(...f.sub.files);
        out.dirs.push(...f.sub.dirs);
        out.warnings.push(...f.sub.warnings);
      } else {
        out.size += f.file.stat.size;
        out.fileCount++;
        if (f.file.stat.size > MAX_FILE_BYTES) {
          out.warnings.push(`skipped file ${f.abs}: larger than 5 MB`);
          continue;
        }
        out.files.push(f.file);
      }
      count++;
    }
    // An empty folder goes as itself; not a status folder at the root with no task in it.
    if (!count && rel && !STATUS_DIRS.includes(rel)) out.dirs.push(rel);
    return out;
  };

  const found = (await walk(root, '', false)) || { files: [], dirs: [], warnings: [] };
  if (warnings) for (const w of found.warnings) syncLog('warning', w);
  const entries = found.dirs.map(rel => ({ path: rel, dir: true }));
  const blobs = new Map();
  const seen = new Set();
  const read = await Promise.all(found.files.map(async (f) => {
    try {
      if (path.basename(f.abs) === TASK_FILE) return { path: f.rel, content: await fsp.readFile(f.abs, 'utf8') };
      return { path: f.rel, blob: await fileHash(f.abs, f.stat), abs: f.abs };
    } catch (e) {
      return null;  // gone meanwhile
    }
  }));
  for (const e of read) {
    if (!e) continue;
    if (e.content !== undefined) {
      entries.push(e);
      continue;
    }
    seen.add(e.abs);
    entries.push({ path: e.path, blob: e.blob });
    if (!blobs.has(e.blob)) blobs.set(e.blob, e.abs);
  }
  for (const abs of hashCache.keys()) {
    if (!seen.has(abs) && abs.startsWith(root + path.sep)) {
      hashCache.delete(abs);
      hashCacheDirty = true;
    }
  }
  saveHashCache();
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, blobs, hash: sha1(JSON.stringify(entries)) };
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

// ---------- the server ----------

// One request to the server: `body` is sent as JSON, or as it is when it is a Buffer (a file). A
// refused request throws an error carrying the server's `code` and `missing` (see server/sync.js).
async function request(method, route, body, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  const raw = Buffer.isBuffer(body);
  let res;
  try {
    res = await fetch(`${SERVER}${route}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Machine-Id': encodeURIComponent(MACHINE_ID), ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.cause?.message || e.message;
    throw new Error(`cannot reach ${SERVER} (${why})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${SERVER} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
    err.code = data.code;
    err.missing = data.missing;
    throw err;
  }
  return data;
}

// What the server has: { config, spaces }, the hash of its config and of each space's last snapshot.
async function serverState() {
  const state = await request('GET', '/api/sync');
  return { config: state.config || null, spaces: state.spaces || {} };
}

// Push taskmgr.json; resolves to the line to log about it.
async function pushConfig(text) {
  const { pruned } = await request('PUT', '/api/sync/config', { text });
  return `pushed taskmgr.json${pruned.length ? ` (removed on the server: ${pruned.join(', ')})` : ''}`;
}

// Push one space's snapshot (see snapshot); resolves to the line to log about it.
async function pushSpace(space, { entries, blobs }) {
  // The attachments the server does not have yet go first, one by one; then the snapshot. Should
  // the server lose one meanwhile, it says which (MISSING_BLOBS) and those are sent once more.
  let uploaded = 0;
  const upload = async (shas) => {
    for (const sha of shas) {
      const abs = blobs.get(sha);
      if (!abs) throw new Error(`${label(space)}: no file for blob ${sha}`);
      let content;
      try {
        content = fs.readFileSync(abs);
      } catch (e) {
        throw new Error(`${abs}: ${e.message}`);
      }
      await request('PUT', `/api/sync/blob/${sha}`, content, { timeout: UPLOAD_TIMEOUT_MS });
      uploaded++;
    }
  };
  if (blobs.size) {
    const { missing } = await request('POST', '/api/sync/blobs', { blobs: [...blobs.keys()] });
    await upload(missing);
  }
  const body = { origin: space.origin, work: space.work, repository: space.repository, machine: MACHINE_ID, entries };
  let result;
  try {
    result = await request('PUT', '/api/sync/space', body);
  } catch (e) {
    if (e.code !== 'MISSING_BLOBS' || !Array.isArray(e.missing)) throw e;
    await upload(e.missing);
    result = await request('PUT', '/api/sync/space', body);
  }
  const { files, dirs } = result;
  try { syncState.set(spaceKey(space), syncState.manifestOf(entries)); } catch (e) { warn(`could not record the sync state: ${e.message}`); }
  const n = (count, what) => `${count} ${what}${count === 1 ? '' : 's'}`;
  return `pushed ${label(space)} (${n(files, 'file')}${dirs ? `, ${n(dirs, 'empty folder')}` : ''}${uploaded ? `, ${n(uploaded, 'attachment')} uploaded` : ''})`;
}

module.exports = { SERVER, TOKEN, MACHINE_ID, CONFIG_PATH, log, warn, die, syncLog, logTo, readConfig, spacesOf, label, snapshot, isDir, serverState, pushConfig, pushSpace, fileHash, saveHashCache };

// ---------- tm push ----------

// Push taskmgr.json, then every tasks folder, whatever the server says it has: a change made on the
// server since the last push leaves it a folder that is not the one pushed, which only a push
// mends (the attachments it has are not sent again). Exit with an error at the first push that fails.
// The start and the end of the run go to the sync log, as does each folder pushed (see syncLog).
async function main() {
  log('tm push');
  log(`  config     : ${CONFIG_PATH}`);
  log(`  server     : ${SERVER}`);
  log(`  machine    : ${MACHINE_ID}`);
  syncLog('info', `tm push started (server ${SERVER}, machine ${MACHINE_ID})`);
  const config = readConfig();
  if (!config) fail(`${CONFIG_PATH} could not be read, or is invalid (see above).`);
  const push = async (what, run) => {
    try {
      const done = await run();
      log(done);
      syncLog(true, done);
    } catch (e) {
      fail(`${what}: ${e.message}`);
    }
  };
  // taskmgr.json goes first: the server prunes by it.
  await push('taskmgr.json', () => pushConfig(config.text));
  const byRoot = new Map();
  for (const s of spacesOf(config.works)) {
    if (!byRoot.has(s.root)) byRoot.set(s.root, []);
    byRoot.get(s.root).push(s);
  }
  for (const [root, spaces] of byRoot) {
    if (!isDir(root)) {
      warn(`${root}: folder not found (${spaces.map(label).join(', ')})`);
      continue;
    }
    const snap = await snapshot(root);
    for (const s of spaces) await push(label(s), () => pushSpace(s, snap));
  }
  log('done');
  syncLog('info', 'tm push finished');
}

// Exit with an error, logged as the end of the run.
function fail(message) {
  syncLog(false, `tm push failed: ${message}`);
  die(message);
}

if (require.main === module) main().catch((e) => fail(e.message));
