
taskmgrd
========

`taskmgrd` runs in the background on the machine that has the tasks. It watches `taskmgr.json` and the  
tasks folder of every work and repository in it, and pushes what changes to a remote tm server (one  
running the web UI). The server merges the pushed `taskmgr.json` into its own `taskmgr.json`, and  
keeps a copy of the tasks under its `data/` folder, laid out like the origins tree:  

```
data/
  origins/
    <origin>/                      "_" for the works without an origin
      <work>/
        tasks/                     the work's common tasks (its tasks_path), the folder as it is
          202508142100 Buy apple/task.txt
          202508142100 Buy apple/receipt.pdf
          done/202508142000 Buy orange/task.txt
        repositories/
          <repository>/            the repository's tasks (its tasks_path, or the tasks folder of its source_path)
            202508142200 Fix mail/task.txt
```

What is pushed: `taskmgr.json` whole when it changes (an invalid one is not pushed; the folders of the  
last good one stay watched), and the tasks of each tasks folder, whenever anything in them changes: every  
task folder right in it and in its `done` / `pending` / `aborted` folders, told by its name alone (a task id,  
12 digits like `202610191522`, with or without a title after a space), whole: every file in it, task file,  
attachments and anything else, subtasks included, and every empty folder. A task folder without a `task.txt`  
gets one first, with the title from its name as its text (empty for a bare id). What is beside the tasks  
is not pushed, nor looked at: a file right in the tasks folder (or in a status folder), and a folder there  
named some other way, whatever is in it. The server brings its copy to the snapshot: a task marked done, pending or aborted (or back to todo) is moved first, then only what differs is written and what is gone removed, so after a push its copy is the tasks  
exactly as they are here, and a renamed, moved or deleted task or attachment is mirrored too. Only `.DS_Store`  
files are left out. Task files go as text; every other file by the sha1 of its content: the daemon asks the  
server which of them it does not have yet and uploads only those, so an unchanged attachment, or the same  
file under a renamed task, is never sent twice (the server keeps them in `data/.sync-blobs/`).  
The server merges a pushed `taskmgr.json` into its own: origins, works and repositories it  
does not have are added, the ones it has take the pushed settings, and the ones it has that were not  
pushed are kept, with their folders (so several machines can push to one server; a work or  
repository renamed or removed on one machine stays on the server until removed there, shown as  
plain "remote" from then on: no longer as that machine's, with its dot). In the  
merged file, the `tasks_path` of every pushed work (that has common tasks) and repository is its  
copy under `data/origins/`, and a repository's `source_path` is left out, so the server's web UI  
shows the pushed tasks. A work pushed without a `tasks_path` has none on the server either: the one  
it had there is dropped, with the copy of its common tasks under `data/origins/`. A tasks  
folder that does not exist is left as it is on the server and looked for every 30 seconds. Changes  
go out 10 seconds after the last of them; at startup the daemon pushes `taskmgr.json` once, and  
at startup and every 5 minutes it asks the server what it has and pushes what differs, and a push  
that fails (the server is down) is retried, with growing waits, until it goes through.  

`.env` says what the daemon does: `PUSHING` and `POLLING`. `PUSHING=1` (on when it is not set) is all of  
the above; `PUSHING=0` turns it off: nothing is watched, nothing pushed, and `tm push` is the way to push.  
With both off, and `AI_RUNNER` off too (below), the daemon has nothing to do and does not start.  

Polling: with `POLLING=1` in `.env`, the daemon pulls too. Every `POLLING_INTERVAL`  
seconds (600, ten minutes, when it is not set) it runs the pull of `tm pull` (see the README: the server's  
`taskmgr.json` merged into this one, every task file and other file of the works and repositories here that  
the server also has added or updated, and the tasks the server deleted since the last sync deleted here),  
so a change made on the server, or pushed to it by another machine, comes here as well. It pulls once  
when it starts, before its first push, so what the server has is taken in first and the push that follows  
sends the folders as merged; after that a pull comes `POLLING_INTERVAL` seconds after the last  
one ended. Before a pull, a change here still waiting out its 10 seconds is looked at and pushed, so it  
reaches the server first. A pull never writes over a change made here: when a folder has one not pushed  
yet (the push failed, or the change came in between), it pulls nothing and says so (see `tm pull` in the  
README), the rescan after it pushes the change, and the next pull goes through. While it runs nothing is  
pushed; after it the server is asked what it has and every folder compared, as at a rescan. The pull's lines go to the  
daemon's `logs/taskmgrd.log`, and a pull that fails is only told there (and in `pm2 logs taskmgrd`):  
the next one comes at the next interval. With `POLLING=0`, or unset, the daemon only pushes,  
and `tm pull` is the way to fetch from the server.  
After each pull the daemon writes how it went to `.tm-poll-state.json` next to `taskmgr.json` (when it ended, whether  
it went through and, if not, the last line of the pull's error), and the web UI on this machine shows that as a dot  
after the server's host at the right end of its status bar: green while the last pull went through within twice  
`POLLING_INTERVAL` (three minutes at least), red when it failed or when none came in time, which means the daemon is  
not running. The tooltip says which, with the time and the error (see `GET /api/polling` in [Server.md](Server.md)).  

Running Claude Code for the server: with `AI_RUNNER=1` in `.env`, the daemon keeps one connection open to the server  
(`GET /api/sync/ai/commands`, see [Server.md](Server.md)) and runs Claude Code here when the server's web UI asks: the  
run button beside the prompt of a task pushed from here starts the run on this machine, where the tasks, the source  
code (a repository's task runs in its `source_path`, as `tm run` does) and the claude login are, with this machine's  
`AI_PERMISSION_MODE`. The transcript goes back to the server as it grows and shows in its dialog as a run of this  
machine does there, with the machine's name; what Claude asks (a permission, a question) is answered in the server's  
browser and comes back the same way. Before the run, the task's `task.txt` and `prompt.txt` as the server has them are  
written here when they differ (a prompt typed in the server's web UI is only in its copy until then; the push that  
follows sends them back), and a task the server has that is not here yet is made here, at the same path. Without the  
daemon, or with `AI_RUNNER` off, the server's run button for this machine's tasks is greyed out and says so; a run  
asked for shows as "waiting for <machine>" until this machine starts it. The runs are kept in this daemon's memory  
(the server shows them again after its own restart, from here): the web UI on this machine, another process, does  
not list them. A run that is over is written into the task folder as `.claude_<time>/` (see the README's `Task folder`)  
and pushed with the task like any file in it, so the server shows it after it is over for as long as the folder is  
there; clearing it in the server's web UI removes it here, through the same connection. What claude writes to stderr goes to `logs/ai.log`, as for the web UI's own runs. Anyone logged in to  
the server's web UI can so run code on this machine, with the permissions above: turn the runner on only for a server  
you trust.  

Watching the runs here: with `AI_RUNNER_WINDOW=1` in `.env` as well, each run opens a terminal window on this machine as it  
starts, which shows the transcript as the server's web UI does, Claude's text as it is written, each tool call with its  
result, what Claude asks (with "waiting for the answer in the web UI of ...", since the answer is still given in the  
server's browser) and the answer when it comes, then how the run ended; Enter closes it. The window is Terminal.app on  
macOS (the first time, macOS asks you to let node control Terminal; a window refused is told in the daemon's log), a new  
console window on Windows, and on Linux the first found of `x-terminal-emulator`, `gnome-terminal`, `konsole`,  
`xfce4-terminal` and `xterm`. It needs the daemon in a session with a display: one started by `./start.sh` from your  
desktop session is; a machine without one logs that no window could be opened and the run goes on as usual. The window  
only shows: nothing is answered in it. Off when not set.  

On the server: set `SYNC_SERVER_TOKEN` in `.env` to a secret of your choice and restart the web UI  
(`./start.sh`); its startup lines then say `sync : receiving from taskmgrd`. Without the token the  
server refuses pushes. The copied files are git-ignored. What each machine pushes and polls is logged  
on the server to `logs/<MACHINE_ID>.log`, in the form of the daemon's own log. Every one of these logs is kept  
under 10 MB: past that, its oldest 2 MB are dropped. A task changed in the server's web UI is  
changed in the copy only: the next push of its folder overwrites it.  

On the machine with the tasks: in `.env`, `SYNC_SERVER` is the server's URL (the one its web UI  
answers at, e.g. `https://tm.example.com`) and `SYNC_SERVER_TOKEN` the same secret; `MACHINE_ID` names  
this machine on the server, where each folder pushed from here is shown as coming from it in place of  
"remote" (any short name; empty, the hostname is sent), with a dot beside it that is green while this machine  
has pushed or polled within the last three minutes and grey otherwise; `PUSHING`  
(default 1), `POLLING` (default 0) and `POLLING_INTERVAL` (seconds, default 600) say what it does (see above).  
`./start.sh` (Windows: `start.bat`) then starts the daemon under pm2 together with the web UI, and `./stop.sh`  
stops both: the two are the apps of `ecosystem.config.cjs`, the daemon only when `SYNC_SERVER` is set, so  
an empty `SYNC_SERVER` is how a machine runs the web UI without the daemon. `start.sh` prints one line on  
what the daemon does; a `.env` that gives it nothing to do (no server, `PUSHING=0` and `POLLING=0`, or a  
`POLLING_INTERVAL` that is not a number of seconds) makes it say so in its log and stop, and pm2 leaves it  
stopped until the next `./start.sh`. The daemon alone, with pm2's own commands (its process is named `taskmgrd`):  

`pm2 logs taskmgrd` follows its log  
`pm2 describe taskmgrd` says whether it runs  
`tm status` says the same for it and the web UI together, in one table (`tm start` / `tm stop` / `tm restart` run `start.sh` / `stop.sh` / `restart.sh` from anywhere)  
`pm2 stop taskmgrd` / `pm2 restart taskmgrd` stop it, or restart it alone (a changed `.env` is read again; `./start.sh` for one that empties or sets `SYNC_SERVER`)  
`pm2 startup` then `pm2 save` make it start with the machine, as the web UI  
`pnpm run daemon` runs it in the foreground without pm2 (Ctrl+C to stop), to see what it does  
`tm push` pushes once, by hand, and exits: `taskmgr.json` and every tasks folder that differs from the server's copy, whether or not the daemon runs (it exits with an error when the server cannot be reached or refuses)  
`tm pull` is the other direction, once: it fetches `taskmgr.json`, the task files and the other files from the server and adds or updates them here, and deletes the tasks the server deleted since the last sync, but no other file (see the README)  

For the API the daemon uses, see [Server.md](Server.md).  
