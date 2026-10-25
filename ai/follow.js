#!/usr/bin/env node
// The terminal window of a run of Claude Code the runner does for the server (opened by ai/window.js):
// under a banner of three lines like Claude Code's own ("tm" with the version, the task's folder and
// the working directory) and the run's details, follows the file the run's events are appended to and
// prints the transcript, under the title the web UI's run dialog has ("Claude: " and the task), as the
// web UI shows it, Claude's text as it is written, each tool call with its result, what Claude asks and the
// answer that comes from the server's browser, and the result; then says how the run ended, removes
// the file, and closes the window a few seconds later (`closeAfter` of the file's meta line, counted
// down; 0 keeps it) or on Enter; space stops the countdown.
//
//   node ai/follow.js <file>       <tmpdir>/tm-runs/<run id>.jsonl: one JSON line per event (see ai/window.js)
const fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { formatDateTime } = require('../utils/taskUtils');
const { version } = require('../package.json');

const POLL_MS = 150;        // how often the file is looked at
const RESULT_LINES = 10;    // lines of a tool result shown
const SUMMARY_LINES = 20;   // lines of a tool call's summary shown (a long command, a plan)
const OPEN_MS = 10 * 1000;  // how long to wait for the file to appear
const CLOSE_S = 10;         // seconds the window stays after the run, unless the meta line says otherwise

const file = process.argv[2];
if (!file) {
  console.error('usage: node ai/follow.js <file>');
  process.exit(2);
}

// ---------- output ----------

const tty = !!process.stdout.isTTY;
const color = tty && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint(1), dim = paint(2), red = paint(31), green = paint(32), yellow = paint(33), cyan = paint(36);
// The green of the "tm" at the top, #63EF3F, as a true color where the terminal has them (iTerm2 and
// most others say so with COLORTERM, Windows Terminal with WT_SESSION); the bright green elsewhere.
const trueColor = /^(truecolor|24bit)$/i.test(process.env.COLORTERM || '') || !!process.env.WT_SESSION;
const phosphor = paint(trueColor ? '38;2;99;239;63' : 92);
// Plain marks for a Windows console that may lack the glyphs (Windows Terminal has them).
const M = process.platform === 'win32' && !process.env.WT_SESSION
  ? { tool: '>', ok: 'ok', bad: 'x', arrow: '->', dot: '-', more: '...' }
  : { tool: '▸', ok: '✓', bad: '✗', arrow: '→', dot: '·', more: '…' };

process.stdout.on('error', () => process.exit(0));

let atLineStart = true;   // the next character begins a line
let lastLineEmpty = true; // the last line finished was empty
let lineLength = 0;

function write(s) {
  if (!s) return;
  process.stdout.write(s);
  for (const ch of s) {
    if (ch === '\n') { lastLineEmpty = lineLength === 0; lineLength = 0; } else lineLength++;
  }
  atLineStart = s.endsWith('\n');
}

const nl = () => { if (!atLineStart) write('\n'); };
const line = (s = '') => { nl(); write(`${s}\n`); };
const gap = () => { nl(); if (!lastLineEmpty) write('\n'); };

const lines = (s) => String(s || '').replace(/\s+$/, '').split('\n');

// A text in a block under a line: `max` lines at most, indented and dim.
function block(all, max, indent = '    ') {
  for (const l of all.slice(0, max)) line(dim(indent + l));
  if (all.length > max) line(dim(`${indent}${M.more} ${all.length - max} more lines`));
}

function duration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ---------- the transcript ----------

let server = '';
let machine = '';
let terminal = 'terminal'; // the app this window is, on macOS: "terminal" (Terminal.app) or "iterm"
let closeAfter = CLOSE_S;  // seconds the window stays after the run (0: until Enter)
let run = null;          // the run as last told
let modelShown = false;
let titleShown = false;  // the "Claude: ..." title over the transcript has been printed
let pendingShown = null; // the pending question the waiting line was printed for
const state = [];        // i -> { opened, printed (characters of a text item written), done }
let finished = false;

// A detail of the run: its name, dim, then the value.
const field = (label, value) => line(`${dim(`${label}:`)} ${value}`);

// At the first word of the run, as Claude Code opens: "tm" with the version, then the run's details
// one under another, the task's folder and the working directory first.
function header(r) {
  const t = r.task || {};
  const name = [t.id, t.title].filter(Boolean).join(' ');
  if (tty) process.stdout.write(`\x1b]0;tm ${name}\x07`);
  line(`${bold(phosphor('tm'))} ${dim(`v${version}`)}`);
  field('task path', r.taskDir || name);
  field('working directory', r.cwd || '');
  if (machine) field('machine', machine);
  if (server) field('server', server);
  field('started', formatDateTime(r.startedAt || Date.now()));
}

