import { getHere } from "./here";

// Fired on window when the server answers that there is no session any more (it restarted, or
// the cookie expired). The auth store listens and takes the app back to the login page.
export const UNAUTHORIZED_EVENT = "taskmgr:unauthorized";

export async function request(url, options) {
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

export const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const q = (params) => new URLSearchParams(params).toString();

// A space is one folder of tasks: { work, repository } with repository "" for the work's common tasks.
export const sp = (space) => ({ work: space.work, repository: space.repository || "" });

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

// The machine this browser is on, for the requests that open something in front of the user: { here },
// nothing when it is not known (see ./here).
const here = () => {
  const name = getHere();
  return name ? { here: name } : {};
};

// Open the folder a tree row shows (a work's tasks folder, or a repository's source folder) in the OS
// file manager: the server's, or, for a folder synced by the machine this browser is on, that one's.
export const openSpaceFolder = (space) => request("/api/space/open", json("POST", { ...sp(space), ...here() }));

// The path of a folder dropped on the page, found by the server from its name and the names of
// what is in it: { path }.
export const locateFolder = ({ name, entries }) => request("/api/folder/locate", json("POST", { name, entries }));

// Make a space's missing tasks folder; resolves to { works, origins }.
export const createSpaceFolder = (space) => request("/api/space/create", json("POST", sp(space)));

// The works and origins: { works, origins }, origins being the named ones ({ origin, description, income, color }),
// some possibly without works yet. Every change to taskmgr.json below resolves to the new ones.

// The raw taskmgr.json: { configPath, text }.
export const getConfig = () => request("/api/config");

export const saveConfig = (text) => request("/api/config", json("PUT", { text }));

// Add an origin, with no works yet.
export const addOrigin = ({ name, income, color, description }) => request("/api/origin", json("POST", { name, income, color, description }));

// Add a repository to a work; its tasks folder is created when missing.
export const addRepository = ({ work, name, tasksPath, sourcePath, description }) =>
  request("/api/repository", json("POST", { work, name, tasksPath, sourcePath, description }));

// Add a work to an origin.
export const addWork = ({ name, origin, tasksPath, income, description }) => request("/api/work", json("POST", { name, origin, tasksPath, income, description }));

// Set the list bar filters ({ month, showDone, showPending, showAbort }) of one space, by its path,
// in taskmgr.json; null resets them.
export const saveFilter = (space, filter) => request("/api/filters", json("PUT", { space, filter }));

// Set one work's name, income ({ monthly, once }, lists of { amount, currency }; null clears it),
// tasks folder, whether it is hidden and its description (the tooltip of its row in the tree; "" for none).
export const saveWork = (work, { name, income, hidden, tasksPath, description }) =>
  request("/api/work", json("PUT", { work, name, income, hidden, tasksPath, description }));

// Set one origin's name, income, color ("" for none) and description, as saveWork does for a work.
export const saveOrigin = (origin, { name, income, color, description }) =>
  request("/api/origin", json("PUT", { origin, name, income, color, description }));

// Set one repository's name, source folder and tasks folder (either may be "", not both) and description.
export const saveRepository = (work, name, { newName, sourcePath, tasksPath, description }) =>
  request("/api/repository", json("PUT", { work, name, newName, sourcePath, tasksPath, description }));

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

// Remove the task's prompt.txt (a prompt emptied). Resolves to { prompt, files } as saveTaskPrompt does.
export const deleteTaskPrompt = (space, rel) => request(`/api/task/prompt?${q({ ...sp(space), rel })}`, { method: "DELETE" });

export const updateTask = (space, rel, fields) => request("/api/task", json("PUT", { ...sp(space), rel, ...fields }));

// The raw task file, as the terminal's editor sees it.
export const getTaskText = (space, rel) => request(`/api/task/text?${q({ ...sp(space), rel })}`);

export const saveTaskText = (space, rel, text) => request("/api/task/text", json("PUT", { ...sp(space), rel, text }));

export const createTaskText = (space, dir, text) => request("/api/tasks/text", json("POST", { ...sp(space), dir, text }));

export const setStatus = (space, rel, status) => request("/api/task/status", json("POST", { ...sp(space), rel, status }));

// Move a task into `into`, another task's rel (as its subtask) or a folder of tasks ("" the root),
// in its own space or, with `to`, in that space.
export const moveTask = (space, rel, into, to) =>
  request("/api/task/move", json("POST", { ...sp(space), rel, into, ...(to ? { to: sp(to) } : {}) }));

// Open the task's folder in the OS file manager, as openSpaceFolder does a space's.
export const openInFileManager = (space, rel) => request("/api/task/open", json("POST", { ...sp(space), rel, ...here() }));

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

// The scheduler, one page a day (`date` is "YYYY-MM-DD"): { date, text, tasks }, text being the
// page, its tasks among its lines (see server/scheduler.js), and tasks those, in their order, each
// { work, repository, ids, title, details, rel, status, missing } as it is now (`missing` when the task is
// gone; `ids` is its id after those of the tasks it is under).
// With `carry` (the day is today), a day opened for the first time starts with the tasks left
// undone on the last day before it.
export const getSchedulerDay = (date, carry = false) => request(`/api/scheduler?${q({ date, ...(carry ? { carry: "1" } : {}) })}`);

// Write the page: its text. Resolves to the day after it.
export const saveSchedulerPage = (date, text) => request("/api/scheduler", json("PUT", { date, text }));

// The same for the days from `date` to `until` (both "YYYY-MM-DD", here), a month of the calendar view.
export const getCalendarDays = (date, until, fresh = false) => {
  const [y, m, d] = date.split("-").map(Number);
  const [y2, m2, d2] = until.split("-").map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y2, m2 - 1, d2 + 1).getTime();
  return request(`/api/calendar?${q({ date, until, from, to, ...(fresh ? { fresh: "1" } : {}) })}`);
};

