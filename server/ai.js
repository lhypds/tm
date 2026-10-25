// The web UI's API for running Claude Code on a task, mounted by index.js under /api after the login
// guard, so every route needs a session:
//
//   GET    /api/ai/events            the runs, live: a text/event-stream (SSE) of events (see below)
//   GET    /api/ai/runs              the runs, with their transcripts: { runs }
//   POST   /api/ai/run               { work, repository?, rel }: start Claude Code on that task; 201 { run }
//   POST   /api/ai/runs/:id/answer   { pending, decision } or { pending, answers }: answer the run's question; { run }
//   POST   /api/ai/runs/:id/stop     stop the run; { run }
//   DELETE /api/ai/runs/:id          forget a finished run; { ok: true }
//   GET    /api/ai/saved/:folder     ?work&repository&rel: a run's record in the task folder (see ai/record.js); { run }
//   DELETE /api/ai/saved/:folder     ?work&repository&rel: remove that record; { ok: true }
//
// The event stream starts with `snapshot` { runs } (the runs with their transcripts), then sends
// `run` (a run's state: status, pending question...), `item` { run, i, item } (one item of a run's
// transcript, new or changed), `delta` { run, i, text } (text appended to a transcript item) and
// `remove` { run } as they happen, with a comment every 25 seconds to keep the connection.
//
// A task of this machine runs here (ai/session.js). A task of a copy pushed from another machine by
// its taskmgrd (server/sync.js) runs on that machine, where the tasks, the source code and the claude
// login are, through its runner (ai/runner.js; ai/remote.js keeps those runs here): the run says so
// in `machine`, is `queued` until the machine starts it, and needs the machine's runner connected
// (409 otherwise). A run that is over is kept in the task folder by the machine that ran it (ai/record.js;
// GET /api/task lists a task's records), and comes here with the task when it is pushed; removing a
// record of a pushed copy goes through that machine too. The runner's own routes, with the sync token
// rather than a login (createAiRunnerApp):
//
//   GET    /api/sync/ai/commands     the commands for this machine, live: a text/event-stream of `command` events
//   POST   /api/sync/ai/events       { events: [{ event, data }] }: the events of its session, and its acks
const fs = require('fs');
const path = require('path');
const express = require('express');

const { TASK_FILE, PROMPT_FILE, readPrompt, readTaskDir } = require('../utils/taskUtils');
const { isDirectory, spaceOf, taskDirIn, titleOf } = require('../ai/task');
const session = require('../ai/session');
const remote = require('../ai/remote');
const record = require('../ai/record');

