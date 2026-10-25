// Runs of Claude Code started from the web UI (the run button beside a task's prompt), through the
// Claude Agent SDK, which starts Claude Code itself: the user's claude login and settings apply as in
// the terminal, and the task gets the same first prompt as `tm run` (see ai/task.js).
//
// What the terminal would show goes into the run's transcript, a list of items the browser follows
// live (GET /api/ai/events in server/ai.js streams them): Claude's text as it is written, the tools
// it calls with their results, and the questions it asks. What Claude would ask in the terminal is
// asked in the browser instead: a permission for a tool (file edits are allowed as they come,
// permissionMode acceptEdits; a command and the rest wait for an answer) and a question of Claude's
// own (AskUserQuestion). Each is the run's `pending` until the browser answers it (answerRun), and
// stopping the run (stopRun) refuses it.
//
// One run at a time per task. The runs are kept in memory, the last RUNS_KEPT finished ones too, so a
// transcript can be read again meanwhile; a restart forgets them. A run that is over is also written
// into the task folder, as .claude_<time>/ (see ai/record.js), which goes with the task wherever it is
// synced and is what the web UI shows of it from then on. What claude writes to stderr goes to logs/ai.log.
//
// AI_PERMISSION_MODE in .env picks the permission mode of a run: acceptEdits unless set; `default`
// asks for edits too, `plan` has Claude plan first (the plan is asked about in the browser, as a
// permission for ExitPlanMode), `auto` lets a classifier decide, `bypassPermissions` asks nothing
// (`dontAsk` refuses instead). The allow rules of the user's and the repository's Claude settings
// apply in every mode, as in the terminal.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { TASK_FILE, PROMPT_FILE } = require('../utils/taskUtils');
const { appendLog } = require('../utils/logfile');
const { samePath, describeRun } = require('./task');
const record = require('./record');

const RUNS_KEPT = 20;          // finished runs kept, oldest dropped first
const RESULT_MAX = 4000;       // characters of a tool result kept in the transcript
const SUMMARY_MAX = 4000;      // characters of a tool call's summary (a command, a plan, ...)

// Tools that are a question to the user rather than a call: shown as what they ask (see ask).
const ASKED_TOOLS = ['AskUserQuestion', 'ExitPlanMode'];

const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'];
const DEFAULT_PERMISSION_MODE = 'acceptEdits';

function permissionMode() {
  const mode = String(process.env.AI_PERMISSION_MODE || '').trim();
  return PERMISSION_MODES.includes(mode) ? mode : DEFAULT_PERMISSION_MODE;
}

// The SDK is an ES module: loaded once, when the first run starts.
let sdk = null;
const loadSdk = () => (sdk ||= import('@anthropic-ai/claude-agent-sdk'));

const runs = new Map();        // id -> run, in the order started
const listeners = new Set();   // (event, data) => void, the browsers following the runs
let logFile = null;
let machine = os.hostname();   // this machine, as the records say where a run was (MACHINE_ID when there is one)

function configure({ logFile: file, machine: name }) {
  logFile = file;
  if (name) machine = name;
}

function log(run, text) {
  if (!logFile) return;
  const lines = String(text).replace(/\s+$/, '').split('\n');
  try {
    for (const l of lines) appendLog(logFile, `${new Date().toISOString()} ${run.id} ${l}\n`);
  } catch (e) { /* the log is not worth failing a run */ }
}

function emit(event, data) {
  for (const fn of listeners) {
    try { fn(event, data); } catch (e) { /* a dead listener is removed on close */ }
  }
}

// Follow the runs: fn(event, data) gets every event (see the SSE route); returns the way to stop.
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const newId = () => crypto.randomBytes(6).toString('hex');

