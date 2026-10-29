#!/usr/bin/env node
// taskmgr web UI server: an Express app exposing the task folders as a JSON API
// and serving the React frontend (Vite in dev, the prebuilt dist/ in production).
//
//   node server/index.js
//
// The works and repositories (each a folder of tasks) come from taskmgr.json, see server/config.js.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const {
  TASK_FILE,
  PROMPT_FILE,
  STATUS_DIRS,
  SYNC_MAX_FOLDER_BYTES,
  SYNC_MAX_FOLDER_FILES,
  SYNC_SKIPPED_FILES,
  readPrompt,
  listDirOf,
  isTaskFolder,
  readTaskDir,
  ensureTaskFile,
  createTask,
  saveTask,
  markTask,
  moveTask,
  normalizeTaskFile,
  deleteTask,
  renameTaskByFirstLine,
  openTask,
  openFolder,
  readTasks,
  compareIdsDesc
} = require('../utils/taskUtils');
const { getEditor } = require('../utils/editorUtils');
const { resolveConfig, POLL_STATE_PATH } = require('./config');
const { createAuthApp } = require('./auth');
const { createSyncApp, isMirrored, spaceKey } = require('./sync');
const { createAiApp, createAiRunnerApp, isRunnerConnected } = require('./ai');
const { listRecords, lastPrompt } = require('../ai/record');
const { trimLogs } = require('../utils/logfile');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
// Dev (Vite middleware, hot reload) when NODE_ENV=development, or when nothing is built yet;
// otherwise the prebuilt dist/ is served, so `pnpm run webui` works without any env set.
const DEV = process.env.NODE_ENV === 'development'
  || (process.env.NODE_ENV !== 'production' && !fs.existsSync(path.join(DIST_DIR, 'index.html')));

let config;
try {
  config = resolveConfig();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A space is one folder of tasks: the common tasks of a work, or one of its repositories.
// Looked up from the query string / body of every task request as ?work=&repository=.
function findSpace(work, repository) {
  const w = config.getWorks().find(x => x.work === work);
  if (!w) return null;
  if (!repository) return { work: w.work, repository: '', root: w.root };
  const p = w.repositories.find(x => x.name === repository);
  if (!p) return null;
  return { work: w.work, repository: p.name, root: p.root };
}

function spaceFrom(params) {
  const work = String(params.work || '');
  const repository = String(params.repository || '');
  if (!work) throw new HttpError(400, 'Missing work.');
  const space = findSpace(work, repository);
  if (!space) throw new HttpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
  if (!space.root) throw new HttpError(404, `"${work}" has no tasks folder of its own.`);
  if (!fs.existsSync(space.root) || !fs.statSync(space.root).isDirectory()) {
    throw new HttpError(404, `Folder not found: ${space.root}`);
  }
  return space;
}

// Resolve a path relative to a space's root and make sure it stays inside it.
function resolveInsideRoot(root, rel) {
  const abs = path.resolve(root, rel || '');
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new HttpError(400, 'Path is outside the tasks root.');
  }
  return abs;
}

function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function resolveDir(root, rel) {
  const abs = resolveInsideRoot(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new HttpError(404, 'Directory not found.');
  }
  return abs;
}

function resolveTaskDir(root, rel) {
  if (!rel) throw new HttpError(400, 'Missing task path.');
  const abs = resolveDir(root, rel);
  if (!isTaskFolder(abs)) {
    throw new HttpError(404, 'Task not found.');
  }
  return abs;
}

// A task folder without a task file still reads as a task (see readTaskDir).
const taskFromDir = readTaskDir;

// A task's prompt, prompt.txt beside its task.txt (PROMPT_FILE and readPrompt are in taskUtils, shared
// with `tm run`): edited under the task's text in the web UI's Task panel. It is not an attachment
// (listFiles leaves it out); GET /api/task answers it and PUT /api/task/prompt writes it.

// Write a task's prompt.txt as typed, overwriting it; a blank text too (the web UI makes the file,
// blank, as the prompt is opened), so the file stays once made.
function writePrompt(taskDirAbs, text) {
  fs.writeFileSync(path.join(taskDirAbs, PROMPT_FILE), text, 'utf8');
}

