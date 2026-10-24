
Server
======


The web UI server (`server/index.js`, Express) answers at `http://<HOST>:<PORT>/` (default `http://127.0.0.1:3456/`).  
Every API is under `/api`, takes and returns JSON, and is never cached (`Cache-Control: no-store`).  
An error answers with its status and `{ error }` (the auth and sync APIs also add a `code`).  
An unknown route under `/api` answers 404.  


Common parameters
-----------------

A *space* is the tasks folder of a work (its common tasks) or of a repository. Task APIs pick one with:  
`work` the work name (required)  
`repository` the repository name (empty or left out for the work's common tasks)  

They are in the query for `GET` / `DELETE` and in the body otherwise (and in the query for `POST /api/task/file`).  

`rel` a task folder (or an attachment) relative to the space's folder, e.g. `done/202508142100 Buy apple`  
`dir` a folder of tasks relative to the space's folder (empty for the space's folder; a task folder for its subtasks)  

A task, as answered:  
```
{ "id": "202508142100", "rel": "202508142100 Buy apple", "folder": "202508142100 Buy apple",
  "status": "todo", "title": "Buy apple", "details": "Buy apple\nfrom the store.",
  "hasSubtask": true, "subtasks": [ { "id": "202508142130", "rel": "202508142100 Buy apple/202508142130 Pay", ... } ] }
```

`status` is `todo`, `done`, `pending` or `aborted`. `subtasks` are the task folders inside the task's own (its  
subtasks, a task inside a task), sorted as a list is, each with its own `subtasks`; `hasSubtask` says there are some.  

The works APIs answer with the tree, `{ works, origins }`: each work with its origin, income, paths and  
repositories, and the origins (`{ origin, income }`, an origin possibly without works yet).  


Login
-----

Defined in `server/auth.js`. A login sets the `taskmgr_session` cookie (30 days, kept in memory).  
Every other API below, except the sync API, answers 401 `LOGIN_REQUIRED` without a session.  

`POST /api/login` `{ username, password }`  
Log in against `data/users.json`. Answers `{ username }`.  
401 `INVALID_CREDENTIALS`, 503 `NO_USERS` without the users file, 429 `RATE_LIMITED` after 20 attempts a minute from one IP.  

`GET /api/session`  
The logged-in user: `{ username }`, or 401 `LOGIN_REQUIRED`.  

`DELETE /api/session`  
Log out. Answers `{ ok: true }`.  


Settings
--------

`GET /api/settings`  
`{ configPath, editor, syncServer }`: the path of `taskmgr.json`, the default text editor, and the host of the server  
this machine syncs with (`SYNC_SERVER` in `.env`, as `tm.example.com`, no scheme; `""` when it is not set).  

`GET /api/polling`  
`{ on, at, ok, error, fresh }`: whether taskmgrd polls the sync server (`POLLING=1` and a `SYNC_SERVER` in `.env`) and how  
its last pull went, from `.tm-poll-state.json` next to `taskmgr.json`, which the daemon writes after each pull: when (ms) it  
ended (`null` when there has been none), whether it went through, why not, and whether it is recent enough for the daemon  
to be taken as running (within twice the polling interval, three minutes at least). The web UI shows it as a dot after the  
server's host in the status bar.  

`GET /api/config`  
The raw `taskmgr.json`: `{ configPath, text }`.  

`PUT /api/config` `{ text }`  
Write `taskmgr.json` as given (400 when it is not valid). Answers the tree.  


Origins, works and repositories
-------------------------------

These change `taskmgr.json` and answer the tree. Removing one never removes its folders.  

`GET /api/spaces`  
The tree. Each work and repository says whether its folder `exists`, whether it is a copy pushed by taskmgrd (`remote`)  
and, then, `machine`: `{ name, seenAt, online }` for the machine it was pushed from (`null` when the push did not say),  
its `MACHINE_ID`, when (ms) it last pushed or polled this server (`null`: not since the server started) and whether that  
was within the last three minutes. The web UI shows it as a green or grey dot beside the name.  

`POST /api/origin` `{ name, income? }`  
Add an origin with no works yet. 201.  

`PUT /api/origin` `{ origin, name, income }`  
Rename an origin and set its income (`null` clears it).  

`DELETE /api/origin?origin=`  
Remove an origin with its works.  

`POST /api/work` `{ name, origin?, tasksPath?, income? }`  
Add a work. 201.  

`PUT /api/work` `{ work, name, income, hidden?, tasksPath? }`  
Rename a work, set its income (`null` clears it), and, when given, whether it is hidden and its tasks folder.  

`DELETE /api/work?work=`  
Remove a work.  

