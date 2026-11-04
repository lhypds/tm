// Configuration for the web UI.
//
// taskmgr.json (next to package.json by default) lists the origins (the organizations the works are
// for), their works and the works' repositories; each work and repository is a folder of tasks:
//
//   {
//     "origins": [
//       {
//         "origin": "gcc3",                       // "" or left out for works without an origin
//         "income": { "monthly": [...] },         // optional, what the origin pays besides its works
//         "works": [
//           {
//             "work": "gcc3.com",
//             "income": {                         // optional, what the work pays
//               "monthly": [{ "amount": 500000, "currency": "JPY", "from": "2026-01", "to": "2026-12" }],  // "from", "to" optional
//               "once": [{ "amount": 100000, "currency": "JPY" }]
//             },
//             "hidden": true,                     // optional, left out of the tree unless hidden works are shown
//             "tasks_path": "~/gcc3",             // optional, common tasks of this work
//             "repositories": [
//               {
//                 "repository": "repository a",
//                 "source_path": "~/gcc3/a",      // optional, its source code
//                 "tasks_path": "~/gcc3/a/tasks"  // tasks of one repository; optional with a
//               }                                 // source_path, defaulting to its "tasks" folder
//             ]
//           }
//         ]
//       }
//     ]
//   }
//
// The older form, a top-level "works" list whose works each have an optional "origin", is still
// read, and is rewritten as "origins" when the file is saved from the web UI; so is a repository's
// older "name", which becomes "repository".
//
// The config file is always <project>/taskmgr.json. It is re-read when it changes, so edits apply
// without a restart.
//
// The web UI's login accounts are in <project>/data/users.json (see server/auth.js); the same data/
// folder receives what taskmgrd pushes from another machine (see server/sync.js).
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, 'taskmgr.json');
const EXAMPLE_CONFIG_PATH = path.join(PROJECT_ROOT, 'taskmgr.json.example');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DEFAULT_USERS_PATH = path.join(DEFAULT_DATA_DIR, 'users.json');
// How taskmgrd's last pull went, written by the daemon after each one (see its poll) and read by
// the web UI server for the status bar (GET /api/polling): { at, ok, error, interval }.
const POLL_STATE_PATH = path.join(PROJECT_ROOT, '.tm-poll-state.json');

function loadDotenv() {
  let dotenv = null;
  try { dotenv = require('dotenv'); } catch (e) { return; }
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(PROJECT_ROOT, '.env')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
}