// A text file's content, null when there is none.
function readText(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const clip = (s, max) => (s.length > max ? `${s.slice(0, max)}...` : s);

// What a tool call is about, in a line or a few: the command of Bash, the file of an edit, the pattern
// of a search, the plan of ExitPlanMode... else the input as JSON.
function summarizeTool(name, input) {
  const i = input || {};
  const s = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
  let text;
  switch (name) {
    case 'Bash': text = s(i.command); break;
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': text = s(i.file_path); break;
    case 'NotebookEdit': text = s(i.notebook_path); break;
    case 'Glob': case 'Grep': text = [i.pattern, i.path].filter(Boolean).map(s).join('  in  '); break;
    case 'WebFetch': text = s(i.url); break;
    case 'WebSearch': text = s(i.query); break;
    case 'Agent': case 'Task': text = s(i.description || i.prompt); break;
    case 'Skill': text = s(i.skill || i.command); break;
    case 'ExitPlanMode': text = s(i.plan); break;
    case 'TodoWrite': text = ''; break;
    default: text = s(i);
  }
  return clip(text, SUMMARY_MAX);
}

// A run as the browser sees it; with its transcript when `withItems`.
function publicRun(run, withItems = false) {
  const { id, task, cwd, taskDir, status, startedAt, endedAt, error, model, sessionId, cost, billed } = run;
  const pending = run.pending ? { id: run.pending.id, kind: run.pending.kind, i: run.pending.i } : null;
  return { id, task, cwd, taskDir, status, startedAt, endedAt, error, pending, model, sessionId, cost, billed, ...(withItems ? { items: run.items } : {}) };
}

function listRuns(withItems = false) {
  return [...runs.values()].map(r => publicRun(r, withItems));
}

function getRun(id) {
  const run = runs.get(id);
  if (!run) throw httpError(404, 'No such run.');
  return run;
}

// Add an item to the transcript; returns its index.
function addItem(run, item) {
  const i = run.items.length;
  run.items.push(item);
  emit('item', { run: run.id, i, item });
  return i;
}

function setItem(run, i, patch) {
  run.items[i] = { ...run.items[i], ...patch };
  emit('item', { run: run.id, i, item: run.items[i] });
}

// Drop the oldest finished runs over RUNS_KEPT.
function prune() {
  const finished = [...runs.values()].filter(r => r.status !== 'running');
  for (const r of finished.slice(0, Math.max(0, finished.length - RUNS_KEPT))) {
    runs.delete(r.id);
    emit('remove', { run: r.id });
  }
}

const taskKey = (t) => `${t.work}/${t.repository || ''}/${t.rel}`;

// Start Claude Code on the task at taskDir in the space, for the browser to follow. `taskRef` is
// { work, repository, rel } as the task APIs name the task. 409 while the task has a run going.
// `id` names the run when the caller has a name for it already (a run asked for by another tm server,
// see ai/runner.js); else one is made up.
function startRun({ space, taskDir, taskRef, id = null }) {
  const key = taskKey(taskRef);
  for (const r of runs.values()) {
    if (r.status === 'running' && r.key === key) throw httpError(409, 'Claude Code is already running on this task.');
  }
  if (id && runs.has(id)) throw httpError(409, `There is a run ${id} already.`);
  let d;
  try {
    d = describeRun(space, taskDir);
  } catch (e) {
    throw httpError(400, e.message);
  }
  const run = {
    id: id || newId(),
    key,
    task: { ...taskRef, id: d.task.id, title: d.title, key },
    cwd: d.cwd,
    taskDir,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    items: [],
    pending: null,     // { id, kind, i, input, settle(patch, result) } while Claude waits for an answer
    model: null,
    sessionId: null,
    cost: null,        // what the run's tokens would cost at API prices, from the result: an estimate
    billed: false,     // whether that is paid: Claude Code used with an API key, not a claude.ai login
    abort: new AbortController(),
    text: null,        // the index of the text item being streamed, while one is
    done: null,        // resolves the input stream, which ends the session, when the run is over
    files: { [TASK_FILE]: readText(path.join(taskDir, TASK_FILE)), [PROMPT_FILE]: d.prompt },  // the task's own files as they are, for the record
    input: d.text      // the first prompt claude was given, for the record
  };
  runs.set(run.id, run);
  prune();
  emit('run', publicRun(run));
  log(run, `start: ${run.task.id} ${run.task.title} in ${run.cwd} (${permissionMode()})`);
  loop(run, d.text).catch(e => log(run, `loop: ${e.stack || e.message}`));
  return run;
}

// The run is over: its pending question (if any) refused, its status and end set, the run written
// into the task folder (see ai/record.js) and then everyone told, so a browser that re-reads the
// folder on the news finds the record there.
function end(run, status, error = null) {
  if (run.status !== 'running') return;
  if (run.pending) run.pending.settle({ cancelled: true }, { behavior: 'deny', message: 'The run was stopped.' });
  run.status = status;
  run.endedAt = Date.now();
  run.error = error;
  log(run, `end: ${status}${error ? ` (${error})` : ''}`);
  try {
    const folder = record.saveRun(run.taskDir, { ...publicRun(run, true), input: run.input, machine }, run.files);
    log(run, `recorded in ${folder}`);
  } catch (e) {
    log(run, `cannot record the run: ${e.message}`);
  }
  emit('run', publicRun(run));
  if (run.done) run.done();
}

// The session itself: Claude Code started with the prompt as the first (and only) user message, its
// messages read into the transcript until the result.
async function loop(run, prompt) {
  let query;
  try {
    ({ query } = await loadSdk());
  } catch (e) {
    addItem(run, { type: 'error', message: `Cannot load the Claude Agent SDK: ${e.message}` });
    end(run, 'failed', e.message);
    return;
  }

  // Streaming input: the one message, then the stream is kept open until the run is over, since
  // closing it would take back a question still waiting for its answer.
  const finished = new Promise(resolve => { run.done = resolve; });
  async function* input() {
    yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: '' };
    await finished;
  }

  const mode = permissionMode();
  const q = query({
    prompt: input(),
    options: {
      cwd: run.cwd,
      additionalDirectories: samePath(run.cwd, run.taskDir) ? [] : [run.taskDir],
      permissionMode: mode,
      ...(mode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      canUseTool: (name, toolInput, opts) => ask(run, name, toolInput, opts),
      abortController: run.abort,
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      title: `tm ${run.task.id} ${run.task.title}`,
      stderr: (data) => log(run, `claude: ${data}`)
    }
  });

  try {
    for await (const msg of q) handle(run, msg);
    if (run.status === 'running') end(run, 'done');
  } catch (e) {
    if (run.status === 'running') {
      if (run.abort.signal.aborted) {
        end(run, 'stopped');
      } else {
        addItem(run, { type: 'error', message: e.message });
        end(run, 'failed', e.message);
      }
    }
  } finally {
    if (run.done) run.done();
  }
}

// One message of the session into the transcript. Messages of subagents (parent_tool_use_id set) are
// left out: the main agent's tool call stands for them.
function handle(run, msg) {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        run.model = msg.model || null;
        run.sessionId = msg.session_id || null;
        // 'none': no API key, a claude.ai login (the usage counts against the subscription, not in dollars)
        run.billed = !!msg.apiKeySource && msg.apiKeySource !== 'none';
        emit('run', publicRun(run));
      }
      break;
    case 'stream_event':
      if (!msg.parent_tool_use_id) streamEvent(run, msg.event);
      break;
    case 'assistant':
      if (msg.parent_tool_use_id) break;
      for (const block of msg.message?.content || []) {
        if (block.type === 'text') finishText(run, block.text);
        // a question of Claude's own, and a plan to approve, are their own items (see ask), not tool calls
        else if (block.type === 'tool_use' && !ASKED_TOOLS.includes(block.name)) addItem(run, { type: 'tool', id: block.id, name: block.name, summary: summarizeTool(block.name, block.input), done: false });
      }
      break;
    case 'user': {
      if (msg.parent_tool_use_id) break;
      const content = msg.message?.content;
      if (!Array.isArray(content)) break;
      for (const block of content) if (block.type === 'tool_result') toolResult(run, block);
      break;
    }
    case 'result':
      result(run, msg);
      break;
    default:
      break;
  }
}

