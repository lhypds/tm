Setup
=====

Settings go in a `.env` file in the taskmgr folder.  


Editor
------

`EDITOR=vim` (default when EDITOR is not set)  
Available editors: `vim`, `nvim`, `subl`(Sublime Text), `notepad`  
Used by `e` in the task list (see [Shortcut and gestures.md](Shortcut%20and%20gestures.md)) and by `tm config` (see [Commands.md](Commands.md)).  


Claude Code
-----------

`AI_PERMISSION_MODE=acceptEdits` (default when not set): the permission mode of a run of Claude Code started from the web UI's Task panel (see [Web UI.md](Web%20UI.md)): `acceptEdits` allows file edits as they come and asks about the rest in the browser, `default` asks about edits too, `plan` has Claude plan first and asks about the plan, `auto` lets a classifier decide, `bypassPermissions` asks nothing. The allow rules of your Claude settings apply in every mode, as in the terminal.  
`AI_RUNNER=1` (off when not set): taskmgrd also runs Claude Code here for the server this machine syncs with: a task pushed from here is run on this machine when the run button is used in the server's web UI, with this machine's `AI_PERMISSION_MODE`, and what Claude asks is answered there (see [taskmgrd.md](taskmgrd.md)).  
`AI_RUNNER_WINDOW=1` (off when not set): each of those runs also opens a terminal window on this machine that shows the transcript as it goes, says when the run is over and closes by itself `AI_RUNNER_WINDOW_CLOSE` seconds later (10 when not set; 0 keeps it until Enter; space stops the countdown). On macOS it is Terminal.app, or iTerm2 with `AI_RUNNER_TERMINAL=iterm` (see [taskmgrd.md](taskmgrd.md)).  


Sync
----

`SYNC_SERVER`, `SYNC_SERVER_TOKEN`, `MACHINE_ID`, `PUSHING`, `POLLING` and `POLLING_INTERVAL` set up the sync daemon and the server it pushes to; see [taskmgrd.md](taskmgrd.md).  
