// The works grouped by origin (the organization they are for): one group per named origin in
// `origins` ({ origin, income, color }), in file order and possibly without works, then the works without
// an origin in a last group whose origin is "".
export function groupWorksByOrigin(works, origins) {
  const groups = new Map((origins || []).map((o) => [o.origin, { origin: o.origin, income: o.income, color: o.color || "", works: [] }]));
  for (const w of works || []) {
    const origin = w.origin || "";
    if (!groups.has(origin)) groups.set(origin, { origin, income: null, color: "", works: [] });
    groups.get(origin).works.push(w);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.origin), ...list.filter((g) => !g.origin)];
}

// How `tm run` names the space a task is in (see run.js): its repository, or its work for a
// work's own task.
export const runName = (space) => space.repository || space.work;

// A task's id for `tm run`: "repository:202610241655" or "work:202610241655".
export const runId = (task) => `${runName(task.space)}:${task.id}`;

// The names `tm run` cannot tell apart: a bare name before the colon matches a work (its own
// tasks) or a repository of any work, so a repository named like another work's repository, or
// like a work, names more than one folder of tasks and `tm run` refuses it.
export function ambiguousRunNames(works) {
  const count = new Map();
  const add = (name) => count.set(name, (count.get(name) || 0) + 1);
  for (const w of works || []) {
    add(w.work);
    for (const p of w.repositories || []) add(p.name);
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name));
}
