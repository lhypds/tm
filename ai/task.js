// Where a task is and what Claude Code is told about it, shared by `tm run` (ai/run.js, in the
// terminal) and the web UI's run button (ai/session.js):
// - the folders of tasks named in taskmgr.json, each a *space* (a work's common tasks, or a
//   repository's), found by name on the command line (resolveSpace) or by work and repository as the
//   task APIs take them (spaceOf);
// - the task folder in one, by id (findTaskDir) or by its path relative to the space (taskDirIn);
// - the first prompt (buildPrompt): the task's task.txt, its prompt.txt when it has one, and the list
//   of its other files, with the task folder's path, then what to do with the changes once the work
//   is done (`after`, the web UI's checkboxes under the prompt: commit and push, or a branch and a
//   pull request; see AFTER); and the folder Claude works in (cwdOf): the repository's source folder
//   for a repository's task, so Claude works on the code, else the task folder. describeRun puts
//   those together for one task.
// Nothing here prints or exits: a problem is thrown as an Error with the message to show.
const fs = require('fs');
const path = require('path');

const {
  TASK_FILE,
  PROMPT_FILE,
  STATUS_DIRS,
  isTaskFolder,
  isSyncSkipped,
  readTaskDir,
  readTasks,
  readPrompt,
  folderId
} = require('../utils/taskUtils');
const { resolveConfig } = require('../server/config');

// Quote a path or name for a command shown to the user.
function q(s) {
  return /[\s"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function samePath(a, b) {
  const real = (p) => { try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); } };
  return real(a) === real(b);
}

// The spaces of a works list (as config.getWorks() answers it), as { work, repository, label, root,
// sourcePath }: a work's common tasks (repository "", root "" when it has no tasks_path) and each
// repository's.
function spacesOf(works) {
  const spaces = [];
  for (const w of works) {
    spaces.push({ work: w.work, repository: '', label: w.work, root: w.root, sourcePath: '' });
    for (const p of w.repositories) {
      spaces.push({ work: w.work, repository: p.name, label: `${w.work}/${p.name}`, root: p.root, sourcePath: p.sourcePath });
    }
  }
  return spaces;
}

// Every folder of tasks named in taskmgr.json, read now; { spaces: [], error } when the config
// cannot be read.
function configuredSpaces() {
  try {
    return { spaces: spacesOf(resolveConfig().getWorks()), error: null };
  } catch (e) {
    return { spaces: [], error: e.message };
  }
}

// How a space is named on the command line: "work/" for the common tasks of a work (never mistaken
// for a repository), "work/repository" for a repository's.
function spaceArg(s) {
  return s.repository ? `${s.work}/${s.repository}` : `${s.work}/`;
}

// The space the first argument of `tm run` names: a work, a repository, "work/repository" or "work/"
// of taskmgr.json (names first, exactly, then ignoring case), else a folder of tasks that exists (a
// folder named like a work: prefix it, ./work). A folder that is a configured tasks folder is that
// space, so a repository's tasks run in its source folder however the folder is named.
function resolveSpace(arg) {
  const { spaces, error } = configuredSpaces();
  const asDir = path.resolve(arg);

  const slash = arg.indexOf('/');
  const byName = (same) => {
    if (slash >= 0) {
      const work = arg.slice(0, slash).trim();
      const repository = arg.slice(slash + 1).trim();
      return spaces.filter(s => same(s.work, work) && same(s.repository, repository));
    }
    return spaces.filter(s => (same(s.work, arg) && !s.repository) || (s.repository && same(s.repository, arg)));
  };
  let matches = byName((a, b) => a === b);
  if (matches.length === 0) matches = byName((a, b) => a.toLowerCase() === b.toLowerCase());

  if (matches.length > 1) {
    throw new Error(`"${arg}" names ${matches.length} folders of tasks; say which:\n` + matches.map(s => `  tm run ${q(spaceArg(s) + ':<id>')}`).join('\n'));
  }
  if (matches.length === 1) {
    const s = matches[0];
    if (!s.root) {
      const repos = spaces.filter(x => x.work === s.work && x.repository);
      throw new Error(`Work "${s.work}" has no tasks folder of its own (no tasks_path in taskmgr.json).`
        + (repos.length ? ` Its repositories:\n` + repos.map(x => `  tm run ${q(spaceArg(x) + ':<id>')}`).join('\n') : ''));
    }
    return s;
  }

  if (isDirectory(asDir)) {
    return spaces.find(s => s.root && samePath(s.root, asDir))
      || { work: '', repository: '', label: asDir, root: asDir, sourcePath: '' };
  }
  if (error) throw new Error(`${error}\nGive a folder of tasks instead (tm run <folder>:<id>), or fix taskmgr.json with \`tm config\`.`);
  throw new Error(`No work or repository named "${arg}" in taskmgr.json, and no such folder. Works and repositories:\n`
    + spaces.filter(s => s.root).map(s => `  ${s.label}`).join('\n'));
}

