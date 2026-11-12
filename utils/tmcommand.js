// A tm command (`tm restart`, `tm push`...) started from inside a process of tm itself, in a process
// of its own that outlives it: taskmgrd carrying out a command the server's web UI gave its machine
// (the Machines dialog, see ai/runner.js). `tm restart` stops the very process that starts it, and pm2
// kills a stopped app's whole process tree, found by parent pid, so a plain child, detached or not,
// would die half way with it. So the command is never a child of the process that asks for it:
//
//   - on macOS and Windows it runs in a terminal window opened for it (utils/terminal.js), which shows
//     what the command prints as it goes, says how it ended and closes a while later: this file run
//     with --show, by the terminal;
//   - elsewhere, or when no window can be opened, in the background: this file run as a go-between
//     that starts the command detached and exits at once, which leaves it with no parent among tm's
//     processes.
//
// Either way the command itself is `node cli.js <command>`, writing to `logFile` (appended, after a
// line saying what was run and when), and the window only follows that file. On macOS the command is
// detached from the window, so closing the window does not stop it; on Windows it shares the window's
// console (detached, each console program it starts would open a blank window of its own), so closing
// the window ends it.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const ROOT = path.join(__dirname, '..');
const POLL_MS = 150;   // how often the window looks at the log

// The commands that can be run this way: the ones that do their work and exit, without a terminal.
const TM_COMMANDS = ['restart', 'start', 'stop', 'push', 'pull', 'status'];

// The command of a line typed as "/restart" (or "restart"): its name, or null when it is not one of
// TM_COMMANDS, or has arguments.
function tmCommandOf(text) {
  const name = String(text || '').trim().replace(/^\//, '').trim().toLowerCase();
  return TM_COMMANDS.includes(name) ? name : null;
}

// Start `tm <command>` on its own; returns once it is on its way (how it ends is in `logFile`).
// `terminal` is which terminal the window is on macOS ("terminal" or "iterm") and `closeAfter` the
// seconds it stays after the command (0: until Enter); `warn(message)` is told when no window could
// be opened (the command then runs in the background). Throws when `command` is not one of TM_COMMANDS.
function startTmCommand(command, logFile, { terminal = 'terminal', closeAfter = 10, warn = () => {} } = {}) {
  if (!TM_COMMANDS.includes(command)) throw new Error(`"${command}" is not a tm command that can be run this way (${TM_COMMANDS.join(', ')}).`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const background = () => {
    const child = spawn(process.execPath, [__filename, command, logFile], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => warn(`tm ${command}: cannot start it: ${e.message}`));
    child.unref();
  };
  if (process.platform !== 'darwin' && process.platform !== 'win32') return background();
  const { openTerminal } = require('./terminal');
  openTerminal(`tm ${command}`, [__filename, '--show', command, logFile, terminal, String(closeAfter)], terminal, (error) => {
    warn(`tm ${command}: ${error}; running it in the background`);
    background();
  });
}

// The command itself, appending to the log (the file `out` is open on).
function spawnCommand(command, out, detached = true) {
  fs.writeSync(out, `${new Date().toISOString()} tm ${command}\n`);
  return spawn(process.execPath, [path.join(ROOT, 'cli.js'), command], { cwd: ROOT, detached, stdio: ['ignore', out, out], windowsHide: true });
}

// The go-between: `node utils/tmcommand.js <command> <logFile>`.
function goBetween(command, logFile) {
  const out = fs.openSync(logFile, 'a');
  const child = spawnCommand(command, out);
  child.on('error', (e) => {
    try { fs.writeSync(out, `cannot start tm ${command}: ${e.message}\n`); } catch (err) { /* nowhere to say it */ }
    process.exit(1);
  });
  child.on('spawn', () => {
    child.unref();
    process.exit(0);
  });
}

// The window: `node utils/tmcommand.js --show <command> <logFile> [terminal] [closeAfter]`. Starts the
// command and prints what it appends to the log, then how it ended, and closes the window.
function show(command, logFile, terminal = 'terminal', closeAfter = 10) {
  const { waitToClose } = require('./terminal');
  const color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const bold = paint(1), dim = paint(2), red = paint(31), green = paint(32);
  process.stdout.on('error', () => process.exit(0));  // the window was closed: the command goes on

  const out = fs.openSync(logFile, 'a');
  let pos = fs.fstatSync(out).size;   // what the log had before is not this command's
  const child = spawnCommand(command, out, process.platform !== 'win32');
  pos = Math.min(fs.fstatSync(out).size, pos + Buffer.byteLength(`${new Date().toISOString()} tm ${command}\n`));
  process.stdout.write(`${bold(`tm ${command}`)}\n\n`);

  let last = '\n';
  const read = fs.openSync(logFile, 'r');
  const buf = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  const pump = () => {
    for (;;) {
      let n = 0;
      try { n = fs.readSync(read, buf, 0, buf.length, pos); } catch (e) { return; }
      if (!n) return;
      pos += n;
      const text = decoder.write(buf.subarray(0, n));
      if (!text) continue;
      last = text.slice(-1);
      process.stdout.write(text);
    }
  };
  const timer = setInterval(pump, POLL_MS);
  const end = (code, message) => {
    clearInterval(timer);
    pump();
    process.stdout.write(`${last === '\n' ? '' : '\n'}\n${message}\n`);
    waitToClose({ closeAfter, terminal, dim, dot: process.platform === 'win32' && !process.env.WT_SESSION ? '-' : '·', code });
  };
  child.on('error', (e) => end(1, red(`Cannot start tm ${command}: ${e.message}`)));
  child.on('exit', (code, signal) => end(code || (signal ? 1 : 0), code === 0 ? green(`tm ${command} done.`) : red(`tm ${command} failed (${signal || `exit code ${code}`}).`)));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const shown = args[0] === '--show';
  const [command, logFile, terminal, closeAfter] = shown ? args.slice(1) : args;
  if (!TM_COMMANDS.includes(command) || !logFile) process.exit(2);
  if (shown) show(command, logFile, terminal === 'iterm' ? 'iterm' : 'terminal', Number(closeAfter) >= 0 ? Number(closeAfter) : 10);
  else goBetween(command, logFile);
}

module.exports = { TM_COMMANDS, tmCommandOf, startTmCommand };
