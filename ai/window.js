// A window on this machine for each run of Claude Code the runner does for the server (ai/runner.js;
// AI_RUNNER_WINDOW=1 in .env, see taskmgrd.js): a terminal opened as the run starts, which shows the
// transcript as it grows, the way the server's web UI does, and says when the run is over. Without
// it the runner's runs are seen in the server's browser alone: this is for whoever sits at the machine
// where the run is.
//
// The window is a terminal running ai/follow.js on a file the session's events for the run are
// appended to as they happen, one JSON line each ({ event, data }, as the web UI's event stream has
// them, see server/ai/ai.js), in <tmpdir>/tm-runs/<run id>.jsonl; the first line (`meta`) names the server
// and this machine, which terminal the window is (`terminal`, so follow.js can close it) and how many
// seconds it stays after the run (`closeAfter`). follow.js removes the file when it is through; one it
// never read (no terminal could be opened) is removed here a minute after the run.
//
// Which terminal, and how it is opened: utils/terminal.js. A window that cannot be opened (no display, no
// terminal found, permission refused) is told in the daemon's log, and the run goes on as it would
// without one.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openTerminal } = require('../utils/terminal');

const DIR = path.join(os.tmpdir(), 'tm-runs');
const CLEANUP_MS = 60 * 1000;   // a run's file is removed this long after the run, should follow.js not have
const FOLLOW = path.join(__dirname, 'follow.js');

// Follow the runs of `session` (ai/session.js): a window for each as it starts. `server` is the tm
// server the runner works for and `machine` this machine's name, both shown in the window; log and
// warn the daemon's. `terminal` is which terminal on macOS ("terminal", Terminal.app, or "iterm") and
// `closeAfter` the seconds the window stays after the run before closing by itself (0: until Enter).
// Returns the way to stop following (the windows open stay).
function watchRuns(session, { server, machine, log, warn, terminal = 'terminal', closeAfter = 10 }) {
  const open = new Map();   // run id -> { file, stream }

  function start(run) {
    let stream;
    const file = path.join(DIR, `${run.id}.jsonl`);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ event: 'meta', data: { server, machine, terminal, closeAfter } }) + '\n');
      stream = fs.createWriteStream(file, { flags: 'a' });
      stream.on('error', (e) => warn(`runner: window of run ${run.id}: cannot write ${file}: ${e.message}`));
    } catch (e) {
      warn(`runner: window of run ${run.id}: cannot write ${file}: ${e.message}`);
      return null;
    }
    openTerminal(`tm ${[run.task.id, run.task.title].filter(Boolean).join(' ')}`, [FOLLOW, file], terminal, (error) => warn(`runner: window of run ${run.id}: ${error}`));
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

module.exports = { watchRuns, DIR };