// Before the first item of the transcript, the title the web UI's run dialog has: "Claude: " and the
// task's title.
function title() {
  if (titleShown) return;
  titleShown = true;
  const t = (run && run.task) || {};
  gap();
  line(bold(`Claude: ${t.title || t.id || ''}`));
}

function onRun(r) {
  if (!r || typeof r !== 'object') return;
  const first = !run;
  run = r;
  if (first) header(r);
  if (r.model && !modelShown) {
    modelShown = true;
    field('model', r.model);
  }
  if (r.pending && pendingShown !== r.pending.id) {
    pendingShown = r.pending.id;
    line(dim(`  waiting for the answer in the web UI of ${server || 'the server'}${M.more}`));
  }
  if (r.status !== 'running') finish(r);
}

// A tool call's summary: its first line beside the name, the rest in a block.
function summary(item) {
  const all = lines(item.summary);
  return { head: all[0] || '', rest: all.slice(1) };
}

function onItem(i, item) {
  if (!item || !Number.isInteger(i) || i < 0) return;
  title();
  const s = state[i] || (state[i] = { opened: false, printed: 0, done: false });
  switch (item.type) {
    case 'text': {
      const text = item.text || '';
      if (!s.opened) { s.opened = true; gap(); }
      if (text.length > s.printed) { write(text.slice(s.printed)); s.printed = text.length; }
      break;
    }
    case 'tool': {
      if (!s.opened) {
        s.opened = true;
        const { head, rest } = summary(item);
        gap();
        line(`${cyan(M.tool)} ${bold(item.name)}  ${head}`);
        block(rest, SUMMARY_LINES);
      }
      if (item.done && !s.done) {
        s.done = true;
        line(item.isError ? red(`  ${M.bad}`) : green(`  ${M.ok}`));
        if (item.result) block(lines(item.result), RESULT_LINES);
      }
      break;
    }
    case 'permission': {
      if (!s.opened) {
        s.opened = true;
        const { head, rest } = summary(item);
        gap();
        line(`${yellow('? Permission')}  ${bold(item.toolName)}  ${head}`);
        block(rest, SUMMARY_LINES);
        if (item.reason) line(dim(`  ${item.reason}`));
      }
      if (!s.done && (item.cancelled || item.decision)) {
        s.done = true;
        line(`  ${M.arrow} ${item.cancelled ? dim('cancelled') : item.decision === 'allow' ? green('allowed') : red('denied')}`);
      }
      break;
    }
    case 'question': {
      const questions = Array.isArray(item.questions) ? item.questions : [];
      if (!s.opened) {
        s.opened = true;
        gap();
        for (const q of questions) {
          line(`${yellow('? Question')}  ${q.question || ''}`);
          for (const o of q.options || []) line(dim(`    ${M.dot} ${o.label}${o.description ? `  ${o.description}` : ''}`));
        }
      }
      if (!s.done && (item.cancelled || item.answers)) {
        s.done = true;
        if (item.cancelled) line(`  ${M.arrow} ${dim('cancelled')}`);
        else for (const q of questions) line(`  ${M.arrow} ${bold((item.answers || {})[q.question] || '')}`);
      }
      break;
    }
    case 'result': {
      if (s.opened) break;
      s.opened = true;
      gap();
      if (item.isError) {
        line(red(`${M.bad} ${item.text || item.subtype || 'error'}`));
      } else {
        const parts = [duration(item.durationMs)];
        if (typeof item.turns === 'number') parts.push(`${item.turns} turn${item.turns === 1 ? '' : 's'}`);
        if (run && run.billed && typeof item.costUsd === 'number') parts.push(`$${item.costUsd.toFixed(2)}`);
        line(green(`${M.ok} ${parts.join(` ${M.dot} `)}`));
      }
      break;
    }
    case 'error':
      if (s.opened) break;
      s.opened = true;
      gap();
      line(red(`Error: ${item.message || ''}`));
      break;
    default:
      break;
  }
}

function onDelta(i, text) {
  const s = state[i];
  if (!s || typeof text !== 'string') return;
  write(text);
  s.printed += text.length;
}

function handle(msg) {
  const { event, data } = msg || {};
  switch (event) {
    case 'meta':
      server = String((data && data.server) || '');
      machine = String((data && data.machine) || '');
      terminal = String((data && data.terminal) || 'terminal');
      if (data && Number.isFinite(data.closeAfter) && data.closeAfter >= 0) closeAfter = data.closeAfter;
      break;
    case 'run': onRun(data); break;
    case 'item': if (data) onItem(data.i, data.item); break;
    case 'delta': if (data) onDelta(data.i, data.text); break;
    default: break;
  }
}