// Claude's text as it is written: a text item opened when a text block starts, grown by each delta
// (the browser appends it), and set to the whole block when the assistant message delivers it.
function streamEvent(run, ev) {
  if (!ev) return;
  if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
    run.text = addItem(run, { type: 'text', text: ev.content_block.text || '' });
  } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && run.text !== null) {
    run.items[run.text].text += ev.delta.text;
    emit('delta', { run: run.id, i: run.text, text: ev.delta.text });
  }
}

function finishText(run, text) {
  if (run.text !== null) {
    const i = run.text;
    run.text = null;
    if (!text && !run.items[i].text) return;
    setItem(run, i, { text: text || run.items[i].text });
  } else if (text) {
    addItem(run, { type: 'text', text });
  }
}

function toolResult(run, block) {
  const i = run.items.findIndex(it => it.type === 'tool' && it.id === block.tool_use_id);
  if (i < 0) return;
  const c = block.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
  setItem(run, i, { done: true, isError: !!block.is_error, result: clip(text, RESULT_MAX) });
}

function result(run, msg) {
  run.cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null;
  const errors = Array.isArray(msg.errors) ? msg.errors.join('\n') : '';
  addItem(run, {
    type: 'result',
    subtype: msg.subtype,
    isError: !!msg.is_error,
    durationMs: msg.duration_ms,
    turns: msg.num_turns,
    costUsd: run.cost,
    text: errors
  });
  end(run, msg.is_error ? 'failed' : 'done', msg.is_error ? (errors || msg.subtype) : null);
}

