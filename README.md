
tm
==


Task manager improved.  


How It Works
------------

The application bacically read the folders in current directory, listing all tasks.  
Each task is a folder with a `task.txt` file inside it.  
The folder name is the task ID, which is the creation time formatted as `YYYYMMDDHHmm`.  
Start it with `tm <folder>` to list the tasks in that folder, or with a bare `tm` to pick a work  
or a repository from the `taskmgr.json` tree first (see `Command`); then move between the tasks.  


`tasks` Folder
--------------

Create a `tasks` folder inside a repository folder and globally gitignore it.  
Use `globally_ignore_tasks.sh` or `.bat` for Windows or below command.  

```
git config --global core.excludesFile ~/.gitignore_global
vim ~/.gitignore_global
```

Add `tasks/` into it.  
Or run `./globally_ignore_tasks.sh` (Windows: `globally_ignore_tasks.bat`), which does both.  

You can manage all tasks in or not in a repository folder.  


Features
--------

Task Preview  
Use `space` to preview task details.  
Support `vi` style keybindings.  

Subtasks  
Support subtasks inside the a task folder; the terminal and the web UI list them as a tree under their task.  

Shortcuts  
Refer `Shortcuts` section.  
Support a `vi` style keybindings, like `j`, `k`, `h`, `l` to navigate between tasks and subtasks.  

Status bar  
Shows the task counter, the work / repository, the task folder path, and the default text editor.  


Dependencies
------------

Node.js  
pnpm  


Installation
------------

Install:  
`pnpm install`  

Install globally:  
`pnpm link`

Uninstall:  
`pnpm unlink` (run inside the taskmgr folder)


Setup
-----

.env  
`EDITOR=vim` (default when EDITOR is not set)  
Available editors: `vim`, `nvim`, `subl`(Sublime Text), `notepad`  
`AI_PERMISSION_MODE=acceptEdits` (default when not set): the permission mode of a run of Claude Code started from the web UI's Task panel (see [docs/Web UI.md](docs/Web%20UI.md)): `acceptEdits` allows file edits as they come and asks about the rest in the browser, `default` asks about edits too, `plan` has Claude plan first and asks about the plan, `auto` lets a classifier decide, `bypassPermissions` asks nothing. The allow rules of your Claude settings apply in every mode, as in the terminal.  
`AI_RUNNER=1` (off when not set): taskmgrd also runs Claude Code here for the server this machine syncs with: a task pushed from here is run on this machine when the run button is used in the server's web UI, with this machine's `AI_PERMISSION_MODE`, and what Claude asks is answered there (see [docs/taskmgrd.md](docs/taskmgrd.md)).  


Command
-------

`tm <folder>` (or `taskmgr <folder>`), e.g. `tm .` or `tm ~/tasks`  
Opens that folder as a task list. No `taskmgr.json` is needed.  
If there is no task, it will show a message: "No tasks found."

`tm` (or `taskmgr`) without arguments  
Shows the works listed in `taskmgr.json` (the same file as the web UI, see [docs/Web UI.md](docs/Web%20UI.md)) as a tree,  
each work followed by its repositories:  

```
  work / repository
  acme         todo:3 done:1 pending:0 aborted:0   ~/acme/tasks
  ├─ alpha     todo:1 done:0 pending:0 aborted:0   ~/acme/alpha/tasks
  └─ beta      folder not found                    ~/acme/beta/tasks
  personal     todo:2 done:5 pending:1 aborted:2   ~/tasks
```

Select a row with `enter` to open its task list: a work row opens the common tasks of the work,  
a repository row opens that repository. `h` at the top of a task list goes back to the tree.  

`tm config`  
Opens `taskmgr.json` in the editor (`EDITOR` in `.env`, see above). If the file does not exist yet,  
it is created from `taskmgr.json.example` first.  

