// The task's title is the first non-empty line of its details; the body is everything after it.
export function splitDetails(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  if (i === -1) return { title: "", body: "" };
  const body = lines.slice(i + 1);
  while (body.length && body[0].trim() === "") body.shift();
  while (body.length && body.at(-1).trim() === "") body.pop();
  return { title: lines[i].trim(), body: body.join("\n") };
}

// The description is the line right after the title; a blank line there means there is none, and
// whatever follows is only notes.
export function describe(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  const i = lines.findIndex((l) => l.trim() !== "");
  return i === -1 ? "" : (lines[i + 1] || "").trim();
}

// A folder of tasks is a tree: each task has its `subtasks`. The list shows it as rows, depth
// first, each under its parent; a row gets its `depth`, `last` (the last of its siblings) and
// `through`, which ancestor levels have rows below it, so their tree lines run on past it (see
// TreeLines). The tasks at the top have no lines, so their subtasks' lines start at level 0.
export function flattenTasks(tasks, depth = 0, through = []) {
  return tasks.flatMap((t, i) => {
    const last = i === tasks.length - 1;
    const below = depth === 0 ? [] : [...through, !last];
    return [{ ...t, depth, through, last }, ...flattenTasks(t.subtasks || [], depth + 1, below)];
  });
}

// The tasks that pass `keep`, each with its subtasks that do. A task that does not pass stays
// when a subtask under it does, so a filter never hides a task that matches it.
export function filterTasks(tasks, keep) {
  return tasks.flatMap((t) => {
    const subtasks = filterTasks(t.subtasks || [], keep);
    return keep(t) || subtasks.length ? [{ ...t, subtasks }] : [];
  });
}

export function joinDetails(title, body) {
  const t = (title || "").trim();
  const b = (body || "").replace(/\r\n/g, "\n").trim();
  return b ? `${t}\n${b}` : t;
}

// A time (ms) as a task id reads: "2026-10-25 10:20", local, to the minute.
export function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "202508142100" -> "2025-08-14 21:00"; anything else is shown as-is.
export function formatStamp(s) {
  const m = /^(\d{4})(\d{2})(\d{2})[_]?(\d{2})(\d{2})/.exec(s || "");
  if (!m) return s || "";
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

// The month a task was created in ("2026-10"), from its id; "" for an id that is not a date.
export const ALL_MONTHS = "all";
export const taskMonth = (task) => (/^\d{6}/.test(task.id) ? `${task.id.slice(0, 4)}-${task.id.slice(4, 6)}` : "");

// The periods of the time filter besides the months: last week and this week (Monday to Sunday),
// as of today.
export const LAST_WEEK = "last-week";
export const THIS_WEEK = "this-week";
const PERIODS = [LAST_WEEK, THIS_WEEK];

const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// The time filter's entries: all, the periods, then the months, newest first: this month always
// (it stands for "this month", tasks or not), and every month the tasks were created in.
export function taskMonths(tasks, now = new Date()) {
  const keys = [...new Set([monthKeyOf(now), ...tasks.map(taskMonth).filter(Boolean)])].sort((a, b) => (a > b ? -1 : 1));
  return [{ key: ALL_MONTHS }, ...PERIODS.map((key) => ({ key })), ...keys.map((key) => ({ key }))];
}

// The day a task was created, from its id ("202610251200": 2026-10-25), local; null for an id that
// is not a date.
function taskDay(task) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(task.id || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// The Monday that starts the week `d` is in, at 0:00.
function weekStart(d) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Whether the task was created in the period `key` names (an entry of taskMonths), as of `now`.
// A task whose id is not a date is in none but "all".
export function inPeriod(task, key, now = new Date()) {
  if (key === ALL_MONTHS) return true;
  if (key === THIS_WEEK || key === LAST_WEEK) {
    const day = taskDay(task);
    if (!day) return false;
    const start = weekStart(now);
    const from = key === THIS_WEEK ? start : plusDays(start, -7);
    return day >= from && day < plusDays(from, 7);
  }
  return taskMonth(task) === key;
}

// An entry's name: "all tasks", a period, or the month as it is ("2026-10", as every time reads).
const PERIOD_TEXT = { [ALL_MONTHS]: "month.all", [LAST_WEEK]: "month.lastWeek", [THIS_WEEK]: "month.thisWeek" };
export const monthLabel = (key, t) => (PERIOD_TEXT[key] ? t(PERIOD_TEXT[key]) : key);

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// A length of time in ms as "12s" or "1m 5s" (how long a run of Claude Code took).
export function duration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const STATUS_LABEL = { todo: "todo", done: "done", pending: "pending", aborted: "aborted" };

// What the preview modal can show in the page: a PDF, an image or a text file.
const TEXT_EXT = /\.(txt|md|markdown|log|csv|tsv|json|ya?ml|xml|ini|conf|cfg|toml|sql|sh|bat|ps1|js|jsx|ts|tsx|py|rb|go|java|c|h|cpp|cs|rs|php|css|html?)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function previewKind(name) {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (IMAGE_EXT.test(name)) return "image";
  if (TEXT_EXT.test(name)) return "text";
  return null;
}
