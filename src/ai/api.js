import { request, json, q, sp } from "@utils/api";
import { getHere } from "@utils/here";

// The machine this browser is on, sent with the requests that start a run: a run on that very machine
// opens no terminal window there (the browser shows it already), one on another machine does (see
// ai/window.js). Nothing when it is not known.
const here = () => (getHere() ? { here: getHere() } : {});

// The runs of Claude Code on tasks (server/ai/ai.js): starting one, answering what Claude asks, stopping
// one. The runs themselves arrive live on the event stream (see useRuns).

// The event stream of every run: GET /api/ai/events.
export const runEventsUrl = "/api/ai/events";

// Start Claude Code on the task at `rel` in the space; resolves to { run } with its transcript (409
// while the task has a run going). `after` is what Claude is told to do with its changes once the
// work is done: "push" (commit and push), "pr" (a new branch, a commit and a pull request) or null.
// `machine` names the one of the folder's machines to run on, when it is synced by two (asked of the user then, see RunOnModal; null: the
// server picks, one whose runner is connected).
export const startRun = (space, rel, after = null, machine = null) =>
  request("/api/ai/run", json("POST", { ...sp(space), rel, ...(after ? { after } : {}), ...(machine ? { machine } : {}), ...here() }));

// Start Claude Code in the space with `prompt`, on no task and making none (the new task dialog's
// Execute): where a task of the space would run. `text` is the task text typed there, given to Claude
// as context; `after` as in startRun. Resolves to { run } with its transcript.
export const startSpacePrompt = (space, { prompt, text = "", after = null }) =>
  request("/api/ai/prompt", json("POST", { ...sp(space), prompt, text, ...(after ? { after } : {}), ...here() }));

// The machines Claude Code can be run on from here (those that sync with this server): { machines:
// [{ name, seenAt, online, runner, linked, port }] }, `linked` whether the machine's taskmgrd is
// connected, so it can be given a tm command, `runner` whether it runs Claude Code too, so it can be
// given a prompt, and `port` the port of the web UI there (see @utils/here).
export const getMachines = () => request("/api/ai/machines");

// Forget `machine`: it leaves the machines, and the folders it synced stay as the server's own; it
// is back, syncing as before, at its next push or pull. { ok: true }.
export const forgetMachine = (machine) => request(`/api/ai/machines/${encodeURIComponent(machine)}`, { method: "DELETE" });

// Start Claude Code on `machine` with `prompt` as it is, on no task, in the home folder there;
// resolves to { run } with its transcript (409 when the machine's runner is not connected).
export const startMachineRun = (machine, prompt) => request("/api/ai/machine/run", json("POST", { machine, prompt, ...here() }));

// Run a tm command on `machine` ("/restart": `tm restart` there), started by its runner in a process
// of its own; resolves to { ok, command } once started (400 when it is not a command that can be run
// this way, 409 when the machine's runner is not connected).
export const runMachineCommand = (machine, command) => request("/api/ai/machine/command", json("POST", { machine, command }));

// Answer the run's pending question `pending`: { decision: "allow" | "deny" } for a permission,
// { answers: { "<question>": "<answer>" } } for a question. { run }.
export const answerRun = (id, pending, body) => request(`/api/ai/runs/${encodeURIComponent(id)}/answer`, json("POST", { pending, ...body }));

export const stopRun = (id) => request(`/api/ai/runs/${encodeURIComponent(id)}/stop`, json("POST", {}));

// A run's record, kept in the task folder once the run was over (its folder is named in the task's
// `runs`, see getTask): the run with its transcript. { run }.
export const getSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`);

// Remove that record (for a copy pushed from another machine, there too). { ok: true }.
export const deleteSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`, { method: "DELETE" });
