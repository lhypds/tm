// A tm command (`tm restart`, `tm push`...) started from inside a process of tm itself, in a process
// of its own that outlives it: taskmgrd carrying out a command the server's web UI gave its machine
// (the Machines dialog, see ai/runner.js). `tm restart` stops the very process that starts it, and pm2
// kills a stopped app's whole process tree, found by parent pid, so a plain child, detached or not,
// would die half way with it. So the command is started in two steps: this file is run as a go-between
// that starts `node cli.js <command>` detached and exits at once, which leaves the command with no
// parent among tm's processes. What it prints goes to `logFile`, appended, after a line saying what
// was run and when.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The commands that can be run this way: the ones that do their work and exit, without a terminal.
const TM_COMMANDS = ['restart', 'start', 'stop', 'push', 'pull', 'status'];

// The command of a line typed as "/restart" (or "restart"): its name, or null when it is not one of
// TM_COMMANDS, or has arguments.
function tmCommandOf(text) {
  const name = String(text || '').trim().replace(/^\//, '').trim().toLowerCase();
  return TM_COMMANDS.includes(name) ? name : null;
}

// Start `tm <command>` on its own; returns once the go-between is started (the command is then on its
// way: how it ends is in `logFile`). Throws when `command` is not one of TM_COMMANDS.
function startTmCommand(command, logFile) {
  if (!TM_COMMANDS.includes(command)) throw new Error(`"${command}" is not a tm command that can be run this way (${TM_COMMANDS.join(', ')}).`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const child = spawn(process.execPath, [__filename, command, logFile], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});  // told by the log not growing; nothing to do about it here
  child.unref();
}

// The go-between: `node utils/tmcommand.js <command> <logFile>`.
if (require.main === module) {
  const [command, logFile] = process.argv.slice(2);
  if (!TM_COMMANDS.includes(command) || !logFile) process.exit(2);
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `${new Date().toISOString()} tm ${command}\n`);
  const child = spawn(process.execPath, [path.join(ROOT, 'cli.js'), command], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.on('error', (e) => {
    try { fs.writeSync(out, `cannot start tm ${command}: ${e.message}\n`); } catch (err) { /* nowhere to say it */ }
    process.exit(1);
  });
  child.on('spawn', () => {
    child.unref();
    process.exit(0);
  });
}

module.exports = { TM_COMMANDS, tmCommandOf, startTmCommand };
