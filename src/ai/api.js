import { request, json, q, sp } from "@utils/api";

// The runs of Claude Code on tasks (server/ai/ai.js): starting one, answering what Claude asks, stopping
// one. The runs themselves arrive live on the event stream (see useRuns).

// The event stream of every run: GET /api/ai/events.
export const runEventsUrl = "/api/ai/events";

// Start Claude Code on the task at `rel` in the space; resolves to { run } with its transcript (409
// while the task has a run going). `after` is what Claude is told to do with its changes once the
// work is done: "push" (commit and push), "pr" (a new branch, a commit and a pull request) or null.
// `machine` names the one of the folder's machines to run on, when it is synced by two (null: the
// server picks, one whose runner is connected).
export const startRun = (space, rel, after = null, machine = null) =>
  request("/api/ai/run", json("POST", { ...sp(space), rel, ...(after ? { after } : {}), ...(machine ? { machine } : {}) }));

// The machines Claude Code can be run on from here (those that sync with this server): { machines:
// [{ name, seenAt, online, runner }] }, `runner` whether the machine's runner is connected, so it can
// be given a prompt.
export const getMachines = () => request("/api/ai/machines");

// Start Claude Code on `machine` with `prompt` as it is, on no task, in the home folder there;
// resolves to { run } with its transcript (409 when the machine's runner is not connected).
export const startMachineRun = (machine, prompt) => request("/api/ai/machine/run", json("POST", { machine, prompt }));

// Answer the run's pending question `pending`: { decision: "allow" | "deny" } for a permission,
// { answers: { "<question>": "<answer>" } } for a question. { run }.
export const answerRun = (id, pending, body) => request(`/api/ai/runs/${encodeURIComponent(id)}/answer`, json("POST", { pending, ...body }));

export const stopRun = (id) => request(`/api/ai/runs/${encodeURIComponent(id)}/stop`, json("POST", {}));

// A run's record, kept in the task folder once the run was over (its folder is named in the task's
// `runs`, see getTask): the run with its transcript. { run }.
export const getSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`);

// Remove that record (for a copy pushed from another machine, there too). { ok: true }.
export const deleteSavedRun = (space, rel, folder) => request(`/api/ai/saved/${encodeURIComponent(folder)}?${q({ ...sp(space), rel })}`, { method: "DELETE" });
