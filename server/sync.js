// Receiving end of taskmgrd (taskmgrd.js): the daemon on the machine that has the tasks pushes its
// taskmgr.json and the tasks of every work and repository here: each task folder of a tasks folder
// whole, task file, attachments and every other file in it (not what is beside the tasks: a file
// right in the tasks folder, or a folder there not named by a task id; see taskEntries in
// utils/taskUtils.js). The config is merged into this server's own taskmgr.json,
// each pushed work and repository pointing at its copy of the tasks, which is kept under data/, laid
// out like the origins tree of taskmgr.json:
//
//   data/
//     origins/
//       <origin>/                     "_" for the works without an origin
//         <work>/
//           tasks/                    the work's common tasks (its tasks_path), the folder as it is
//             202508142100 Buy apple/task.txt
//             202508142100 Buy apple/receipt.pdf
//             done/202508142000 Buy orange/task.txt
//           repositories/
//             <repository>/           the repository's tasks (its tasks_path, or the "tasks" folder of its source)
//               202508142200 Fix mail/task.txt
//
// Every request carries `Authorization: Bearer <SYNC_SERVER_TOKEN>`: the same secret is SYNC_SERVER_TOKEN
// in both .env files. Without SYNC_SERVER_TOKEN in this server's .env, pushes are refused (503).
// It also carries `X-Machine-Id` (the MACHINE_ID of the machine, URI-encoded): the time of each
// machine's last request is kept, in memory, so the web UI can show whether it is in touch (see
// machineInfo, below), and what it pushes and polls is logged to logs/<MACHINE_ID>.log (see machineLog).
//
//   GET /api/sync                                            -> { ok, config, spaces }
//       what is here: the sha1 of the last pushed config, and of each space's last snapshot
//       ("origin/work/repository" -> sha1), so the daemon pushes only what differs.
//   PUT /api/sync/config  { text }                           -> { ok, pruned }
//       merges the config into this server's taskmgr.json (an invalid one is refused; see
//       mergeConfigs), with the pushed tasks_path set to the copies under data/origins/ (see
//       toMirror), and removes, under data/origins/, the origins, works and repositories not in it.
//       A space the pushing machine pushed before and no longer lists (renamed or removed there)
//       is kept, but no longer as that machine's (see machineInfo).
//   POST /api/sync/blobs  { blobs: [sha1] }                  -> { ok, missing }
//       which of these files the server does not have yet (see the blob store below).
//   PUT /api/sync/blob/<sha1>   (the raw file)               -> { ok }
//       stores one file by the sha1 of its content; refused when the content does not hash to it.
//   PUT /api/sync/space   { origin, work, repository, machine, entries }  -> { ok, files, dirs }
//       brings one space's folder to the snapshot (tasks that changed status moved first): entries are [{ path, content }] for task
//       `machine` (MACHINE_ID of the pushing machine, optional) is remembered for the space and shown
//       in the web UI here as where its copy comes from (see machineInfo, below).
//       files (text), [{ path, blob: sha1 }] for every other file, taken from the blob store, and
//       [{ path, dir: true }] for an empty folder, paths relative to the space's folder. When a blob
//       is not in the store, nothing is written and the answer is 409 MISSING_BLOBS { missing }.
//   GET /api/sync/pull/config                                -> { ok, text }
//   GET /api/sync/pull/space?origin=&work=&repository=       -> { ok, entries }
//   GET /api/sync/pull/file?origin=&work=&repository=&path=  -> the raw file
//       what `tm pull` reads: this server's taskmgr.json, a space's task folders listed like a push
//       (task files as text, the others by sha1 and size), and one file of it. Nothing is changed.
//
// Attachments go through the blob store, data/.sync-blobs/<sha1>, so that a file the server already
// has (unchanged since the last push, or the same file under a renamed task) is never sent again:
// the daemon asks which blobs are missing, uploads those, then pushes the snapshot, which hard-links
// (or copies) each blob into place. A blob that no space's last snapshot refers to any more is
// removed once it is an hour old (never sooner, so a blob uploaded for a snapshot still on its way
// stays).
//
// Files are written into data/.sync-tmp/ first and renamed into place, so a file is never half
// written; a push cut short leaves the space part done, and the next one finishes it.
// data/.sync-state.json remembers the hashes GET answers with, the blobs each space refers to, and the
// machine each space was last pushed from.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { parseConfig, upgradeRaw } = require('./config');
const { appendLog } = require('../utils/logfile');
const { STATUS_DIRS, taskEntries } = require('../utils/taskUtils');