function firstDetailLine(details) {
  return (details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
}

// Same ordering as the CLI: todo first, then done, then pending, then aborted; newest id first
// within a group.
function statusOrder(s) {
  const st = (s || '').toLowerCase();
  if (st === 'done') return 1;
  if (st === 'pending') return 2;
  if (st === 'aborted') return 3;
  return 0;
}

function sortTasks(tasks) {
  tasks.sort((a, b) => {
    const sa = statusOrder(a.status);
    const sb = statusOrder(b.status);
    if (sa !== sb) return sa - sb;
    return compareIdsDesc(a, b);
  });
  return tasks;
}

const STATUSES = ['todo', 'done', 'pending', 'aborted'];

function normalizeStatus(s) {
  const st = String(s || '').toLowerCase();
  return STATUSES.includes(st) ? st : 'todo';
}

// A task with its subtasks (the task folders inside its own, sorted as a list is), each with
// theirs, so the UI shows a folder of tasks as a tree.
function serializeTask(root, t) {
  const taskDir = path.dirname(t.path);
  let subtasks = [];
  try { subtasks = sortTasks(readTasks(taskDir)).map(s => serializeTask(root, s)); } catch (e) { subtasks = []; }
  return {
    id: t.id,
    rel: toRel(root, taskDir),
    folder: path.basename(taskDir),
    status: normalizeStatus(t.status),
    title: firstDetailLine(t.details),
    details: t.details || '',
    hasSubtask: subtasks.length > 0,
    subtasks
  };
}

// Breadcrumb from the space's root down to `abs`: every task folder on the way (the "done",
// "pending" and "aborted" folders between them are skipped).
function crumbsFor(root, abs) {
  const crumbs = [];
  let cur = abs;
  while (cur !== root) {
    let title = path.basename(cur);
    if (isTaskFolder(cur)) {
      try { title = firstDetailLine(readTaskDir(cur).details) || title; } catch (e) { /* keep folder name */ }
    }
    crumbs.unshift({ rel: toRel(root, cur), title });
    cur = isTaskFolder(cur) ? listDirOf(cur) : path.dirname(cur);
  }
  return crumbs;
}

// A machine as the web UI shows it: syncApp.machineInfo plus `runner`, whether its taskmgrd is
// connected to run Claude Code for this server (AI_RUNNER=1 there, see ai/remote.js); a machine so
// connected is in touch.
function withRunner(m) {
  if (!m) return null;
  const runner = isRunnerConnected(m.name);
  return { ...m, runner, online: m.online || runner };
}

// The machine a mirror folder (see isMirrored) was pushed from, as the last push of the space said:
// { name, seenAt, online, runner } (see withRunner), or null (shown as plain "remote"). A space is
// found by work and repository; the origin comes from the config, as a work is in one origin only.
function machineOf({ work, repository, root }) {
  if (!isMirrored(config.dataDir, root)) return null;
  const w = config.getWorks().find(x => x.work === work);
  return w ? withRunner(syncApp.machineInfo({ origin: w.origin, work: w.work, repository: repository || '' })) : null;
}

// How many tasks are todo, done, pending and aborted, subtasks included.
function countTasks(tasks, counts = { todo: 0, done: 0, pending: 0, aborted: 0 }) {
  for (const t of tasks) {
    counts[normalizeStatus(t.status)]++;
    countTasks(t.subtasks || [], counts);
  }
  return counts;
}

function listDir(space, rel) {
  const root = space.root;
  const abs = resolveDir(root, rel);
  const tasks = sortTasks(readTasks(abs)).map(t => serializeTask(root, t));
  const isRoot = abs === root;
  const parent = isRoot ? null : toRel(root, isTaskFolder(abs) ? listDirOf(abs) : path.dirname(abs));
  return {
    work: space.work,
    repository: space.repository,
    dir: toRel(root, abs),
    absDir: abs,
    remote: isMirrored(config.dataDir, root),
    machine: machineOf(space),
    isRoot,
    parent,
    crumbs: crumbsFor(root, abs),
    tasks,
    counts: countTasks(tasks)
  };
}

// The top-level tasks of several spaces in one list, each task saying which space it lives in
// (its rel is relative to that space's root). Spaces whose folder is missing (or that have none)
// are skipped.
function listSpacesTasks(spaces, absDir) {
  const tasks = [];
  for (const s of spaces) {
    if (!fs.existsSync(s.root) || !fs.statSync(s.root).isDirectory()) continue;
    for (const t of readTasks(s.root)) tasks.push({ ...serializeTask(s.root, t), work: s.work, repository: s.repository });
  }
  sortTasks(tasks);
  const remote = isMirrored(config.dataDir, absDir);
  // absDir, when given, is the root of the first space (a work's common tasks).
  const machine = remote && spaces[0] && spaces[0].root === absDir ? machineOf(spaces[0]) : null;
  return { dir: '', absDir, remote, machine, isRoot: true, parent: null, crumbs: [], tasks, counts: countTasks(tasks) };
}

// A work's common tasks and those of all its repositories.
function workSpaces(w) {
  return [
    { work: w.work, repository: '', root: w.root },
    ...w.repositories.map(p => ({ work: w.work, repository: p.name, root: p.root }))
  ];
}

// The works/repositories list with, for each folder, whether it exists, whether it is a copy
// pushed by taskmgrd (remote) and, then, the machine it was pushed from. A work without a tasks
// folder of its own (root "") is not missing one.
function listSpaces() {
  const describe = (root, space) => {
    const remote = isMirrored(config.dataDir, root);
    // A mirror folder is ours to make (nothing has been pushed into it yet), so it is created
    // here instead of asking the user to.
    if (remote && !fs.existsSync(root)) {
      try { fs.mkdirSync(root, { recursive: true }); } catch (e) { /* shown as missing below */ }
    }
    return {
      root,
      exists: !root || (fs.existsSync(root) && fs.statSync(root).isDirectory()),
      remote,
      machine: remote ? withRunner(syncApp.machineInfo(space)) : null
    };
  };
  return config.getWorks().map(w => ({
    work: w.work,
    origin: w.origin,
    income: w.income,
    hidden: w.hidden,
    shownPath: w.shownPath,
    ...describe(w.root, { origin: w.origin, work: w.work, repository: '' }),
    repositories: w.repositories.map(p => ({ name: p.name, sourcePath: p.sourcePath, shownPath: p.shownPath, paths: p.paths, ...describe(p.root, { origin: w.origin, work: w.work, repository: p.name }) }))
  }));
}

// What every change to taskmgr.json answers with: the works and the named origins ({ origin,
// income }, an origin possibly without works yet).
function spacesBody() {
  return { works: listSpaces(), origins: config.getOrigins() };
}

// The content of a folder inside a task, as `tm push` would sync it: its entries ({ name, rel,
// isDir, size, children for a folder }), folders first, or null when the folder is not synced
// (larger than 10 MB or with more than 10 files, see SYNC_MAX_FOLDER_BYTES in taskUtils), so the
// web UI shows it closed. Sized and counted as push does; hidden files are not listed.
function syncedTree(root, dirAbs) {
  let size = 0;
  let count = 0;
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SYNC_SKIPPED_FILES.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      let stat;
      try { stat = fs.statSync(abs); } catch (err) { continue; }  // a broken link
      if (stat.isDirectory()) {
        const children = walk(abs);
        if (!children) return null;
        if (!e.name.startsWith('.')) out.push({ name: e.name, rel: toRel(root, abs), isDir: true, size: 0, children });
      } else if (stat.isFile()) {
        size += stat.size;
        count++;
        if (size > SYNC_MAX_FOLDER_BYTES || count > SYNC_MAX_FOLDER_FILES) return null;
        if (!e.name.startsWith('.')) out.push({ name: e.name, rel: toRel(root, abs), isDir: false, size: stat.size });
      }
    }
    return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  };
  try {
    return walk(dirAbs);
  } catch (err) {
    return null;
  }
}

