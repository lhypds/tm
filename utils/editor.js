// Utility to select the user's preferred editor.
// Extracted from cli.js so other modules can reuse it.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const DEFAULT_EDITOR = process.platform === 'win32' ? 'notepad' : 'vim';

// true if `cmd` is an existing path or can be found on PATH
function commandExists(cmd) {
  if (!cmd) return false;
  if (cmd.includes('/') || cmd.includes('\\')) return fs.existsSync(cmd);
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

let cached = null;

// Resolve the editor once: { editor, missing }
// - editor:  the command line to use (e.g. "vim", "code --wait")
// - missing: the configured editor that was not found, or null
function getEditorInfo() {
  if (cached) return cached;
  const configured = (process.env.EDITOR || process.env.VISUAL || '').trim();
  let editor = configured || DEFAULT_EDITOR;
  let missing = null;
  if (configured && !commandExists(configured.split(/\s+/)[0])) {
    missing = configured;
    editor = DEFAULT_EDITOR;
  }
  cached = { editor, missing };
  return cached;
}

function getEditor() {
  return getEditorInfo().editor;
}

// Returns the argument list to open filePath and jump to the last line in insert mode
// (pass { atEnd: false } to just open the file, e.g. for the config file).
// `editor` may contain extra arguments (e.g. "code --wait"); they are kept.
function getEditorArgs(editor, filePath, { atEnd = true } = {}) {
  const tokens = (editor || '').trim().split(/\s+/).filter(Boolean);
  const extra = tokens.slice(1);
  const base = path.basename(tokens[0] || '');
  if (!atEnd) return [...extra, filePath];
  if (base === 'vim' || base === 'nvim' || base === 'vi') {
    // +normal! GA  =>  go to last line (G), enter insert mode at end of line (A)
    return [...extra, '+normal! GA', filePath];
  } else if (base === 'nano') {
    // nano +line goes to that line; use a large number to land on the last line
    return [...extra, '+99999', filePath];
  }
  return [...extra, filePath];
}

// Command + args ready for spawn, for the resolved editor.
function getEditorCommand(filePath, options) {
  const editor = getEditor();
  const cmd = editor.trim().split(/\s+/)[0];
  return { cmd, args: getEditorArgs(editor, filePath, options) };
}

module.exports = { getEditor, getEditorArgs, getEditorCommand, getEditorInfo };
