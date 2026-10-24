// Runs of Claude Code on other machines, mirrored here for the browsers. On a server that receives
// pushes from taskmgrd (server/sync.js), a task of a pushed copy is run where its tasks, the source
// code and the claude login are: on the machine that pushed it, by its taskmgrd (ai/runner.js, with
// AI_RUNNER=1 in its .env). That runner keeps one connection open here (GET /api/sync/ai/commands in
// server/ai.js) and gets the browsers' commands over it: run, answer, stop, dismiss (command). What
// its runs do comes back as the events of its own session (ai/session.js: snapshot, run, item, delta,
// remove; POST /api/sync/ai/events, see receive) and is kept here, run by run, so the browsers see
// those runs as they see the runs of this machine: the same events (subscribe), the same shape
// (publicRun), plus `machine`, where the run is. A run asked for is `queued` here until the machine
// starts it (its own `run` event takes over) or refuses.
//
// Every command is acknowledged (an `ack` event carrying the command's id: ok, or the error to show);
// command() resolves on it, or rejects when the machine refuses, is not connected, or does not answer
// in time. Everything is in memory: a restart forgets the runs, and each runner sends them again
// (its snapshot) when it connects.
const crypto = require('crypto');

const ACK_MS = 15 * 1000;   // how long a machine has to acknowledge a command

const runs = new Map();        // id -> run: the machine's publicRun, items included, plus machine
const machines = new Map();    // machine -> { send(command), close(), since }: the connection of its runner
const waiting = new Map();     // command id -> { machine, resolve, reject, timer }
const listeners = new Set();   // (event, data) => void, the browsers following the runs

const newId = () => crypto.randomBytes(6).toString('hex');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function emit(event, data) {
  for (const fn of listeners) {
    try { fn(event, data); } catch (e) { /* a dead listener is removed on close */ }
  }
}

// Follow the runs: fn(event, data) gets every event, as session.subscribe does for the local runs.
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A run as the browser sees it; with its transcript when `withItems`.
function publicRun(run, withItems = false) {
  const { items, ...rest } = run;
  return withItems ? { ...rest, items } : rest;
}

function listRuns(withItems = false) {
  return [...runs.values()].map(r => publicRun(r, withItems));
}

const has = (id) => runs.has(id);

function getRun(id) {
  const run = runs.get(id);
  if (!run) throw httpError(404, 'No such run.');
  return run;
}

const notConnected = (machine) => httpError(409, `Claude Code runs on ${machine}, which is not connected: start taskmgrd there with AI_RUNNER=1 in its .env.`);

// Whether the runner of `machine` is connected (and so can be given a run).
const isConnected = (machine) => machines.has(machine);

// The runner of `machine` has connected: `send(command)` writes a command to it, `close()` ends the
// connection. Returns the way to say it is gone. A second connection of the same machine replaces
// the first, which is closed.
function connect(machine, send, close) {
  const old = machines.get(machine);
  if (old) {
    machines.delete(machine);
    try { old.close(); } catch (e) { /* already gone */ }
  }
  const conn = { send, close, since: Date.now() };
  machines.set(machine, conn);
  return () => {
    if (machines.get(machine) !== conn) return;  // replaced meanwhile
    machines.delete(machine);
    for (const [id, w] of [...waiting]) {
      if (w.machine !== machine) continue;
      clearTimeout(w.timer);
      waiting.delete(id);
      w.reject(httpError(502, `${machine} disconnected.`));
    }
    // A run asked for that the machine never said it started: gone with the connection. (Should it
    // have started after all, its next snapshot brings the run back as it is.)
    for (const r of runs.values()) {
      if (r.machine === machine && r.status === 'queued') fail(r, `${machine} disconnected before starting the run.`);
    }
  };
}

// Give `machine` a command; resolves on its ack, rejects with the error it answers, or when it is not
// connected or does not answer within `timeout`.
function command(machine, cmd, timeout = ACK_MS) {
  const conn = machines.get(machine);
  if (!conn) return Promise.reject(notConnected(machine));
  const id = newId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(httpError(504, `${machine} did not answer in time.`));
    }, timeout);
    waiting.set(id, { machine, resolve, reject, timer });
    try {
      conn.send({ id, ...cmd });
    } catch (e) {
      clearTimeout(timer);
      waiting.delete(id);
      reject(httpError(502, `Cannot reach ${machine}: ${e.message}`));
    }
  });
}

function ack(machine, data) {
  const w = waiting.get(data?.id);
  if (!w || w.machine !== machine) return;
  clearTimeout(w.timer);
  waiting.delete(data.id);
  if (data.ok) w.resolve(data);
  else w.reject(httpError(data.status || 502, data.error || `${machine} refused.`));
}

// A queued run that will not start: failed, with the reason in its transcript.
function fail(run, error) {
  run.status = 'failed';
  run.endedAt = Date.now();
  run.error = error;
  const i = run.items.length;
  run.items.push({ type: 'error', message: error });
  emit('item', { run: run.id, i, item: run.items[i] });
  emit('run', publicRun(run));
}