// "~" is the home folder; a Windows path ("C:/code", "C:\code") run from WSL is its /mnt/c/code,
// which path.resolve would otherwise take as relative and resolve inside the current folder.
function expandHome(p) {
  if (!p) return p;
  const drive = process.platform !== 'win32' && /^([A-Za-z]):[\\/]/.exec(p);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${p.slice(3).replace(/\\/g, '/')}`;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

const REWARD_PERIODS = ['monthly', 'once'];

// Validate the older single "reward" and return { amount, currency, period }, or null when there
// is none. Its text form "500,000 JPY / month" (no "/ month" means one-time) is still accepted.
function normalizeReward(r) {
  if (r === undefined || r === null || r === '') return null;
  if (typeof r === 'string') {
    const m = r.trim().match(/^([\d,.]+)\s*([A-Za-z]{3})\s*(\/\s*(month|mo|monthly))?$/i);
    if (!m) throw new Error(`"${r}" is not like "500,000 JPY / month".`);
    r = { amount: Number(m[1].replace(/,/g, '')), currency: m[2], period: m[3] ? 'monthly' : 'once' };
  }
  if (typeof r !== 'object' || Array.isArray(r)) throw new Error('must be an object { amount, currency, period }.');
  const amount = typeof r.amount === 'string' ? Number(r.amount.replace(/,/g, '')) : r.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new Error('"amount" must be a positive number.');
  const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('"currency" must be a 3-letter code such as JPY.');
  if (!REWARD_PERIODS.includes(r.period)) throw new Error(`"period" must be one of ${REWARD_PERIODS.join(', ')}.`);
  return { amount, currency, period: r.period };
}

// Validate one income item and return { amount, currency }, with "from" and "to" (the year and month
// a monthly item starts and the last month it pays, "2026-01") when it has them.
function normalizeIncomeItem(x, period) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('each item must be an object { amount, currency }.');
  const amount = typeof x.amount === 'string' ? Number(x.amount.replace(/,/g, '')) : x.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) throw new Error('"amount" must be a positive number.');
  const currency = typeof x.currency === 'string' ? x.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('"currency" must be a 3-letter code such as JPY.');
  const item = { amount, currency };
  for (const k of ['from', 'to']) {
    if (x[k] === undefined || x[k] === null || x[k] === '') continue;
    if (period !== 'monthly') throw new Error(`only a monthly item can have "${k}".`);
    if (typeof x[k] !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(x[k])) throw new Error(`"${k}" must be a year and month such as 2026-01.`);
    item[k] = x[k];
  }
  if (item.from && item.to && item.to < item.from) throw new Error('"to" must not be before "from".');
  return item;
}

// Validate an income { monthly: [...], once: [...] } and return it with both lists, or null when
// both are empty. An older single "reward" is read as a one-item income.
function normalizeIncome(income, reward) {
  if (income === undefined || income === null) {
    const r = normalizeReward(reward);
    if (!r) return null;
    income = { [r.period]: [{ amount: r.amount, currency: r.currency }] };
  }
  if (typeof income !== 'object' || Array.isArray(income)) throw new Error('must be an object { monthly, once }.');
  const value = {};
  for (const period of REWARD_PERIODS) {
    const items = income[period] === undefined ? [] : income[period];
    if (!Array.isArray(items)) throw new Error(`"${period}" must be an array.`);
    value[period] = items.map((x, i) => {
      try {
        return normalizeIncomeItem(x, period);
      } catch (e) {
        throw new Error(`${period}[${i}]: ${e.message}`);
      }
    });
  }
  return value.monthly.length || value.once.length ? value : null;
}

// The raw config in the "origins" form: an older top-level "works" list is grouped by each work's
// "origin", in the order each origin first appears, with works without one in a last group.
function toOrigins(raw) {
  if (raw.origins !== undefined || !Array.isArray(raw.works)) return raw;
  const groups = new Map();
  for (const w of raw.works) {
    const isObject = w && typeof w === 'object' && !Array.isArray(w);
    const origin = isObject && typeof w.origin === 'string' ? w.origin.trim() : '';
    if (!groups.has(origin)) groups.set(origin, []);
    if (isObject) {
      const { origin: _, ...rest } = w;
      groups.get(origin).push(rest);
    } else {
      groups.get(origin).push(w);
    }
  }
  const list = [...groups].map(([origin, works]) => (origin ? { origin, works } : { works }));
  const { works: _, ...rest } = raw;
  return { ...rest, origins: [...list.filter(g => g.origin), ...list.filter(g => !g.origin)] };
}

// The raw config in its current form: "origins" (see toOrigins), and each repository named by
// "repository" (first) rather than the older "name".
function upgradeRaw(raw) {
  raw = toOrigins(raw);
  for (const g of Array.isArray(raw.origins) ? raw.origins : []) {
    for (const w of g && Array.isArray(g.works) ? g.works : []) {
      if (!w || !Array.isArray(w.repositories)) continue;
      w.repositories = w.repositories.map(p => {
        if (!p || typeof p !== 'object' || p.repository !== undefined || p.name === undefined) return p;
        const { name, ...rest } = p;
        return { repository: name, ...rest };
      });
    }
  }
  return raw;
}

// Validate and normalize the "origins" array into { works, origins }: one list of works, each with
// its origin, and the named origins with their income (an origin may have no works yet). Names are
// trimmed, roots expanded to absolute paths, origin and work names unique (repositories unique
// within their work) so they can be used as URL segments.
function normalizeOrigins(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('"origins" must be a non-empty array.');
  }
  const seenOrigins = new Set();
  const seenWorks = new Set();
  const works = [];
  const origins = [];
  raw.forEach((g, i) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error(`origins[${i}] must be an object.`);
    if (g.origin !== undefined && typeof g.origin !== 'string') throw new Error(`origins[${i}].origin must be a string.`);
    const origin = (g.origin || '').trim();
    if (seenOrigins.has(origin)) throw new Error(origin ? `Duplicate origin "${origin}".` : 'Only one origin may have no name.');
    seenOrigins.add(origin);
    let originIncome = null;
    try {
      originIncome = normalizeIncome(g.income);
    } catch (e) {
      throw new Error(`origins[${i}].income${origin ? ` ("${origin}")` : ''}: ${e.message}`);
    }
    if (originIncome && !origin) throw new Error(`origins[${i}]: only an origin with a name can have an income.`);
    if (origin) origins.push({ origin, income: originIncome });
    const list = g.works === undefined ? [] : g.works;
    if (!Array.isArray(list)) throw new Error(`origins[${i}].works${origin ? ` ("${origin}")` : ''} must be an array.`);
    list.forEach((w, j) => works.push(normalizeWork(w, `origins[${i}].works[${j}]`, origin, seenWorks)));
  });
  return { works, origins };
}

// A repository's tasks folder, absolute: its tasks_path, or the "tasks" folder in its source code
// folder when it has none.
function repositoryTasksRoot(tasks, source) {
  return tasks ? path.resolve(expandHome(tasks)) : path.join(path.resolve(expandHome(source)), 'tasks');
}

// Validate and normalize one work entry; `at` is where it is in the file, for error messages.
function normalizeWork(w, at, origin, seenWorks) {
  if (!w || typeof w !== 'object') throw new Error(`${at} must be an object.`);
  if (!isNonEmptyString(w.work)) throw new Error(`${at}.work must be a non-empty string.`);
  const work = w.work.trim();
  if (w.tasks_path !== undefined && typeof w.tasks_path !== 'string') throw new Error(`${at}.tasks_path ("${work}") must be a string.`);
  const tasksPath = (w.tasks_path || '').trim();
  if (work.includes('/')) throw new Error(`${at}.work "${work}" must not contain "/".`);
  if (seenWorks.has(work)) throw new Error(`Duplicate work name "${work}".`);
  seenWorks.add(work);
  let income;
  try {
    income = normalizeIncome(w.income, w.reward);
  } catch (e) {
    throw new Error(`${at}.${w.income === undefined ? 'reward' : 'income'} ("${work}"): ${e.message}`);
  }

  if (w.hidden !== undefined && typeof w.hidden !== 'boolean') throw new Error(`${at}.hidden ("${work}") must be true or false.`);

  const seenRepositories = new Set();
  const repositories = (w.repositories === undefined ? [] : w.repositories);
  if (!Array.isArray(repositories)) throw new Error(`${at}.repositories ("${work}") must be an array.`);
  return {
    work,
    origin,
    income,
    hidden: w.hidden === true,
    // "" when the work has no common tasks folder, only its repositories'.
    root: tasksPath ? path.resolve(expandHome(tasksPath)) : '',
    // The path as written in taskmgr.json (with "~" kept), for the UI to show.
    shownPath: tasksPath,
    repositories: repositories.map((p, j) => {
      if (!p || typeof p !== 'object') throw new Error(`${at}.repositories[${j}] ("${work}") must be an object.`);
      if (!isNonEmptyString(p.repository)) throw new Error(`${at}.repositories[${j}].repository ("${work}") must be a non-empty string.`);
      const name = p.repository.trim();
      if (name.includes('/')) throw new Error(`Repository name "${name}" of "${work}" must not contain "/".`);
      if (seenRepositories.has(name)) throw new Error(`Duplicate repository name "${name}" in "${work}".`);
      seenRepositories.add(name);
      if (p.source_path !== undefined && typeof p.source_path !== 'string') throw new Error(`Repository "${name}" of "${work}": "source_path" must be a string.`);
      if (p.tasks_path !== undefined && typeof p.tasks_path !== 'string') throw new Error(`Repository "${name}" of "${work}": "tasks_path" must be a string.`);
      const source = (p.source_path || '').trim();
      const tasks = (p.tasks_path || '').trim();
      if (!source && !tasks) throw new Error(`Repository "${name}" of "${work}" needs a "tasks_path" or a "source_path" folder.`);
      return {
        name,
        root: repositoryTasksRoot(tasks, source),
        sourcePath: source ? path.resolve(expandHome(source)) : '',
        // Its source code folder as written in taskmgr.json, or its tasks folder when it has none.
        shownPath: source || tasks,
        // Both folders as written ("" when left out), for editing.
        paths: { source, tasks }
      };
    })
  };
}

// Parse and validate the text of a config file.
function parseConfig(text, configPath) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${configPath}: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${configPath} must contain a JSON object.`);
  try {
    return normalizeOrigins(upgradeRaw(raw).origins);
  } catch (e) {
    throw new Error(`${configPath}: ${e.message}`);
  }
}

