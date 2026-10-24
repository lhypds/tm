// The runner of taskmgrd: runs Claude Code on this machine for the tm server it syncs with
// (SYNC_SERVER), so a task of a copy pushed from here can be run from the server's web UI where the
// tasks, the source code and the claude login are. On with AI_RUNNER=1 in .env (see taskmgrd.js).
//
// It keeps one connection open to the server, GET /api/sync/ai/commands (a text/event-stream, see
// server/ai.js), reads the commands the server's browsers give (run, answer, stop, dismiss; see
// ai/remote.js), carries each out on this machine's session (ai/session.js) and acknowledges it (an
// `ack` event: ok, or the error for the browser). Every event of the session goes back as it happens,
// POST /api/sync/ai/events, a snapshot of the runs first each time the connection is made, so the
// server shows these runs as it shows its own. A connection lost is made again, with growing waits.
//
// A run command carries the task's text files as the server has them (task.txt, prompt.txt): they are
// written here first when they differ, since a prompt typed in the server's web UI is only in its copy
// until then (the push that follows sends them back, so nothing is lost; a file the server has not is
// left as it is here). A task the server has at a path this machine has not is looked for by its id
// (it may be in another status folder here) and, when it is nowhere here, made at that path.
const fs = require('fs');
const path = require('path');

const { TASK_FILE, PROMPT_FILE, TASK_FOLDER_RE, folderId } = require('../utils/taskUtils');
const { resolveConfig } = require('../server/config');
const { isDirectory, spaceOf, taskDirIn, taskDirsUnder } = require('./task');

const RETRY_MS = [2000, 5000, 15000, 60000];  // waits before connecting again, the last one repeating
const FLUSH_MS = 50;                          // events are sent together after this long

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// The messages of a text/event-stream, { event, data }, from its body (a web ReadableStream).
async function* sseMessages(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const msg = { event: '', data: '' };
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) msg.event = line.slice(6).trim();
        else if (line.startsWith('data:')) msg.data += (msg.data ? '\n' : '') + line.slice(5).replace(/^ /, '');
      }
      if (msg.event || msg.data) yield msg;
    }
  }
}