// Ask `machine` to run Claude Code on the task: the run is here as `queued`, under the id the machine
// will give it, until the machine starts it (its `run` event takes over) or refuses (then it is
// forgotten and the refusal thrown). `task` is { work, repository, rel, id, title, key } as the
// browser names the task, `taskDir` the copy's folder here, `files` the task's text files as they
// are here ({ "task.txt": text, "prompt.txt": text | null }), written there before the run.
async function startRun({ machine, task, taskDir, files }) {
  if (!machines.has(machine)) throw notConnected(machine);
  for (const r of runs.values()) {
    if (r.task.key === task.key && (r.status === 'running' || r.status === 'queued')) throw httpError(409, 'Claude Code is already running on this task.');
  }
  const run = {
    id: newId(),
    machine,
    task,
    cwd: null,
    taskDir,
    status: 'queued',
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    pending: null,
    model: null,
    sessionId: null,
    cost: null,
    billed: false,
    items: []
  };
  runs.set(run.id, run);
  emit('run', publicRun(run));
  try {
    await command(machine, { type: 'run', run: run.id, work: task.work, repository: task.repository, rel: task.rel, files });
  } catch (e) {
    if (runs.get(run.id) === run && run.status === 'queued') {
      runs.delete(run.id);
      emit('remove', { run: run.id });
    }
    throw e;
  }
  return runs.get(run.id) || run;
}

// The browser's answer to the run's pending question, passed on to the machine (see session.answerRun).
async function answerRun(id, pendingId, body) {
  const run = getRun(id);
  if (!run.pending || run.pending.id !== pendingId) throw httpError(409, 'That question is not waiting for an answer any more.');
  await command(run.machine, { type: 'answer', run: id, pending: pendingId, body });
  return runs.get(id) || run;
}

// Stop the run on its machine. A queued run the machine does not know of is just over.
async function stopRun(id) {
  const run = getRun(id);
  if (run.status !== 'running' && run.status !== 'queued') throw httpError(409, 'This run is over.');
  try {
    await command(run.machine, { type: 'stop', run: id });
  } catch (e) {
    if (!(e.status === 404 && run.status === 'queued')) throw e;
    run.status = 'stopped';
    run.endedAt = Date.now();
    emit('run', publicRun(run));
  }
  return runs.get(id) || run;
}

// Forget a finished run here, and on its machine (which may be gone: no reason to keep the run).
function dismissRun(id) {
  const run = getRun(id);
  if (run.status === 'running' || run.status === 'queued') throw httpError(409, 'Stop the run first.');
  runs.delete(id);
  emit('remove', { run: id });
  command(run.machine, { type: 'dismiss', run: id }).catch(() => {});
}

// A run as the machine tells it (its publicRun, items included in a snapshot), kept as this machine's.
function upsert(machine, pub) {
  if (!pub || typeof pub.id !== 'string') return;
  const old = runs.get(pub.id);
  if (old && old.machine !== machine) return;
  const run = { ...old, ...pub, machine, items: Array.isArray(pub.items) ? pub.items : old ? old.items : [] };
  runs.set(run.id, run);
  emit('run', publicRun(run));
  // The transcript whole, item by item: a browser that has the run keeps its items on a `run` event.
  if (Array.isArray(pub.items)) pub.items.forEach((item, i) => emit('item', { run: run.id, i, item }));
}

// Every run of the machine, as it connects: the runs it no longer has are dropped (a queued one is
// kept: its command may still be on its way), the others brought up to date.
function snapshot(machine, list) {
  const ids = new Set(list.map(r => r && r.id));
  for (const r of [...runs.values()]) {
    if (r.machine === machine && r.status !== 'queued' && !ids.has(r.id)) {
      runs.delete(r.id);
      emit('remove', { run: r.id });
    }
  }
  for (const r of list) upsert(machine, r);
}

// What the runner of `machine` sends: the events of its session, in order, and its acks.
function receive(machine, events) {
  for (const ev of events) {
    const { event, data } = ev || {};
    switch (event) {
      case 'snapshot':
        snapshot(machine, Array.isArray(data?.runs) ? data.runs : []);
        break;
      case 'run':
        upsert(machine, data);
        break;
      case 'item': {
        const r = runs.get(data?.run);
        if (!r || r.machine !== machine || !Number.isInteger(data.i) || data.i < 0) break;
        r.items[data.i] = data.item;
        emit('item', data);
        break;
      }
      case 'delta': {
        const r = runs.get(data?.run);
        const it = r && r.machine === machine ? r.items[data.i] : null;
        if (!it) break;
        it.text = (it.text || '') + String(data.text || '');
        emit('delta', data);
        break;
      }
      case 'remove': {
        const r = runs.get(data?.run);
        if (!r || r.machine !== machine) break;
        runs.delete(r.id);
        emit('remove', { run: r.id });
        break;
      }
      case 'ack':
        ack(machine, data);
        break;
      default:
        break;
    }
  }
}

module.exports = { subscribe, listRuns, publicRun, has, isConnected, connect, receive, startRun, answerRun, stopRun, dismissRun };
