Commands
========

`tm <folder>` (or `taskmgr <folder>`), e.g. `tm .` or `tm ~/tasks`  
Opens that folder as a task list. No `taskmgr.json` is needed.  
If there is no task, it will show a message: "No tasks found."

`tm` (or `taskmgr`) without arguments  
Shows the works listed in `taskmgr.json` (the same file as the web UI, see [Web UI.md](Web%20UI.md)) as a tree,  
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
Opens `taskmgr.json` in the editor (`EDITOR` in `.env`, see [Setup.md](Setup.md)). If the file does not exist yet,  
it is created from `taskmgr.json.example` first.  

`tm run <work | repository | work/repository | folder>:<id>`  
Starts Claude Code (`claude`, installed separately) on one task, e.g. `tm run develop:202610241655`. Before the colon is where the task is: a work of `taskmgr.json` (its common tasks), a repository (`work/repository` when several works have a repository of that name, `work/` for the common tasks of a work that also names a repository), or a path to a folder of tasks; after it, the task's id, looked for in the `done`, `pending` and `aborted` folders and among the subtasks too. The two may also be two arguments (`tm run develop 202610241655`), and the id may then be a path to the task folder, for two tasks with one id at different levels. The first prompt is made of the task's `task.txt`, its `prompt.txt` when it has one (the prompt is then what to do and the task text its context; without one the task text is what to do) and the list of its other files, with the task folder's path (see [Task file.md](Task%20file.md)). A repository's task runs in the repository's source folder (`source_path`), so Claude works on the code, with the task folder added (`--add-dir`) so its files can be read; any other task runs in its own folder. Whatever follows goes to `claude` as it is: `-p` prints the answer and exits, `--model opus` picks a model, and so on. `--dry-run` prints the folder, the command and the prompt without starting claude; `tm run --help` has the details. Exits as claude does. The web UI's Task panel has a run button beside the prompt that starts the same run through the Claude Agent SDK, with Claude's output, and the questions it would ask in the terminal, in a dialog (see [Web UI.md](Web%20UI.md)). Everything about Claude Code is in `ai/`.  

`tm push`  
Pushes `taskmgr.json` and the tasks folders to the remote server once, by hand, the same push the sync daemon does (see [taskmgrd.md](taskmgrd.md); `SYNC_SERVER` and `SYNC_SERVER_TOKEN` in `.env`). It prints what it pushed and exits, with an error when the server cannot be reached. Every tasks folder is sent each time, so whatever was changed on the server since is put back as it is here; attachments the server already has are not uploaded again. Only the tasks go: the task folders right in the tasks folder and in its `done` / `pending` / `aborted` folders, told by their name alone (a task id, 12 digits like `202610191522`, with or without a title after a space), each whole; a task folder without a `task.txt` gets one first, with the title from its name as its text. A file right in the tasks folder, or a folder there named some other way, is not pushed. Each run, its start, what it pushed and its end, is logged to `logs/taskmgr.log` (the daemon's own pushes go to `logs/taskmgrd.log`). Every log in `logs/` is kept under 10 MB: past that, its oldest 2 MB are dropped.  

`tm pull`  
Fetches `taskmgr.json` and, for the works and repositories listed in it, the task folders from the server (every `task.txt` and the other files, attachments and files in folders; what is beside the tasks in a folder is not pulled, as it is not pushed), once, by hand. A file or folder that exists is updated when it differs, one that does not is added. A task the server deleted since the last sync (taskmgrd's last push or the last pull, remembered in `.tm-sync-state.json`) is deleted here too, with its folder, unless a subtask is still in it. Other files the server lacks are never deleted here, since taskmgrd does not push files over its size limits. What is here wins: nothing is pulled while a change you made here since the last sync (a task added, changed, deleted, renamed or moved, an attachment added, changed or deleted) is not pushed yet. `tm pull` compares every folder with what was last synced first; one that differs, or was never synced and is not empty, is listed with its changes and the pull exits with 1, so push first (`tm push`, or wait for taskmgrd), which overwrites the server's copy, a change made there to the same task included. A change made here while the pull runs is left as it is and told the same way. Nothing never synced before is ever deleted. `taskmgr.json` is merged, and only for what is already in it: an origin, work or repository you have takes the server's fields (keeping its own `tasks_path` and `source_path`), and one only on the server is not pulled, with its files. Same `.env` settings as `tm push`, and logged to the same `logs/taskmgr.log`. With `POLLING=1` in `.env`, taskmgrd does this pull by itself: once when it starts, before its first push, then every `POLLING_INTERVAL` seconds (600 when not set, ten minutes), logged to its `logs/taskmgrd.log` (see [taskmgrd.md](taskmgrd.md)).  

`tm start`  
Starts the web UI under pm2, and taskmgrd, the sync daemon, with it when `SYNC_SERVER` is set in `.env`: it runs the `start.sh` of the taskmgr folder (`start.bat` on Windows, see [Web UI.md](Web%20UI.md)), from wherever you are, and prints what it prints.  

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
