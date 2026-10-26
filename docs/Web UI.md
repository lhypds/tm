
Web UI
======

A React app (Vite + Express) over the same task folders, in a plain black-and-white style.  
It manages several *works*, each with common tasks and any number of *repositories*:  

```
work
  repository
    task
```

It is one page: that tree on the left (a drawer that folds away; on a narrow window, a phone, it and the Task panel start closed), the tasks of the chosen work  
(its common tasks) or repository on the right, to list, filter, add, edit, mark done, pending or aborted,  
delete, and open subtasks and attachments. Above the list, the "done", "pending" and "aborted" boxes take  
the done, the pending and the aborted tasks out of the list and back (the progress view always has its  
todo, done and pending columns; its "aborted" box shows and hides the aborted column); the mouse wheel over the list moves the selection, as in the terminal. A subtask is a task inside a task (a task folder in  
the task's own folder); the list is a tree like the one on the left, each subtask under its task  
with tree lines before its title. With a task selected, "New task" (and `a` / `n`) adds a subtask  
of it (the button says "New subtask"); `esc` drops the selection (a click on the blank area keeps it),  
and then they add a task at the top. A search or filter keeps a task whose subtask matches. In  
the progress view a task's card sits in the column of its status with its subtasks' cards under  
it as the same tree, a subtask whose status differs from the column shown in grey. `tab` (or `h` at the top of a task list) moves the  
keyboard to the tree, `l` / `enter` back to the tasks.  
The Task panel on the right shows the selected task's `task.txt`, editable in place (saved when the text loses the focus, on ⌘S / Ctrl+S or `esc`; ⌘Z / Ctrl+Z and ⌘⇧Z / Ctrl+Y undo and redo, as in any text field), with a folder button at the top right that opens the task's folder in the OS file manager (as the row's and the preview's do), the brain and delete beside it, and its attachments under it. The brain button there shows the task's prompt, its `prompt.txt` (a prompt for an AI agent working on the task), under the text and its attachments, past a divider that says "Prompt" and carries the prompt's own delete: typing a prompt creates the file, emptying or deleting it removes it. The panel is then two parts of the same height, the task's (its text, then its files) and the prompt's. Whether the prompt is shown is kept across sessions, as the panes are, and deleting the prompt hides it again; the brain shows a dot while the task has a prompt.txt, shown or hidden. The task preview (`space`) has a brain of its own at its top left, showing the prompt under the text the same way (apart from the panel's); a double click on either text (or `e` / `i`, on the one `j` / `k` chose: they walk the task's text, the prompt when shown, then the files, with nothing chosen until the first press; the text chosen is shaded as a chosen file's row is) edits it, with the prompt's own delete above the prompt, as on the panel (`d` on the prompt asks before deleting it too). With the prompt shown, `j` / `k` on the panel move between the text, the attachments and the prompt (the highlight on the "Task" head or the "Prompt" divider says which); `enter`, `e` or `i` edit the text chosen, and `d` on the prompt asks before deleting it. An attachment opened from the panel or the preview (`space` / `enter` on the file chosen, or a click) is shown in the page: a PDF, an image, or a text file (txt, md, ...) in the font and over the grid the task's text has, editable the same way (a double click, or `e` / `i`), written as typed when the edit ends. Beside its name are download and delete (`d` deletes too): it asks first, and the preview closes once the file is gone.  
The "Prompt" divider also carries a run button, at the left of its delete, greyed out until the task has a prompt: it starts Claude Code on the task, as `tm run` does in the terminal (the same first prompt, the same folder; see [Commands.md](Commands.md)), through the Claude Agent SDK on the server's machine, with the login and the settings of the user the server runs as. The run then opens in a dialog like the task preview's, titled "Claude: " and the task, with the run's state at its top right: Claude's text as it is written, the tools it calls (a click on one shows its output), at the end its time and turns (and its cost, only when Claude Code is used with an API key: with a claude.ai login the usage counts against the subscription and no figure is shown, as in the terminal), and what it asks, answered right there instead of in a terminal: a permission for a tool, with allow and deny (file edits are allowed as they come, see `AI_PERMISSION_MODE` in `.env`), or a question of Claude's own, with its options and a line for an answer of one's own. The state says "waiting for your answer" meanwhile, and a toast says so whatever task is shown. The dialog closes with `esc` or its `×` while the run goes on; the run button shows a dot while the task has a run going and opens its dialog again; once the run is over the dot goes, and the next click starts a new run (the past runs are listed under the prompt, see below). At the dialog's top left: stop, while the run goes; greyed out after, and for a past run. The runs are kept by the server, the last twenty finished ones too, until it restarts; every browser that is logged in sees them and may answer. One run at a time per task. A run that is over is also written into the task folder, as a `.claude_<time>` folder (the run with its transcript, the prompt as it was, and a readable transcript; see [Task file.md](Task%20file.md)), which is synced with the task: the records are listed under the prompt's text, as the files are under the task's ("Runs": when each run was, how it went and on which machine), newest first: a click on one opens it in the dialog, whatever run is going, with when it was after its state, so a run can be read again after a restart, on the server the task is pushed to, or on another machine the task is pulled to; its × removes it, after asking (for a pushed copy, on the machine it came from too). On the panel, `j` / `k` walk down to them after the prompt, as they walk the files; `space` or `enter` on the one chosen opens it in the dialog, where `space` or `q` closes it again and `j` / `k` step to the next or previous record, and `d` removes it, after asking. The list is re-read when a run ends and when the dialog closes (and with the page's periodic reload, which brings a record pushed from another machine). A task of a folder pushed from another machine by its taskmgrd (shown as that machine's) runs on that machine instead, where its tasks, source code and claude login are, when the daemon there has `AI_RUNNER=1` (see [taskmgrd.md](taskmgrd.md)): the run button is greyed out, and says why, while that machine is not connected; a run started shows "waiting for <machine>" until the machine starts it, then the machine's name after its state, and is followed and answered the same way.  
The page re-reads the tree and the tasks every ten seconds while its tab is visible, so changes
pushed from another machine or made with the cli show up on their own; the refresh button at the top does it at once.  
The status bar at the bottom counts the tasks shown and names their folder (the tree says which machine a pushed folder came from);  
at its right end is the host of the server this machine syncs with (`SYNC_SERVER` in `.env`, without the scheme),  
when there is one. With `POLLING=1` a dot follows it, for taskmgrd's pulls from that server: green while the last one  
went through recently (within twice `POLLING_INTERVAL`, three minutes at least), red when it failed or none came in  
time (the daemon is not running); the tooltip says which, with the time and the error.  

Configuration: `taskmgr.json` (copy `taskmgr.json.example`; the file is git-ignored).  
The bare `tm` command reads the same file:  
```
{
  "origins": [
    {
      "origin": "gcc3",
      "works": [
        {
          "work": "gcc3.com",
          "income": { "monthly": [{ "amount": 500000, "currency": "JPY", "from": "2026-01" }], "once": [{ "amount": 100000, "currency": "JPY" }] },
          "tasks_path": "~/gcc3/tasks",
          "repositories": [
            { "repository": "repository a", "source_path": "~/gcc3/repository-a" },
            { "repository": "repository b", "source_path": "~/gcc3/repository-b", "tasks_path": "~/gcc3/tasks/repository-b" }
          ]
        }
      ]
    },
    { "works": [{ "work": "personal", "tasks_path": "~/tasks", "repositories": [] }] }
  ]
}
```
`tasks_path` is the folder holding the task folders (`~` is expanded). A work's `tasks_path` is optional: a work without one has no common tasks of its own, only its repositories'. Each entry of `origins` is an organization the works are for, with its works; in the web UI's tree, its works are grouped under its name. One entry may leave `origin` out (or `""`) for works without an origin, which come last. Work names are unique across all origins. The older form, a top-level `works` list whose works each have an optional `origin`, is still read, and is rewritten as `origins` when the file is saved from the web UI; so is a repository's older `name`, which becomes `repository`. `income` (optional) is what the work pays, as two lists of `{ amount, currency }` (a 3-letter code): `monthly` and `once` (one-time payments); a monthly item may also have `from`, the year and month it starts (`"2026-01"`, optional); An origin may have an `income` of the same form too (what it pays besides its works). An older single `reward` (`{ amount, currency, period }`) is still read, and becomes `income` when the work is saved from the web UI. In the web UI, the + button next to "Origins" opens the add dialog, which adds an origin (name and income), a work (into an origin, which is required; its tasks folder, if given, is created if missing) or a repository (into a work, with a source folder, a tasks folder or both; its tasks folder is created if missing); the + on an origin's row starts it on adding a work there, the one on a work's row on adding a repository there. The income of an origin or a work is shown at the right of its name in units of 10,000 (万): the one-time total, then `m` and the monthly total, e.g. `44 + m7`. The pencil button at the right of an origin's or a work's row edits its name and income (add or remove monthly and one-time items), and the one on a repository's row edits its name. The tree is in the file's order, and dragging reorders it: an origin's name among the origins, a work (with its repositories) among the works of its origin, a repository among those of its work; while dragging, a light grey line across the tree shows where the dragged one would go, and the file is rewritten on the drop. Nothing moves to another origin or work by dragging. `hidden` (optional, `true`) hides a work and its repositories from the tree; it is set with the "Hide this work" box in the work's edit dialog, and the "Show hidden works" box under the tree's head shows them again (greyed out). The pie-chart button at the top right opens the income analysis: in one currency, the annual income (monthly × 12), what the monthly items actually pay in a chosen year (counted from each one's `from` month), the one-time total, and a pie of where the income comes from, by origin (hidden works count only when asked for). `source_path` (optional) is a repository's source code folder; the tree shows it under the repository's name, or its `tasks_path` when it has none. A repository's `tasks_path` may be left out (or `""`) when it has a `source_path`: its tasks are then read from the `tasks` folder in the source folder. Paths in the tree are shown as written here, with `~` kept. The file is re-read when it changes.  
`PORT` / `HOST` in `.env` set the port (default 3456) and host (default 127.0.0.1).  

Login: the web UI asks for a username and password. Accounts are a list in `data/users.json`  
(copy `data/users.example.json`; the file is git-ignored),  
all seeing the same works. The file is read on every login, so edits apply without a restart:  
```
[
  { "username": "admin", "password": "change-me" },
  { "username": "liu", "password": "..." }
]
```
Without the file nobody can log in. Sessions are kept in memory, so a restart signs everyone out  
(the browser remembers the password and logs back in by itself until "Log out").  

Setup (installs dependencies, creates `.env`, `taskmgr.json` and `data/users.json` from the examples, builds the frontend):  
`./setup.sh`  

Run as a background service with pm2 (`pnpm add -g pm2`):  
`./start.sh` start, `./stop.sh` stop, `./restart.sh` pull latest code, rebuild and restart. Each does the same to taskmgrd, the sync daemon, when `SYNC_SERVER` is set in `.env` (see [taskmgrd.md](taskmgrd.md)); leave it empty to run the web UI alone.  
Once `tm` is installed (`./install.sh`), `tm start`, `tm stop` and `tm restart` run these scripts from any folder (the `.bat` ones on Windows), and `tm status` shows whether the web UI and taskmgrd are online under pm2 (see [Commands.md](Commands.md)).  
On Windows: `setup.bat` once, then `start.bat`, `stop.bat`, `restart.bat` (taskmgrd too, when `SYNC_SERVER` is set in `.env`); `install.bat` / `uninstall.bat` add or remove the global commands. Paths in `taskmgr.json` are then Windows paths (`C:\code\...` or `C:/code/...`).  
Then open the printed URL (default `http://127.0.0.1:3456/`).  
The pm2 apps are in `ecosystem.config.cjs`: the web UI, named `PM2_NAME` in `.env` (default `taskmgr`), and `taskmgrd`.  

For development (hot reload, production server without pm2), see [Develop.md](Develop.md).  