function listFiles(root, taskDirAbs) {
  const entries = fs.readdirSync(taskDirAbs, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === TASK_FILE || e.name === PROMPT_FILE) continue;  // the task's own files, not attachments
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory() && STATUS_DIRS.includes(e.name)) continue;  // holds done / pending / aborted subtasks
    const abs = path.join(taskDirAbs, e.name);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (err) { /* ignore */ }
    const isSubtask = e.isDirectory() && isTaskFolder(abs);
    const file = { name: e.name, rel: toRel(root, abs), isDir: e.isDirectory(), isSubtask, size };
    if (file.isDir && !isSubtask) {
      const children = syncedTree(root, abs);
      if (children) file.children = children;
    }
    files.push(file);
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

// Write a task's details (and status, which moves its folder) and rename its folder after the title.
function writeTaskFields(taskDirAbs, fields) {
  const task = taskFromDir(taskDirAbs);
  if (fields.details !== undefined) task.details = String(fields.details).replace(/\r\n/g, '\n');
  saveTask(task);
  task.path = renameTaskByFirstLine(task.path);
  if (fields.status !== undefined) markTask(task, normalizeStatus(fields.status));
  return path.dirname(task.path);
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Pushes from taskmgrd on another machine (see server/sync.js): authorized by a shared token, not a
// login, and larger than the UI's requests, so mounted before the body limit and the login guard.
const syncToken = process.env.SYNC_SERVER_TOKEN;
// Every log in logs/ is kept under 10 MB (see utils/logfile.js): the ones written here are trimmed as
// they grow, the others once, now.
trimLogs(path.join(PROJECT_ROOT, 'logs'));
const syncApp = createSyncApp({ dataDir: config.dataDir, logsDir: path.join(PROJECT_ROOT, 'logs'), token: syncToken, readConfig: config.readText, writeConfig: config.writeText });
app.use(syncApp);
// The runners of those machines (their taskmgrd with AI_RUNNER=1), which run Claude Code there for
// the tasks pushed from there (see server/ai.js): the same token.
app.use(createAiRunnerApp({ auth: syncApp.auth }));

app.use(express.json({ limit: '10mb' }));

// Login first: everything under /api below needs a session (see server/auth.js).
app.use(createAuthApp({ usersPath: config.usersPath }));

// A change made here (a task moved, edited, deleted, a file added...) leaves the pushed copies no
// longer what taskmgrd pushed: the hashes of its snapshots are forgotten, or the next push, finding
// its folder the same as at the last one, would send nothing and leave the change here in place.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) syncApp.forgetPushed(); });
  next();
});

