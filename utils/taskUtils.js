const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TASK_FILE = 'task.txt';

// A task's prompt, prompt.txt beside its task.txt: the text for an AI agent working on the task,
// edited under the task's text in the web UI's Task panel and run by `tm run`. It is not an
// attachment.
const PROMPT_FILE = 'prompt.txt';

// The prompt.txt text of a task folder, or null when it has none.
function readPrompt(taskDirAbs) {
  const p = path.join(taskDirAbs, PROMPT_FILE);
  try {
    return fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null;
  } catch (e) {
    return null;
  }
}

// A task's status is where its folder is: right in a folder of tasks it is todo, in that
// folder's "done", "pending" or "aborted" folder it is done, pending or aborted.
const STATUS_DIRS = ['done', 'pending', 'aborted'];

// What `tm push` leaves out of a task (see snapshot in push.js): a file larger than this, and a
// folder inside it (not a task folder) larger than this or with more files than this, its
// subfolders' included. Such a folder is not synced, and the web UI does not open it either.
const SYNC_MAX_FILE_BYTES = 5 * 1024 * 1024;
const SYNC_MAX_FOLDER_BYTES = 10 * 1024 * 1024;
const SYNC_MAX_FOLDER_FILES = 10;
const SYNC_SKIPPED_FILES = new Set(['.DS_Store']);  // never pushed: Finder rewrites it all the time

// task.txt is just the task's details, the first line being its title. Older files start
// with a front matter block (---, status:, labels:, ..., ---); its status is returned as
// oldStatus so readTasks can move the task into its status folder.
function parseTask(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fm) return { details: text };
  const st = /^status:\s*(.*)$/m.exec(fm[1]);
  return { details: fm[2].replace(/^(\r?\n)+/, ''), oldStatus: st ? st[1].trim().toLowerCase() : '' };
}

// The folder whose list shows the task in taskDir: its parent, or the one above when the
// parent is a status folder.
function listDirOf(taskDir) {
  const parent = path.dirname(taskDir);
  return STATUS_DIRS.includes(path.basename(parent)) ? path.dirname(parent) : parent;
}

function statusOf(taskDir) {
  const parent = path.basename(path.dirname(taskDir));
  return STATUS_DIRS.includes(parent) ? parent : 'todo';
}

// The folders holding the tasks listed in dir, with the status of the tasks in each.
function statusFolders(dir) {
  return [{ dir, status: 'todo' }, ...STATUS_DIRS.map(st => ({ dir: path.join(dir, st), status: st }))];
}

// Folder names that are tasks: a 12-digit creation minute, optionally followed by a space and
// a title ("202610191522 fix mail").
const TASK_FOLDER_RE = /^\d{12}( |$)/;

// A directory is a task folder when its name has the time prefix, and only then: a folder named
// some other way is not a task even when it holds a task.txt (a run record, .claude_<time>/,
// keeps a copy of the task's; see ai/record.js).
function isTaskFolder(dirAbs) {
  try {
    if (!fs.statSync(dirAbs).isDirectory()) return false;
  } catch (e) {
    return false;
  }
  return TASK_FOLDER_RE.test(path.basename(dirAbs));
}

// Of a tasks folder listed for the sync (paths relative to it, "/"-separated; a file as { path },
// an empty folder as { path, dir: true }; see snapshot in push.js), the entries that are in one of
// its task folders: a folder right in it, or in its done, pending or aborted folder, that is a task
// by name alone (TASK_FOLDER_RE: an id, then a title or nothing, as isTaskFolder tells a task).
// Nothing else in a tasks folder is synced: a file right in it, a folder named some other way and
// whatever is in it (even a task.txt), a file right in a status folder; an empty status folder is
// left out too. What is in a task folder goes whole, subtasks, attachments and other files alike.
function taskEntries(entries) {
  return entries.filter((e) => {
    const p = String(e.path).split('/');
    const n = STATUS_DIRS.includes(p[0]) ? 2 : 1;  // how many leading parts name the task folder
    if (p.length < n || (p.length === n && e.dir !== true)) return false;  // a status folder itself, or a file right there
    return TASK_FOLDER_RE.test(p[n - 1]);
  });
}

// Read the task of a task folder. A folder without a task file (one made by
// hand, or just "<id> title") is still a task, titled after the folder name.
function readTaskDir(dirAbs) {
  const name = path.basename(dirAbs);
  const taskPath = path.join(dirAbs, TASK_FILE);
  const parsed = fs.existsSync(taskPath) ? parseTask(fs.readFileSync(taskPath, 'utf8')) : { details: folderTitle(name) };
  parsed.status = statusOf(dirAbs);
  parsed.id = folderId(name);  // only the id prefix
  parsed.path = taskPath;
  return parsed;
}

