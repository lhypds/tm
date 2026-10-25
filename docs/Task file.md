Task file
=========

Each task is a folder `<id> <title>`, the id being its creation minute (`YYYYMMDDHHmm`). A folder named some other way is not a task, whatever is in it.

`task.txt`  
Plain text file, just the task details. The first line is the title.  
A task folder without a `task.txt` is still a task, titled after the folder name.  
Any other file in the folder is an attachment, except `prompt.txt` (optional): a prompt for an AI  
agent working on the task, which the web UI's Task panel edits under the task's text (see [Web UI.md](Web%20UI.md))  
and `tm run` hands to Claude Code with the task text and the list of the attachments (see [Commands.md](Commands.md)),  
and the `.claude_<time>` folders, one per run of Claude Code started from the web UI, written when the run is over:  
`run.json` (the run and its transcript), `task.txt` and `prompt.txt` (the task and its prompt as they were) and  
`transcript.md` (the same run, to read).  
They are not attachments, and are synced with the task, so the web UI's run button shows the last run wherever the task is.

File example:
```
Buy apple.
Buy apple from the store.
```


Subtasks
--------

A task folder may hold task folders of its own, named the same way: its subtasks.  
The terminal and the web UI list them as a tree under their task.  


Status
------

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
