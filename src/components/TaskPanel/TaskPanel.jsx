import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { BrainIcon, TrashIcon } from "@components/icons";
import Attachments from "@components/Attachments";
import RunButton from "@components/RunButton";
import RunList from "@components/RunList";
import styles from "./panel.module.css";

// The selected task beside the list: its task.txt as written, editable in place. It is saved
// when the text loses focus or on cmd/ctrl+s; esc ends the edit, saving it. onSave(task, text)
// writes it. When `focusKey` is the task's key, the text named by `focusArea` ("task", or "prompt")
// takes the focus and onFocused is called.
// Under a head like the tree's: "Task", with the brain and delete at its right; onDelete(task)
// asks before deleting. The brain (onTogglePrompt) shows and hides the task's prompt, its
// prompt.txt (`promptOpen`): the text is then split in two, the prompt under a divider that says
// "Prompt" and carries the prompt's own delete (onDeletePrompt(task) asks first).
// Typing a prompt creates the file, onSavePrompt(task, text) writing it; a blank one deletes it.
// The divider also carries the run button (RunButton), greyed out until the task has a prompt, or
// while `noRunner` says why the task cannot run now (a copy from a machine that is not connected; the
// text is the button's tooltip): onRun(task) starts Claude Code on the task and opens the run's dialog,
// or opens the dialog of the run the task has (`run`, see useRuns) or of its last run kept in the
// folder (`attachments.runs`), which the button shows with a dot. Under the prompt's text, those runs
// are listed as the files are (RunList): a click on one opens it in the dialog (onRun(task, folder)),
// its × removes it (attachments.forgetRun).
// `section` is the text the keyboard is on, "task" or "prompt" (null while an attachment is), shown
// by which head is highlighted; onSection(area) is called when a text is clicked into.
// Under the texts, the task's attachments; files dropped anywhere on the panel are uploaded into
// the task folder (`attachments` is the task's useTaskFiles, which also holds the prompt;
// onPreview(file) opens one; `selectedFile` is the rel of the one the keyboard is on).
export default function TaskPanel({
  task,
  focused,
  focusKey,
  focusArea,
  onFocused,
  onSave,
  onDelete,
  onPreview,
  attachments,
  selectedFile,
  promptOpen,
  onTogglePrompt,
  section,
  onSection,
  onSavePrompt,
  onDeletePrompt,
  run,
  noRunner,
  onRun,
}) {
  const { t } = useTranslation();
  const textRef = useRef(null);
  const promptRef = useRef(null);
  const [over, setOver] = useState(false);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const hasPrompt = attachments.prompt != null; // not while unread (undefined) or without a file (null)
  const focusOf = (area) => !!task && focusKey === task.key && focusArea === area;

  return (
    <div
      className={styles.root}
      data-over={over}
      onDragOver={(e) => {
        if (!task || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        // leaving for a child keeps the highlight; leaving the panel drops it
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
      }}
      onDrop={(e) => {
        if (!task || !hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) attachments.add(files);
      }}
    >
      {/* the highlight moves down to the prompt's divider while the keyboard is on the prompt */}
      <div className={styles.bar} data-focused={focused && section !== "prompt"}>
        <span className={styles.barTitle}>{t("panel.heading")}</span>
        <div className={styles.barActions}>
          {/* it looks the same shown or hidden (the prompt being there says so), with a dot while the
              task has a prompt.txt. Not kept focused on mousedown: a text being edited saves on the
              blur before the toggle; let go after the click, so space and enter are the page's again. */}
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            data-dot={hasPrompt}
            aria-pressed={promptOpen}
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePrompt();
            }}
            title={t(promptOpen ? "panel.hidePrompt" : "panel.showPrompt")}
            aria-label={t(promptOpen ? "panel.hidePrompt" : "panel.showPrompt")}
          >
            <BrainIcon />
          </button>
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            disabled={!task}
            onClick={(e) => {
              e.currentTarget.blur();
              onDelete(task);
            }}
            title={t("delete.title")}
            aria-label={t("delete.title")}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      {task ? (
        <>
          {/* The task's part: its text, with its files under it. The text is keyed by id, which a
              rename (a new first line) keeps, so saving does not lose the focus. */}
          <div className={styles.region}>
            <TaskText
              key={`${task.space.work}/${task.space.repository || ""}/${task.id}`}
              task={task}
              textRef={textRef}
              focus={focusOf("task")}
              onFocused={onFocused}
              onFocus={() => onSection("task")}
              onSave={onSave}
            />
            <Attachments
              className={styles.files}
              space={task.space}
              files={attachments.files}
              selectedRel={selectedFile}
              busy={attachments.uploading}
              onAdd={attachments.add}
              onRemove={attachments.remove}
              onPreview={onPreview}
            />
          </div>
          {promptOpen && (
            <>
              <div className={styles.divider} data-focused={focused && section === "prompt"}>
                <span className={styles.barTitle}>{t("panel.prompt")}</span>
                <div className={styles.barActions}>
                  <RunButton run={run} saved={attachments.runs?.length > 0} disabled={!hasPrompt} reason={noRunner} onClick={() => onRun(task)} />
                  <button
                    type="button"
                    className="btn"
                    tabIndex={-1}
                    disabled={!hasPrompt}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onDeletePrompt(task);
                    }}
                    title={t("panel.deletePrompt")}
                    aria-label={t("panel.deletePrompt")}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {/* The prompt's part: its text, with the task's runs under it when it has had any. */}
              <div className={styles.region}>
                <PromptText
                  key={`prompt:${task.space.work}/${task.space.repository || ""}/${task.id}`}
                  task={task}
                  prompt={attachments.prompt}
                  textRef={promptRef}
                  focus={focusOf("prompt")}
                  onFocused={onFocused}
                  onFocus={() => onSection("prompt")}
                  onSave={onSavePrompt}
                />
                {attachments.runs?.length > 0 && <RunList className={styles.files} runs={attachments.runs} onOpen={(r) => onRun(task, r.folder)} onRemove={(r) => attachments.forgetRun(r.folder)} />}
              </div>
            </>
          )}
          {over && <div className={styles.dropOverlay}>{t("panel.dropFiles")}</div>}
        </>
      ) : (
        <div className={styles.empty}>
          <p className="muted">{t("panel.none")}</p>
        </div>
      )}
    </div>
  );
}