`tm run <work | repository | work/repository | folder>:<id>`  
Starts Claude Code (`claude`, installed separately) on one task, e.g. `tm run develop:202610241655`. Before the colon is where the task is: a work of `taskmgr.json` (its common tasks), a repository (`work/repository` when several works have a repository of that name, `work/` for the common tasks of a work that also names a repository), or a path to a folder of tasks; after it, the task's id, looked for in the `done`, `pending` and `aborted` folders and among the subtasks too. The two may also be two arguments (`tm run develop 202610241655`), and the id may then be a path to the task folder, for two tasks with one id at different levels. The first prompt is made of the task's `task.txt`, its `prompt.txt` when it has one (the prompt is then what to do and the task text its context; without one the task text is what to do) and the list of its other files, with the task folder's path. A repository's task runs in the repository's source folder (`source_path`), so Claude works on the code, with the task folder added (`--add-dir`) so its files can be read; any other task runs in its own folder. Whatever follows goes to `claude` as it is: `-p` prints the answer and exits, `--model opus` picks a model, and so on. `--dry-run` prints the folder, the command and the prompt without starting claude; `tm run --help` has the details. Exits as claude does. The web UI's Task panel has a run button beside the prompt that starts the same run through the Claude Agent SDK, with Claude's output, and the questions it would ask in the terminal, in a dialog (see [docs/Web UI.md](docs/Web%20UI.md)). Everything about Claude Code is in `ai/`.  