const ORIGINS_DIR = 'origins';
const NO_ORIGIN_DIR = '_';
const WORK_TASKS_DIR = 'tasks';
const REPOSITORIES_DIR = 'repositories';
const TMP_DIR = '.sync-tmp';
const BLOBS_DIR = '.sync-blobs';
const STATE_FILE = '.sync-state.json';
const BODY_LIMIT = '50mb';           // a snapshot: task texts and the hashes of the other files
const BLOB_LIMIT = '1gb';            // one attachment
const BLOB_KEEP_MS = 60 * 60 * 1000; // how long an unreferenced blob is kept before it is removed
const BLOB_RE = /^[0-9a-f]{40}$/;
const MACHINE_MAX = 80;             // the longest MACHINE_ID kept (longer ones are cut)
const ONLINE_MS = 3 * 60 * 1000;    // how long after its last request a machine counts as in touch

class SyncError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra || {}); }
}

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// The key of a space in the state: names never contain "/" (see server/config.js), so the three
// parts can always be told apart. "" for no origin / the work's common tasks.
function spaceKey({ origin, work, repository }) {
  return [origin || '', work, repository || ''].join('/');
}

// The keys (see spaceKey) of every space of these works (as parseConfig returns them): a work's
// common tasks when it has a tasks folder, and each of its repositories.
function spaceKeys(works) {
  const keys = new Set();
  for (const w of works) {
    if (w.root) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: '' }));
    for (const p of w.repositories) keys.add(spaceKey({ origin: w.origin, work: w.work, repository: p.name }));
  }
  return keys;
}

// A folder name of the mirror: an origin, work or repository name as it is, refused when it is not
// a plain name. (Whether the names stay inside data/origins/ is checked on the whole path, below.)
function segment(name, what) {
  if (typeof name !== 'string' || !name.trim()) throw new SyncError(400, `Missing ${what}.`);
  const s = name.trim();
  if (s === '.' || s === '..' || /[/\0]/.test(s)) throw new SyncError(400, `Invalid ${what} "${name}".`);
  return s;
}

// Does `abs` lie inside the folder `dir`?
const inside = (dir, abs) => abs.startsWith(dir + path.sep);

// Is the folder `abs` one of the copies kept here for taskmgrd, under data/origins/?
const isMirrored = (dataDir, abs) => !!abs && inside(path.join(dataDir, ORIGINS_DIR), path.resolve(abs));

// Where a space is kept: a work's common tasks, or one of its repositories. Always under
// data/origins/, whatever the names are (a "\" is a separator on Windows).
function spaceDir(dataDir, { origin, work, repository }) {
  const parts = [segment(origin || NO_ORIGIN_DIR, 'origin'), segment(work, 'work')];
  if (repository) parts.push(REPOSITORIES_DIR, segment(repository, 'repository'));
  else parts.push(WORK_TASKS_DIR);
  const originsDir = path.join(dataDir, ORIGINS_DIR);
  const target = path.resolve(originsDir, ...parts);
  if (!inside(originsDir, target)) throw new SyncError(400, 'The names must stay inside the data folder.');
  return target;
}

// One snapshot entry checked: a relative path of plain names, and content, blob or dir: true.
function checkEntry(e, i) {
  if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path) throw new SyncError(400, `entries[${i}]: missing path.`);
  const parts = e.path.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || s.includes('\0'))) throw new SyncError(400, `entries[${i}]: invalid path "${e.path}".`);
  if (e.dir === true) return { rel: path.join(...parts), dir: true };
  if (typeof e.blob === 'string') {
    if (!BLOB_RE.test(e.blob)) throw new SyncError(400, `entries[${i}]: invalid blob "${e.blob}".`);
    return { rel: path.join(...parts), blob: e.blob };
  }
  if (typeof e.content !== 'string') throw new SyncError(400, `entries[${i}]: missing content.`);
  return { rel: path.join(...parts), content: e.content };
}

