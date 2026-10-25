
tm
==


Task manager improved.  


How It Works
------------

The application bacically read the folders in current directory, listing all tasks.  
Each task is a folder with a `task.txt` file inside it (see [docs/Task file.md](docs/Task%20file.md)).  

The folder name is the task ID, which is the creation time formatted as `YYYYMMDDHHmm`.  
Start it with `tm <folder>` to list the tasks in that folder, or with a bare `tm` to pick a work  
or a repository from the `taskmgr.json` tree first (see [docs/Commands.md](docs/Commands.md)); then move between the tasks  
with `vi` style keys (see [docs/Shortcut and gestures.md](docs/Shortcut%20and%20gestures.md)).  


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
Support a `vi` style keybindings, like `j`, `k`, `h`, `l` to navigate between tasks and subtasks.  
Refer [docs/Shortcut and gestures.md](docs/Shortcut%20and%20gestures.md).  

Status bar  
Shows the task counter, the work / repository, the task folder path, and the default text editor.  

Web UI and sync  
A React app over the same task folders, and a daemon that syncs them with a remote tm server.  
Refer [docs/Web UI.md](docs/Web%20UI.md) and [docs/taskmgrd.md](docs/taskmgrd.md).  

Claude Code  
`tm run` and the web UI's run button start Claude Code on a task.  
Refer [docs/Commands.md](docs/Commands.md).  


Documents
---------

* [Setup](docs/Setup.md) — The `.env` settings: `EDITOR`, `AI_PERMISSION_MODE`, `AI_RUNNER` and the sync variables.  
* [Commands](docs/Commands.md) — Every `tm` command: opening a folder or the work tree, `config`, `run`, `push`, `pull`, `start`, `stop`, `restart`, `status`.  
* [Task file](docs/Task%20file.md) — The task folder, `task.txt`, `prompt.txt`, attachments, subtasks and how the status is stored.  
* [Shortcut and gestures](docs/Shortcut%20and%20gestures.md) — The terminal task list, its keys and mouse gestures.  
* [Web UI](docs/Web%20UI.md) — A React app over the same task folders, managing works and repositories.  
* [taskmgrd](docs/taskmgrd.md) — Sync daemon that pushes the tasks to a remote tm server running the web UI, and pulls them from it when polling is on.  
* [Develop](docs/Develop.md) — Development setup.  
* [Server](docs/Server.md) — Server APIs.  