// What Claude would ask in the terminal, asked in the browser: the run's pending question, answered
// by answerRun (or refused when the run is stopped). Resolves to the SDK's permission result.
function ask(run, name, input, { signal, decisionReason } = {}) {
  return new Promise((resolve) => {
    const id = newId();
    const question = name === 'AskUserQuestion';
    const i = question
      ? addItem(run, { type: 'question', questions: Array.isArray(input?.questions) ? input.questions : [], answers: null })
      : addItem(run, { type: 'permission', toolName: name, summary: summarizeTool(name, input), reason: decisionReason || '', decision: null });
    const settle = (patch, permission) => {
      if (!run.pending || run.pending.id !== id) return;
      run.pending = null;
      setItem(run, i, patch);
      emit('run', publicRun(run));
      resolve(permission);
    };
    run.pending = { id, kind: question ? 'question' : 'permission', i, input, settle };
    if (signal) signal.addEventListener('abort', () => settle({ cancelled: true }, { behavior: 'deny', message: 'The run was stopped.' }), { once: true });
    emit('run', publicRun(run));
    log(run, `asks: ${name}`);
  });
}

// The browser's answer to the run's pending question `pendingId`: { decision: "allow" | "deny" } for a
// permission, { answers: { "<question>": "<answer>" } } for a question. Answers the run.
function answerRun(id, pendingId, body) {
  const run = getRun(id);
  const p = run.pending;
  if (!p || p.id !== pendingId) throw httpError(409, 'That question is not waiting for an answer any more.');
  if (p.kind === 'question') {
    const answers = body?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers) || !Object.values(answers).every(v => typeof v === 'string')) {
      throw httpError(400, 'Missing answers.');
    }
    p.settle({ answers }, { behavior: 'allow', updatedInput: { questions: run.items[p.i].questions, answers } });
  } else {
    const decision = body?.decision;
    if (decision !== 'allow' && decision !== 'deny') throw httpError(400, 'decision must be "allow" or "deny".');
    p.settle({ decision }, decision === 'allow'
      ? { behavior: 'allow', updatedInput: p.input }
      : { behavior: 'deny', message: 'The user refused this in the tm web UI.' });
  }
  log(run, `answered: ${p.kind}`);
  return run;
}

// Stop a run: Claude Code is interrupted, a pending question refused.
function stopRun(id) {
  const run = getRun(id);
  if (run.status !== 'running') throw httpError(409, 'This run is over.');
  run.abort.abort();
  end(run, 'stopped');
  return run;
}

module.exports = { configure, subscribe, listRuns, publicRun, startRun, answerRun, stopRun, summarizeTool };
