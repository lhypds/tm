import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import Attachments from "@components/Attachments";
import { BrainIcon, FolderIcon, TrashIcon } from "@components/icons";
import { RunButton } from "@ai";
import { fileUrl } from "@utils/api";
import { moveIndex } from "@utils/keys";
import { formatSize, previewKind } from "@utils/task";
import styles from "./editor.module.css";

// An icon button beside the title, framed as the Task panel's (`.btn`); `dot` marks it. It never
// keeps the focus, so the dialog's keys stay the dialog's.
function HeaderButton({ label, dot, pressed, onClick, children }) {
  return (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      data-dot={dot}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// The task dialog: a task's task.txt in one text area, the way the terminal opens it in $EDITOR
// (the first line is the title), for a new task (`task` null: "New task", or with `parent` a
// subtask of that task, which the title says) and for an existing one (`task`: "Task", opened with
// space or a double click on it). `isOpen` is separate so a closed dialog keeps its last text until it reopens.
// Nothing is written until it is saved, with the button at the bottom right or cmd/ctrl+s:
// onSave({ text, files, prompt, execute }), `files` the attachments added to a new task (kept until
// then), `prompt` the Prompt area's text, or null while that is hidden (the prompt is left as it is).
// The brain beside the title shows the Prompt area under the text, the task's prompt.txt (`prompt`:
// its saved text, null for none, undefined until read). With a prompt typed there the button reads
// "Save & Execute" (`execute`): the task is saved and Claude Code runs on it; with it blank or
// hidden, "Save". The button is greyed out while the task's text is blank. For a new task the
// prompt starts hidden; for an existing one as it was last left (`promptDefault`, onPromptOpen(open)
// keeps it).
// An existing task also has, beside the title, its folder (onOpenFolder) and delete (onDelete, which
// asks first); beside "Prompt" the run button (RunButton: `run` the task's run, shown by
// onRun(task) while it goes, `noRunner` why it cannot run; otherwise it saves and executes, as the
// button at the bottom); and under the texts its attachments (`files`, the one at `selectedRel`
// marked), a click on one opening it through onOpenFile.
// Keys: esc in a text takes the caret out of it (a second esc closes the dialog, as Cancel does:
// what was typed is dropped), and the page's keys then work, handed over by Home through `keysRef`
// (keysRef.current(name) says whether it used the key): j / k walk the task's text, the prompt
// (when shown) and the attachments (onSelectRel(rel)), the one chosen shaded; e / i put the caret
// in the text chosen; g shows the prompt and puts the caret in it; r runs (as the run button). On
// an existing task also: enter / space open the attachment chosen, d deletes it (onDeleteFile), or
// the task with none chosen, o opens the folder, and q, space or enter close the dialog while
// nothing was typed. A new task opens with the caret in its text, an existing one with nothing chosen.
export default function TaskEditorModal({
  isOpen,
  task,
  space,
  parent,
  saving,
  keysRef,
  prompt: savedPromptText,
  promptDefault,
  onPromptOpen,
  files = [],
  selectedRel,
  onSelectRel,
  run,
  noRunner,
  onRun,
  onCancel,
  onSave,
  onPreview,
  onOpenFile,
  onOpenFolder,
  onDelete,
  onDeleteFile,
}) {
  const { t } = useTranslation();
  const title = task ? t("panel.heading") : parent ? t("editor.newSubtask", { name: parent.title || parent.id }) : t("editor.newTask");
  const savedText = task?.details ?? "";
  const savedPrompt = (task && savedPromptText) || "";
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, setPending] = useState([]); // File objects
  const [section, setSection] = useState(null); // the text the caret is in, or was last, or j / k chose: "task" or "prompt"; null: none yet
  const base = useRef({ text: "", prompt: "" }); // the texts as saved, to tell what was typed
  const textRef = useRef(null);
  const promptRef = useRef(null);
  const taskKey = task?.key ?? null;

  // Opened (or for another task): the saved texts, nothing chosen, and for a new task the caret in its text.
  useEffect(() => {
    if (!isOpen) return;
    base.current = { text: savedText, prompt: savedPrompt };
    setText(savedText);
    setPrompt(savedPrompt);
    setPending([]);
    setPromptOpen(taskKey ? !!promptDefault : false);
    setSection(taskKey ? null : "task");
    if (!taskKey) textRef.current?.focus();
  }, [isOpen, taskKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A saved text read later (the prompt, once the folder is read; a reload) is taken unless it was typed on.
  useEffect(() => {
    const old = base.current.text;
    base.current.text = savedText;
    setText((cur) => (cur === old ? savedText : cur));
  }, [savedText]);
  useEffect(() => {
    const old = base.current.prompt;
    base.current.prompt = savedPrompt;
    setPrompt((cur) => (cur === old ? savedPrompt : cur));
  }, [savedPrompt]);

  const dirty = text !== savedText || (promptOpen && prompt !== savedPrompt) || pending.length > 0;
  const execute = promptOpen && !!prompt.trim(); // a blank prompt is not executed
  const blocked = !text.trim(); // nothing to save
  const going = !!run && (run.status === "running" || run.status === "queued");
  const chosen = selectedRel ? null : section === "prompt" && !promptOpen ? "task" : section;

  const focusText = (area) => setTimeout(() => (area === "prompt" ? promptRef : textRef).current?.focus());
  const choose = (area) => {
    setSection(area);
    onSelectRel?.(null);
  };

  // The caret goes to the prompt when it is shown; hidden, back to a new task's text.
  function showPrompt(open) {
    setPromptOpen(open);
    if (task) onPromptOpen?.(open);
    if (open) focusText("prompt");
    else {
      setSection((s) => (s === "prompt" ? "task" : s));
      if (!task) focusText("task");
    }
  }

  function submit(e) {
    e?.preventDefault();
    if (saving || blocked) return;
    onSave({ text, files: pending, prompt: promptOpen ? prompt : null, execute });
  }
  // The task's run going is shown; otherwise it is saved and executed.
  function runNow() {
    if (going) onRun(task);
    else if (execute && !noRunner) submit();
  }

  // esc: out of the text first, then (nothing being typed in) the dialog closes
  function onEscape() {
    const el = document.activeElement;
    if (el === textRef.current || el === promptRef.current) el.blur();
    else onCancel();
  }

  // cmd/ctrl+s saves wherever the caret is, in a text or out of it.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      submitRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // The page's keys, with the caret in no text (see above).
  const keys = (key) => {
    const name = key.length === 1 ? key.toLowerCase() : key;
    const rows = ["task", ...(promptOpen ? ["prompt"] : []), ...files.map((f) => f.rel)];
    const file = files.find((f) => f.rel === selectedRel) || null;
    const move = moveIndex(name, file ? rows.indexOf(file.rel) : rows.indexOf(chosen), rows.length);
    if (move !== null) {
      const row = rows[move];
      if (row === "task" || row === "prompt") choose(row);
      else onSelectRel?.(row);
      return true;
    }
    if (name === "e" || name === "i") {
      focusText(chosen || "task");
      return true;
    }
    if (name === "g") {
      if (!promptOpen) showPrompt(true);
      else focusText("prompt");
      return true;
    }
    if (name === "r") {
      runNow();
      return true;
    }
    if (!task) return false;
    if (name === "d") {
      // the chosen attachment, else the task itself (not on the prompt, which is not deleted); each asks first
      if (file) onDeleteFile(file);
      else if (chosen !== "prompt") onDelete(task);
      return true;
    }
    if (name === "o") {
      onOpenFolder(task);
      return true;
    }
    if (!["q", "enter", "space"].includes(name)) return false;
    if (name !== "q" && file) onOpenFile(file);
    else if (!dirty) onCancel(); // what was typed is not dropped by a stray key
    return true;
  };
  useEffect(() => {
    if (!keysRef) return;
    keysRef.current = isOpen ? keys : null;
  });

  const brainLabel = t(promptOpen ? "panel.hidePrompt" : "panel.showPrompt");
  const actions = (
    <div className={styles.headerButtons}>
      {task && (
        <HeaderButton label={t("tree.openFolder")} onClick={() => onOpenFolder(task)}>
          <FolderIcon />
        </HeaderButton>
      )}
      <HeaderButton label={brainLabel} dot={!!prompt.trim()} pressed={promptOpen} onClick={() => showPrompt(!promptOpen)}>
        <BrainIcon />
      </HeaderButton>
      {task && (
        <HeaderButton label={t("delete.title")} onClick={() => onDelete(task)}>
          <TrashIcon />
        </HeaderButton>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onCancel} onEscape={onEscape} title={title} titleActions={actions} closeOnOverlay={!!task && !dirty} className={styles.modal} tight>
      <form className={styles.form} onSubmit={submit}>
        <textarea
          ref={textRef}
          className={styles.text}
          value={text}
          placeholder={task ? t("common.untitled") : undefined}
          data-selected={chosen === "task"}
          onFocus={() => choose("task")}
          onChange={(e) => setText(e.target.value)}
          aria-label={title}
        />

        {promptOpen && (
          <>
            {/* the prompt's head, as the panel's divider: its name, and the run button */}
            <div className={styles.promptHead}>
              <span>{t("panel.prompt")}</span>
              {task && <RunButton run={run} disabled={!execute || blocked} reason={noRunner} onClick={runNow} />}
            </div>
            <textarea
              ref={promptRef}
              className={styles.text}
              value={prompt}
              data-selected={chosen === "prompt"}
              onFocus={() => choose("prompt")}
              onChange={(e) => setPrompt(e.target.value)}
              aria-label={t("panel.prompt")}
            />
          </>
        )}

        {!task && (
          <Attachments
            space={space}
            onPreview={onPreview}
            files={[]}
            pending={pending}
            onAdd={(list) => setPending((p) => [...p, ...list])}
            onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
          />
        )}
        {task && files.length > 0 && (
          <div className={styles.files}>
            <div className="muted">{t("attach.title")}</div>
            <ul>
              {files.map((f) => (
                <li key={f.rel} data-selected={f.rel === selectedRel}>
                  <a
                    href={fileUrl(task.space, f.rel)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (!previewKind(f.name)) return;
                      e.preventDefault();
                      e.currentTarget.blur(); // a focused link would keep the keys from the dialog
                      onOpenFile(f);
                    }}
                  >
                    {f.name}
                  </a>
                  <span className="muted"> {formatSize(f.size)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.actions}>
          <span className={`muted ${styles.hint}`}>{t(execute ? "editor.executeHint" : "editor.saveHint")}</span>
          <button type="button" className="btn lg" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving || blocked}>
            {saving ? t("editor.saving") : t(execute ? "editor.saveExecute" : "editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
