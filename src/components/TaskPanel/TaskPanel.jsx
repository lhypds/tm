import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { BrainIcon, FolderIcon, TrashIcon } from "@components/icons";
import Attachments from "@components/Attachments";
import RunButton from "@components/RunButton";
import RunList from "@components/RunList";
import { Checkbox } from "@ui";
import styles from "./panel.module.css";

// The selected task beside the list: its task.txt as written, editable in place. It is saved
// when the text loses focus or on cmd/ctrl+s; esc ends the edit, saving it. onSave(task, text)
// writes it. When `focusKey` is the task's key, the text named by `focusArea` ("task", or "prompt")
// takes the focus and onFocused is called.
// Under a head like the tree's: "Task", with the folder, the brain and delete at its right, as the
// preview's title has them; onOpenFolder(task) opens the task's folder in the OS file manager,
// onDelete(task) asks before deleting. The brain (onTogglePrompt) shows and hides the task's prompt, its
// prompt.txt (`promptOpen`): the text is then split in two, the prompt under a divider that says
// "Prompt". Opening it makes the file (blank) when the task has none; onSavePrompt(task, text)
// overwrites it as typed, and nothing deletes it.
// The divider also carries the run button (RunButton), greyed out until the task has a prompt, or
// while `noRunner` says why the task cannot run now (a copy from a machine that is not connected; the
// text is the button's tooltip): onRun(task) starts Claude Code on the task and opens the run's dialog,
// or opens the dialog of the run the task has going (`run`, see useRuns), which the button shows with
// a dot. Under the prompt's text, two checkboxes say what Claude does with its changes once the
// work is done (`after`: "push" commits and pushes, "pr" makes a branch, commits and opens a pull
// request, null nothing; onAfter(value) changes it): one or the other, so ticking one unticks the
// other. Then the task's past runs (`attachments.runs`, the records kept in its
// folder) are listed as the files are (RunList): a click on one opens it in the dialog (onRun(task, folder)),
// its × removes it (onForgetRun(record), which asks first), and `selectedRun` is the folder of the one
// the keyboard is on (j / k walk them after the prompt), highlighted as a chosen file is.
// `section` is the text the keyboard is on, "task" or "prompt" (null while an attachment is), shown
// by which head is highlighted; onSection(area) is called when a text is clicked into.
// Under the texts, the task's attachments; files dropped anywhere on the panel are uploaded into
// the task folder (`attachments` is the task's useTaskFiles, which also holds the prompt;
// onPreview(file) opens one, onDeleteFile(file) asks before deleting one, its ×, as d on it does;
// `selectedFile` is the rel of the one the keyboard is on).
export default function TaskPanel({
  task,
  focused,
  focusKey,
  focusArea,
  onFocused,
  onSave,
  onOpenFolder,
  onDelete,
  onPreview,
  onDeleteFile,
  attachments,
  selectedFile,
  promptOpen,
  onTogglePrompt,
  section,
  onSection,
  onSavePrompt,
  run,
  noRunner,
  onRun,
  after,
  onAfter,
  selectedRun,
  onForgetRun,
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
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            disabled={!task}
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenFolder(task);
            }}
            title={t("tree.openFolder")}
            aria-label={t("tree.openFolder")}
          >
            <FolderIcon />
          </button>
          {/* it looks the same shown or hidden (the prompt being there says so), with a dot while the
              task has a prompt.txt. Not kept focused on mousedown: a text being edited saves on the
              blur before the toggle; let go after the click, so space and enter are the page's again. */}
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            disabled={!task}
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
              open={attachments.open}
              onToggle={attachments.toggleDir}
              busy={attachments.uploading}
              onAdd={attachments.add}
              onRemove={onDeleteFile}
              onPreview={onPreview}
            />
          </div>
          {promptOpen && (
            <>
              <div className={styles.divider} data-focused={focused && section === "prompt"}>
                <span className={styles.barTitle}>{t("panel.prompt")}</span>
                <div className={styles.barActions}>
                  <RunButton run={run} disabled={!hasPrompt} reason={noRunner} onClick={() => onRun(task)} />
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
                {/* what to do with the changes after the work: one of the two, or neither */}
                <div className={styles.after}>
                  <Checkbox className={styles.afterCheck} checked={after === "push"} onChange={(on) => onAfter(on ? "push" : null)}>
                    {t("ai.afterPush")}
                  </Checkbox>
                  <Checkbox className={styles.afterCheck} checked={after === "pr"} onChange={(on) => onAfter(on ? "pr" : null)}>
                    {t("ai.afterPr")}
                  </Checkbox>
                </div>
                {attachments.runs?.length > 0 && <RunList className={styles.files} runs={attachments.runs} selectedFolder={selectedRun} onOpen={(r) => onRun(task, r.folder)} onRemove={onForgetRun} />}
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