`POST /api/repository` `{ work, name, tasksPath?, sourcePath? }`  
Add a repository to a work. 201.  

`PUT /api/repository` `{ work, name, newName, tasksPath?, sourcePath? }`  
Rename a repository and set its folders.  

`DELETE /api/repository?work=&name=`  
Remove a repository from a work.  

`POST /api/origin/move` `{ origin, before }`  
`POST /api/work/move` `{ work, before }`  
`POST /api/repository/move` `{ work, name, before }`  
Reorder `taskmgr.json`, which is the order of the tree: put the origin before the named origin `before`, the work before  
the work `before` of its origin, the repository before the repository `before` of its work; `before` `null` puts it last  
in its list. Nothing moves to another list (a work to another origin, a repository to another work): 400.  

`POST /api/space/create` `{ work, repository? }`  
Create the missing tasks folder of a work or a repository. 201.  

`POST /api/space/open` `{ work, repository? }`  
Open the folder of a tree row with the OS file manager on the server's machine: a work's tasks folder,  
or a repository's source folder (its tasks folder when it has none). Answers `{ ok: true }`.  


Tasks
-----

`GET /api/tasks?work=&repository=&dir=`  
The tasks in a folder, sorted todo, done, pending, aborted, each with its subtasks:  
`{ work, repository, dir, absDir, remote, machine, isRoot, parent, crumbs, tasks, counts }`; `counts` counts the subtasks too;  
`remote` says whether the folder is a copy pushed by taskmgrd and `machine` which machine pushed it, as in `GET /api/spaces` (`null` when unknown).  

`GET /api/tasks/all?all=1` / `?origin=` / `?work=`  
Every task of every work, of one origin (all its works and their repositories), or of one work  
(its common tasks and its repositories'), in one list.  

`POST /api/tasks` `{ work, repository?, dir?, details?, status? }`  
Create a task in `dir`; the folder is named after the first line of `details`. 201 `{ task }`.  

`POST /api/tasks/text` `{ work, repository?, dir?, text }`  
Create a task in `dir` from the whole `task.txt` text. 201 `{ task }`.  

`GET /api/task?work=&repository=&rel=`  
One task, its files and its prompt: `{ task, files, prompt }`, each file `{ name, rel, isDir, isSubtask, size }`  
(`task.txt` and `prompt.txt` are not among them), `prompt` the text of the task's `prompt.txt`, or `null` when it has none.  

`PUT /api/task/prompt` `{ work, repository?, rel, text }`  
Write the task's `prompt.txt` as typed; a blank `text` deletes the file instead. `{ prompt, files }` as they are after it.  

`PUT /api/task` `{ work, repository?, rel, details?, status? }`  
Set a task's details and status; the folder is renamed after the first line and moved by the status. `{ task }`.  

`POST /api/task/status` `{ work, repository?, rel, status }`  
Mark a task `todo`, `done`, `pending` or `aborted` (moves its folder). `{ task }`.  

`GET /api/task/text?work=&repository=&rel=`  
The `task.txt` text: `{ text }`.  

`PUT /api/task/text` `{ work, repository?, rel, text }`  
Write `task.txt` as typed, tidy it and rename the folder after its first line. `{ task }`.  

`POST /api/task/open` `{ work, repository?, rel }`  
Open the task folder with the OS file manager on the server's machine. `{ ok: true }`.  

`DELETE /api/task?work=&repository=&rel=`  
Delete a task folder. `{ ok: true }`.  


Attachments
-----------

`GET /api/file?work=&repository=&rel=&download=`  
Serve a file inside a task folder; `download=1` sends it as a download.  

`POST /api/task/file?work=&repository=&rel=&name=`  
Upload an attachment into the task folder `rel`. The body is the raw file (up to 200 MB). A taken name  
becomes `name (1).ext`, `name (2).ext`, ...; a hidden name or `task.txt` is refused. 201 `{ files }`.  

`DELETE /api/file?work=&repository=&rel=`  
Delete one attachment (not `task.txt`). `{ files }`.  

`PUT /api/file` `{ work, repository, rel, text }`  
Write one attachment as text, as the web UI's preview edits a text file (not `task.txt`; line ends become `\n`). `{ files }`.  


AI
--

Defined in `server/ai.js`: runs of Claude Code on a task, started from the Task panel and followed in the browser, through  
the Claude Agent SDK (the runs themselves live in `ai/session.js`). A task of a folder pushed from another machine by its  
taskmgrd (see Sync below) runs on that machine instead, through the runner of its daemon (`AI_RUNNER=1` there, see  
[taskmgrd.md](taskmgrd.md); `ai/remote.js` keeps those runs here): the routes below serve both kinds of run alike, and such  
a run carries `machine`, the machine's `MACHINE_ID`, and is `queued` until that machine starts it. A run, as answered:  
```
{ "id": "b6f397354f17", "task": { "work": "acme", "repository": "alpha", "rel": "202610241655 Fix mail", "id": "202610241655", "title": "Fix mail", "key": "acme/alpha/202610241655 Fix mail" },
  "cwd": "/home/me/acme/alpha", "taskDir": "/home/me/acme/alpha/tasks/202610241655 Fix mail",
  "status": "running", "startedAt": 1761300000000, "endedAt": null, "error": null,
  "pending": { "id": "c8990b3bf3b2", "kind": "question", "i": 2 }, "model": "claude-fable-5-1", "sessionId": "...", "cost": null, "billed": false,
  "items": [ ... ] }
```
`status` is `running`, `done`, `failed` or `stopped` (and `queued` for a run on another machine that has not started it yet);  
`pending` is what Claude waits for an answer to (`null` otherwise):  
`kind` `permission` or `question`, `i` the index of its item. `cost` is what the run's tokens would cost at API prices (from the  
result; `null` before), `billed` whether that is paid: Claude Code used with an API key, not a claude.ai login (the web UI shows  
the cost only then). `items` is the transcript, each item by `type`:  
`text` `{ text }` (Claude's, grown as it is written), `tool` `{ id, name, summary, done, isError?, result? }` (a tool call, `summary` what  
it is about, `result` its output once `done`), `permission` `{ toolName, summary, reason, decision, cancelled? }` (`decision` `allow`,  
`deny` or `null` while pending), `question` `{ questions, answers, cancelled? }` (`questions` as the AskUserQuestion tool asks them,  
`answers` by question text or `null` while pending), `result` `{ subtype, isError, durationMs, turns, costUsd, text }` and `error` `{ message }`.  
`GET /api/ai/runs` answers the runs with their transcripts; the others answer a run without it.  