const blobPath = (dataDir, sha) => path.join(dataDir, BLOBS_DIR, sha);

// A blob put in place: a hard link to the store when the file system allows, a copy otherwise.
function placeBlob(from, to) {
  try {
    fs.linkSync(from, to);
  } catch (e) {
    fs.copyFileSync(from, to);
  }
}

// The tasks of a snapshot (`entries`, by `path` relative to `root`) that `root` has under another
// status folder (todo, done/, pending/, aborted/ beside each other) are moved there first, folder and all,
// so a task marked done, pending or aborted (or back to todo) is moved, not copied anew and the old one
// deleted.
// The same task is the same id (the first word of its folder name), whatever the rest of the name.
// Calls onMove() for each task moved, onError(path, error) for each that could not be.
function moveTasks(root, entries, { onMove = () => {}, onError = () => {} } = {}) {
  root = path.resolve(root);
  for (const e of entries) {
    const parts = String(e.path).split('/');
    if (parts.pop() !== 'task.txt' || parts.length < 1) continue;
    try {
      const target = path.resolve(root, ...parts);
      if (!inside(root, target)) throw new Error('the path leaves the folder');
      if (fs.existsSync(target)) continue;
      const taskName = parts.pop();
      if (STATUS_DIRS.includes(parts[parts.length - 1])) parts.pop();
      const id = taskName.split(/\s/)[0];
      for (const dir of [null, ...STATUS_DIRS]) {
        const base = path.resolve(root, ...parts, ...(dir ? [dir] : []));
        let names = [];
        try { names = fs.readdirSync(base); } catch (err) { continue; }
        const found = names.find(n => (n === taskName || n.split(/\s/)[0] === id) && fs.existsSync(path.join(base, n, 'task.txt')));
        if (!found) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(path.join(base, found), target);
        onMove();
        break;
      }
    } catch (err) {
      onError(e.path, err);
    }
  }
}

// Bring `target` to the entries, in place: the tasks that changed status are moved first (see
// moveTasks), then each file that differs is written (through data/.sync-tmp/, so a file is never half
// written), and whatever the snapshot does not have is removed. A file placed from the blob store and
// still the same is told by its inode, so the attachments are not read again at every push. Nothing
// is written when a blob is not in the store (409).
function writeSnapshot(dataDir, target, entries) {
  const list = entries.map(e => {
    const abs = path.resolve(target, e.rel);
    if (!inside(target, abs)) throw new SyncError(400, `Path "${e.rel}" leaves the folder.`);
    return { ...e, abs };
  });
  const missing = [...new Set(list.filter(e => e.blob && !fs.existsSync(blobPath(dataDir, e.blob))).map(e => e.blob))];
  if (missing.length) throw new SyncError(409, `${missing.length} file${missing.length === 1 ? ' is' : 's are'} not on the server yet.`, { code: 'MISSING_BLOBS', missing });

  fs.mkdirSync(target, { recursive: true });
  moveTasks(target, list.map(e => ({ path: e.rel.split(path.sep).join('/') })));

  const tmpRoot = path.join(dataDir, TMP_DIR);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const put = (abs, write) => {
    const tmp = path.join(tmpRoot, crypto.randomBytes(6).toString('hex'));
    try {
      write(tmp);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // A folder where a file goes (or the other way round) is cleared first.
      if (isDir(abs)) fs.rmSync(abs, { recursive: true, force: true });
      fs.renameSync(tmp, abs);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  };
  let files = 0;
  let dirs = 0;
  for (const e of list) {
    if (e.dir) {
      if (!isDir(e.abs)) {
        fs.rmSync(e.abs, { force: true });
        fs.mkdirSync(e.abs, { recursive: true });
      }
      dirs++;
      continue;
    }
    files++;
    let stat = null;
    try { stat = fs.statSync(e.abs); } catch (err) { /* not there yet */ }
    if (e.blob) {
      const from = blobPath(dataDir, e.blob);
      const blob = fs.statSync(from);
      if (stat && stat.isFile() && ((stat.ino === blob.ino && stat.dev === blob.dev) || (stat.size === blob.size && sha1(fs.readFileSync(e.abs)) === e.blob))) continue;
      put(e.abs, (tmp) => placeBlob(from, tmp));
    } else {
      if (stat && stat.isFile() && fs.readFileSync(e.abs, 'utf8') === e.content) continue;
      put(e.abs, (tmp) => fs.writeFileSync(tmp, e.content, 'utf8'));
    }
  }

  // What the snapshot does not have goes: a file not in it, a folder nothing in it lies under.
  const keepFiles = new Set(list.filter(e => !e.dir).map(e => e.abs));
  const keepDirs = new Set();
  for (const e of list) for (let d = e.dir ? e.abs : path.dirname(e.abs); d !== target && inside(target, d); d = path.dirname(d)) keepDirs.add(d);
  const prune = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (keepDirs.has(abs)) prune(abs);
        else fs.rmSync(abs, { recursive: true, force: true });
      } else if (!keepFiles.has(abs)) {
        fs.rmSync(abs, { force: true });
      }
    }
  };
  prune(target);
  return { files, dirs };
}