// ---------- the end ----------

function cleanup() {
  if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* closed */ } fd = null; }
  try { fs.unlinkSync(file); } catch (e) { /* gone, or removed by the daemon */ }
}

function finish(r) {
  finished = true;
  clearInterval(timer);
  gap();
  if (r.status === 'done') line(green('Run done.'));
  else if (r.status === 'stopped') line(yellow('Run stopped.'));
  else line(red(`Run ${r.status || 'failed'}${r.error ? `: ${r.error}` : '.'}`));
  cleanup();
  if (!process.stdin.isTTY) process.exit(0);
  waitToClose();
}

// After the run, the window closes by itself `closeAfter` seconds later, counted down on its last
// line, or on Enter before that; space stops the countdown, and the window then stays until Enter,
// as it does from the start with closeAfter 0. The keys are read one by one (raw mode), so ctrl-c
// closes too.
function waitToClose() {
  const stdin = process.stdin;
  let countdown = null;
  const stayOpen = () => {
    if (!countdown) return;
    clearInterval(countdown);
    countdown = null;
    process.stdout.write(`\r\x1b[2K${dim('Press Enter to close.')}`);
  };
  const close = () => {
    if (countdown) clearInterval(countdown);
    if (stdin.setRawMode) stdin.setRawMode(false);
    closeWindow();
    process.exit(0);
  };
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdin.on('data', (key) => {
    if (key === '\r' || key === '\n' || key === '\x03' || key === '\x04') close();  // enter, ctrl-c, ctrl-d
    else if (key === ' ') stayOpen();
  });
  if (!(closeAfter > 0)) {
    line(dim('Press Enter to close.'));
    return;
  }
  let left = Math.ceil(closeAfter);
  const show = () => process.stdout.write(`\r\x1b[2K${dim(`Closing in ${left}s ${M.dot} Enter closes now, space keeps it open.`)}`);
  nl();
  show();
  countdown = setInterval(() => {
    if (--left > 0) { show(); return; }
    process.stdout.write('\n');
    close();
  }, 1000);
}

// On macOS the window is Terminal.app's or iTerm2's (`terminal`). Terminal keeps a window whose
// process ended ("[Process completed]", by default) rather than closing it, and iTerm2 may be set to
// (its profile's "after a session ends"): it is closed from here, once this process is gone (so the app
// does not ask about a process still running), by its tty. Elsewhere the terminal closes with the process.
function closeWindow() {
  if (process.platform !== 'darwin') return;
  let tty;
  try {
    tty = execFileSync('tty', { stdio: ['inherit', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return;
  }
  if (!/^\/dev\/[\w/]+$/.test(tty)) return;
  const script = terminal === 'iterm' ? [
    'delay 0.3',
    'tell application "iTerm"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'repeat with s in sessions of t',
    `if tty of s is "${tty}" then close s`,
    'end repeat',
    'end repeat',
    'end repeat',
    'end tell'
  ] : [
    'delay 0.3',
    'tell application "Terminal"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    `if tty of t is "${tty}" then close t`,
    'end repeat',
    'end repeat',
    'end tell'
  ];
  try {
    spawn('osascript', script.flatMap(l => ['-e', l]), { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { /* the window stays */ }
}

function fail(message) {
  clearInterval(timer);
  line(red(message));
  if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* closed */ } }
  process.exit(1);
}

// ---------- following the file ----------

let fd = null;
let pos = 0;
let buf = '';
const decoder = new StringDecoder('utf8');
const began = Date.now();

function tick() {
  if (fd === null) {
    try {
      fd = fs.openSync(file, 'r');
    } catch (e) {
      if (e.code !== 'ENOENT') fail(`Cannot read ${file}: ${e.message}`);
      else if (Date.now() - began > OPEN_MS) fail(`No such file: ${file}`);
      return;
    }
  }
  let size;
  try {
    size = fs.fstatSync(fd).size;
  } catch (e) {
    return fail(`Cannot read ${file}: ${e.message}`);
  }
  if (size <= pos) return;
  const chunk = Buffer.alloc(size - pos);
  const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
  pos += n;
  buf += decoder.write(chunk.subarray(0, n));
  let i;
  while (!finished && (i = buf.indexOf('\n')) >= 0) {
    const text = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!text.trim()) continue;
    let msg;
    try { msg = JSON.parse(text); } catch (e) { continue; }
    handle(msg);
  }
}

const timer = setInterval(tick, POLL_MS);
tick();