// The calendars under the scheduler's page as taskmgr.json lists them: { calendars }, each
// { name, type, url, color } (`type` "google", "apple" or "", `url` the address of its ICS feed,
// `color` that of its events, "#rrggbb" or "").
export const getCalendars = () => request("/api/calendars");

// Replace that list. Resolves to it as it is kept.
export const saveCalendars = (calendars) => request("/api/calendars", json("PUT", { calendars }));

// A new event named `title` on the day `date` ("YYYY-MM-DD") in Apple's Calendar, on the machine this
// browser is on when that is one of the server's machines, else on the server's (a Mac either way),
// which comes to the front with it open, for its time to be chosen (see utils/calendar.js).
export const newCalendarEvent = (date, title) => request("/api/calendar/new-event", json("POST", { date, title, ...here() }));

// The events of the day `date` ("YYYY-MM-DD", here: its bounds are sent with it) in the Google and
// Apple calendars the server is given (see server/calendar.js): { configured, events, errors },
// each event { id, title, location, allDay, start, end, source, calendar, color } and its details
// (description, url, conference, organizer, attendees, attachments, status, busy, repeats, created,
// updated: see detailsOf in server/calendar.js), with start and end in
// ms (the days, "YYYY-MM-DD", the last one not included, of an `allDay` one). `fresh` reads the
// calendars anew, not the copy the server keeps for a few minutes.
export const getCalendarDay = (date, fresh = false) => {
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const to = new Date(y, m - 1, d + 1).getTime();
  return request(`/api/calendar?${q({ date, from, to, ...(fresh ? { fresh: "1" } : {}) })}`);
};

// Route to the tasks of every origin: the root, which is also what the title links to.
export const allPath = "/";

// Route to all the tasks of an origin.
export const originPath = (origin) => `/o/${encodeURIComponent(origin)}`;

// Route to a space's task list. Origin-less works keep the legacy /w path.
export const spacePath = (origin, work, repository) =>
  (origin ? `${originPath(origin)}/${encodeURIComponent(work)}` : `/w/${encodeURIComponent(work)}`) +
  (repository ? `/${encodeURIComponent(repository)}` : "");