const isDir = (abs) => {
  try {
    return fs.statSync(abs).isDirectory();
  } catch (e) {
    return false;
  }
};

// Remove, under data/origins/, what the pushed config does not have any more: an origin, a work, the
// tasks folder of a work that has none now, a repository. Returns what was removed (relative to data/).
function pruneOrigins(dataDir, works) {
  const expected = new Map();  // origin folder -> work -> { tasks, repositories }
  for (const w of works) {
    const o = w.origin || NO_ORIGIN_DIR;
    if (!expected.has(o)) expected.set(o, new Map());
    expected.get(o).set(w.work, { tasks: !!w.root, repositories: new Set(w.repositories.map(p => p.name)) });
  }
  const subdirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
      return [];
    }
  };
  const pruned = [];
  const remove = (abs) => {
    fs.rmSync(abs, { recursive: true, force: true });
    pruned.push(path.relative(dataDir, abs).split(path.sep).join('/'));
  };
  const originsDir = path.join(dataDir, ORIGINS_DIR);
  for (const o of subdirs(originsDir)) {
    const worksOf = expected.get(o);
    if (!worksOf) { remove(path.join(originsDir, o)); continue; }
    for (const w of subdirs(path.join(originsDir, o))) {
      const spec = worksOf.get(w);
      const workDir = path.join(originsDir, o, w);
      if (!spec) { remove(workDir); continue; }
      if (!spec.tasks && fs.existsSync(path.join(workDir, WORK_TASKS_DIR))) remove(path.join(workDir, WORK_TASKS_DIR));
      for (const r of subdirs(path.join(workDir, REPOSITORIES_DIR))) {
        if (!spec.repositories.has(r)) remove(path.join(workDir, REPOSITORIES_DIR, r));
      }
    }
  }
  return pruned;
}

// The pushed config (raw, "origins" form) with its folders turned into the copies here: a work with
// common tasks gets the folder of its copy as tasks_path, and so does every repository, whose
// source_path (a folder on the other machine) is left out.
function toMirror(dataDir, pushed) {
  const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
  for (const g of pushed.origins) {
    const origin = name(g, 'origin');
    for (const w of g.works || []) {
      const work = name(w, 'work');
      if (name(w, 'tasks_path')) w.tasks_path = spaceDir(dataDir, { origin, work, repository: '' });
      else delete w.tasks_path;
      for (const p of w.repositories || []) {
        delete p.source_path;
        p.tasks_path = spaceDir(dataDir, { origin, work, repository: name(p, 'repository') });
      }
    }
  }
  return pushed;
}