function readConfigFile(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    throw new Error(`Could not read ${configPath}: ${e.message}`);
  }
  return parseConfig(text, configPath);
}

function resolveConfig() {
  loadDotenv();
  const configPath = DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(configPath)) {
    const hint = fs.existsSync(EXAMPLE_CONFIG_PATH) ? ` Copy taskmgr.json.example to taskmgr.json and list your works there.` : '';
    throw new Error(`Config file not found: ${configPath}.${hint}`);
  }

  const first = readConfigFile(configPath);
  const port = parseInt(process.env.PORT || 3456, 10);
  const host = process.env.HOST || '127.0.0.1';
  const dataDir = DEFAULT_DATA_DIR;
  const usersPath = DEFAULT_USERS_PATH;

  // Works and origins are re-read when the file's mtime changes; a broken edit keeps the last good ones.
  let cached = { mtimeMs: fs.statSync(configPath).mtimeMs, ...first };
  function current() {
    try {
      const mtimeMs = fs.statSync(configPath).mtimeMs;
      if (mtimeMs !== cached.mtimeMs) {
        cached = { mtimeMs, ...readConfigFile(configPath) };
      }
    } catch (e) {
      console.error(`Warning: ${e.message} (keeping the previous configuration)`);
    }
    return cached;
  }
  const getWorks = () => current().works;
  // The named origins, { origin, income }, in file order.
  const getOrigins = () => current().origins;

  // The config file as written, for editing in the web UI.
  function readText() {
    return fs.readFileSync(configPath, 'utf8');
  }

  // Replace the config file; an invalid one is refused and the file left as it was.
  function writeText(text) {
    const parsed = parseConfig(text, configPath);
    fs.writeFileSync(configPath, text);
    cached = { mtimeMs: fs.statSync(configPath).mtimeMs, ...parsed };
  }

  const write = (raw) => writeText(JSON.stringify(raw, null, 2) + '\n');

  // The raw origin entry named `origin`, added before the group of works without an origin when
  // there is none yet and `create` is set.
  function findRawOrigin(raw, origin, create) {
    if (!Array.isArray(raw.origins)) raw.origins = [];
    let g = raw.origins.find(x => named(x, 'origin', origin));
    if (!g && create) {
      g = { origin, works: [] };
      raw.origins.splice(afterNamedOrigins(raw.origins), 0, g);
    }
    return g;
  }

  // Where a named origin goes to be last among the named ones: the index of the group of works
  // without an origin, or the end of the list when there is none.
  function afterNamedOrigins(list) {
    const at = list.findIndex(x => !x || !(typeof x.origin === 'string' && x.origin.trim()));
    return at === -1 ? list.length : at;
  }

  const named = (x, key, name) => x && typeof x[key] === 'string' && x[key].trim() === name;

  // The file text parsed, in the "origins" form, to change and write back.
  function readRaw() {
    return upgradeRaw(JSON.parse(readText()));
  }

  // The raw work entry named `work`, with the list holding it.
  function findRawWork(raw, work) {
    for (const g of Array.isArray(raw.origins) ? raw.origins : []) {
      const list = g && Array.isArray(g.works) ? g.works : [];
      const w = list.find(x => named(x, 'work', work));
      if (w) return { w, list };
    }
    throw new Error(`No work named "${work}".`);
  }

  // The work (or origin, with `nameKey` "origin") entry with its income set (null removes it),
  // placed after the name so the file keeps its usual key order. An older "reward" is dropped: the
  // income replaces it.
  function withIncome(w, income, nameKey = 'work') {
    const value = normalizeIncome(income);
    const out = {};
    for (const [k, v] of Object.entries(w)) {
      if (k === 'income' || k === 'reward') continue;
      if (value && !out.income && k !== nameKey) out.income = value;
      out[k] = v;
    }
    if (value && !out.income) out.income = value;
    return out;
  }

  // Set one work's name, income ({ monthly, once }; null removes it) and, when given, its tasks
  // folder ("" removes it) and whether it is hidden (false removes the key), and rewrite the file as 2-space
  // indented JSON. Uniqueness and the "/" rule are checked by writeText.
  function updateWork(work, { name, income, hidden, tasksPath }) {
    const raw = readRaw();
    const { w, list } = findRawWork(raw, work);
    const newName = name.trim();
    if (!newName) throw new Error('The name must not be empty.');
    w.work = newName;
    if (tasksPath !== undefined) {
      const tasks = tasksPath.trim();
      if (tasks) w.tasks_path = tasks;
      else delete w.tasks_path;
    }
    const out = withIncome(w, income);
    if (hidden === true) out.hidden = true;
    else if (hidden === false) delete out.hidden;
    list[list.indexOf(w)] = out;
    write(raw);
  }

  // Set one origin's name and income ({ monthly, once }; null removes it), like updateWork.
  function updateOrigin(origin, { name, income }) {
    const raw = readRaw();
    const g = origin && findRawOrigin(raw, origin, false);
    if (!g) throw new Error(`No origin named "${origin}".`);
    const newName = name.trim();
    if (!newName) throw new Error('The name must not be empty.');
    g.origin = newName;
    raw.origins[raw.origins.indexOf(g)] = withIncome(g, income, 'origin');
    write(raw);
  }

  // Add an origin with no works yet, after the named ones.
  function addOrigin({ name, income }) {
    const raw = readRaw();
    const origin = name.trim();
    if (!origin) throw new Error('The name must not be empty.');
    if (findRawOrigin(raw, origin, false)) throw new Error(`Duplicate origin "${origin}".`);
    const g = findRawOrigin(raw, origin, true);
    raw.origins[raw.origins.indexOf(g)] = withIncome(g, income, 'origin');
    write(raw);
  }

  // Add a work at the end of its origin (which must be named; it is added when it does not exist),
  // with no repositories. The tasks folder, when given, is created when it does not exist yet, so
  // the work can be opened right away.
  function addWork({ name, origin, tasksPath, income }) {
    const raw = readRaw();
    const work = name.trim();
    if (!work) throw new Error('The name must not be empty.');
    const originName = origin.trim();
    if (!originName) throw new Error('The origin must not be empty.');
    const tasks = (tasksPath || '').trim();
    const g = findRawOrigin(raw, originName, true);
    if (!Array.isArray(g.works)) g.works = [];
    g.works.push(withIncome({ work, ...(tasks ? { tasks_path: tasks } : {}), repositories: [] }, income));
    write(raw);
    if (tasks) fs.mkdirSync(path.resolve(expandHome(tasks)), { recursive: true });
  }

  // Add a repository at the end of a work; its tasks folder is created like a new work's. With no
  // tasks folder, tasks_path is left out and the "tasks" folder in the source folder is used.
  function addRepository({ work, name, tasksPath, sourcePath }) {
    const raw = readRaw();
    const { w } = findRawWork(raw, work);
    const repository = name.trim();
    if (!repository) throw new Error('The name must not be empty.');
    const tasks = (tasksPath || '').trim();
    const source = (sourcePath || '').trim();
    if (!tasks && !source) throw new Error('Give a tasks folder or a source folder.');
    if (!Array.isArray(w.repositories)) w.repositories = [];
    w.repositories.push({ repository, ...(source ? { source_path: source } : {}), ...(tasks ? { tasks_path: tasks } : {}) });
    write(raw);
    fs.mkdirSync(repositoryTasksRoot(tasks, source), { recursive: true });
  }

  // Set one repository's name, source folder and tasks folder; an empty folder is left out, as
  // when adding one. Uniqueness and the "/" rule are checked by writeText.
  function updateRepository(work, from, { name, tasksPath, sourcePath }) {
    const raw = readRaw();
    const { w } = findRawWork(raw, work);
    const list = Array.isArray(w.repositories) ? w.repositories : [];
    const p = list.find(x => named(x, 'repository', from));
    if (!p) throw new Error(`No repository named "${from}" in "${work}".`);
    const repository = name.trim();
    if (!repository) throw new Error('The name must not be empty.');
    const tasks = (tasksPath || '').trim();
    const source = (sourcePath || '').trim();
    if (!tasks && !source) throw new Error('Give a tasks folder or a source folder.');
    // Rebuilt so the keys keep their usual order; any others stay after them.
    const { repository: _r, name: _n, source_path: _s, tasks_path: _t, ...rest } = p;
    list[list.indexOf(p)] = { repository, ...(source ? { source_path: source } : {}), ...(tasks ? { tasks_path: tasks } : {}), ...rest };
    write(raw);
  }

  // Remove one work, with its repositories, from the file. Its folders are left as they are.
  function removeWork(work) {
    const raw = readRaw();
    const { w, list } = findRawWork(raw, work);
    list.splice(list.indexOf(w), 1);
    write(raw);
  }

  // Remove one origin, with its works and their repositories, from the file. Their folders are
  // left as they are.
  function removeOrigin(origin) {
    const raw = readRaw();
    const g = origin && findRawOrigin(raw, origin, false);
    if (!g) throw new Error(`No origin named "${origin}".`);
    raw.origins.splice(raw.origins.indexOf(g), 1);
    write(raw);
  }

  // Remove one repository of a work from the file. Its folders are left as they are.
  function removeRepository(work, name) {
    const raw = readRaw();
    const { w } = findRawWork(raw, work);
    const list = Array.isArray(w.repositories) ? w.repositories : [];
    const p = list.find(x => named(x, 'repository', name));
    if (!p) throw new Error(`No repository named "${name}" in "${work}".`);
    list.splice(list.indexOf(p), 1);
    write(raw);
  }

  // Reordering (the web UI's tree is in file order): each move puts an entry before the one of its
  // list named `before`, or last in its list when `before` is null. An entry cannot move to another
  // list: a work stays in its origin, a repository in its work. Putting an entry before itself
  // changes nothing.

  // Move a named origin, with its works, among the named ones; the works without an origin stay last.
  function moveOrigin(origin, before) {
    const raw = readRaw();
    const g = origin && findRawOrigin(raw, origin, false);
    if (!g) throw new Error(`No origin named "${origin}".`);
    if (before !== null && !(before && findRawOrigin(raw, before, false))) throw new Error(`No origin named "${before}".`);
    if (before === origin) return;
    raw.origins.splice(raw.origins.indexOf(g), 1);
    const at = before === null ? afterNamedOrigins(raw.origins) : raw.origins.findIndex(x => named(x, 'origin', before));
    raw.origins.splice(at, 0, g);
    write(raw);
  }

  // Move a work, with its repositories, among the works of its origin.
  function moveWork(work, before) {
    const raw = readRaw();
    const { w, list } = findRawWork(raw, work);
    if (moveIn(list, w, 'work', before, `No work named "${before}" in the origin of "${work}".`)) write(raw);
  }

  // Move a repository among the repositories of its work.
  function moveRepository(work, name, before) {
    const raw = readRaw();
    const { w } = findRawWork(raw, work);
    const list = Array.isArray(w.repositories) ? w.repositories : [];
    const p = list.find(x => named(x, 'repository', name));
    if (!p) throw new Error(`No repository named "${name}" in "${work}".`);
    if (moveIn(list, p, 'repository', before, `No repository named "${before}" in "${work}".`)) write(raw);
  }

  // Put `x`, an entry of `list`, before the entry whose `key` is `before`, or last (null); `missing`
  // is the error when there is no such entry. False when `x` is already there.
  function moveIn(list, x, key, before, missing) {
    if (before !== null && named(x, key, before)) return false;
    const to = before === null ? null : list.find(y => named(y, key, before));
    if (before !== null && !to) throw new Error(missing);
    list.splice(list.indexOf(x), 1);
    list.splice(to ? list.indexOf(to) : list.length, 0, x);
    return true;
  }

  return {
    configPath, port, host, dataDir, usersPath, getWorks, getOrigins, readText, writeText,
    addOrigin, addWork, addRepository, updateWork, updateOrigin, updateRepository, removeOrigin, removeWork, removeRepository,
    moveOrigin, moveWork, moveRepository
  };
}

module.exports = { resolveConfig, loadDotenv, parseConfig, upgradeRaw, DEFAULT_CONFIG_PATH, EXAMPLE_CONFIG_PATH, DEFAULT_DATA_DIR, POLL_STATE_PATH };
