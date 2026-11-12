// Terminal windows on this machine, for what tm does here for the server: opening one that runs a node
// script (a run of Claude Code followed by ai/follow.js, see ai/window.js; a tm command, see
// utils/tmcommand.js), and closing it from inside once that script is through.
//
// Which terminal: on macOS Terminal.app, or iTerm2 with `terminal` "iterm" (AI_RUNNER_TERMINAL=iterm in
// .env), either through osascript, which the first time asks you to let node control the app; a new
// console window on Windows (`start`); and on Linux the first found of x-terminal-emulator,
// gnome-terminal, konsole, xfce4-terminal and xterm.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const LINUX_TERMINALS = [
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['xterm', ['-e']]
];

// Open a terminal window titled `title` running node on `args` (a script and its arguments; `terminal`
// picks the app on macOS, "terminal" or "iterm"); `onError(message)` is told when that fails (now, or
// when the program that opens it says so), once.
function openTerminal(title, args, terminal, onError) {
  let told = false;
  const failed = (message) => { if (!told) { told = true; onError(message); } };
  let child;
  try {
    if (process.platform === 'darwin') child = terminal === 'iterm' ? openITerm(args) : openMac(args);
    else if (process.platform === 'win32') child = openWindows(title, args);
    else child = openLinux(args);
  } catch (e) {
    failed(`cannot open a terminal: ${e.message}`);
    return;
  }
  let stderr = '';
  if (child.stderr) child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  child.on('error', (e) => failed(`cannot open a terminal: ${e.message}`));
  child.on('exit', (code) => {
    if (code) failed(`cannot open a terminal: ${stderr.trim().split('\n').pop() || `exit code ${code}`}`);
  });
  child.unref();
}

const detached = { detached: true, stdio: ['ignore', 'ignore', 'pipe'] };

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// The command a macOS window's shell runs, as an AppleScript string literal's text: the shell is
// replaced by the script, so the window is through when it is.
const macCommand = (args) => `clear; exec ${[process.execPath, ...args].map(shellQuote).join(' ')}`.replace(/[\\"]/g, '\\$&');

// Terminal.app: a new window running the command. Terminal opens a window of its own when it is
// launched, so that one is used then, rather than leaving an idle window beside the run's.
function openMac(args) {
  const script = macCommand(args);
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

// iTerm2: a new window, the command typed into its session's shell as Terminal's is. iTerm too may
// open a window of its own when launched (as its settings say), used then the same way.
function openITerm(args) {
  const script = macCommand(args);
  const lines = [
    'set wasRunning to application "iTerm" is running',
    'tell application "iTerm"',
    'activate',
    'if wasRunning or (count of windows) is 0 then',
    'set w to (create window with default profile)',
    'else',
    'set w to front window',
    'end if',
    `tell current session of w to write text "${script}"`,
    'end tell'
  ];
  return spawn('osascript', lines.flatMap(l => ['-e', l]), detached);
}

// A new console window: `start` gives node one of its own, whether or not the daemon has a console
// (under pm2 it has none; see taskmgrd.js runPull). The script is no child of this process then, but of
// the `cmd` that started it and is gone at once.
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


// Once the script of a window is through (called from that script), the window closes by itself
// `closeAfter` seconds later, counted down on its last line, or on Enter before that; space stops the
// countdown, and the window then stays until Enter, as it does from the start with closeAfter 0. The
// keys are read one by one (raw mode), so ctrl-c closes too. `terminal` is the app the window is on
// macOS (see closeWindow), `dim` paints the line, `dot` is the mark between its two halves. The
// process exits with `code` as the window closes; without a terminal (stdin is not one) at once.
function waitToClose({ closeAfter = 10, terminal = 'terminal', dim = (s) => s, dot = '-', code = 0 } = {}) {
  const stdin = process.stdin;
  if (!stdin.isTTY) process.exit(code);
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
    closeWindow(terminal);
    process.exit(code);
  };
  if (stdin.setRawMode) stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  stdin.on('data', (key) => {
    if (key === '\r' || key === '\n' || key === '\x03' || key === '\x04') close();  // enter, ctrl-c, ctrl-d
    else if (key === ' ') stayOpen();
  });
  if (!(closeAfter > 0)) {
    process.stdout.write(`${dim('Press Enter to close.')}\n`);
    return;
  }
  let left = Math.ceil(closeAfter);
  const show = () => process.stdout.write(`\r\x1b[2K${dim(`Closing in ${left}s ${dot} Enter closes now, space keeps it open.`)}`);
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
// does not ask about a process still running), by its tty; called from the window's own script. Elsewhere the terminal closes with the process.
function closeWindow(terminal = 'terminal') {
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

module.exports = { openTerminal, waitToClose, closeWindow };