// The pushed config merged into the one here, both raw and in the "origins" form: an origin, work
// or repository that is only here is kept, one that is only pushed is added. A work in both (by
// name, in the same origin) takes the pushed fields, with its repositories merged the same way (a
// repository in both is the pushed one). A work pushed without common tasks (no tasks_path) loses
// the tasks_path it has here: the pushed one is what the work is, and a pull could not keep the
// folder anyway (its copy under data/origins/ goes with it, see pruneOrigins). A work pushed under
// another origin than here moves there, as work names are unique across origins. Returns the merged
// raw config.
function mergeConfigs(here, pushed) {
  const name = (v, key) => (v && typeof v[key] === 'string' ? v[key].trim() : '');
  const merged = { ...here, ...pushed, origins: (here.origins || []).map(g => ({ ...g, works: [...(g.works || [])] })) };
  for (const g of pushed.origins) {
    const origin = name(g, 'origin');
    let target = merged.origins.find(o => name(o, 'origin') === origin);
    if (!target) {
      target = { ...g, works: [] };
      merged.origins.push(target);
    } else if (g.income !== undefined) {
      target.income = g.income;
    }
    for (const w of g.works || []) {
      const work = name(w, 'work');
      for (const o of merged.origins) {
        if (o !== target) o.works = o.works.filter(x => name(x, 'work') !== work);
      }
      const i = target.works.findIndex(x => name(x, 'work') === work);
      if (i < 0) { target.works.push(w); continue; }
      const repositories = [...(target.works[i].repositories || [])];
      for (const p of w.repositories || []) {
        const j = repositories.findIndex(x => name(x, 'repository') === name(p, 'repository'));
        if (j < 0) repositories.push(p);
        else repositories[j] = p;
      }
      const out = { ...target.works[i], ...w, repositories };
      if (!name(w, 'tasks_path')) delete out.tasks_path;
      target.works[i] = out;
    }
  }
  return merged;
}

// The MACHINE_ID of a push as kept: one line, trimmed, at most MACHINE_MAX characters; "" for none.
function machineName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\0-\x1f\x7f]/g, ' ').trim().slice(0, MACHINE_MAX);
}