// The space of a work and a repository ("" for the work's common tasks), as the web UI's task APIs
// name one, among the works given; null when there is none.
function spaceOf(works, work, repository) {
  return spacesOf(works).find(s => s.work === work && s.repository === (repository || '')) || null;
}

// Every task folder listed in dir, with the subtasks inside each, depth first (status folders included).
function* taskDirsUnder(dir) {
  for (const t of readTasks(dir)) {
    const taskDir = path.dirname(t.path);
    yield taskDir;
    yield* taskDirsUnder(taskDir);
  }
}

// The folder of the task `arg` names in the space: the task (or subtask) with that id or exactly that
// folder name, else a path to a task folder.
function findTaskDir(space, arg) {
  if (!isDirectory(space.root)) throw new Error(`Folder not found: ${space.root}`);
  const found = [];
  for (const d of taskDirsUnder(space.root)) {
    const name = path.basename(d);
    if (folderId(name) === arg || name === arg) found.push(d);
  }
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    const spaceName = space.work ? spaceArg(space) : space.root;
    throw new Error(`${found.length} tasks in ${space.label} have the id ${arg}; give the folder instead:\n`
      + found.map(d => `  tm run ${q(spaceName)} ${q(d)}`).join('\n'));
  }
  const asDir = path.resolve(arg);
  if (isTaskFolder(asDir)) return asDir;
  throw new Error(`No task ${arg} in ${space.label} (${space.root}).`);
}