`tm push`  
Pushes `taskmgr.json` and the tasks folders to the remote server once, by hand, the same push the sync daemon does (see [docs/taskmgrd.md](docs/taskmgrd.md); `SYNC_SERVER` and `SYNC_SERVER_TOKEN` in `.env`). It prints what it pushed and exits, with an error when the server cannot be reached. Every tasks folder is sent each time, so whatever was changed on the server since is put back as it is here; attachments the server already has are not uploaded again. Only the tasks go: the task folders right in the tasks folder and in its `done` / `pending` / `aborted` folders, told by their name alone (a task id, 12 digits like `202610191522`, with or without a title after a space), each whole; a task folder without a `task.txt` gets one first, with the title from its name as its text. A file right in the tasks folder, or a folder there named some other way, is not pushed. Each run, its start, what it pushed and its end, is logged to `logs/taskmgr.log` (the daemon's own pushes go to `logs/taskmgrd.log`). Every log in `logs/` is kept under 10 MB: past that, its oldest 2 MB are dropped.  

`tm pull`  
Fetches `taskmgr.json` and, for the works and repositories listed in it, the task folders from the server (every `task.txt` and the other files, attachments and files in folders; what is beside the tasks in a folder is not pulled, as it is not pushed), once, by hand. A file or folder that exists is updated when it differs, one that does not is added. A task the server deleted since the last sync (taskmgrd's last push or the last pull, remembered in `.tm-sync-state.json`) is deleted here too, with its folder, unless a subtask is still in it. Other files the server lacks are never deleted here, since taskmgrd does not push files over its size limits. What is here wins: nothing is pulled while a change you made here since the last sync (a task added, changed, deleted, renamed or moved, an attachment added, changed or deleted) is not pushed yet. `tm pull` compares every folder with what was last synced first; one that differs, or was never synced and is not empty, is listed with its changes and the pull exits with 1, so push first (`tm push`, or wait for taskmgrd), which overwrites the server's copy, a change made there to the same task included. A change made here while the pull runs is left as it is and told the same way. Nothing never synced before is ever deleted. `taskmgr.json` is merged, and only for what is already in it: an origin, work or repository you have takes the server's fields (keeping its own `tasks_path` and `source_path`), and one only on the server is not pulled, with its files. Same `.env` settings as `tm push`, and logged to the same `logs/taskmgr.log`. With `POLLING=1` in `.env`, taskmgrd does this pull by itself: once when it starts, before its first push, then every `POLLING_INTERVAL` seconds (600 when not set, ten minutes), logged to its `logs/taskmgrd.log` (see [docs/taskmgrd.md](docs/taskmgrd.md)).  

`tm start`  
Starts the web UI under pm2, and taskmgrd, the sync daemon, with it when `SYNC_SERVER` is set in `.env`: it runs the `start.sh` of the taskmgr folder (`start.bat` on Windows, see [docs/Web UI.md](docs/Web%20UI.md)), from wherever you are, and prints what it prints.  

`tm stop`  
Stops both (`stop.sh` / `stop.bat`).  

`tm restart`  
Pulls the latest code of taskmgr, installs and rebuilds, then stops and starts both (`restart.sh` / `restart.bat`).  

`tm status`  
Shows whether the web UI and taskmgrd run under pm2, one row each, with their pm2 state (`online`, `stopped`, `errored`, or `not started` when pm2 does not know them), pid, uptime, restart count and memory, and the URL of the web UI when it runs:  

```
  name      status  pid    uptime  restarts  memory
  taskmgr   online  41023  3d 2h   0         48 MB   http://localhost:3456
  taskmgrd  online  41031  3d 2h   0         115 MB  sync daemon
```

With `SYNC_SERVER` empty in `.env` only the web UI is listed. It exits with 1 when one of them is not online, so a script can test it, and then says what to run (`tm start`, or `pm2 logs <name>` for one that errored). Needs pm2 (`./setup.sh` installs it).  

`tm help` (or `tm -h`, `tm --help`)  
Prints the commands above. To open a folder named like a command (`config`, `run`, `push`, `pull`, `start`, `stop`, `restart`, `status` or `help`), prefix it: `tm ./config`.  


Task files
----------

Each task is a folder `<id> <title>`, the id being its creation minute (`YYYYMMDDHHmm`).

`task.txt`  
Plain text file, just the task details. The first line is the title.  
A task folder without a `task.txt` is still a task, titled after the folder name.  
Any other file in the folder is an attachment, except `prompt.txt` (optional): a prompt for an AI  
agent working on the task, which the web UI's Task panel edits under the task's text (see [docs/Web UI.md](docs/Web%20UI.md))  
and `tm run` hands to Claude Code with the task text and the list of the attachments (see `Command`).

File example:
```
Buy apple.
Buy apple from the store.
```

The status is where the folder is: a task right in a folder of tasks is todo, one in its
`done` folder is done, one in its `pending` folder is pending, one in its `aborted` folder is
aborted. Marking a task done, pending or aborted moves its folder there (the `done` / `pending` /
`aborted` folder is created when needed and removed when it is empty again):
```
tasks/
  202508142100 Buy orange./
  done/
    202508142100 Buy apple./
  pending/
  aborted/
```
Task files from older versions, which began with a `---` block (`status:`, `labels:`, ...), are
converted the first time their folder is listed: the block is dropped, and a done or pending
task is moved into its folder.


Task List
---------

Example:  
```
     id            task
[x]  202508142100  Buy apple.   
[ ]  202508142100  Buy orange.  
```

Task status:
empty for todo.  
x for done.  
p for pending.  
a for aborted.  

Task order:  
TODO tasks first, then done tasks, then pending tasks, then aborted tasks.


Shortcuts
---------

l  
List tasks, or refresh task list.  

a / n  
Add a task: a large "New task" box opens where you type the whole `task.txt`, the  
first line being the name and the rest the details (enter for a new line; as in vim,  
esc then `:wq` creates it and `:q` cancels). It creates a folder `<id> <name>` inside current directory  
(the id is the creation minute, `YYYYMMDDHHmm`; a second task in the same minute gets  
the next minute).  

shift+a  
Add a subtask of the selected task: the same box, created inside that task's folder.  

e  
Edit a task with the default text editor.  

↑ or ↓ (arrow keys)  
j and k
Move from tasks.  

h and l  
→ or ← (arrow keys)
Move from main task and subtasks. Subtasks are already listed under their task as a tree  
(`├─`, `└─`); `l` opens a task's subtasks on their own, `h` goes back up.  
`h` at the top of the list goes back to the work / repository tree (when started with a bare `tm`).  

x  
Mark a task as done.  

Space  
Show task details.  

Enter  
Open a task folder to view details and attachments.  

d  
Delete a task.  

s  
Create subtasks with AI.  

r  
Refresh the task list.  

p  
Pending a task.  

w  
Abort a task (its folder moves into `aborted`; `w` again makes it todo).  

:  
Enter command mode (like Vim). Supported commands:  
`:h` or `:help` shows a help popup with all shortcuts.  
`:q` or `:quit` quits the application; in a task list opened from the work / repository tree it goes back to the tree instead.


Gestures
--------

Mouse scroll up/down  
Scroll through the task list.  
(Not working on Windows.)  


Documents
---------

* [Web UI](docs/Web%20UI.md) — A React app over the same task folders, managing works and repositories.  
* [taskmgrd](docs/taskmgrd.md) — Sync daemon that pushes the tasks to a remote tm server running the web UI, and pulls them from it when polling is on.  
* [Develop](docs/Develop.md) — Development setup.  
* [Server](docs/Server.md) — Server APIs.  