// Constant-time comparison, as for passwords (see server/auth.js).
function tokensMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// The file name of a machine's log: its MACHINE_ID with what a file name cannot hold replaced; ""
// when nothing is left of it.
function logFileName(id) {
  return String(id || '').replace(/[\/\\:*?"<>|\0-\x1f\x7f]/g, '_').replace(/^\.+/, '').trim();
}

const label = ({ origin, work, repository }) => `${origin ? `${origin} / ` : ''}${work}${repository ? ` / ${repository}` : ''}`;

// Mounts the sync routes. Mount it before the login guard: a push is authorized by the token, not a
// session. `token` is SYNC_SERVER_TOKEN; with none, every push is refused. `readConfig` and
// `writeConfig` read and replace this server's taskmgr.json (see server/config.js). `logsDir` is
// where each machine's log goes (see machineLog); default: logs/ next to data/.
function createSyncApp({ dataDir, logsDir = path.join(dataDir, '..', 'logs'), token, readConfig, writeConfig }) {
  const app = express();
  const enabled = typeof token === 'string' && token.trim() !== '';
  const statePath = path.join(dataDir, STATE_FILE);

  // Whatever a crash left half written: the snapshot folders, and the uploads not yet renamed.
  fs.rmSync(path.join(dataDir, TMP_DIR), { recursive: true, force: true });
  try {
    for (const name of fs.readdirSync(path.join(dataDir, BLOBS_DIR))) {
      if (!BLOB_RE.test(name)) fs.rmSync(path.join(dataDir, BLOBS_DIR, name), { force: true });
    }
  } catch (e) { /* no store yet */ }

  function readState() {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return {
        config: typeof s.config === 'string' ? s.config : null,
        spaces: s.spaces && typeof s.spaces === 'object' ? s.spaces : {},
        blobs: s.blobs && typeof s.blobs === 'object' ? s.blobs : {},  // space key -> the blobs of its snapshot
        machines: s.machines && typeof s.machines === 'object' ? s.machines : {}  // space key -> MACHINE_ID of its last push
      };
    } catch (e) {
      return { config: null, spaces: {}, blobs: {}, machines: {} };
    }
  }

  // Remove the blobs no space refers to any more, once they are old enough (see BLOB_KEEP_MS).
  function pruneBlobs(state) {
    const used = new Set(Object.values(state.blobs).flat());
    const dir = path.join(dataDir, BLOBS_DIR);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    const now = Date.now();
    for (const name of names) {
      if (!BLOB_RE.test(name) || used.has(name)) continue;  // an upload on its way is left alone
      const abs = path.join(dir, name);
      try {
        if (now - fs.statSync(abs).mtimeMs > BLOB_KEEP_MS) fs.rmSync(abs, { force: true });
      } catch (e) { /* gone meanwhile */ }
    }
  }

  function writeState(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
  }

  // MACHINE_ID -> when (ms) that machine last made a request. In memory only: after a restart a machine
  // is in touch again at its next push or poll.
  const seen = new Map();

  // The token and the machine id of a request from taskmgrd, checked and read into req.machine. Also
  // app.auth, for the other routes taskmgrd calls (the runner's, see server/ai.js): the same token, and
  // the machine counts as in touch by them too.
  const auth = (req, res, next) => {
    if (!enabled) return res.status(503).json({ error: 'Sync is off on this server: set SYNC_SERVER_TOKEN in its .env.', code: 'SYNC_OFF' });
    const m = /^Bearer\s+(.+)$/.exec(String(req.headers.authorization || ''));
    if (!m || !tokensMatch(m[1].trim(), token.trim())) return res.status(401).json({ error: 'Wrong sync token.', code: 'INVALID_TOKEN' });
    const raw = String(req.headers['x-machine-id'] || '');
    let id;
    try { id = machineName(decodeURIComponent(raw)); } catch (e) { id = machineName(raw); }
    if (id) seen.set(id, Date.now());
    req.machine = id;
    next();
  };
  app.use('/api/sync', auth);
  app.auth = auth;

  // One line to logs/<MACHINE_ID>.log, the log of what that machine pushes and polls here, in the form
  // of the daemon's own log (see syncLog in push.js): the time, SUCCESS / FAILED / INFO, the message.
  // Like the daemon's log, it is kept under 10 MB (its oldest 2 MB dropped when it grows past that).
  // Nothing is logged for a request without a machine id.
  function machineLog(req, level, message) {
    const name = logFileName(req.machine);
    if (!name) return;
    const file = path.join(logsDir, `${name}.log`);
    const tag = level === 'info' ? 'INFO   ' : level === 'failed' ? 'FAILED ' : 'SUCCESS';
    try {
      appendLog(file, `${new Date().toISOString()} ${tag} ${message}\n`);  // kept under 10 MB (see utils/logfile.js)
    } catch (e) {
      console.error(`cannot write ${file}: ${e.message}`);
    }
  }

  const json = express.json({ limit: BODY_LIMIT });

  // What is here, so the daemon can push only what differs. A space whose folder is gone is left out.
  app.get('/api/sync', (req, res) => {
    const state = readState();
    const spaces = {};
    for (const [key, hash] of Object.entries(state.spaces)) {
      const [origin, work, repository] = key.split('/');
      try {
        if (fs.existsSync(spaceDir(dataDir, { origin, work, repository }))) spaces[key] = hash;
      } catch (e) { /* a key that is not a space: left out */ }
    }
    machineLog(req, 'info', `polled: ${Object.keys(spaces).length} tasks folder${Object.keys(spaces).length === 1 ? '' : 's'} here`);
    res.json({ ok: true, config: state.config, spaces });
  });

  app.put('/api/sync/config', json, (req, res) => {
    const text = (req.body || {}).text;
    if (typeof text !== 'string') throw new SyncError(400, 'Missing text.');
    let pushedWorks;
    try {
      pushedWorks = parseConfig(text, 'the pushed taskmgr.json').works;
    } catch (e) {
      throw new SyncError(400, e.message);
    }
    const pushed = toMirror(dataDir, upgradeRaw(JSON.parse(text)));
    const mergedText = JSON.stringify(mergeConfigs(upgradeRaw(JSON.parse(readConfig())), pushed), null, 2) + '\n';
    let parsed;
    try {
      parsed = parseConfig(mergedText, 'taskmgr.json');
      writeConfig(mergedText);
    } catch (e) {
      throw new SyncError(409, `Cannot merge with the taskmgr.json here: ${e.message}`);
    }
    const pruned = pruneOrigins(dataDir, parsed.works);
    const state = readState();
    state.config = sha1(text);
    const keys = spaceKeys(parsed.works);
    for (const k of Object.keys(state.spaces)) if (!keys.has(k)) { delete state.spaces[k]; delete state.blobs[k]; }
    for (const k of Object.keys(state.machines)) if (!keys.has(k)) delete state.machines[k];
    // A space this machine pushed before and its config no longer lists (a work or repository
    // renamed or removed there) stays here, as one of this server's own (see mergeConfigs), but is
    // no longer this machine's: the machine is forgotten, so the web UI shows the copy as plain
    // "remote", without the dot, and so is the snapshot, so the space is pushed whole should the
    // machine list it again. Its blobs stay referenced, so none is uploaded again then.
    if (req.machine) {
      const pushed = spaceKeys(pushedWorks);
      for (const k of Object.keys(state.machines)) {
        if (state.machines[k] === req.machine && !pushed.has(k)) { delete state.machines[k]; delete state.spaces[k]; }
      }
    }
    writeState(state);
    pruneBlobs(state);
    machineLog(req, 'success', `pushed taskmgr.json${pruned.length ? ` (removed here: ${pruned.join(', ')})` : ''}`);
    res.json({ ok: true, pruned });
  });

  // Which of these blobs are not here yet.
  app.post('/api/sync/blobs', json, (req, res) => {
    const { blobs } = req.body || {};
    if (!Array.isArray(blobs) || blobs.some(b => typeof b !== 'string' || !BLOB_RE.test(b))) throw new SyncError(400, '"blobs" must be an array of sha1 hashes.');
    const missing = [...new Set(blobs)].filter(b => !fs.existsSync(blobPath(dataDir, b)));
    res.json({ ok: true, missing });
  });

  // One file into the blob store, named by the sha1 of its content.
  app.put('/api/sync/blob/:sha', express.raw({ type: () => true, limit: BLOB_LIMIT }), (req, res) => {
    const sha = String(req.params.sha || '');
    if (!BLOB_RE.test(sha)) throw new SyncError(400, `Invalid blob "${sha}".`);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (crypto.createHash('sha1').update(body).digest('hex') !== sha) throw new SyncError(400, 'The content does not hash to the given sha1.');
    const dir = path.join(dataDir, BLOBS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${sha}.${crypto.randomBytes(4).toString('hex')}`);
    try {
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, blobPath(dataDir, sha));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    res.json({ ok: true });
  });

  app.put('/api/sync/space', json, (req, res) => {
    const { origin = '', work, repository = '', machine, entries } = req.body || {};
    if (typeof origin !== 'string' || typeof repository !== 'string') throw new SyncError(400, 'origin and repository must be strings.');
    const target = spaceDir(dataDir, { origin, work, repository });
    if (!Array.isArray(entries)) throw new SyncError(400, '"entries" must be an array.');
    const list = entries.map(checkEntry);
    const { files, dirs } = writeSnapshot(dataDir, target, list);
    const state = readState();
    const key = spaceKey({ origin: origin.trim(), work: work.trim(), repository: repository.trim() });
    state.spaces[key] = sha1(JSON.stringify(entries));
    state.blobs[key] = [...new Set(list.filter(e => e.blob).map(e => e.blob))];
    const name = machineName(machine);
    if (name) state.machines[key] = name;
    else delete state.machines[key];
    writeState(state);
    pruneBlobs(state);
    machineLog(req, 'success', `pushed ${label({ origin, work, repository })} (${files} file${files === 1 ? '' : 's'}, ${dirs} empty folder${dirs === 1 ? '' : 's'})`);
    res.json({ ok: true, files, dirs });
  });

  // ---------- pull: what `tm pull` reads ----------

  // The folder of a space as this server's taskmgr.json has it (a copy of a pushed folder, or a folder
  // of its own), or a 404 when the config does not list it or it has no tasks folder.
  function rootOf(q) {
    const { works } = parseConfig(readConfig(), 'taskmgr.json');
    const origin = String(q.origin || '').trim();
    const work = String(q.work || '').trim();
    const repository = String(q.repository || '').trim();
    const w = works.find(x => x.work === work && (x.origin || '') === origin);
    const root = w && (repository ? (w.repositories.find(p => p.name === repository) || {}).root : w.root);
    if (!root) throw new SyncError(404, `No tasks folder for "${[origin, work, repository].filter(Boolean).join(' / ')}" here.`);
    return root;
  }

  // The server's taskmgr.json as it is.
  app.get('/api/sync/pull/config', (req, res) => {
    machineLog(req, 'info', 'pulled taskmgr.json');
    res.json({ ok: true, text: readConfig() });
  });

  // The task folders of a space, in the form of a push (what is beside them in the folder is left
  // out, as a push leaves it out; see taskEntries): { path, content } for a task file, { path, blob:
  // sha1, size } for any other file (fetched with /pull/file), { path, dir: true } for an empty folder.
  app.get('/api/sync/pull/space', (req, res) => {
    const root = rootOf(req.query);
    const listed = [];
    const walk = (dir, rel) => {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch (e) {
        return;
      }
      let count = 0;
      for (const name of names) {
        if (name === '.DS_Store') continue;
        const abs = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(abs);
        } catch (e) {
          continue;
        }
        const entryRel = rel ? `${rel}/${name}` : name;
        if (stat.isDirectory()) {
          walk(abs, entryRel);
        } else if (stat.isFile()) {
          try {
            if (name === 'task.txt') {
              listed.push({ path: entryRel, content: fs.readFileSync(abs, 'utf8') });
            } else {
              listed.push({ path: entryRel, blob: crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'), size: stat.size });
            }
          } catch (e) {
            continue;
          }
        } else {
          continue;
        }
        count++;
      }
      if (!count && rel) listed.push({ path: rel, dir: true });
    };
    walk(root, '');
    const entries = taskEntries(listed);
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    machineLog(req, 'info', `pulled ${label(req.query)} (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'})`);
    res.json({ ok: true, entries });
  });

  // One file of a space, raw. `path` is relative to the space's folder.
  app.get('/api/sync/pull/file', (req, res) => {
    const root = path.resolve(rootOf(req.query));
    const rel = String(req.query.path || '');
    const parts = rel.split('/');
    if (!rel || parts.some(s => !s || s === '.' || s === '..' || s.includes('\0'))) throw new SyncError(400, `Invalid path "${rel}".`);
    const abs = path.resolve(root, ...parts);
    if (!inside(root, abs)) throw new SyncError(400, 'The path leaves the folder.');
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch (e) {
      throw new SyncError(404, `No file "${rel}".`);
    }
    if (!stat.isFile()) throw new SyncError(404, `No file "${rel}".`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
  });

  // A refused request answers with its code (and, for MISSING_BLOBS, the blobs to upload).
  app.use('/api/sync', (err, req, res, next) => {
    if (!(err instanceof SyncError)) return next(err);
    machineLog(req, 'failed', `${req.method} ${req.originalUrl.split('?')[0]}: ${err.message}`);
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.missing ? { missing: err.missing } : {}) });
  });

  // The machine the space (see spaceKey) was last pushed from: { name, seenAt, online }, with its
  // MACHINE_ID, when (ms) it last made a request (null: not since the server started) and whether that
  // was within ONLINE_MS. null when the space was never pushed or the push did not say. Read from the
  // state file each time, as pushes come in between.
  app.machineInfo = (space) => {
    const name = readState().machines[spaceKey(space)] || '';
    if (!name) return null;
    const seenAt = seen.get(name) || null;
    return { name, seenAt, online: !!seenAt && Date.now() - seenAt < ONLINE_MS };
  };

  // Forget the hashes of the pushed snapshots, so the next push sends every space whole: to be called
  // when the tasks are changed here (the web UI), which leaves the copies no longer what was pushed.
  // The blobs each space refers to are kept, so none is uploaded again.
  app.forgetPushed = () => {
    const state = readState();
    if (!Object.keys(state.spaces).length) return;
    state.spaces = {};
    writeState(state);
  };

  return app;
}

module.exports = { createSyncApp, isMirrored, spaceKey, sha1, moveTasks };
