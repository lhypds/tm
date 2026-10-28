// The record of a run of Claude Code, kept in the task folder once the run is over (see session.js,
// end), as a folder named after the time the run began:
//
//   <task>/.claude_20261025143012/
//     run.json         the run as the API answers it (server/ai.js), transcript included, plus `input`
//                      (the first prompt claude was given) and `machine` (where it ran)
//     task.txt         the task's task.txt as it was when the run began (left out when it had none)
//     prompt.txt       its prompt.txt as it was (left out when it had none)
//     transcript.md    the same run, to read
//
// A dot folder: not an attachment in the web UI, not told to claude (ai/task.js listFiles), but synced
// with the task as every file in a task folder is (utils/taskUtils.js taskEntries), so the tm server
// that receives the task shows the run after it is over, whatever restarted meanwhile, and `tm pull`
// brings it to the other machines. The web UI's run button opens the latest record when the task has
// no run going (GET /api/task lists them, GET /api/ai/saved/:folder reads one).
const fs = require('fs');
const path = require('path');

const { TASK_FILE, PROMPT_FILE, formatDateTime } = require('../utils/taskUtils');

const PREFIX = '.claude_';
const RECORD_RE = /^\.claude_(\d{14})(?:-\d+)?$/;  // the time, and a number when two began the same second
const RUN_FILE = 'run.json';
const TRANSCRIPT_FILE = 'transcript.md';
const COPIED_FILES = [TASK_FILE, PROMPT_FILE];  // the task's own files, copied as they were

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// yyyyMMddHHmmss, local time, as task ids are stamped.
function stamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const isRecordName = (name) => RECORD_RE.test(String(name || ''));

// The folder of a record named `folder` in the task folder; refused when the name is not a record's.
function recordDir(taskDir, folder) {
  if (!isRecordName(folder)) throw httpError(400, `"${folder}" is not a run record.`);
  return path.join(taskDir, folder);
}

function duration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// The run as a text to read: what it was, the prompt, then the transcript item by item.
function transcript(record) {
  const out = [];
  const t = record.task || {};
  out.push(`# Claude: ${t.title || t.id || ''}`);
  out.push('');
  out.push(`- task: ${[t.work, t.repository, t.rel].filter(Boolean).join(' / ')}`);
  if (record.machine) out.push(`- machine: ${record.machine}`);
  if (record.cwd) out.push(`- folder: ${record.cwd}`);
  out.push(`- started: ${formatDateTime(record.startedAt)}`);
  if (record.endedAt) out.push(`- ended: ${formatDateTime(record.endedAt)} (${duration(record.endedAt - record.startedAt)})`);
  out.push(`- status: ${record.status}${record.error ? ` (${record.error})` : ''}`);
  if (record.model) out.push(`- model: ${record.model}`);
  if (record.sessionId) out.push(`- session: ${record.sessionId}`);
  if (typeof record.input === 'string') {
    out.push('');
    out.push('## Prompt');
    out.push('');
    out.push(record.input.replace(/\s+$/, ''));
  }
  out.push('');
  out.push('## Transcript');
  for (const item of record.items || []) {
    out.push('');
    switch (item.type) {
      case 'text':
        out.push((item.text || '').replace(/\s+$/, ''));
        break;
      case 'tool': {
        const mark = !item.done ? '…' : item.isError ? '✗' : '✓';
        out.push(`${mark} **${item.name}** ${item.summary || ''}`.replace(/\s+$/, ''));
        if (item.done && item.result) out.push('```', item.result.replace(/\s+$/, ''), '```');
        break;
      }
      case 'permission':
        out.push(`> Permission: ${item.toolName} ${item.summary || ''}`.replace(/\s+$/, ''));
        out.push(`> ${item.cancelled ? 'cancelled' : item.decision || 'unanswered'}`);
        break;
      case 'question':
        for (const q of item.questions || []) {
          out.push(`> Question: ${q.question}`);
          out.push(`> ${item.cancelled ? 'cancelled' : (item.answers && item.answers[q.question]) || 'unanswered'}`);
        }
        break;
      case 'result': {
        const parts = [duration(item.durationMs)];
        if (typeof item.turns === 'number') parts.push(`${item.turns} turn${item.turns === 1 ? '' : 's'}`);
        if (record.billed && typeof item.costUsd === 'number') parts.push(`$${item.costUsd.toFixed(2)}`);
        out.push(item.isError ? `Error: ${item.text || item.subtype}` : `Result: ${parts.join(' · ')}`);
        break;
      }
      case 'error':
        out.push(`Error: ${item.message}`);
        break;
      default:
        break;
    }
  }
  return out.join('\n').replace(/\s+$/, '') + '\n';
}

// Write the record of a run that is over: `record` is the run as the API answers it with its
// transcript, plus `input` and `machine`; `files` the task's own files as they were when the run
// began, { "task.txt": text, "prompt.txt": text }, each left out when null. Returns the folder's name.
function saveRun(taskDir, record, files = {}) {
  let name = `${PREFIX}${stamp(record.startedAt || Date.now())}`;
  for (let n = 2; fs.existsSync(path.join(taskDir, name)); n++) name = `${PREFIX}${stamp(record.startedAt || Date.now())}-${n}`;
  const dir = path.join(taskDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, RUN_FILE), JSON.stringify(record, null, 2) + '\n');
  for (const f of COPIED_FILES) if (typeof files[f] === 'string') fs.writeFileSync(path.join(dir, f), files[f]);
  fs.writeFileSync(path.join(dir, TRANSCRIPT_FILE), transcript(record));
  return name;
}

function readRun(dir) {
  const record = JSON.parse(fs.readFileSync(path.join(dir, RUN_FILE), 'utf8'));
  if (!record || typeof record !== 'object' || typeof record.id !== 'string') throw new Error('not a run');
  return record;
}

// The records of a task, newest first, each the run without its transcript plus `folder` (the
// record's name) and `saved: true`. A folder that is not a record, or whose run.json cannot be read, is left out.
function listRecords(taskDir) {
  let names;
  try { names = fs.readdirSync(taskDir); } catch (e) { return []; }
  const runs = [];
  for (const name of names.filter(isRecordName).sort().reverse()) {
    try {
      const { items, ...rest } = readRun(path.join(taskDir, name));
      runs.push({ ...rest, folder: name, saved: true });
    } catch (e) { /* not a record after all */ }
  }
  return runs;
}

// One record, transcript included, as listRecords lists it, plus `files`: the task's own files the
// record has a copy of (task.txt, prompt.txt), for the run dialog to show.
function readRecord(taskDir, folder) {
  const dir = recordDir(taskDir, folder);
  try {
    const files = COPIED_FILES.filter(f => fs.existsSync(path.join(dir, f)));
    return { ...readRun(dir), folder, saved: true, files };
  } catch (e) {
    throw httpError(404, 'No such run record.');
  }
}

// Remove a record, files and all.
function deleteRecord(taskDir, folder) {
  const dir = recordDir(taskDir, folder);
  if (!fs.existsSync(dir)) throw httpError(404, 'No such run record.');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { saveRun, listRecords, readRecord, deleteRecord, isRecordName };
