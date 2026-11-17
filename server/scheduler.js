'use strict';

// The scheduler: one page a day, kept as <data>/scheduler/<YYYY-MM-DD>.json:
//
//   { "date": "2026-11-17", "text": "what was typed on the page", "tasks": [{ work, repository, ids, title, line }] }
//
// A day has no file until something is put on it (a task dragged onto the page, or a text typed),
// and its file is removed once it is empty again. A task is kept by where it lives, not by its
// path, which changes with its title and status: its space (work and repository) and `ids`, its
// own id after those of the tasks it is under (an id alone is unique in its folder only). `title`
// is the one it had when it was put there, shown when the task is no longer found. `line` is the
// row of the page the task sits on: how many lines of the text are above it (0 the top; tasks on
// the same line are in the list's order).

const fs = require('fs');
const path = require('path');
const express = require('express');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `find({ work, repository, ids })` answers the task as it is now ({ rel, title, status }) or null
// when it is gone; `idsOf({ work, repository, rel })` the ids of the task at `rel` (throws when
// there is none).
function createSchedulerApp({ dataDir, find, idsOf }) {
  const app = express.Router();
  const dir = path.join(dataDir, 'scheduler');

  const fail = (status, message) => Object.assign(new Error(message), { status });

  function dateOf(value) {
    const date = String(value || '');
    const d = new Date(`${date}T00:00:00Z`);
    if (!DATE_RE.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw fail(400, 'Invalid date.');
    return date;
  }

  const lineOf = (n) => (Number.isInteger(n) && n > 0 ? n : 0);

  const fileOf = (date) => path.join(dir, `${date}.json`);

  function readDay(date) {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(fileOf(date), 'utf8')) || {}; } catch (e) { raw = {}; }
    const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .filter(t => t && typeof t.work === 'string' && Array.isArray(t.ids) && t.ids.length > 0)
      .map(t => ({ work: t.work, repository: String(t.repository || ''), ids: t.ids.map(String), title: String(t.title || ''), line: lineOf(t.line) }));
    return { date, text: typeof raw.text === 'string' ? raw.text : '', tasks };
  }

  function writeDay(day) {
    const file = fileOf(day.date);
    if (!day.text && day.tasks.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(day, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  const same = (a, b) => a.work === b.work && a.repository === b.repository && a.ids.join('/') === b.ids.join('/');

  // The day as the page shows it: each task with its title, path and status as they are now, or
  // `missing` (and the title it was put there with) when it is gone.
  function shown(day) {
    return {
      ...day,
      tasks: day.tasks.map((t) => {
        let now = null;
        try { now = find(t); } catch (e) { now = null; }
        return now ? { ...t, title: now.title, rel: now.rel, status: now.status, missing: false } : { ...t, rel: null, status: null, missing: true };
      })
    };
  }

  app.get('/api/scheduler', (req, res) => {
    res.json(shown(readDay(dateOf(req.query.date))));
  });

  // Write the page: its `text` and, with `tasks` ([{ work, repository, ids, line }]), where its
  // tasks sit: they are put in that order, each on its line (one that is not in the list keeps
  // its line, after them; one that is not on the day is not added). With `exact`, the list is the
  // day's tasks: one that is not on the day is put on it (when the task is found), and one that is
  // not in the list is taken off (how the page undoes and redoes its changes).
  app.put('/api/scheduler', (req, res) => {
    const body = req.body || {};
    const day = readDay(dateOf(body.date));
    if (body.text !== undefined) day.text = String(body.text ?? '');
    if (Array.isArray(body.tasks)) {
      const rest = [...day.tasks];
      const placed = [];
      for (const t of body.tasks) {
        const entry = { work: String(t.work || ''), repository: String(t.repository || ''), ids: (Array.isArray(t.ids) ? t.ids : []).map(String) };
        const i = rest.findIndex(x => same(x, entry));
        if (i >= 0) placed.push({ ...rest.splice(i, 1)[0], line: lineOf(t.line) });
        else if (body.exact && entry.ids.length > 0 && !placed.some(x => same(x, entry))) {
          let now = null;
          try { now = find(entry); } catch (e) { now = null; }
          if (now) placed.push({ ...entry, title: now.title, line: lineOf(t.line) });
        }
      }
      day.tasks = body.exact ? placed : [...placed, ...rest];
    }
    writeDay(day);
    res.json(shown(day));
  });

  // Put tasks ({ work, repository, rel } each) on a day, on `line` (0, the top, when not given),
  // as the `index`th of its tasks (the last ones when not given); one that is there already stays
  // where it is.
  app.post('/api/scheduler/tasks', (req, res) => {
    const body = req.body || {};
    const day = readDay(dateOf(body.date));
    let at = Number.isInteger(body.index) && body.index >= 0 ? Math.min(body.index, day.tasks.length) : day.tasks.length;
    for (const t of Array.isArray(body.tasks) ? body.tasks : []) {
      const entry = { work: String(t.work || ''), repository: String(t.repository || ''), ids: idsOf(t), title: '', line: lineOf(body.line) };
      const now = find(entry);
      if (!now) throw fail(404, 'Task not found.');
      entry.title = now.title;
      if (!day.tasks.some(x => same(x, entry))) day.tasks.splice(at++, 0, entry);
    }
    writeDay(day);
    res.json(shown(day));
  });

  // Take a task off a day: ?date=&work=&repository=&ids=<id>/<id>.
  app.delete('/api/scheduler/task', (req, res) => {
    const day = readDay(dateOf(req.query.date));
    const entry = { work: String(req.query.work || ''), repository: String(req.query.repository || ''), ids: String(req.query.ids || '').split('/') };
    day.tasks = day.tasks.filter(x => !same(x, entry));
    writeDay(day);
    res.json(shown(day));
  });

  return app;
}

module.exports = { createSchedulerApp };