// The task folder at `rel` (relative to the space's folder, as the task APIs take it) in the space;
// an Error, with a status for the API, when it is outside the space or is no task.
function taskDirIn(space, rel) {
  if (!isDirectory(space.root)) throw httpError(404, `Folder not found: ${space.root}`);
  if (!rel) throw httpError(400, 'Missing task path.');
  const abs = path.resolve(space.root, rel);
  const relToRoot = path.relative(space.root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) throw httpError(400, 'Path is outside the tasks root.');
  if (!isTaskFolder(abs)) throw httpError(404, 'Task not found.');
  return abs;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// The task's other files, as the web UI lists them: not task.txt, prompt.txt, dot files, lock or cache
// files (isSyncSkipped) or the status folders (which hold subtasks); a folder that is a task is a
// subtask. Folders first, then by name.
function listFiles(taskDir) {
  let entries;
  try { entries = fs.readdirSync(taskDir, { withFileTypes: true }); } catch (e) { return []; }
  const files = [];
  for (const e of entries) {
    if (e.name === TASK_FILE || e.name === PROMPT_FILE || e.name.startsWith('.') || isSyncSkipped(e.name)) continue;
    if (e.isDirectory() && STATUS_DIRS.includes(e.name)) continue;
    const abs = path.join(taskDir, e.name);
    let size = 0;
    try { size = fs.statSync(abs).size; } catch (err) { /* ignore */ }
    files.push({ name: e.name, isDir: e.isDirectory(), isSubtask: e.isDirectory() && isTaskFolder(abs), size });
  }
  files.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
  return files;
}

// A text without its leading and trailing blank lines.
function trimBlank(text) {
  return (text || '').replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
}

// What Claude is told to do with its changes once the work is done, by name: "push" commits them and
// pushes, "pr" puts them on a new branch and opens a pull request. Nothing else is said otherwise.
const AFTER = {
  push: [
    'When the work is done, commit every change you made with a clear commit message and push the',
    'commit to the remote of the current branch.'
  ].join('\n'),
  pr: [
    'When the work is done, create a new branch for this task from the current one, commit every change',
    'you made on it with a clear commit message, push the branch and open a pull request for it against',
    'the branch you started from (`gh pr create`), with the task as its description. Do not merge it.'
  ].join('\n')
};

// `after` as given (by the API, say) when it names a step of AFTER, else null (nothing after).
function afterOf(after) {
  return typeof after === 'string' && Object.prototype.hasOwnProperty.call(AFTER, after) ? after : null;
}

// The first prompt for claude: what to do, the task text, the prompt text, where the files are, and
// what to do with the changes after (`after`: a key of AFTER, or null). A blank prompt.txt (the web UI
// makes one as the prompt is opened) counts as none: the task text is what to do.
function buildPrompt(space, task, prompt, taskDir, cwd, after = null) {
  if (prompt !== null && !trimBlank(prompt)) prompt = null;
  const where = space.repository
    ? `repository "${space.repository}" of work "${space.work}"`
    : space.work ? `work "${space.work}"` : `folder ${space.root}`;
  const files = listFiles(taskDir);
  const out = [];
  out.push(`Task ${task.id} from tm, the task manager (${where}).`);
  out.push(prompt !== null
    ? 'Do what its prompt says; the task text is the context.'
    : 'Do what the task says.');
  out.push('');
  out.push('## Task (task.txt)');
  out.push(trimBlank(task.details) || '(empty)');
  if (prompt !== null) {
    out.push('');
    out.push('## Prompt (prompt.txt)');
    out.push(trimBlank(prompt) || '(empty)');
  }
  out.push('');
  out.push('## Task folder');
  out.push(taskDir);
  if (files.length) {
    out.push('Its other files (read the ones you need):');
    for (const f of files) {
      const note = f.isSubtask ? 'subtask' : f.isDir ? 'folder' : formatSize(f.size);
      out.push(`- ${f.name}${f.isDir ? '/' : ''} (${note})`);
    }
  } else {
    out.push('It has no other files.');
  }
  if (!samePath(cwd, taskDir)) {
    out.push('');
    out.push(`Working folder: ${cwd}, the source code of the repository.`);
  }
  if (AFTER[after]) {
    out.push('');
    out.push('## After');
    out.push(AFTER[after]);
  }
  return out.join('\n') + '\n';
}

// The folder Claude works in for a task of the space: the repository's source folder (which must
// exist), else the task folder.
function cwdOf(space, taskDir) {
  if (!space.sourcePath) return taskDir;
  if (!isDirectory(space.sourcePath)) throw new Error(`Source folder of ${space.label} not found: ${space.sourcePath}`);
  return space.sourcePath;
}

// The title of a task: the first line of its text, else its folder name.
function titleOf(task, taskDir) {
  return (task.details || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0] || path.basename(taskDir);
}

// Everything a run of Claude Code on the task in taskDir starts from: { task, title, prompt, cwd,
// after, text }, `prompt` the prompt.txt text (null without one), `after` the step asked for once the
// work is done (a key of AFTER, or null) and `text` the first prompt for claude.
function describeRun(space, taskDir, after = null) {
  const task = readTaskDir(taskDir);
  const prompt = readPrompt(taskDir);
  const cwd = cwdOf(space, taskDir);
  after = afterOf(after);
  return { task, title: titleOf(task, taskDir), prompt, cwd, after, text: buildPrompt(space, task, prompt, taskDir, cwd, after) };
}

module.exports = {
  q,
  isDirectory,
  samePath,
  spacesOf,
  configuredSpaces,
  spaceArg,
  resolveSpace,
  spaceOf,
  taskDirsUnder,
  findTaskDir,
  taskDirIn,
  listFiles,
  AFTER,
  afterOf,
  buildPrompt,
  cwdOf,
  titleOf,
  describeRun
};