// The host of the sync server in .env (SYNC_SERVER, the URL taskmgrd pushes to), "tm.example.com"
// or "tm.example.com:8080" for the status bar; "" when there is none.
function syncServerHost() {
  const url = String(process.env.SYNC_SERVER || '').trim();
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch (e) {
    return url.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  }
}

app.get('/api/settings', (req, res) => {
  res.json({ configPath: config.configPath, editor: getEditor(), syncServer: syncServerHost() });
});

// For the dot beside the sync server in the status bar: whether taskmgrd polls that server (POLLING=1
// in .env, with a SYNC_SERVER) and how its last pull went, from the state the daemon writes after
// each one (POLL_STATE_PATH, see taskmgrd's poll): `at` when it ended (ms; null when there has been
// none), `ok` whether it went through, `error` why not, and `fresh` whether it is recent enough for
// the daemon to be taken as running: within twice the polling interval, three minutes at least.
const isOn = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
function pollingStatus() {
  const on = isOn(process.env.POLLING) && !!String(process.env.SYNC_SERVER || '').trim();
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(POLL_STATE_PATH, 'utf8'));
  } catch (e) {
    // no pull yet
  }
  if (!last || typeof last.at !== 'number') return { on, at: null, ok: null, error: null, fresh: false };
  const interval = Number(last.interval) || Number(process.env.POLLING_INTERVAL) || 600;
  const staleMs = Math.max(3 * 60 * 1000, 2 * interval * 1000);
  return { on, at: last.at, ok: last.ok === true, error: last.error || null, fresh: Date.now() - last.at < staleMs };
}

app.get('/api/polling', (req, res) => {
  res.json(pollingStatus());
});

// The raw taskmgr.json, to edit the works and repositories from the web UI.
app.get('/api/config', (req, res) => {
  res.json({ configPath: config.configPath, text: config.readText() });
});

