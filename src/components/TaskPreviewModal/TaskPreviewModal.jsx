import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { BrainIcon, FolderIcon, TrashIcon } from "@components/icons";
import { fileUrl } from "@utils/api";
import { noDoubleClickSelect } from "@utils/keys";
import { formatSize, previewKind } from "@utils/task";
import styles from "./taskPreview.module.css";

// task.txt as the terminal's space preview shows it: blank lines at the ends dropped, each line trimmed.
function previewText(details) {
  const lines = (details || "").replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines
    .slice(start, end)
    .map((line) => line.trim())
    .join("\n");
}

// A text (task.txt, or prompt.txt) in a textarea, caret at the end. A blur saves (onSave(text), when
// it changed) and ends the edit, and so does esc; cmd/ctrl+s saves and keeps editing.
function Editor({ value, placeholder, textRef, onSave, onEndEdit }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    const el = textRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [textRef]);

  const save = () => {
    if (draft !== value) onSave(draft);
  };

  return (
    <textarea
      ref={textRef}
      className={styles.text}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        save();
        onEndEdit();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          save();
        }
      }}
    />
  );
}

// An icon button at the left end of the header, framed as the Task panel's (`.btn`); `dot` marks it.
// It never keeps the focus, so space and enter stay the preview's keys (close it) rather than
// pressing the button again: it takes the focus for the click (a text being edited is saved on the
// blur first) and lets it go after.
function HeaderButton({ label, dot, disabled, onClick, children }) {
  return (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      data-dot={dot}
      disabled={disabled}
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

// Look at a task's task.txt, with its attachments under it (`files`, the one at `selectedRel` marked;
// Home moves it with j / k and opens it with enter), a click on a file
// (or enter) opening it through `onOpenFile`, which previews a PDF, image or text file instead of
// downloading it. A double click on a text (or `onEdit(area)`, e / i in Home) starts editing it:
// `editing` is "task" or "prompt" while one is a textarea, saved by onSave(task, text) or
// onSavePrompt(task, text). The buttons beside the "Task" title at the top left open the task's folder (`onOpenFolder`),
// show the task's prompt (the brain, `onTogglePrompt`: with `promptOpen`, `prompt`, its prompt.txt
// text, null for none, undefined until read, is shown under the text, as the Task panel shows it;
// the brain carries a dot while the task has one) and delete the task (`onDelete`, which asks
// first). The prompt is under a head that says "Prompt", as the panel's divider does.
// `section` is the text the keyboard is on, "task" or "prompt" (null while an attachment is, and
// until j / k chose one: the preview opens with nothing chosen); that text is highlighted, as a
// chosen attachment's row is. Opened with space or a double click on the task and closed with
// space, q, enter or escape.
export default function TaskPreviewModal({
  task,
  files,
  selectedRel,
  editing,
  onEdit,
  onEndEdit,
  onSave,
  onSavePrompt,
  onOpenFile,
  onOpenFolder,
  onDelete,
  onClose,
  prompt,
  promptOpen,
  onTogglePrompt,
  section,
}) {
  const { t } = useTranslation();
  const textRef = useRef(null); // the textarea being edited, task or prompt (one at a time)
  // esc ends an edit (the blur saves it); otherwise it closes the preview, whatever is chosen in it
  const onEscape = editing ? () => textRef.current?.blur() : undefined;

  const actions = task && (
    <div className={styles.headerButtons}>
      <HeaderButton label={t("tree.openFolder")} onClick={() => onOpenFolder(task)}>
        <FolderIcon />
      </HeaderButton>
      <HeaderButton label={t(promptOpen ? "panel.hidePrompt" : "panel.showPrompt")} dot={prompt != null} onClick={onTogglePrompt}>
        <BrainIcon />
      </HeaderButton>
      <HeaderButton label={t("delete.title")} onClick={() => onDelete(task)}>
        <TrashIcon />
      </HeaderButton>
    </div>
  );
  return (
    <Modal isOpen={!!task} onClose={onClose} onEscape={onEscape} className={styles.modal} title={t("panel.heading")} titleActions={actions} tight>
      <div className={styles.body}>
        {editing === "task" && task ? (
          <Editor
            key={`task:${task.key}`}
            value={task.details}
            placeholder={t("common.untitled")}
            textRef={textRef}
            onSave={(text) => onSave(task, text)}
            onEndEdit={onEndEdit}
          />
        ) : (
          <pre className={styles.text} data-selected={section === "task"} onMouseDown={noDoubleClickSelect} onDoubleClick={() => onEdit("task")}>
            {previewText(task?.details)}
          </pre>
        )}
        {promptOpen && task && (
          <>
            {/* the prompt's head, as the panel's divider: its name */}
            <div className={styles.promptHead}>
              <span>{t("panel.prompt")}</span>
            </div>
            {editing === "prompt" ? (
              <Editor
                key={`prompt:${task.key}`}
                value={prompt ?? ""}
                textRef={textRef}
                onSave={(text) => onSavePrompt(task, text)}
                onEndEdit={onEndEdit}
              />
            ) : (
              /* as written, not trimmed as task.txt is: a prompt's indents may matter; empty when
                 there is no file (or until it is read) */
              <pre className={styles.text} data-selected={section === "prompt"} onMouseDown={noDoubleClickSelect} onDoubleClick={() => onEdit("prompt")}>
                {prompt ?? ""}
              </pre>
            )}
          </>
        )}
        {task && files.length > 0 && (
          <div className={styles.files}>
            <div className="muted">{t("attach.title")}</div>
            <ul>
              {files.map((f) => (
                <li key={f.rel} data-selected={f.rel === selectedRel}>
                  {f.isDir ? (
                    <span>{f.name}/</span>
                  ) : (
                    <a
                      href={fileUrl(task.space, f.rel)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (!onOpenFile || !previewKind(f.name)) return;
                        e.preventDefault();
                        e.currentTarget.blur(); // a focused link would keep space and enter from closing the preview
                        onOpenFile(f);
                      }}
                    >
                      {f.name}
                    </a>
                  )}
                  {!f.isDir && <span className="muted"> {formatSize(f.size)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