// Start the runner; `server` is SYNC_SERVER, `token` SYNC_SERVER_TOKEN, `machineId` MACHINE_ID, and
// log / warn the daemon's. `session` is this machine's runs (ai/session.js unless a test gives
// another), `getWorks` the works of taskmgr.json as they are now (read each time, as the file may
// change), `logFile` where the runs log what claude writes to stderr. Returns { stop }.
function startRunner({ server, token, machineId, log, warn, logFile, session = require('./session'), getWorks = () => resolveConfig().getWorks() }) {
  session.configure({ logFile });
  const headers = { Authorization: `Bearer ${token}`, 'X-Machine-Id': encodeURIComponent(machineId) };

  let stopped = false;
  let abort = null;        // the connection under way, to end it
  let connected = false;   // the stream is open: the session's events are sent as they happen
  let failures = 0;

  // ---------- events to the server ----------

  // The events wait FLUSH_MS and go together, in order, one request at a time. Each is written out as
  // it comes (as the web UI's event stream writes it), since the session hands out its items by
  // reference and grows a text item after telling of it: kept as objects, an item would go out with
  // the text its deltas add again. A request that fails drops the connection: the next one begins
  // with a snapshot, so nothing is missed for long.
  let queue = [];   // the events, each serialized
  let sending = false;

  function enqueue(event, data) {
    queue.push(JSON.stringify({ event, data }));
    if (!sending) {
      sending = true;
      setTimeout(flush, FLUSH_MS);
    }
  }

  async function flush() {
    try {
      while (queue.length) {
        const events = queue;
        queue = [];
        await post(events);
      }
    } catch (e) {
      queue = [];
      warn(`runner: ${e.message}`);
      if (abort) abort.abort();
    } finally {
      sending = false;
    }
  }

  // Send serialized events, in order.
  async function post(events) {
    let res;
    try {
      res = await fetch(`${server}/api/sync/ai/events`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: `{"events":[${events.join(',')}]}`,
        signal: AbortSignal.timeout(30 * 1000)
      });
    } catch (e) {
      throw new Error(`cannot reach ${server} (${e.name === 'TimeoutError' ? 'no answer in time' : (e.cause && e.cause.code) || e.message})`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`${server} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
    }
  }

  // ---------- the commands ----------

  // The task the command names, here: its space by work and repository as in taskmgr.json now, its
  // folder at `rel`, else by its id anywhere in the space, else made at `rel`.
  function locate({ work, repository, rel }) {
    const space = spaceOf(getWorks(), String(work || ''), String(repository || ''));
    if (!space) throw httpError(404, `No ${repository ? `repository "${repository}" in "${work}"` : `work "${work}"`} on ${machineId}.`);
    if (!space.root) throw httpError(404, `"${work}" has no tasks folder of its own on ${machineId}.`);
    if (!isDirectory(space.root)) throw httpError(404, `Folder not found on ${machineId}: ${space.root}`);
    const relPath = String(rel || '');
    try {
      return { space, taskDir: taskDirIn(space, relPath), made: false };
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const name = path.basename(relPath);
    const id = folderId(name);
    if (!TASK_FOLDER_RE.test(name)) throw httpError(400, `"${name}" is not a task folder name.`);
    const found = [...taskDirsUnder(space.root)].filter(d => folderId(path.basename(d)) === id);
    if (found.length === 1) return { space, taskDir: found[0], made: false };
    if (found.length > 1) throw httpError(409, `${found.length} tasks on ${machineId} have the id ${id}; which one?`);
    const abs = path.resolve(space.root, relPath);
    const toRoot = path.relative(space.root, abs);
    if (!toRoot || toRoot.startsWith('..') || path.isAbsolute(toRoot)) throw httpError(400, 'Path is outside the tasks root.');
    fs.mkdirSync(abs, { recursive: true });
    return { space, taskDir: abs, made: true };
  }

  // The task's text files as the server has them, written here when they differ. Returns the names written.
  function writeFiles(taskDir, files) {
    const written = [];
    if (!files || typeof files !== 'object') return written;
    for (const name of [TASK_FILE, PROMPT_FILE]) {
      const text = files[name];
      if (typeof text !== 'string') continue;  // null: the server has none, what is here stays
      const abs = path.join(taskDir, name);
      let here = null;
      try { here = fs.readFileSync(abs, 'utf8'); } catch (e) { /* none here */ }
      if (here === text) continue;
      fs.writeFileSync(abs, text, 'utf8');
      written.push(name);
    }
    return written;
  }

  function handle(cmd) {
    const reply = (extra) => enqueue('ack', { id: cmd.id, ...extra });
    try {
      switch (cmd.type) {
        case 'run': {
          const { space, taskDir, made } = locate(cmd);
          const written = writeFiles(taskDir, cmd.files);
          const run = session.startRun({ id: String(cmd.run || '') || null, space, taskDir, taskRef: { work: space.work, repository: space.repository, rel: String(cmd.rel || '') } });
          log(`runner: run ${run.id}: ${run.task.id} ${run.task.title} in ${run.cwd}${made ? ' (task made here)' : ''}${written.length ? ` (${written.join(', ')} written)` : ''}`);
          break;
        }
        case 'answer':
          session.answerRun(String(cmd.run || ''), String(cmd.pending || ''), cmd.body || {});
          break;
        case 'stop':
          session.stopRun(String(cmd.run || ''));
          break;
        case 'dismiss':
          session.dismissRun(String(cmd.run || ''));
          break;
        default:
          throw httpError(400, `Unknown command "${cmd.type}".`);
      }
      reply({ ok: true });
    } catch (e) {
      warn(`runner: ${cmd.type}: ${e.message}`);
      reply({ ok: false, status: e.status || 500, error: e.message });
    }
  }

  // ---------- the connection ----------

  // One connection: open the stream, send the runs as they are, then follow the session and read the
  // commands until the stream ends.
  async function connection(signal) {
    let res;
    try {
      res = await fetch(`${server}/api/sync/ai/commands`, { headers: { ...headers, Accept: 'text/event-stream' }, signal });
    } catch (e) {
      if (signal.aborted) return;
      throw new Error(`cannot reach ${server} (${(e.cause && e.cause.code) || e.message})`);
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`${server} answered ${res.status}${data.error ? `: ${data.error}` : ''}`);
    }
    if (failures) log(`runner: ${server} answers again`);
    failures = 0;
    connected = true;
    log(`runner: connected to ${server}, running Claude Code for it as ${machineId}`);
    const snapshot = session.listRuns(true);
    const off = session.subscribe((event, data) => { if (connected) enqueue(event, data); });
    enqueue('snapshot', { runs: snapshot });
    try {
      for await (const msg of sseMessages(res.body)) {
        if (msg.event !== 'command') continue;
        let cmd;
        try { cmd = JSON.parse(msg.data); } catch (e) { continue; }
        if (cmd && typeof cmd === 'object') handle(cmd);
      }
    } finally {
      connected = false;
      off();
    }
    if (!signal.aborted) throw new Error('the connection closed');
  }

  async function loop() {
    while (!stopped) {
      abort = new AbortController();
      try {
        await connection(abort.signal);
      } catch (e) {
        if (stopped) break;
        failures++;
        const wait = RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)];
        warn(`runner: ${e.message}; connecting again in ${wait / 1000}s`);
        await new Promise(resolve => {
          const t = setTimeout(resolve, wait);
          abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    }
  }

  loop();

  return {
    stop() {
      stopped = true;
      connected = false;
      if (abort) abort.abort();
    }
  };
}

module.exports = { startRunner, sseMessages };
