'use strict';

// The scheduler: one page a day, kept as <data>/scheduler/<YYYY-MM-DD>.json:
//
//   { "date": "2026-11-17", "text": "the page", "carried": "2026-11-16" }
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
// page, and its file is removed once the page is empty again, unless it has `carried`: the day its
// first tasks were brought over from (see carryOver).
//
// The days are synced between the machines through the server (tm push / tm pull and taskmgrd, see
// pushScheduler in push.js and pullScheduler in pull.js), a day at a time, told apart by its hash
// (see schedulerStore). A page then has the tasks of every machine on it: one that is not on this
// machine is `missing` here, and is shown by the title of its line.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Whether `value` is a day as its file is named: "2026-11-17", a real one.
function isDate(value) {
  const date = String(value || '');
  const d = new Date(`${date}T00:00:00Z`);
  return DATE_RE.test(date) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

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

// The days as they are kept under `dataDir`, for the routes below and for the sync (the server's
// routes in server/sync.js, and push.js / pull.js on a machine): read(date) is { date, text,
// carried? } (an empty page for a day without a file), write(day) writes it (or removes the file
// of an empty day that was not carried), remove(date) removes it, has(date) says whether it has a
// file, before(date) is the last day before it that has one (or null), and list() is { date: hash }
// of every day that has a file, the hash being of its page and its `carried`: two machines have
// the same day when their hashes are the same.
function schedulerStore(dataDir) {
  const dir = path.join(dataDir, 'scheduler');
  const fileOf = (date) => path.join(dir, `${date}.json`);

  function read(date) {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(fileOf(date), 'utf8')) || {}; } catch (e) { raw = {}; }
    const text = typeof raw.text === 'string' ? raw.text : '';
    const old = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .filter(t => t && typeof t.work === 'string' && Array.isArray(t.ids) && t.ids.length > 0)
      .map(t => ({ work: t.work, repository: String(t.repository || ''), ids: t.ids.map(String), title: String(t.title || ''), line: t.line }));
    const day = { date, text: old.length ? withTasks(text, old) : text };
    if (typeof raw.carried === 'string') day.carried = raw.carried;
    return day;
  }

  const has = (date) => fs.existsSync(fileOf(date));

  function dates() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    return names.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).filter(isDate).sort();
  }

  function before(date) {
    const earlier = dates().filter(d => d < date);
    return earlier.length ? earlier[earlier.length - 1] : null;
  }

  const remove = (date) => fs.rmSync(fileOf(date), { force: true });

  function write({ date, text, carried }) {
    const day = { date, text: String(text ?? '') };
    if (typeof carried === 'string') day.carried = carried;
    if (!day.text && !day.carried) return remove(date);
    fs.mkdirSync(dir, { recursive: true });
    const file = fileOf(date);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(day, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  const hashOf = (day) => crypto.createHash('sha1').update(JSON.stringify([day.text, day.carried ?? null])).digest('hex');

  function list() {
    const out = {};
    for (const date of dates()) out[date] = hashOf(read(date));
    return out;
  }

  return { dir, read, write, remove, has, before, list };
}

// `find({ work, repository, ids })` answers the task as it is now ({ rel, title, details, status }) or null
// when it is not here: gone, or a task of another machine (the days are synced, the tasks of a work
// or repository only to the machines that have it). `here({ work, repository })` says whether this
// machine has that work or repository at all.
function createSchedulerApp({ dataDir, find, here = () => true }) {
  const app = express.Router();
  const store = schedulerStore(dataDir);
  const { read: readDay, write: writeDay, has: hasDay, before: dayBefore } = store;

  const fail = (status, message) => Object.assign(new Error(message), { status });

  function dateOf(value) {
    if (!isDate(value)) throw fail(400, 'Invalid date.');
    return String(value);
  }

  // A day opened for the first time (it has no file) starts with what was left of the last day
  // before it: that day's tasks that are still there and neither done nor aborted, in their
  // order, as the lines of its page. A task of a work or repository this machine does not have is
  // another machine's, where it may well be there still: it is brought over too, as its line is.
  // `carried` keeps the day they came from, and with it the file once its page is emptied, so they
  // are brought over once.
  function carryOver(date) {
    const from = dayBefore(date);
    if (!from) return readDay(date);
    const left = readDay(from).text.split('\n').map(taskOf).filter(Boolean).map(live)
      .filter(t => (t.missing ? !isHere(t) : t.status !== 'done' && t.status !== 'aborted'));
    const day = { date, text: left.map(taskLine).join('\n'), carried: from };
    if (left.length) writeDay(day);
    return left.length ? day : readDay(date);
  }

  const isHere = (t) => {
    try { return !!here(t); } catch (e) { return true; }
  };

  // A task as it is now: with its title, path and status, or `missing` (and the title given) when
  // it is gone.
  function live(t) {
    let now = null;
    try { now = find(t); } catch (e) { now = null; }
    return now ? { ...t, title: now.title, details: now.details || '', rel: now.rel, status: now.status, missing: false } : { ...t, rel: null, status: null, missing: true };
  }

  // The day as the page shows it: its text, and the tasks of its lines, in their order, as they
  // are now.
  const shown = (day) => ({ ...day, tasks: day.text.split('\n').map(taskOf).filter(Boolean).map(live) });

  // ?date=, and carry=1 for the day that is today where it is asked from: see carryOver.
  app.get('/api/scheduler', (req, res) => {
    const date = dateOf(req.query.date);
    res.json(shown(req.query.carry && !hasDay(date) ? carryOver(date) : readDay(date)));
  });

  // Write the page: `text`, its tasks among its lines.
  app.put('/api/scheduler', (req, res) => {
    const body = req.body || {};
    const day = { ...readDay(dateOf(body.date)), text: String(body.text ?? '') }; // `carried` stays
    writeDay(day);
    res.json(shown(day));
  });

  return app;
}

module.exports = { createSchedulerApp, schedulerStore, isDate };