`GET /api/ai/events`  
The runs, live: a `text/event-stream` (SSE). It starts with `snapshot` `{ runs }` (every run, with its transcript), then sends  
`run` (a run as above, without `items`: its state changed), `item` `{ run, i, item }` (an item of a run's transcript, new or  
changed), `delta` `{ run, i, text }` (text appended to item `i`) and `remove` `{ run }` as they happen, with a comment every  
25 seconds to keep the connection.  

`GET /api/ai/runs`  
Every run the server has, with its transcript: `{ runs }`.  

`POST /api/ai/run` `{ work, repository?, rel }`  
Start Claude Code on that task: in the repository's source folder (`source_path`) for a repository's task, else in the task  
folder, with the task folder readable either way, and the same first prompt as `tm run`. 201 `{ run }`, with its transcript;  
409 while the task has a run going, 400 when the source folder is missing. For a task of a pushed folder, the run is asked of  
that machine's runner, with the task's `task.txt` and `prompt.txt` as they are here (written there before the run when  
they differ), and answered once the machine has started it (201) or refused (its error and status); 409 when the machine's  
runner is not connected, or the folder was pushed without a machine id; 504 when the machine does not answer in 15 seconds.  

`POST /api/ai/runs/:id/answer` `{ pending, decision }` or `{ pending, answers }`  
Answer the run's pending question `pending` (its id): `decision` `allow` or `deny` for a permission, `answers` for a  
question, an object from each question's text to the answer (the label picked, several joined by `, `, or a text of one's  
own). `{ run }`; 409 when that question is not pending any more.  

`POST /api/ai/runs/:id/stop`  
Stop a run: Claude Code is interrupted and a pending question refused. `{ run }`; 409 when it is over.  

`DELETE /api/ai/runs/:id`  
Forget a finished run, transcript and all. `{ ok: true }`; 409 while it runs.  

The routes of a runner (the taskmgrd of another machine with `AI_RUNNER=1`, see [taskmgrd.md](taskmgrd.md)), authorized  
as the sync routes are (`Authorization: Bearer <SYNC_SERVER_TOKEN>` and `X-Machine-Id`, which names the machine; 400 without  
one), so a runner connected counts as its machine being in touch:  

`GET /api/sync/ai/commands`  
The commands for that machine, live: a `text/event-stream` of `command` events, each `{ id, type, ... }`: `run` `{ run, work,  
repository, rel, files }` (start Claude Code on that task as run `run`, `files` being `{ "task.txt": text, "prompt.txt": text | null }`  
as the server has them), `answer` `{ run, pending, body }`, `stop` `{ run }` and `dismiss` `{ run }`, with a comment every 25 seconds  
to keep the connection. One connection per machine: a new one replaces the old. While a machine has none, its tasks cannot be run.  

