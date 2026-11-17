'use strict';

// The scheduler: one page a day, kept as <data>/scheduler/<YYYY-MM-DD>.json:
//
//   { "date": "2026-11-17", "text": "the page" }
//
// The page is its text and nothing else. A task put on it is a line of that text (the page shows
// such a line as a card), so the text copied from the page has its tasks in it:
//
//   [the task's title](tm://<work>/<repository>#<id>/<id>)
//
// A task is kept by where it lives, not by its path, which changes with its title and status: its
// space (work and repository, percent-encoded) and its ids, its own id after those of the tasks it
// is under (an id alone is unique in its folder only). The title is the one it had when the line
// was written, shown when the task is no longer found. A day has no file until something is on its
// page, and its file is removed once the page is empty again.

const fs = require('fs');
const path = require('path');
const express = require('express');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// `find({ work, repository, ids })` answers the task as it is now ({ rel, title, status }) or null
// when it is gone.
function createSchedulerApp({ dataDir, find }) {
  const app = express.Router();
  const dir = path.join(dataDir, 'scheduler');

  const fail = (status, message) => Object.assign(new Error(message), { status });

  function dateOf(value) {
    const date = String(value || '');
    const d = new Date(`${date}T00:00:00Z`);
    if (!DATE_RE.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw fail(400, 'Invalid date.');
    return date;
  }

  const fileOf = (date) => path.join(dir, `${date}.json`);

  // A line of the page that is a task (see above), and the task of such a line (null for any
  // other line): { work, repository, ids, title }.
  const TASK_RE = /^\[(.*)\]\(tm:\/\/([^/#()\s]*)\/([^/#()\s]*)#([^#()\s]+)\)$/;
  const enc = (v) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const taskLine = (t) => `[${t.title}](tm://${enc(t.work)}/${enc(t.repository)}#${t.ids.map(enc).join('/')})`;
  function taskOf(line) {
    const m = TASK_RE.exec(line);
    if (!m) return null;
    try {
      return { work: decodeURIComponent(m[2]), repository: decodeURIComponent(m[3]), ids: m[4].split('/').map(decodeURIComponent), title: m[1] };
    } catch (e) {
      return null;
    }
  }

  // A day written before its tasks were lines of its text had them beside it, each
  // { work, repository, ids, title, line } with `line` the lines of the text above it: read as
  // the page it was.
  function withTasks(text, tasks) {
    const lines = text === '' && tasks.every(t => !(t.line > 0)) ? [] : text.split('\n');
    const out = [];
    for (let i = 0; i <= lines.length; i++) {
      for (const t of tasks) if (Math.max(0, Math.min(Number(t.line) || 0, lines.length)) === i) out.push(taskLine(t));
      if (i < lines.length) out.push(lines[i]);
    }
    return out.join('\n');
  }

  function readDay(date) {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(fileOf(date), 'utf8')) || {}; } catch (e) { raw = {}; }
    const text = typeof raw.text === 'string' ? raw.text : '';
    const old = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .filter(t => t && typeof t.work === 'string' && Array.isArray(t.ids) && t.ids.length > 0)
      .map(t => ({ work: t.work, repository: String(t.repository || ''), ids: t.ids.map(String), title: String(t.title || ''), line: t.line }));
    return { date, text: old.length ? withTasks(text, old) : text };
  }

  function writeDay(day) {
    const file = fileOf(day.date);
    if (!day.text) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(day, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  // A task as it is now: with its title, path and status, or `missing` (and the title given) when
  // it is gone.
  function live(t) {
    let now = null;
    try { now = find(t); } catch (e) { now = null; }
    return now ? { ...t, title: now.title, rel: now.rel, status: now.status, missing: false } : { ...t, rel: null, status: null, missing: true };
  }

  // The day as the page shows it: its text, and the tasks of its lines, in their order, as they
  // are now.
  const shown = (day) => ({ ...day, tasks: day.text.split('\n').map(taskOf).filter(Boolean).map(live) });

  app.get('/api/scheduler', (req, res) => {
    res.json(shown(readDay(dateOf(req.query.date))));
  });

  // Write the page: `text`, its tasks among its lines.
  app.put('/api/scheduler', (req, res) => {
    const body = req.body || {};
    const day = { date: dateOf(body.date), text: String(body.text ?? '') };
    writeDay(day);
    res.json(shown(day));
  });

  return app;
}

module.exports = { createSchedulerApp };