function TaskText({ task, textRef, focus, onFocused, onFocus, onSave }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(task.details);
  const sent = useRef(null); // the text last saved, until the list reloads with it

  // Focus with the caret at the end, where the details go.
  useEffect(() => {
    const el = textRef.current;
    if (!focus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [focus, onFocused, textRef]);

  // Take the reloaded text unless it was typed on since saving.
  useEffect(() => {
    setDraft((d) => (sent.current === null || d === sent.current ? task.details : d));
    sent.current = null;
  }, [task.details]);

  function save() {
    if (draft === task.details || draft === sent.current) return;
    sent.current = draft;
    onSave(task, draft);
  }

  return (
    <textarea
      ref={textRef}
      className={styles.text}
      value={draft}
      placeholder={t("common.untitled")}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={save}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.currentTarget.blur(); // saved by onBlur
        }
      }}
    />
  );
}

// The task's prompt.txt under its text, edited the same way: saved on blur, cmd/ctrl+s and esc.
// `prompt` is the saved text, null for no file and undefined until the folder is read (the text is
// empty until then, and takes what is read). A blank prompt leaves no file (see useTaskFiles).
function PromptText({ task, prompt, textRef, focus, onFocused, onFocus, onSave }) {
  const [draft, setDraft] = useState(prompt ?? "");
  const sent = useRef(null); // the text last saved, until the folder is re-read with it
  const saved = prompt ?? "";

  useEffect(() => {
    const el = textRef.current;
    if (!focus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    onFocused();
  }, [focus, onFocused, textRef]);

  // Take the read or reloaded text unless it was typed on since saving.
  useEffect(() => {
    if (prompt === undefined) return;
    setDraft((d) => (sent.current === null || d === sent.current ? prompt ?? "" : d));
    sent.current = null;
  }, [prompt]);

  function save() {
    if (draft === saved || draft === sent.current) return;
    sent.current = draft;
    onSave(task, draft);
  }

  return (
    <textarea
      ref={textRef}
      className={styles.text}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={onFocus}
      onBlur={save}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.currentTarget.blur(); // saved by onBlur
        }
      }}
    />
  );
}
