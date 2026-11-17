// What both sides last agreed on, per space ("origin/work/repository" -> { path: sha1 }), kept in
// .tm-sync-state.json next to taskmgr.json. taskmgrd writes it after each push and `tm pull` after each
// pull, so a path that is in it but gone on one side was deleted there (not just never synced), and
// that deletion can be mirrored to the other side. A path never in it is never deleted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_CONFIG_PATH } = require('./config');

const STATE_PATH = path.join(path.dirname(DEFAULT_CONFIG_PATH), '.tm-sync-state.json');

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

// { path: sha1 } of a snapshot's entries (a task file by its text, another file by its blob sha1,
// an empty folder as '').
function manifestOf(entries) {
  const m = {};
  for (const e of entries) m[e.path] = e.dir === true ? '' : typeof e.content === 'string' ? sha1(Buffer.from(e.content, 'utf8')) : e.blob || '';
  return m;
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return data && typeof data.spaces === 'object' && data.spaces ? data : { spaces: {} };
  } catch (e) {
    return { spaces: {} };
  }
}

function get(key) {
  return load().spaces[key] || null;
}

function save(state) {
  const tmp = `${STATE_PATH}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_PATH);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function set(key, manifest) {
  const state = load();
  state.spaces[key] = manifest;
  save(state);
}

// The scheduler's days both sides last agreed on, { date: hash } (see schedulerStore in
// server/scheduler.js), kept beside the spaces: a day whose hash here is still that one was not
// changed here since, and one that is in it but gone on a side was deleted there.
function getScheduler() {
  const days = load().scheduler;
  return days && typeof days === 'object' ? days : {};
}

function setScheduler(days) {
  save({ ...load(), scheduler: days });
}

module.exports = { manifestOf, get, set, getScheduler, setScheduler };
