
Develop
=======


Web UI
------

Develop with hot reload in the foreground (Ctrl+C to stop):  
`pnpm run dev`  

Production server without pm2, after `pnpm run build`:  
`NODE_ENV=production node server/index.js [path/to/taskmgr.json]` (PowerShell: `$env:NODE_ENV='production'; node server/index.js`)  


API
---

The server's APIs are listed in [Server.md](Server.md).  


AI
--

The Claude Code integration itself is in `ai/`: `task.js` finds a task and makes its first prompt (shared by the terminal  
and the web UI), `run.js` is `tm run` (the `run.js` at the root only requires it), and `session.js` runs Claude Code for the  
web UI through the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, which brings its own copy of Claude Code and uses  
the login in `~/.claude`), keeping the runs and relaying what Claude asks, and `record.js` writes a run that is over into  
the task folder (`.claude_<time>/`: run.json, prompt.txt, transcript.md) and reads those records back. A task pushed from another machine runs on  
that machine: `runner.js` is the runner in its taskmgrd (`AI_RUNNER=1`), which holds a connection to the server, carries  
out the commands it gets on its own `session.js` and sends the session's events back, and `remote.js` is the server's  
side, which keeps those runs as it gets them and hands the browsers' commands over, so `server/ai.js` serves both kinds  
of run as one. Everything around it sits with its own layer: the API is `server/ai.js` (see [Server.md](Server.md)), the  
browser's calls to it are the `*Run` functions of `src/utils/api.js`, the hook that follows the runs is  
`src/hooks/useRuns.js`, the components that show them are `src/components/RunButton` (beside a prompt) and  
`src/components/RunModal`, and their texts are the `ai` keys of the translations in `src/i18n`. What claude writes to  
stderr goes to `logs/ai.log`.    