`POST /api/sync/ai/events` `{ events }`  
The events of the machine's session, in order, each `{ event, data }` as `GET /api/ai/events` sends them (`snapshot` first,  
whenever the machine connects, then `run`, `item`, `delta`, `remove`), and `ack` `{ id, ok, status?, error? }` for each command,  
`id` the command's. `{ ok: true }`. The server keeps the runs so sent and passes them on to its browsers.  


Sync
----

Defined in `server/sync.js`, used by `taskmgrd` (see [taskmgrd.md](taskmgrd.md)). No login: every request needs  
`Authorization: Bearer <SYNC_SERVER_TOKEN>`; 503 `SYNC_OFF` when the server has no `SYNC_SERVER_TOKEN`,  
401 `INVALID_TOKEN` for a wrong one. Every request also carries `X-Machine-Id`, the sender's `MACHINE_ID`  
(URI-encoded); the server keeps, in memory, when each machine was last heard from, for the `machine` field  
of `GET /api/spaces`, and logs what each machine pushes and polls to `logs/<MACHINE_ID>.log` (one line per  
config or folder pushed, poll, config or folder pulled, and refused request; characters a file name cannot  
hold are replaced by `_` in the name).  

`GET /api/sync`  
What the server has: `{ ok, config, spaces }`, the sha1 of the last pushed `taskmgr.json` (`null` when there is none)  
and of each space's last snapshot, keyed `origin/work/repository` (`""` for no origin, or the work's common tasks).  

`PUT /api/sync/config` `{ text }`  
Merge the pushed config into the server's `taskmgr.json` and prune `data/origins/` to what is in it. `{ ok, pruned }`.  
The pushed works and repositories get their copies under `data/origins/` as `tasks_path`; `source_path` is left out.  
Origins, works and repositories only on the server are kept, those only pushed are added; a work in both  
(same origin, same name) takes the pushed fields, its repositories merged the same way (the pushed one wins  
for a repository in both). A work pushed without `tasks_path` loses the one it has on the server, and the copy  
of its common tasks under `data/origins/` is removed (listed in `pruned`). A work pushed under another origin  
moves there. A space the pushing machine (`X-Machine-Id`) pushed before and no longer lists (a work or repository  
renamed or removed there) is kept, but is no longer that machine's: its `machine` becomes `null` (plain "remote",  
no dot) and its snapshot is forgotten, so it is pushed whole should the machine list it again. 409 when the merge is invalid.  

`POST /api/sync/blobs` `{ blobs }`  
Which of these files (sha1 hashes of their content) the server does not have yet: `{ ok, missing }`.  

`PUT /api/sync/blob/<sha1>` (the raw file as the body, up to 1 GB)  
Store one file in the blob store, `data/.sync-blobs/<sha1>`. 400 when the content does not hash to `<sha1>`. `{ ok }`.  

`GET /api/sync/pull/config`  
The server's `taskmgr.json` as it is: `{ ok, text }`. Used by `tm pull`.  

`GET /api/sync/pull/space?origin=&work=&repository=`  
A space's task folders listed like a push (what is beside them in the folder, a file right in it or a folder not named by a task id, is left out as a push leaves it out): `{ ok, entries }` with `{ path, content }` for a task file, `{ path, blob: sha1, size }` for any other file and `{ path, dir: true }` for an empty folder. 404 when the server has no tasks folder for it.  

`GET /api/sync/pull/file?origin=&work=&repository=&path=`  
One file of a space, raw. Nothing on the server is changed by the pull routes.  

`PUT /api/sync/space` `{ origin, work, repository, machine, entries }`  
Bring one tasks folder to the snapshot, in place (a task that changed status is moved first, then only what differs is written, and what the snapshot lacks removed): `entries` are `{ path, content }` for task files (text),  
`{ path, blob: sha1 }` for every other file (attachments included), taken from the blob store, and  
`{ path, dir: true }` for an empty folder, paths relative to the tasks folder. After it, the server's copy  
is the pushed folder exactly. `{ ok, files, dirs }`. 409 `MISSING_BLOBS` `{ missing }` when a blob is not in the  
store; nothing is written then. A blob no space refers to any more is removed once it is an hour old.  
`machine` (optional, the pusher's `MACHINE_ID`, or its hostname) is remembered for the space, in `data/.sync-state.json`,  
and the web UI shows it as where the copy comes from (`machine` in `GET /api/spaces` and `GET /api/tasks`), with a dot  
that is green while that machine has pushed or polled within the last three minutes.  
