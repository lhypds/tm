// A window on this machine for each run of Claude Code the runner does for the server (ai/runner.js;
// AI_RUNNER_WINDOW=1 in .env, see taskmgrd.js): a terminal opened as the run starts, which shows the
// transcript as it grows, the way the server's web UI does, and says when the run is over. Without
// it the runner's runs are seen in the server's browser alone: this is for whoever sits at the machine
// where the run is.
//
// The window is a terminal running ai/follow.js on a file the session's events for the run are
// appended to as they happen, one JSON line each ({ event, data }, as the web UI's event stream has
// them, see server/ai.js), in <tmpdir>/tm-runs/<run id>.jsonl; the first line (`meta`) names the server
// and this machine. follow.js removes the file when it is through; one it never read (no terminal
// could be opened) is removed here a minute after the run.
//
// Which terminal: Terminal.app on macOS (through osascript, which the first time asks you to let node
// control Terminal), a new console window on Windows (`start`), and on Linux the first found of
// x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal and xterm. A window that cannot be
// opened (no display, no terminal found, permission refused) is told in the daemon's log, and the run
// goes on as it would without one.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(os.tmpdir(), 'tm-runs');
const CLEANUP_MS = 60 * 1000;   // a run's file is removed this long after the run, should follow.js not have
const FOLLOW = path.join(__dirname, 'follow.js');
const LINUX_TERMINALS = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['xterm', ['-e']]
];

// Follow the runs of `session` (ai/session.js): a window for each as it starts. `server` is the tm
// server the runner works for and `machine` this machine's name, both shown in the window; log and
// warn the daemon's. Returns the way to stop following (the windows open stay).
function watchRuns(session, { server, machine, log, warn }) {
  const open = new Map();   // run id -> { file, stream }

  function start(run) {
    let stream;
    const file = path.join(DIR, `${run.id}.jsonl`);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ event: 'meta', data: { server, machine } }) + '\n');
      stream = fs.createWriteStream(file, { flags: 'a' });
      stream.on('error', (e) => warn(`runner: window of run ${run.id}: cannot write ${file}: ${e.message}`));
    } catch (e) {
      warn(`runner: window of run ${run.id}: cannot write ${file}: ${e.message}`);
      return null;
    }
    openTerminal(`tm ${run.task.id} ${run.task.title}`, file, (error) => warn(`runner: window of run ${run.id}: ${error}`));
    log(`runner: run ${run.id}: window opened (${file})`);
    return { file, stream };
  }

  const off = session.subscribe((event, data) => {
    if (!data) return;
    const id = event === 'run' ? data.id : data.run;
    let w = open.get(id);
    if (!w) {
      if (event !== 'run' || data.status !== 'running') return;
      w = start(data);
      if (!w) return;
      open.set(id, w);
    }
    // Serialized now: the session hands out its items by reference and grows a text item afterwards.
    w.stream.write(JSON.stringify({ event, data }) + '\n');
    if (event === 'run' && data.status !== 'running') {
      open.delete(id);
      w.stream.end();
      setTimeout(() => fs.rm(w.file, { force: true }, () => {}), CLEANUP_MS).unref();
    }
  });
  return off;
}

// Open a terminal window titled `title` running follow.js on `file`; `onError(message)` is told when
// that fails (now, or when the program that opens it says so).
function openTerminal(title, file, onError) {
  const args = [FOLLOW, file];
  let child;
  try {
    if (process.platform === 'darwin') child = openMac(args);
    else if (process.platform === 'win32') child = openWindows(title, args);
    else child = openLinux(args);
  } catch (e) {
    onError(`cannot open a terminal: ${e.message}`);
    return;
  }
  let stderr = '';
  if (child.stderr) child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  child.on('error', (e) => onError(`cannot open a terminal: ${e.message}`));
  child.on('exit', (code) => {
    if (code) onError(`cannot open a terminal: ${stderr.trim().split('\n').pop() || `exit code ${code}`}`);
  });
  child.unref();
}

const detached = { detached: true, stdio: ['ignore', 'ignore', 'pipe'] };

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Terminal.app: a new window running the command. Terminal opens a window of its own when it is
// launched, so that one is used then, rather than leaving an idle window beside the run's.
function openMac(args) {
  const cmd = `clear; exec ${[process.execPath, ...args].map(shellQuote).join(' ')}`;
  const script = cmd.replace(/[\\"]/g, '\\$&');
  const lines = [
    'set wasRunning to application "Terminal" is running',
    'tell application "Terminal"',
    'activate',
    'if wasRunning or (count of windows) is 0 then',
    `do script "${script}"`,
    'else',
    `do script "${script}" in front window`,
    'end if',
    'end tell'
  ];
  return spawn('osascript', lines.flatMap(l => ['-e', l]), detached);
}

// A new console window: `start` gives node one of its own, whether or not the daemon has a console
// (under pm2 it has none; see taskmgrd.js runPull).
function openWindows(title, args) {
  const q = (s) => `"${String(s).replace(/"/g, '')}"`;
  const command = `start ${q(title)} ${q(process.execPath)} ${args.map(q).join(' ')}`;
  return spawn('cmd.exe', ['/d', '/c', command], { ...detached, windowsVerbatimArguments: true, windowsHide: true });
}

function openLinux(args) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('no display (DISPLAY and WAYLAND_DISPLAY are not set)');
  for (const [name, flags] of LINUX_TERMINALS) {
    const bin = inPath(name);
    if (bin) return spawn(bin, [...flags, process.execPath, ...args], detached);
  }
  throw new Error(`no terminal found (${LINUX_TERMINALS.map(t => t[0]).join(', ')})`);
}

function inPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch (e) { /* not here */ }
  }
  return null;
}

module.exports = { watchRuns, DIR };
