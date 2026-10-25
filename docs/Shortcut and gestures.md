Shortcut and gestures
=====================

The terminal task list, and the keys and mouse gestures that drive it.  
`:h` shows the same shortcuts in a popup inside the application.  


Task list
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

Subtasks are listed under their task as a tree (`├─`, `└─`).  
The status bar shows the task counter, the work / repository, the task folder path, and the default text editor.  


Shortcuts
---------

l  
List tasks, or refresh task list.  

a / n  
Add a task: a large "New task" box opens where you type the whole `task.txt`, the  
first line being the name and the rest the details (enter for a new line; as in vim,  
esc then `:wq` creates it and `:q` cancels). It creates a folder `<id> <name>` inside current directory  
(the id is the creation minute, `YYYYMMDDHHmm`; a second task in the same minute gets  
the next minute). See [Task file.md](Task%20file.md).  

shift+a  
Add a subtask of the selected task: the same box, created inside that task's folder.  

e  
Edit a task with the default text editor (`EDITOR` in `.env`, see [Setup.md](Setup.md)).  

↑ or ↓ (arrow keys)  
j and k  
Move from tasks.  

h and l  
→ or ← (arrow keys)  
Move from main task and subtasks. Subtasks are already listed under their task as a tree  
(`├─`, `└─`); `l` opens a task's subtasks on their own, `h` goes back up.  
`h` at the top of the list goes back to the work / repository tree (when started with a bare `tm`, see [Commands.md](Commands.md)).  

x  
Mark a task as done.  

Space  
Show task details.  

Enter / o  
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