app.put('/api/config', (req, res) => {
  const text = (req.body || {}).text;
  if (typeof text !== 'string') throw new HttpError(400, 'Missing text.');
  try {
    config.writeText(text);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Add a work to taskmgr.json.
app.post('/api/work', (req, res) => {
  const { name, origin = '', tasksPath = '', income = null } = req.body || {};
  if (typeof name !== 'string' || typeof origin !== 'string' || typeof tasksPath !== 'string') throw new HttpError(400, 'Missing name.');
  try {
    config.addWork({ name, origin, tasksPath, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Set the name, income (null clears it) and, when given, the tasks folder and whether it is hidden,
// of one work in taskmgr.json.
app.put('/api/work', (req, res) => {
  const { work, name, income, hidden, tasksPath } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || income === undefined) throw new HttpError(400, 'Missing work, name or income.');
  if (hidden !== undefined && typeof hidden !== 'boolean') throw new HttpError(400, '"hidden" must be true or false.');
  if (tasksPath !== undefined && typeof tasksPath !== 'string') throw new HttpError(400, '"tasksPath" must be a string.');
  try {
    config.updateWork(work, { name, income, hidden, tasksPath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Set the name and income (null clears it) of one origin in taskmgr.json.
app.put('/api/origin', (req, res) => {
  const { origin, name, income } = req.body || {};
  if (typeof origin !== 'string' || typeof name !== 'string' || income === undefined) throw new HttpError(400, 'Missing origin, name or income.');
  try {
    config.updateOrigin(origin, { name, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Set the name, source folder and tasks folder of one repository of a work in taskmgr.json.
app.put('/api/repository', (req, res) => {
  const { work, name, newName, tasksPath = '', sourcePath = '' } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || typeof newName !== 'string' || typeof tasksPath !== 'string' || typeof sourcePath !== 'string') {
    throw new HttpError(400, 'Missing work, name or newName.');
  }
  try {
    config.updateRepository(work, name, { name: newName, tasksPath, sourcePath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one origin, with its works, from taskmgr.json; their folders are kept.
app.delete('/api/origin', (req, res) => {
  const origin = String(req.query.origin || '');
  try {
    config.removeOrigin(origin);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one work from taskmgr.json; its folders are kept.
app.delete('/api/work', (req, res) => {
  const work = String(req.query.work || '');
  try {
    config.removeWork(work);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Remove one repository of a work from taskmgr.json; its folders are kept.
app.delete('/api/repository', (req, res) => {
  const work = String(req.query.work || '');
  const name = String(req.query.name || '');
  try {
    config.removeRepository(work, name);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Add an origin (with no works yet) to taskmgr.json.
app.post('/api/origin', (req, res) => {
  const { name, income = null } = req.body || {};
  if (typeof name !== 'string') throw new HttpError(400, 'Missing name.');
  try {
    config.addOrigin({ name, income });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Add a repository to a work in taskmgr.json.
app.post('/api/repository', (req, res) => {
  const { work, name, tasksPath = '', sourcePath = '' } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string' || typeof tasksPath !== 'string' || typeof sourcePath !== 'string') {
    throw new HttpError(400, 'Missing work or name.');
  }
  try {
    config.addRepository({ work, name, tasksPath, sourcePath });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.status(201).json(spacesBody());
});

// Reorder taskmgr.json, which is the order of the tree: put an origin before the named origin
// `before`, a work before the work `before` of its origin, a repository before the repository
// `before` of its work; `before` null puts it last in its list. See config.moveOrigin and the others.
const beforeOf = (body) => {
  const before = body.before === undefined ? null : body.before;
  if (before !== null && typeof before !== 'string') throw new HttpError(400, '"before" must be a name or null.');
  return before;
};

app.post('/api/origin/move', (req, res) => {
  const { origin } = req.body || {};
  if (typeof origin !== 'string') throw new HttpError(400, 'Missing origin.');
  const before = beforeOf(req.body);
  try {
    config.moveOrigin(origin, before);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

app.post('/api/work/move', (req, res) => {
  const { work } = req.body || {};
  if (typeof work !== 'string') throw new HttpError(400, 'Missing work.');
  const before = beforeOf(req.body);
  try {
    config.moveWork(work, before);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

app.post('/api/repository/move', (req, res) => {
  const { work, name } = req.body || {};
  if (typeof work !== 'string' || typeof name !== 'string') throw new HttpError(400, 'Missing work or name.');
  const before = beforeOf(req.body);
  try {
    config.moveRepository(work, name, before);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json(spacesBody());
});

// Open the folder a tree row shows with the OS file manager: a work's tasks folder, or a
// repository's source code folder (its tasks folder when it has none).
app.post('/api/space/open', (req, res) => {
  const work = String(req.body?.work || '');
  const repository = String(req.body?.repository || '');
  const w = config.getWorks().find(x => x.work === work);
  const p = repository ? w?.repositories.find(x => x.name === repository) : null;
  if (!w || (repository && !p)) throw new HttpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
  const dir = p ? p.sourcePath || p.root : w.root;
  if (!dir) throw new HttpError(404, `"${work}" has no tasks folder of its own.`);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, `Folder not found: ${dir}`);
  openFolder(dir);
  res.json({ ok: true });
});

// Where a folder dropped on the web UI is: the browser gives only its name and what is in it, so
// it is looked for by those, first around the folders in taskmgr.json (their parents and
// grandparents, two levels down), then under the home folder (four levels down), skipping hidden
// folders and node_modules. The first folder of that name holding all of `entries` is taken.
const LOCATE_SKIPPED = new Set(['node_modules', 'AppData', 'Library', '$RECYCLE.BIN']);
const LOCATE_MAX_DIRS = 30000;

function locateFolder(name, entries) {
  const sameName = process.platform === 'win32' || process.platform === 'darwin'
    ? (a, b) => a.toLowerCase() === b.toLowerCase()
    : (a, b) => a === b;
  const holds = (dir) => {
    try {
      const names = new Set(fs.readdirSync(dir));
      return entries.every(e => names.has(e));
    } catch {
      return false;
    }
  };
  const seen = new Set();
  let visited = 0;
  // Breadth first from `start`, `depth` levels down.
  const search = (start, depth) => {
    let level = [start];
    for (let d = 0; d <= depth && level.length; d++) {
      const next = [];
      for (const dir of level) {
        if (seen.has(dir) || ++visited > LOCATE_MAX_DIRS) continue;
        seen.add(dir);
        let children;
        try {
          children = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const c of children) {
          if (!c.isDirectory() || c.name.startsWith('.') || LOCATE_SKIPPED.has(c.name)) continue;
          const child = path.join(dir, c.name);
          if (sameName(c.name, name) && holds(child)) return child;
          next.push(child);
        }
      }
      level = next;
    }
    return null;
  };

  const near = new Set();
  for (const w of config.getWorks()) {
    for (const p of [w.root, ...w.repositories.flatMap(r => [r.root, r.sourcePath])]) {
      if (!p) continue;
      near.add(path.dirname(p));
      near.add(path.dirname(path.dirname(p)));
    }
  }
  for (const dir of near) {
    const found = search(dir, 2);
    if (found) return found;
  }
  return search(os.homedir(), 4);
}

// The path of a folder dropped on the web UI, from its name and the names in it: { path }, with
// the home folder written "~" as in taskmgr.json.
app.post('/api/folder/locate', (req, res) => {
  const name = String(req.body?.name || '');
  const entries = Array.isArray(req.body?.entries) ? req.body.entries.map(String).slice(0, 50) : [];
  if (!name || name.includes('/') || name.includes('\\')) throw new HttpError(400, 'Missing name.');
  const found = locateFolder(name, entries);
  if (!found) throw new HttpError(404, `Folder "${name}" not found.`);
  const home = os.homedir();
  const rel = path.relative(home, found);
  const shown = path.sep === '/' && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel}` : found;
  res.json({ path: shown });
});

// Create the missing tasks folder of a work or a repository.
app.post('/api/space/create', (req, res) => {
  const space = findSpace(String(req.body?.work || ''), String(req.body?.repository || ''));
  if (!space) throw new HttpError(404, 'Unknown work or repository.');
  if (!space.root) throw new HttpError(400, `"${space.work}" has no tasks folder of its own.`);
  fs.mkdirSync(space.root, { recursive: true });
  res.status(201).json(spacesBody());
});

app.get('/api/spaces', (req, res) => {
  res.json(spacesBody());
});

app.get('/api/tasks', (req, res) => {
  res.json(listDir(spaceFrom(req.query), String(req.query.dir || '')));
});

// Every task of every work (?all=1), of an origin (?origin=: all its works and their
// repositories) or of one work (?work=: its common tasks and its repositories'), in one list.
app.get('/api/tasks/all', (req, res) => {
  const origin = String(req.query.origin || '');
  const work = String(req.query.work || '');
  if (req.query.all) return res.json(listSpacesTasks(config.getWorks().flatMap(workSpaces), ''));
  if (origin) {
    if (!config.getOrigins().some(o => o.origin === origin)) throw new HttpError(404, `Unknown origin "${origin}".`);
    const works = config.getWorks().filter(w => w.origin === origin);
    return res.json(listSpacesTasks(works.flatMap(workSpaces), ''));
  }
  const w = config.getWorks().find(x => x.work === work);
  if (!w) throw new HttpError(404, `Unknown work "${work}".`);
  res.json(listSpacesTasks(workSpaces(w), w.root));
});

// Create a task in `dir` with the given fields. Ids are the creation minute; a second
// task in the same minute gets the next free minute as its id (see createTask).
app.post('/api/tasks', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const dirAbs = resolveDir(root, body.dir || '');
  const taskPath = createTask(dirAbs);
  const taskDir = writeTaskFields(path.dirname(taskPath), body);
  res.status(201).json({ task: serializeTask(root, taskFromDir(taskDir)) });
});

// One task with its attachments and its prompt (the prompt.txt text, null when it has none), and
// `lastPrompt`, the prompt its latest run was given (see ai/record.js lastPrompt).
app.get('/api/task', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  res.json({ task: serializeTask(root, taskFromDir(taskDir)), files: listFiles(root, taskDir), prompt: readPrompt(taskDir), lastPrompt: lastPrompt(taskDir), runs: listRecords(taskDir) });
});

// Write a task's prompt.txt as typed (see writePrompt). Answers the prompt as it is now and the
// task's attachments.
app.put('/api/task/prompt', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  if (typeof body.text !== 'string') throw new HttpError(400, 'Missing text.');
  writePrompt(taskDir, body.text.replace(/\r\n/g, '\n'));
  res.json({ prompt: readPrompt(taskDir), files: listFiles(root, taskDir) });
});

app.put('/api/task', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = writeTaskFields(resolveTaskDir(root, body.rel), body);
  res.json({ task: serializeTask(root, taskFromDir(taskDir)) });
});

app.post('/api/task/status', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  const status = String(body.status || '').toLowerCase();
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const task = taskFromDir(taskDir);
  markTask(task, status);
  res.json({ task: serializeTask(root, taskFromDir(path.dirname(task.path))) });
});

// Move a task into `into`: another task's folder (it becomes a subtask of that task) or a folder
// of tasks ("" the space's root), keeping its status (see moveTask). With `to` ({ work, repository })
// `into` is in that space instead, and the task leaves its own; the answer's rel is then in `to`.
app.post('/api/task/move', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  const toRoot = body.to ? spaceFrom(body.to).root : root;
  const intoDir = resolveDir(toRoot, String(body.into || ''));
  if (STATUS_DIRS.includes(path.basename(intoDir))) throw new HttpError(400, 'Not a folder of tasks.');
  const task = taskFromDir(taskDir);
  try {
    moveTask(task, intoDir);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  res.json({ task: serializeTask(toRoot, taskFromDir(path.dirname(task.path))) });
});

// The task file as text, for the web editor (the terminal opens the same file in $EDITOR).
app.get('/api/task/text', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  const taskPath = ensureTaskFile(path.join(taskDir, TASK_FILE));
  res.json({ text: fs.readFileSync(taskPath, 'utf8') });
});

// Write the task file as typed, then do what the terminal does after the editor closes:
// tidy the file and rename the folder after the first line of the details.
function writeTaskText(root, taskDir, text) {
  const taskPath = path.join(taskDir, TASK_FILE);
  fs.writeFileSync(taskPath, String(text || '').replace(/\r\n/g, '\n'), 'utf8');
  normalizeTaskFile(taskPath);
  const newPath = renameTaskByFirstLine(taskPath);
  return serializeTask(root, taskFromDir(path.dirname(newPath)));
}

app.put('/api/task/text', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  res.json({ task: writeTaskText(root, taskDir, body.text) });
});

// Create a task in `dir` from the typed task file text.
app.post('/api/tasks/text', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const dirAbs = resolveDir(root, body.dir || '');
  const taskDir = path.dirname(createTask(dirAbs));
  res.status(201).json({ task: writeTaskText(root, taskDir, body.text) });
});

// Open the task folder with the OS file manager (only meaningful when the browser runs on the same machine).
app.post('/api/task/open', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const taskDir = resolveTaskDir(root, body.rel);
  openTask(taskFromDir(taskDir));
  res.json({ ok: true });
});

app.delete('/api/task', (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  deleteTask(taskFromDir(taskDir));
  res.json({ ok: true });
});

// Serve an attachment that lives inside a task folder.
app.get('/api/file', (req, res) => {
  const { root } = spaceFrom(req.query);
  const abs = resolveInsideRoot(root, String(req.query.rel || ''));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
  res.set('Cache-Control', 'no-store');
  // dotfiles allowed: a run's record is a hidden folder (.claude_<time>) and sendFile 404s any path through one
  if (req.query.download === '1') return res.download(abs, { dotfiles: 'allow' });
  res.sendFile(abs, { dotfiles: 'allow' });
});

// A file name for an attachment: a plain name, never the task file or a hidden file.
function attachmentName(raw) {
  const name = path.basename(String(raw || '').replace(/\\/g, '/')).trim();
  if (!name || name === '.' || name === '..' || name.startsWith('.') || name === TASK_FILE) {
    throw new HttpError(400, 'Invalid file name.');
  }
  return name;
}

// "name.ext", or "name (1).ext", "name (2).ext", ... when that is taken.
function freeFileName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

// Upload an attachment into a task folder. The body is the raw file; space, task and file name
// are in the query, so no multipart parser is needed.
app.post('/api/task/file', express.raw({ type: () => true, limit: '200mb' }), (req, res) => {
  const { root } = spaceFrom(req.query);
  const taskDir = resolveTaskDir(root, String(req.query.rel || ''));
  const name = freeFileName(taskDir, attachmentName(req.query.name));
  fs.writeFileSync(path.join(taskDir, name), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  res.status(201).json({ files: listFiles(root, taskDir) });
});

// The task folder an attachment is in: a file right inside a task folder (not its task file), or in
// a folder in it (not one of its done / pending / aborted folders, which hold subtasks). Throws when
// `abs` is no such file.
function taskDirOfAttachment(root, abs) {
  const notAttachment = () => new HttpError(400, 'Not an attachment.');
  if (path.basename(abs) === TASK_FILE && isTaskFolder(path.dirname(abs))) throw notAttachment();
  let dir = path.dirname(abs);
  let child = abs;
  while (!isTaskFolder(dir)) {
    child = dir;
    dir = path.dirname(dir);
    if (dir === child || !path.relative(root, dir) || path.relative(root, dir).startsWith('..')) throw notAttachment();
  }
  if (child !== abs && STATUS_DIRS.includes(path.basename(child))) throw notAttachment();
  return dir;
}

// Delete one attachment (see taskDirOfAttachment).
app.delete('/api/file', (req, res) => {
  const { root } = spaceFrom(req.query);
  const abs = resolveInsideRoot(root, String(req.query.rel || ''));
  const taskDir = taskDirOfAttachment(root, abs);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
  fs.unlinkSync(abs);
  res.json({ files: listFiles(root, taskDir) });
});

// Write an attachment as text, as typed in the preview's editor (see taskDirOfAttachment). Answers
// the task's attachments, with the file's new size.
app.put('/api/file', (req, res) => {
  const body = req.body || {};
  const { root } = spaceFrom(body);
  const abs = resolveInsideRoot(root, String(body.rel || ''));
  const taskDir = taskDirOfAttachment(root, abs);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'File not found.');
  if (typeof body.text !== 'string') throw new HttpError(400, 'Missing text.');
  fs.writeFileSync(abs, body.text.replace(/\r\n/g, '\n'), 'utf8');
  res.json({ files: listFiles(root, taskDir) });
});

// Running Claude Code on a task from the panel, and answering what it asks (see ai.js): here, or on
// the machine a pushed copy came from.
app.use(createAiApp({
  config,
  logFile: path.join(PROJECT_ROOT, 'logs', 'ai.log'),
  machine: String(process.env.MACHINE_ID || '').trim() || undefined,
  locate: (space) => ({ remote: isMirrored(config.dataDir, space.root), machine: machineOf(space) })
}));

app.use('/api', (req, res) => { throw new HttpError(404, 'Unknown API route.'); });

// Frontend. Dev: Vite runs in middleware mode so the API and the app share one port.
// Prod: the prebuilt dist/ is served as static files.
// Dev: the hot reload socket rides on the app's own server (and port), not a port of its own,
// so the browser needs nothing but the page's address to receive it.
const httpServer = http.createServer(app);

async function mountFrontend() {
  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: PROJECT_ROOT,
      server: { middlewareMode: true, ws: { server: httpServer } },
      appType: 'custom'
    });
    app.use(vite.middlewares);
    app.use(asyncRoute(async (req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      try {
        const template = await fs.promises.readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
        res.status(200).set({ 'Content-Type': 'text/html' }).end(await vite.transformIndexHtml(req.originalUrl, template));
      } catch (err) {
        vite.ssrFixStacktrace(err);
        next(err);
      }
    }));
  } else {
    if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      console.error('dist/ not found. Run `pnpm run build` (or ./setup.sh) first.');
      process.exit(1);
    }
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => { if (err) next(); });
    });
  }
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = (err instanceof HttpError) ? err.status : (err.status || 500);
  if (status === 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.message || 'Internal error' });
});

mountFrontend().then(() => {
  const server = httpServer.listen(config.port, config.host, () => {
    console.log('taskmgr web UI' + (DEV ? ' (dev)' : ''));
    console.log(`  config     : ${config.configPath}`);
    console.log(`  users      : ${config.usersPath}`);
    console.log(`  sync       : ${syncToken && syncToken.trim() ? `receiving from taskmgrd into ${path.join(config.dataDir, 'origins')}` : 'off (set SYNC_SERVER_TOKEN in .env to receive pushes from taskmgrd)'}`);
    for (const w of config.getWorks()) {
      console.log(`  work       : ${w.work}${w.origin ? ` (${w.origin})` : ''}${w.root ? `  ${w.root}` : ''}`);
      for (const p of w.repositories) console.log(`    repository : ${p.name}  ${p.root}${p.sourcePath ? `  (source: ${p.sourcePath})` : ''}`);
    }
    console.log(`  url        : http://${config.host}:${config.port}/`);
    console.log('Press Ctrl+C to stop.');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Error: port ${config.port} is already in use. Set PORT in .env.`);
    } else {
      console.error(`Error: ${e.message}`);
    }
    process.exit(1);
  });
});