// An older task file: drop its front matter, and move a done, pending or aborted task (still
// right in its folder of tasks) into its status folder. Returns the task as it is now.
function migrateTask(task) {
  if (task.oldStatus === undefined) return task;
  const { oldStatus } = task;
  delete task.oldStatus;
  saveTask(task);
  if (task.status === 'todo' && STATUS_DIRS.includes(oldStatus)) {
    try { markTask(task, oldStatus); } catch (e) { /* leave it where it is */ }
  }
  return task;
}

// Make sure the task file of a task folder exists, so an editor or a write
// finds a well-formed file. Returns the task file path.
function ensureTaskFile(taskPath) {
  if (!fs.existsSync(taskPath)) saveTask(readTaskDir(path.dirname(taskPath)));
  return taskPath;
}

// The tasks listed in dir: its task folders and those in its status folders.
function readTasks(dir) {
  // every folder first: migrating an older task can move it into a status folder not read yet
  const dirs = [];
  for (const f of statusFolders(dir)) {
    let entries;
    try { entries = fs.readdirSync(f.dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const dirAbs = path.join(f.dir, e.name);
      if (e.isDirectory() && isTaskFolder(dirAbs)) dirs.push(dirAbs);
    }
  }
  const tasks = dirs.map(d => migrateTask(readTaskDir(d)));

  // sort by id descending (newest first)
  tasks.sort(compareIdsDesc);
  return tasks;
}

// Determine whether a task directory contains any subtasks (task folders).
function hasSubtask(taskDir) {
  try {
    if (!taskDir) return false;
    if (!fs.existsSync(taskDir) || !fs.statSync(taskDir).isDirectory()) return false;
    return statusFolders(taskDir).some(f => {
      try {
        return fs.readdirSync(f.dir, { withFileTypes: true }).some(e => e.isDirectory() && isTaskFolder(path.join(f.dir, e.name)));
      } catch (e) {
        return false;
      }
    });
  } catch (e) {
    return false;
  }
}

function formatTaskId(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}`;
}

// A time (ms) as tm shows every time, the way a task id reads: "2026-10-25 09:38", local, to the
// minute (the web UI has the same in src/utils/task.js).
function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Task folders are named "<id>" or "<id> <title>": the id is the first
// space-separated token of the folder name.
function folderId(name) {
  return name.split(' ')[0];
}

// The title part of a task folder name ("" for a bare id).
function folderTitle(name) {
  const i = name.indexOf(' ');
  return i < 0 ? '' : name.slice(i + 1).trim();
}

// Turn a task title into the folder-name suffix: drop characters that are
// unsafe in folder names and cap the length.
function folderSuffix(title) {
  return (title || '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 80);
}

// Folder name for a task: "<id>" or "<id> <title>" when a title is given.
function taskFolderName(id, title) {
  const suffix = folderSuffix(title);
  return suffix ? `${id} ${suffix}` : id;
}

// Whether any folder in dir (or its status folders) already uses this id, bare
// or with a title suffix. Folders without a task file count too: the id must
// stay unique in the folder, whatever the status, so a task can always move.
function isTaskIdTaken(dir, id) {
  return statusFolders(dir).some(f => {
    try {
      return fs.readdirSync(f.dir, { withFileTypes: true }).some(e => e.isDirectory() && folderId(e.name) === id);
    } catch (e) {
      return false;
    }
  });
}

// Compare two task ids (digit strings), newest first.
// Ids are zero-padded timestamps, so string order equals time order.
function compareIdsDesc(a, b) {
  return String(b.id).localeCompare(String(a.id));
}

// Return the first free task id in dir starting from `now` (YYYYMMDDHHmm).
// If a task with that id already exists (bare or renamed "<id> title"), the
// minute is bumped by one until an unused id is found, so two tasks created in
// the same minute get distinct folders. Date arithmetic handles hour/day rollover.
function nextFreeTaskId(dir, now) {
  const d = new Date(now.getTime());
  let id = formatTaskId(d);
  while (isTaskIdTaken(dir, id)) {
    d.setMinutes(d.getMinutes() + 1);
    id = formatTaskId(d);
  }
  return id;
}

// The task title is the first non-empty line of its details.
function firstDetailLine(details) {
  return (details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || '';
}

// Create a (todo) task folder in dir and return the path of its task file.
// The folder is "<id>" or, when details start with a title line, "<id> <title>".
function createTask(dir, details = '') {
  const now = new Date();
  // task id is the creation time as YYYYMMDDHHmm (local time), bumped by a
  // minute per collision so a second task in the same minute never reuses
  // (or opens) the first one's folder.
  const id = nextFreeTaskId(dir, now);
  const taskDir = path.join(dir, taskFolderName(id, firstDetailLine(details)));
  fs.mkdirSync(taskDir);
  const taskPath = path.join(taskDir, TASK_FILE);
  fs.writeFileSync(taskPath, details, 'utf8');

  // return path to let caller open editor while screen is suspended
  return taskPath;
}

function saveTask(task) {
  fs.writeFileSync(task.path, task.details || '', 'utf8');
}

// Remove a status folder once its last task has left it.
function removeIfEmptyStatusDir(dir) {
  if (!STATUS_DIRS.includes(path.basename(dir))) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch (e) { /* ignore */ }
}

// Set a task's status by moving its folder: into its list's "done", "pending" or "aborted"
// folder, or back into the list itself for todo. Updates task.path and task.status.
// Rename a task folder. On Windows a folder something has open (a file in it open in a program, an
// Explorer window or a terminal in it, a Claude run working in it) cannot be renamed: say so plainly.
// Between two disks (a task moved to a space on another one) a rename cannot be done: the folder is
// copied, then removed.
function renameFolder(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
      fs.rmSync(from, { recursive: true, force: true });
      return;
    }
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
    throw new Error(`The folder is in use, close what has it open (a file in it, an Explorer window, a terminal, a Claude run) and try again: ${from}`);
  }
}

function markTask(task, status) {
  if (!task) return;
  const taskDir = path.dirname(task.path);
  const from = path.dirname(taskDir);
  const listDir = listDirOf(taskDir);
  const to = status === 'todo' ? listDir : path.join(listDir, status);
  if (to === from) return;
  const dest = path.join(to, path.basename(taskDir));
  if (fs.existsSync(dest)) throw new Error(`Already exists: ${dest}`);
  fs.mkdirSync(to, { recursive: true });
  renameFolder(taskDir, dest);
  removeIfEmptyStatusDir(from);
  task.status = status;
  task.path = path.join(dest, path.basename(task.path));
}

// Move a task into the list of `dir` (another task's folder, making it a subtask, or a folder of
// tasks, possibly of another space), keeping its status: right in dir for todo, else in dir's status
// folder. Its subtasks go along in its folder. Ids are unique in a folder only, so a dir that has a
// task of the same id already does not take it. Updates task.path.
function moveTask(task, dir) {
  const taskDir = path.dirname(task.path);
  const rel = path.relative(taskDir, dir);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('A task cannot go into itself or its own subtask.');
  const from = path.dirname(taskDir);
  const to = task.status === 'todo' ? dir : path.join(dir, task.status);
  if (to === from) return;
  const id = folderId(path.basename(taskDir));
  if (listDirOf(taskDir) !== dir && isTaskIdTaken(dir, id)) throw new Error(`A task with id ${id} is there already: ${dir}`);
  const dest = path.join(to, path.basename(taskDir));
  if (fs.existsSync(dest)) throw new Error(`Already exists: ${dest}`);
  fs.mkdirSync(to, { recursive: true });
  renameFolder(taskDir, dest);
  removeIfEmptyStatusDir(from);
  task.path = path.join(dest, path.basename(task.path));
}

// Rewrite a task file as it was typed into its well-formed shape: just the
// details, so a pasted front matter block goes away.
function normalizeTaskFile(taskPath) {
  try {
    const task = parseTask(fs.readFileSync(taskPath, 'utf8'));
    task.path = taskPath;
    saveTask(task);
  } catch (e) { /* ignore */ }
}

function deleteTask(task) {
  const taskDir = path.dirname(task.path);  // use actual path, folder may have suffix
  fs.rmSync(taskDir, { recursive: true, force: true });
  removeIfEmptyStatusDir(path.dirname(taskDir));
}

// After creating/editing a task, rename its folder to "<id> <first detail line>".
// Returns the new task path (or original if nothing to rename).
function renameTaskByFirstLine(taskPath) {
  try {
    const content = fs.readFileSync(taskPath, 'utf8');
    const parsed = parseTask(content);
    const firstLine = firstDetailLine(parsed.details);
    if (!firstLine) return taskPath;
    const taskDir = path.dirname(taskPath);
    const parentDir = path.dirname(taskDir);
    const oldName = path.basename(taskDir);
    // keep the id, replace any existing title suffix
    const newName = taskFolderName(folderId(oldName), firstLine);
    if (oldName === newName) return taskPath;
    const newDir = path.join(parentDir, newName);
    renameFolder(taskDir, newDir);
    return path.join(newDir, path.basename(taskPath));
  } catch (e) {
    return taskPath;
  }
}

function openTask(task) {
  if (!task) return;
  openFolder(path.dirname(task.path));
}

// Open a folder with the OS file manager.
function openFolder(dir) {
  if (process.platform === 'win32') {
    const winPath = dir.replace(/\//g, '\\');
    spawnSync('explorer', [winPath], { stdio: 'ignore' });
  } else {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawnSync(opener, [dir], { stdio: 'ignore' });
  }
}

module.exports = {
  formatDateTime,
  TASK_FILE,
  PROMPT_FILE,
  STATUS_DIRS,
  SYNC_MAX_FILE_BYTES,
  SYNC_MAX_FOLDER_BYTES,
  SYNC_MAX_FOLDER_FILES,
  SYNC_SKIPPED_FILES,
  TASK_FOLDER_RE,
  readPrompt,
  listDirOf,
  isTaskFolder,
  taskEntries,
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
  parseTask,
  folderId,
  readTasks,
  hasSubtask,
  compareIdsDesc
};
