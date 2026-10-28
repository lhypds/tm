// Fired on window when the server answers that there is no session any more (it restarted, or
// the cookie expired). The auth store listens and takes the app back to the login page.
export const UNAUTHORIZED_EVENT = "taskmgr:unauthorized";

async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.code === "LOGIN_REQUIRED") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body.code || "";
    throw err;
  }
  return body;
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const q = (params) => new URLSearchParams(params).toString();

// A space is one folder of tasks: { work, repository } with repository "" for the work's common tasks.
const sp = (space) => ({ work: space.work, repository: space.repository || "" });

// Resolves to { username }; rejects with status 401 on a wrong username or password.
export const login = (username, password) => request("/api/login", json("POST", { username, password }));

// Resolves to { username } for the current session; null when nobody is logged in.
export async function getSession() {
  const res = await fetch("/api/session", { cache: "no-store" });
  if (res.status === 401) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const logout = () => request("/api/session", { method: "DELETE" });

// { configPath, editor, syncServer }: the path of taskmgr.json, the default text editor, and the
// host ("tm.example.com", no scheme) of the server this machine syncs with, "" when there is none.
export const getSettings = () => request("/api/settings");

// Whether taskmgrd polls the sync server and how its last pull went: { on, at, ok, error, fresh },
// `at` (ms) null when there has been none, `fresh` whether it is recent enough for the daemon to be
// taken as running.
export const getPolling = () => request("/api/polling");

export const listSpaces = () => request("/api/spaces");

// Open the folder a tree row shows (a work's tasks folder, or a repository's source folder) in the OS file manager.
export const openSpaceFolder = (space) => request("/api/space/open", json("POST", sp(space)));

// The path of a folder dropped on the page, found by the server from its name and the names of
// what is in it: { path }.
export const locateFolder = ({ name, entries }) => request("/api/folder/locate", json("POST", { name, entries }));

// Make a space's missing tasks folder; resolves to { works, origins }.
export const createSpaceFolder = (space) => request("/api/space/create", json("POST", sp(space)));

// The works and origins: { works, origins }, origins being the named ones ({ origin, income }),
// some possibly without works yet. Every change to taskmgr.json below resolves to the new ones.

// The raw taskmgr.json: { configPath, text }.
export const getConfig = () => request("/api/config");

export const saveConfig = (text) => request("/api/config", json("PUT", { text }));

// Add an origin, with no works yet.
export const addOrigin = ({ name, income }) => request("/api/origin", json("POST", { name, income }));

// Add a repository to a work; its tasks folder is created when missing.
export const addRepository = ({ work, name, tasksPath, sourcePath }) => request("/api/repository", json("POST", { work, name, tasksPath, sourcePath }));

// Add a work to an origin.
export const addWork = ({ name, origin, tasksPath, income }) => request("/api/work", json("POST", { name, origin, tasksPath, income }));

// Set one work's name, income ({ monthly, once }, lists of { amount, currency }; null clears it),
// tasks folder and whether it is hidden.
export const saveWork = (work, { name, income, hidden, tasksPath }) => request("/api/work", json("PUT", { work, name, income, hidden, tasksPath }));

// Set one origin's name and income, as saveWork does for a work.
export const saveOrigin = (origin, { name, income }) => request("/api/origin", json("PUT", { origin, name, income }));

// Set one repository's name, source folder and tasks folder (either may be "", not both).
export const saveRepository = (work, name, { newName, sourcePath, tasksPath }) =>
  request("/api/repository", json("PUT", { work, name, newName, sourcePath, tasksPath }));

// Reorder taskmgr.json, which is the tree's order: put an origin before the named origin `before`,
// a work before the work `before` of its origin, a repository before the repository `before` of its
// work; `before` null puts it last in its list. An entry cannot move to another list.
export const moveOrigin = (origin, before) => request("/api/origin/move", json("POST", { origin, before }));
export const moveWork = (work, before) => request("/api/work/move", json("POST", { work, before }));
export const moveRepository = (work, name, before) => request("/api/repository/move", json("POST", { work, name, before }));

// Remove one origin (with its works), work or repository of a work from taskmgr.json; the folders are kept.
export const deleteOrigin = (origin) => request(`/api/origin?${q({ origin })}`, { method: "DELETE" });
export const deleteWork = (work) => request(`/api/work?${q({ work })}`, { method: "DELETE" });
export const deleteRepository = (work, name) => request(`/api/repository?${q({ work, name })}`, { method: "DELETE" });

export const listTasks = (space, dir = "") => request(`/api/tasks?${q({ ...sp(space), dir })}`);

// The tasks of every work ({ all: "1" }), a whole origin ({ origin }) or work ({ work }: its own and
// its repositories'), each with the work and repository it lives in.
export const listAllTasks = (scope) => request(`/api/tasks/all?${q(scope)}`);

// fields: { status, details }
export const createTask = (space, dir, fields) => request("/api/tasks", json("POST", { ...sp(space), dir, ...fields }));

// One task with its attachments, its prompt and the records of its runs of Claude Code: { task, files,
// prompt, runs }, prompt being the prompt.txt text, or null when the task has none, and runs the
// records newest first, each a run without its transcript plus `folder` (see getSavedRun).
export const getTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`);

// Write the task's prompt.txt as typed, a blank text too. Resolves to { prompt, files } as
// they are after the write (prompt null when there is no file).
export const saveTaskPrompt = (space, rel, text) => request("/api/task/prompt", json("PUT", { ...sp(space), rel, text }));

export const updateTask = (space, rel, fields) => request("/api/task", json("PUT", { ...sp(space), rel, ...fields }));

// The raw task file, as the terminal's editor sees it.
export const getTaskText = (space, rel) => request(`/api/task/text?${q({ ...sp(space), rel })}`);

export const saveTaskText = (space, rel, text) => request("/api/task/text", json("PUT", { ...sp(space), rel, text }));

export const createTaskText = (space, dir, text) => request("/api/tasks/text", json("POST", { ...sp(space), dir, text }));

export const setStatus = (space, rel, status) => request("/api/task/status", json("POST", { ...sp(space), rel, status }));

export const openInFileManager = (space, rel) => request("/api/task/open", json("POST", { ...sp(space), rel }));

export const deleteTask = (space, rel) => request(`/api/task?${q({ ...sp(space), rel })}`, { method: "DELETE" });

// Upload one File into a task folder; resolves to the task's files after the upload.
export const uploadFile = (space, rel, file) =>
  request(`/api/task/file?${q({ ...sp(space), rel, name: file.name })}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });

export const deleteFile = (space, rel) => request(`/api/file?${q({ ...sp(space), rel })}`, { method: "DELETE" });

// Write a text attachment as typed (the preview's editor); resolves to the task's files after the write.
export const saveFile = (space, rel, text) => request("/api/file", json("PUT", { ...sp(space), rel, text }));

export const fileUrl = (space, rel, download = false) =>
  `/api/file?${q({ ...sp(space), rel, ...(download ? { download: "1" } : {}) })}`;

// Route to the tasks of every origin: the root, which is also what the title links to.
export const allPath = "/";

// Route to all the tasks of an origin.
export const originPath = (origin) => `/o/${encodeURIComponent(origin)}`;

// Route to a space's task list. Origin-less works keep the legacy /w path.
export const spacePath = (origin, work, repository) =>
  (origin ? `${originPath(origin)}/${encodeURIComponent(work)}` : `/w/${encodeURIComponent(work)}`) +
  (repository ? `/${encodeURIComponent(repository)}` : "");

// The runs of Claude Code on tasks (server/ai.js): starting one, answering what Claude asks, stopping
// one. The runs themselves arrive live on the event stream (see hooks/useRuns).

// The event stream of every run: GET /api/ai/events.
export const runEventsUrl = "/api/ai/events";

// Start Claude Code on the task at `rel` in the space; resolves to { run } with its transcript (409
// while the task has a run going). `after` is what Claude is told to do with its changes once the
// work is done: "push" (commit and push), "pr" (a new branch, a commit and a pull request) or null.
export const startRun = (space, rel, after = null) => request("/api/ai/run", json("POST", { ...sp(space), rel, ...(after ? { after } : {}) }));

// Answer the run's pending question `pending`: { decision: "allow" | "deny" } for a permission,
// { answers: { "<question>": "<answer>" } } for a question. { run }.
export const answerRun = (id, pending, body) => request(`/api/ai/runs/${encodeURIComponent(id)}/answer`, json("POST", { pending, ...body }));

export const stopRun = (id) => request(`/api/ai/runs/${encodeURIComponent(id)}/stop`, json("POST", {}));

// A run's record, kept in the task folder once the run was over (its folder is named in the task's
// `runs`, see getTask): the run with its transcript. { run }.
export const getSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`);

// Remove that record (for a copy pushed from another machine, there too). { ok: true }.
export const deleteSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`, { method: "DELETE" });
