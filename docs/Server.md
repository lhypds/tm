
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
`{ configPath, editor, syncServer, syncServerUrl }`: the path of `taskmgr.json` (in its short form, `./taskmgr.json`), the default text editor, and the host of the server  
this machine syncs with (`SYNC_SERVER` in `.env`, as `tm.example.com`, no scheme; `""` when it is not set), with `syncServerUrl` its origin (`https://tm.example.com`), which that host links to.  

`GET /api/machine`  
Which machine this is, for the pages of the server it syncs with: `{ machine }`, its `MACHINE_ID` (the hostname when not  
set). No login: it is asked across origins by the web UI of `SYNC_SERVER` opened in a browser on this computer  
(`http://127.0.0.1:<port>/api/machine`), which so learns it is on one of that server's machines and has folders opened  
here (`here` in `POST /api/space/open`). Only that server's origin may read it (CORS; 403 for any other, or none); the  
route is not there without a `SYNC_SERVER`.  

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
The tree. Each work and repository says whether its folder `exists`, whether machines sync it with taskmgrd (`remote`: a folder under `data/origins/` that at least one machine pushes or pulls; one no machine syncs is the server's own, shown by its path)  
and, then, `machines`: `[{ name, seenAt, online, runner }]` for the machines that sync it (at most two, sorted by name;  
`[]` when no push said), each with its `MACHINE_ID`, when (ms) it last pushed or polled this server (`null`: not since the  
server started), whether that was within the last three minutes, and whether its runner is connected; and `machine`, the  
one of them its tasks run on (one with its runner connected, or else the first; `null` when there is none). The web UI  
shows every machine's name, each with a green or grey dot.  

`POST /api/origin` `{ name, income?, color?, description? }`  
Add an origin with no works yet. 201.  

`PUT /api/origin` `{ origin, name, income, color?, description? }`  
Rename an origin and set its income (`null` clears it), and, when given, its color and description (`""` clears it).  

`DELETE /api/origin?origin=`  
Remove an origin with its works.  

`POST /api/work` `{ name, origin?, tasksPath?, income?, description? }`  
Add a work. Without a `tasksPath`, its tasks are kept in tm's own data folder, `./data/origins/<origin>/<work>/tasks` (where a machine pushing the same origin and work puts its copy, so the two are one folder once such a machine syncs it), which is written to `taskmgr.json` as its `tasks_path`. 201.

Renaming an origin, a work or a repository (`PUT /api/origin`, `/api/work`, `/api/repository`) renames its folder under `./data/origins/` with it, when it has one, and rewrites the `tasks_path`s in it; 400 when a folder of the new name is there already.  

`PUT /api/work` `{ work, name, income, hidden?, tasksPath?, description? }`  
Rename a work, set its income (`null` clears it), and, when given, whether it is hidden, its tasks folder and its description (`""` clears it).  

`DELETE /api/work?work=`  
Remove a work.  

`POST /api/repository` `{ work, name, tasksPath?, sourcePath?, description? }`  
Add a repository to a work. With neither a `tasksPath` nor a `sourcePath`, its tasks are kept in `./data/origins/<origin>/<work>/repositories/<repository>`, written as its `tasks_path`. 201.  

`PUT /api/repository` `{ work, name, newName, tasksPath?, sourcePath?, description? }`  
Rename a repository and set its folders, and its description when given (`""` clears it).  

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

`POST /api/space/open` `{ work, repository?, here? }`  
Open the folder of a tree row with the OS file manager on the server's machine: a work's tasks folder,  
or a repository's source folder (its tasks folder when it has none). Answers `{ ok: true }`.  
`here` is the machine the browser is on, when it knows (see `GET /api/machine`): for a folder that machine syncs, the  
folder is opened there instead, as it is there (its own `taskmgr.json`), by its taskmgrd; `{ ok: true, machine }`. 409  
when that machine does not sync the folder (nothing is opened: on the server nobody would see it; the web UI, on a page  
not served by its own computer, says so instead of asking) or its taskmgrd is not connected, 504 when  
it does not answer in 15 seconds.  

`POST /api/space/code` `{ work, repository, here? }`  
Open the source code of a repository (its `source_path`) in VS Code (`code <folder>`; on macOS the app itself when  
the command is not on the server's PATH) on the server's machine. `{ ok: true }`; 404 when it has no `source_path`, 500  
when VS Code cannot be started. With `here`, as for `POST /api/space/open`: the repository is opened on that machine,  
at the `source_path` its own `taskmgr.json` gives it (404 when it has none there).  


Tasks
-----

`GET /api/tasks?work=&repository=&dir=`  
The tasks in a folder, sorted todo, done, pending, aborted, each with its subtasks:  
`{ work, repository, dir, absDir, shownDir, remote, machine, machines, isRoot, parent, crumbs, tasks, counts }`; `counts` counts the subtasks too;  
`remote` says whether the folder is a copy pushed by taskmgrd and `machines` / `machine` which machines sync it, as in `GET /api/spaces`.  

`GET /api/tasks/all?all=1` / `?origin=` / `?work=`  
Every task of every work, of one origin (all its works and their repositories), or of one work  
(its common tasks and its repositories'), in one list.  

`POST /api/tasks` `{ work, repository?, dir?, details?, status? }`  
Create a task in `dir`; the folder is named after the first line of `details`. 201 `{ task }`.  

`POST /api/tasks/text` `{ work, repository?, dir?, text }`  
Create a task in `dir` from the whole `task.txt` text. 201 `{ task }`.  

`GET /api/task?work=&repository=&rel=`  
One task, its files, its prompt and the records of its runs of Claude Code: `{ task, files, prompt, runs }`, each file  
`{ name, rel, isDir, isSubtask, size }` (`task.txt`, `prompt.txt` and dot files are not among them), `prompt` the text of  
the task's `prompt.txt`, or `null` when it has none, and `runs` the records kept in the folder (its `.claude_<time>`  
folders, see AI below), newest first, each a run as `GET /api/ai/runs` answers one, without `items`, plus `folder` (the  
record's name) and `saved: true`.  

`PUT /api/task/prompt` `{ work, repository?, rel, text }`  
Write the task's `prompt.txt` as typed, overwriting it; a blank `text` too. `{ prompt, files }` as they are after it.  

`DELETE /api/task/prompt?work=&repository=&rel=`  
Remove the task's `prompt.txt`; fine when it has none. `{ prompt, files }` as they are after it (`prompt` is `null`).  

`PUT /api/task` `{ work, repository?, rel, details?, status? }`  
Set a task's details and status; the folder is renamed after the first line and moved by the status. `{ task }`.  

`POST /api/task/status` `{ work, repository?, rel, status }`  
Mark a task `todo`, `done`, `pending` or `aborted` (moves its folder). `{ task }`.  

`GET /api/task/text?work=&repository=&rel=`  
The `task.txt` text: `{ text }`.  

`PUT /api/task/text` `{ work, repository?, rel, text }`  
Write `task.txt` as typed, tidy it and rename the folder after its first line. `{ task }`.  

`POST /api/task/open` `{ work, repository?, rel, here? }`  
Open the task folder with the OS file manager on the server's machine. `{ ok: true }`. With `here`, as for  
`POST /api/space/open`: the task of a folder that machine syncs is opened there, found by its path or its id.  

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
Delete one attachment (not `task.txt`): a file, or a folder with all that is in it (not a subtask's  
folder, a `done` / `pending` / `aborted` folder or a hidden one). `{ files }`.  

`PUT /api/file` `{ work, repository, rel, text }`  
Write one attachment as text, as the web UI's preview edits a text file (not `task.txt`; line ends become `\n`). `{ files }`.  


AI
--

Defined in `server/ai/ai.js`: runs of Claude Code on a task, started from the Task panel and followed in the browser, through  
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

`POST /api/ai/run` `{ work, repository?, rel, machine? }`  
`machine` (optional) names the one of the folder's machines to run on, for a folder two machines sync (400 when it does not sync the folder; without it, one whose runner is connected, or else the first). Start Claude Code on that task: in the repository's source folder (`source_path`) for a repository's task, else in the task  
folder, with the task folder readable either way, and the same first prompt as `tm run`. 201 `{ run }`, with its transcript;  
409 while the task has a run going, 400 when the source folder is missing. For a task of a pushed folder, the run is asked of  
that machine's runner, with the task's `task.txt` and `prompt.txt` as they are here (written there before the run when  
they differ), and answered once the machine has started it (201) or refused (its error and status); 409 when the machine's  
runner is not connected, or the folder was pushed without a machine id; 504 when the machine does not answer in 15 seconds.  

`GET /api/ai/machines`  
The machines Claude Code can be run on from here: `{ machines: [{ name, seenAt, online, runner, linked, port }] }`, as `GET /api/spaces`  
says a machine, for every machine that syncs a space with this server, made a request since it started, or has its  
taskmgrd connected, sorted by name. `linked`: its taskmgrd is connected, so it can be given a tm command, a folder to  
open or a new event; `runner`: it runs Claude Code too (`AI_RUNNER=1` there), so it can be given a prompt; `port`: the  
port of the web UI on that machine (`null` when not known), where a browser on it asks which machine it is on.  

`DELETE /api/ai/machines/<name>`  
Forget a machine (the × beside one that is not in touch, in the web UI's Machines dialog): it leaves the machines and the  
`machines` of the spaces it synced (one left with none is the server's own from then on), and what was deleted or edited  
here is no longer remembered for it. `{ ok: true }`; 404 when it is not known. Never refused otherwise: a machine that  
is in touch, or comes back later, goes on syncing and is counted again at its next push or pull.  

`POST /api/ai/machine/run` `{ machine, prompt }`  
Start Claude Code on that machine with the prompt as it is, on no task, in the home folder of its user (the web UI's  
Machines dialog). 201 `{ run }`, with its transcript: a run as above whose `task` is `{ work: "", repository: "", rel: "",  
id: "", title, key, free: true }` (`title` the prompt's first line, `key` `~prompt/<run id>`), `taskDir` `null` and `files`  
`{ "prompt.txt": <the prompt> }`. It is followed, answered and stopped as any run; having no task folder, it leaves no  
record. 400 without a prompt, 409 when the machine's runner is not connected, 504 when it does not answer in 15 seconds.  

`POST /api/ai/machine/command` `{ machine, command }`  
Run a tm command on that machine (the web UI's Machines dialog, a prompt that starts with `/`): `command` is `/restart`,  
`/start`, `/stop`, `/push`, `/pull` or `/status` (the `/` may be left out; no arguments), run there as `tm restart` and so on  
by the machine's runner, in a process of its own, so a restart of the daemon that got the command goes through.  
`{ ok: true, command }` once the machine has started it; what it prints is in that machine's `logs/command.log`, and in a terminal window there on macOS and Windows.  
400 when it is not one of those commands, 409 when the machine's taskmgrd is not connected (`AI_RUNNER` is not needed), 504 when it does not answer in 15 seconds.  

`POST /api/ai/runs/:id/answer` `{ pending, decision }` or `{ pending, answers }`  
Answer the run's pending question `pending` (its id): `decision` `allow` or `deny` for a permission, `answers` for a  
question, an object from each question's text to the answer (the label picked, several joined by `, `, or a text of one's  
own). `{ run }`; 409 when that question is not pending any more.  

`POST /api/ai/runs/:id/stop`  
Stop a run: Claude Code is interrupted and a pending question refused. `{ run }`; 409 when it is over.  

A run that is over is also written into the task folder by the machine that ran it, as `.claude_<yyyyMMddHHmmss>/` (the  
time it began; `-2`, `-3`... when two began the same second): `run.json`, the run as above with its transcript plus `input`  
(the first prompt claude was given) and `machine` (where it ran); `task.txt` and `prompt.txt`, the task's own files as  
they were (each when it had one); and `transcript.md`, the same to read. Dot folders go with the task when it is pushed or pulled, so a server  
shows the runs of the tasks pushed to it after they are over, whatever restarted meanwhile; `GET /api/task` lists them.  

`GET /api/ai/saved/:folder?work=&repository=&rel=`  
One record of the task, transcript included: `{ run }`, the run plus `folder` and `saved: true`. 400 when the name is not a  
record's, 404 when there is none.  

`DELETE /api/ai/saved/:folder?work=&repository=&rel=`  
Remove a record. For a task of a pushed copy, the machine it came from removes it too (its next push would bring it back  
otherwise), so its runner must be connected (409 otherwise). `{ ok: true }`; 404 when there is none.  

The routes of a runner (the taskmgrd of another machine, see [taskmgrd.md](taskmgrd.md)), authorized  
as the sync routes are (`Authorization: Bearer <SYNC_SERVER_TOKEN>` and `X-Machine-Id`, which names the machine; 400 without  
one), so a runner connected counts as its machine being in touch. The runner also says `X-Ai-Runner` (`1` or `0`: whether it  
runs Claude Code, `AI_RUNNER` there; a runner that does not say does) and `X-Web-Port` (the port of the web UI there):  

`GET /api/sync/ai/commands`  
The commands for that machine, live: a `text/event-stream` of `command` events, each `{ id, type, ... }`: `run` `{ run, work,  
repository, rel, files }` (start Claude Code on that task as run `run`, `files` being `{ "task.txt": text, "prompt.txt": text | null }`  
as the server has them), `prompt` `{ run, prompt }` (start Claude Code with that prompt on no task, as run `run`), `answer` `{ run, pending, body }`, `stop` `{ run }` and `forget` `{ work, repository, rel, folder }`  
(remove that run record from the task folder there), `tm` `{ command }` (a tm command there), `open` `{ work, repository, rel }`  
(open that task's folder in the file manager there, or, without `rel`, the folder the tree shows for the space), `code` `{ work, repository }` (open that repository's `source_path` in VS Code there) and `calendar` `{ date, title }`  
(a new event in Apple's Calendar there; acknowledged once it is made), with a comment every 25 seconds to keep the connection. One connection per machine: a new one replaces the old. While a machine has none, its tasks cannot be run.  

`POST /api/sync/ai/events` `{ events }`  
The events of the machine's session, in order, each `{ event, data }` as `GET /api/ai/events` sends them (`snapshot` first,  
whenever the machine connects, then `run`, `item`, `delta`, `remove`), and `ack` `{ id, ok, status?, error? }` for each command,  
`id` the command's. `{ ok: true }`. The server keeps the runs so sent and passes them on to its browsers.  


Scheduler
---------

Defined in `server/scheduler.js`. One page a day, kept as `data/scheduler/<YYYY-MM-DD>.json` (git-ignored; synced between the machines through the server, see the scheduler routes under Sync below):  
`{ date, text }`, `text` the page. A task put on the page is a line of the text, shown as a card: `[title](tm://<work>/<repository>#<id>/<id>)`,  
the ids being the task's id after those of the tasks it is under (its path changes with its title and status, its ids do not), the title the one it had when the line was written.  
A day has no file until its page has something on it, and the file is removed when the page is empty again.  
A file of the older shape (`tasks: [{ work, repository, ids, title, line }]` beside the text) is read as the page it was.

`GET /api/scheduler?date=&carry=1` the day (empty when it has no file; with `carry`, sent for today, a day that has no file yet is first given the tasks of the last day before it that are neither done, aborted nor gone, and keeps that day as `carried`, so it happens once): `{ date, text, tasks }`, `tasks` those of the text's lines, each `{ work, repository, ids, title, rel, status, missing }` as it is now (`missing: true` when it is not here: gone, or a task of another machine, the days being synced and a work's tasks only to the machines that have that work; the page shows it by the title of its line, as any other task but without its status box). With `carry`, a missing task of a work or repository this machine does not have is brought over too, as its line is. 400 for a date that is not `YYYY-MM-DD`.  
`PUT /api/scheduler` `{ date, text }` writes the page. Answers the day.


Calendar
--------

Defined in `server/calendar.js`. The day's events under the scheduler's page, read from Google Calendar and Apple (iCloud) Calendar by the address of each calendar's ICS feed.  
The calendars are listed in `taskmgr.json` under `calendars` (see [Web UI.md](Web%20UI.md)), so they are synced with it: a push sends the list to the server, a pull takes the server's.  
A feed read is kept for five minutes. Repeating events are expanded (`ical.js`), a cancelled one is left out.

`GET /api/calendar?date=&from=&to=&fresh=1` the events of the day `date` (`from` and `to` its bounds in ms, in the browser's time zone; `fresh` reads the feeds anew; with `until=` too, those of the days from `date` to `until`, 62 at most, for the calendar view): `{ configured, events, errors }`,  
each event `{ id, title, location, allDay, start, end, source, calendar, color }` with its details for the preview (`description`, `url`, `conference`, `organizer`, `attendees`, `attachments`, `status`, `busy`, `repeats`, `created`, `updated`: see `detailsOf`) (`color` its calendar's, `""` for none), `start` and `end` in ms (the days, the last one not included, of an `allDay` one), `source` `google`, `apple` or empty, `calendar` its name in `taskmgr.json` (the feed's own without one);  
`errors` the calendars that could not be read, each `{ source, calendar, error }`; `configured` is false when none is listed.

`GET /api/calendars` the calendars as `taskmgr.json` lists them, for the dialog that adds and removes them: `{ calendars }`, each `{ name, type, url, color }`.  
`PUT /api/calendars` `{ calendars }` replaces the list in `taskmgr.json` (an entry whose address is not an `https://`, `http://` or `webcal://` one is refused) and answers it as it is kept.

`POST /api/calendar/new-event` `{ date, title, until?, here? }` a new event of an hour on that day in Apple's Calendar (`utils/calendar.js`), which comes to the front with it open (with `until`, a later day, an event of whole days from `date` through it): on the server's machine (a Mac), or, with `here` (the machine the browser is on, see `GET /api/machine`) naming a machine in touch with this server, on that one, by its taskmgrd. `{ ok: true }`; 500 with the reason otherwise (not a Mac, the machine not connected, macOS not letting tm press the keys).


Sync
----

Defined in `server/sync.js`, used by `taskmgrd` (see [taskmgrd.md](taskmgrd.md)). No login: every request needs  
`Authorization: Bearer <SYNC_SERVER_TOKEN>`; 503 `SYNC_OFF` when the server has no `SYNC_SERVER_TOKEN`,  
401 `INVALID_TOKEN` for a wrong one. Every request also carries `X-Machine-Id`, the sender's `MACHINE_ID`  
(URI-encoded); the server keeps, in memory, when each machine was last heard from, for the `machine` field  
of `GET /api/spaces`, and logs what each machine pushes and polls to `logs/<MACHINE_ID>.log` (one line per  
config or folder pushed, poll, config or folder pulled, and refused request; characters a file name cannot  
hold are replaced by `_` in the name).  

At most two machines sync one space (push it, or pull it), the first two to do so. Any other is refused, 409  
`TOO_MANY_MACHINES`, by `PUT /api/sync/space` and the pull routes of that space, until one of the two lets go of it: its  
pushed `taskmgr.json` no longer lists the space (see `PUT /api/sync/config`). taskmgrd logs the refusal and goes on with the  
other spaces; `tm push` does too, and ends with an error.  

`GET /api/sync`  
What the server has: `{ ok, config, spaces }`, the sha1 of the last pushed `taskmgr.json` (`null` when there is none)  
and of each space's last snapshot, keyed `origin/work/repository` (`""` for no origin, or the work's common tasks).  

`PUT /api/sync/config` `{ text }`  
Merge the pushed config into the server's `taskmgr.json` and prune `data/origins/` to what is in it. `{ ok, pruned }`.  
The pushed works and repositories get their copies under `./data/origins/` as `tasks_path`; `source_path` is left out.  
Origins, works and repositories only on the server are kept, those only pushed are added; a work in both  
(same origin, same name) takes the pushed fields, its repositories merged the same way (the pushed one wins  
for a repository in both). A work pushed without `tasks_path` loses the one it has on the server, and the copy  
of its common tasks under `data/origins/` is removed (listed in `pruned`), unless no machine syncs those common tasks (a work added in the server's web UI): they are the server's own, and stay. A work pushed under another origin  
moves there. A space the pushing machine (`X-Machine-Id`) pushed before and no longer lists (a work or repository  
renamed or removed there) is kept, but is no longer that machine's: it leaves the space's `machines` (the folder is shown by its path  
when none is left), freeing its place for another machine, and the space's snapshot is forgotten, so it is pushed whole should the machine list it again. 409 when the merge is invalid.  

`POST /api/sync/blobs` `{ blobs }`  
Which of these files (sha1 hashes of their content) the server does not have yet: `{ ok, missing }`.  

`PUT /api/sync/blob/<sha1>` (the raw file as the body, up to 1 GB)  
Store one file in the blob store, `data/.sync-blobs/<sha1>`. 400 when the content does not hash to `<sha1>`. `{ ok }`.  

`GET /api/sync/scheduler`  
The scheduler's days here (the server's own, which its web UI shows and writes, and every machine shares): `{ ok, days }`, `days` being `{ date: hash }` of every day that has a file, the hash of its page and its `carried` (see `schedulerStore` in `server/scheduler.js`). A machine compares it with its own days and with the hashes it last synced (`scheduler` in its `.tm-sync-state.json`), which say which side changed a day.  

`PUT /api/sync/scheduler` `{ days, deleted }`  
Writes each of `days` (`{ date, text, carried? }`) and removes the days of `deleted` (dates). `tm push` and taskmgrd send the days changed on the machine since its last sync, whatever the server's have become (what is on the machine wins), and as `deleted` those deleted there that the server still has as last synced. `{ ok, days }` as `GET` answers after it. 400 for an invalid day.  

`POST /api/sync/pull/scheduler` `{ dates }`  
Those days as they are here: `{ ok, days }`, each `{ date, text, carried? }`. `tm pull` asks for the days the server has another way than the machine and that were not changed there since its last sync; a day changed there and not pushed yet is left as it is and told, and a day the server no longer has is removed there while it is still the day last synced.  

`GET /api/sync/pull/config`  
The server's `taskmgr.json` as it is: `{ ok, text }`. Used by `tm pull`.  

`GET /api/sync/pull/space?origin=&work=&repository=`  
A space's task folders listed like a push (what is beside them in the folder, a file right in it or a folder not named by a task id, is left out as a push leaves it out): `{ ok, entries }` with `{ path, content }` for a task file, `{ path, blob: sha1, size }` for any other file and `{ path, dir: true }` for an empty folder, and `deleted`, `{ path: hash }` (`''` for a folder): the attachments deleted in the server's web UI that the pulling machine still has, which `tm pull` deletes there while they are still what was deleted. 404 when the server has no tasks folder for it.  

`POST /api/sync/pull/deleted` `{ origin, work, repository, paths }`  
The pulling machine has dealt with those deleted paths (deleted them, or did not have them). Until it says so, its pushes of a path deleted in the web UI, still as it was deleted, are left out, so the path does not come back; pushed with another content, it was changed there and is written. `{ ok }`.  

`GET /api/sync/pull/file?origin=&work=&repository=&path=`  
One file of a space, raw. Nothing on the server is changed by the pull routes, but the pulling machine counts as one  
of the space's machines (409 `TOO_MANY_MACHINES` when it has two others).  

`PUT /api/sync/space` `{ origin, work, repository, machine, entries, base }`  
Bring one tasks folder to the snapshot, in place (a task that changed status is moved first, then only what differs is written, and what the snapshot lacks removed): `entries` are `{ path, content }` for task files (text),  
`{ path, blob: sha1 }` for every other file (attachments included), taken from the blob store, and  
`{ path, dir: true }` for an empty folder, paths relative to the tasks folder. After it, the server's copy  
is the pushed folder exactly, unless the push has a `base` (`{ path: sha1 }`: what the machine and the server last agreed on, the sha1 of a file, `""` for an empty folder), which `tm push` and taskmgrd send. The two are then compared a task at a time (a task folder right in the tasks folder or in a status folder, by its id, with all in it): a task pushed as it is in the base was not changed on the machine and stays as it is on the server (changed, moved or deleted there, or not); a task pushed another way, or in the base and no longer pushed, is the machine's and is written, or removed, as pushed; a task of the server that is neither pushed nor in the base stays. `{ ok, files, dirs, left }`, `left` being how many pushed tasks were left as they are on the server. 409 `PULL_FIRST`, nothing written, when the pushing machine is not one of the space's machines yet and the folder has a task the snapshot lacks (a work or repository of the same name added in the server's web UI, with tasks made there, or pushed by another machine): the machine then merges the two by task id (the 12 digits a task folder's name starts with) and pushes again, with `merged: true` in the body, which is not refused. For the merge it reads the folder with the pull routes and `merge=1` in the query, which does not count it as one of the space's machines yet (the push does). A task of the server whose id the machine does not have is brought there whole (subtasks and attachments included); a task whose id both have is the machine's: the push replaces the server's. 409 `MISSING_BLOBS` `{ missing }` when a blob is not in the  
store; nothing is written then. A blob no space refers to any more is removed once it is an hour old.  
`machine` (optional, the pusher's `MACHINE_ID`, or its hostname) is remembered as one of the space's machines, in  
`data/.sync-state.json` (409 `TOO_MANY_MACHINES`, nothing written, when it has two others), and the web UI shows it as  
where the copy comes from (`machines` in `GET /api/spaces` and `GET /api/tasks`), with a dot that is green while that  
machine has pushed or polled within the last three minutes.  