const KEEP_MS = 25 * 1000;  // a comment this often keeps an event stream open

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Open an event stream on res: returns the way to send an event. Comments keep it open; `onClose`
// is called when the client goes.
function eventStream(req, res, onClose) {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  const beat = setInterval(() => res.write(': keep\n\n'), KEEP_MS);
  req.on('close', () => {
    clearInterval(beat);
    onClose();
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// `locate(space)` says where a space's tasks are: { remote, machine }, `remote` whether the folder is
// a copy pushed from another machine and `machine` that machine as the web UI shows it ({ name,
// online, runner }, see index.js), null when unknown. `machine` is this machine's name, for the records
// of its runs (MACHINE_ID; the hostname when not given).
function createAiApp({ config, logFile, machine, locate = () => ({ remote: false, machine: null }) }) {
  session.configure({ logFile, machine });
  const app = express.Router();

  // The space a request names, as the task APIs do (work, repository "" for the common tasks).
  function spaceFrom(params) {
    const work = String(params.work || '');
    const repository = String(params.repository || '');
    if (!work) throw httpError(400, 'Missing work.');
    const space = spaceOf(config.getWorks(), work, repository);
    if (!space) throw httpError(404, repository ? `Unknown repository "${repository}" in "${work}".` : `Unknown work "${work}".`);
    if (!space.root) throw httpError(404, `"${work}" has no tasks folder of its own.`);
    if (!isDirectory(space.root)) throw httpError(404, `Folder not found: ${space.root}`);
    return space;
  }

  // Every run, this machine's and the other machines', transcripts included.
  const allRuns = () => [...session.listRuns(true), ...remote.listRuns(true)];

  app.get('/api/ai/events', (req, res) => {
    const offs = [];
    const send = eventStream(req, res, () => offs.forEach(off => off()));
    send('snapshot', { runs: allRuns() });
    offs.push(session.subscribe(send), remote.subscribe(send));
  });

  app.get('/api/ai/runs', (req, res) => {
    res.json({ runs: allRuns() });
  });

  app.post('/api/ai/run', async (req, res) => {
    const body = req.body || {};
    const space = spaceFrom(body);
    const rel = String(body.rel || '');
    const taskDir = taskDirIn(space, rel);
    const taskRef = { work: space.work, repository: space.repository, rel };
    const where = locate(space) || {};
    if (!where.remote) {
      const run = session.startRun({ space, taskDir, taskRef });
      return res.status(201).json({ run: session.publicRun(run, true) });
    }
    // A copy pushed from another machine: run there, with the task's text as it is here.
    if (!where.machine) throw httpError(409, 'This folder is a copy pushed without a machine id; Claude Code cannot run on it.');
    const t = readTaskDir(taskDir);
    const task = { ...taskRef, id: t.id, title: titleOf(t, taskDir), key: `${space.work}/${space.repository || ''}/${rel}` };
    let text = null;
    try { text = fs.readFileSync(path.join(taskDir, TASK_FILE), 'utf8'); } catch (e) { /* a bare folder: the title stands */ }
    const files = { [TASK_FILE]: text, [PROMPT_FILE]: readPrompt(taskDir) };
    const run = await remote.startRun({ machine: where.machine.name, task, taskDir, files });
    res.status(201).json({ run: remote.publicRun(run, true) });
  });

  app.post('/api/ai/runs/:id/answer', async (req, res) => {
    const id = String(req.params.id);
    const body = req.body || {};
    const pending = String(body.pending || '');
    if (remote.has(id)) return res.json({ run: remote.publicRun(await remote.answerRun(id, pending, body)) });
    res.json({ run: session.publicRun(session.answerRun(id, pending, body)) });
  });

  app.post('/api/ai/runs/:id/stop', async (req, res) => {
    const id = String(req.params.id);
    if (remote.has(id)) return res.json({ run: remote.publicRun(await remote.stopRun(id)) });
    res.json({ run: session.publicRun(session.stopRun(id)) });
  });

  app.delete('/api/ai/runs/:id', (req, res) => {
    const id = String(req.params.id);
    if (remote.has(id)) remote.dismissRun(id);
    else session.dismissRun(id);
    res.json({ ok: true });
  });

  // A run's record in the task folder (see ai/record.js), named as GET /api/task lists them.
  app.get('/api/ai/saved/:folder', (req, res) => {
    const space = spaceFrom(req.query);
    const taskDir = taskDirIn(space, String(req.query.rel || ''));
    res.json({ run: record.readRecord(taskDir, String(req.params.folder)) });
  });

  // Remove a record. A pushed copy's is removed by the machine it came from (the next push would
  // bring it back otherwise), and here as well, so it is gone at once.
  app.delete('/api/ai/saved/:folder', async (req, res) => {
    const space = spaceFrom(req.query);
    const rel = String(req.query.rel || '');
    const taskDir = taskDirIn(space, rel);
    const folder = String(req.params.folder);
    const where = locate(space) || {};
    if (where.remote) {
      if (!where.machine) throw httpError(409, 'This folder is a copy pushed without a machine id; its records cannot be removed from here.');
      await remote.forgetRecord(where.machine.name, { work: space.work, repository: space.repository, rel }, folder);
    }
    record.deleteRecord(taskDir, folder);
    res.json({ ok: true });
  });

  return app;
}

// The routes of the runners (ai/runner.js), mounted before the login guard: `auth` is the sync
// app's check of the token and the machine id (server/sync.js), so a runner counts as its machine
// being in touch, as a push does.
function createAiRunnerApp({ auth }) {
  const app = express.Router();
  app.use('/api/sync/ai', auth, (req, res, next) => {
    if (!req.machine) throw httpError(400, 'Missing X-Machine-Id.');
    next();
  });

  // The commands for the machine, as the browsers give them, for as long as the stream is open.
  app.get('/api/sync/ai/commands', (req, res) => {
    let off = () => {};
    const send = eventStream(req, res, () => off());
    off = remote.connect(req.machine, (command) => send('command', command), () => res.end());
  });

  // The events of the machine's session, and its acks, in order.
  app.post('/api/sync/ai/events', express.json({ limit: '50mb' }), (req, res) => {
    const events = (req.body || {}).events;
    if (!Array.isArray(events)) throw httpError(400, 'Missing events.');
    remote.receive(req.machine, events);
    res.json({ ok: true });
  });

  return app;
}

module.exports = { createAiApp, createAiRunnerApp, isRunnerConnected: remote.isConnected };
