import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea } from "@ui";
import Attachments from "@components/Attachments";
import { BrainIcon } from "@components/icons";
import styles from "./editor.module.css";

// A new task in one text area, the way the terminal opens it in $EDITOR; the first line becomes
// the title. `isOpen` is separate so a closed editor keeps its last text until it reopens. Its
// attachments are kept until it is saved (onSave(text, files, prompt)). With `parent`, the task is a
// subtask of that task, which the title says. An existing task is edited in the task panel instead.
// The brain beside the title, as the task preview's, shows a Prompt area under the text (hidden
// again each time the editor opens): what is typed there becomes the task's prompt.txt, and the
// save button is then "Save & Execute", which creates the task and runs Claude Code on it (`prompt`
// is that text, blank or not; null with the prompt hidden, when the task is only saved). As big as
// the task preview.
export default function TaskEditorModal({ isOpen, space, parent, saving, onCancel, onSave, onPreview }) {
  const { t } = useTranslation();
  const title = parent ? t("editor.newSubtask", { name: parent.title || parent.id }) : t("editor.newTask");
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, setPending] = useState([]); // File objects
  const textRef = useRef(null);
  const promptRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setPending([]);
    setText("");
    setPrompt("");
    setPromptOpen(false);
    textRef.current?.focus();
  }, [isOpen]);

  // The caret goes to the prompt when it is shown, and back to the task's text when it is hidden.
  function togglePrompt() {
    const open = !promptOpen;
    setPromptOpen(open);
    setTimeout(() => (open ? promptRef : textRef).current?.focus());
  }

  function submit(e) {
    e?.preventDefault();
    if (saving) return;
    onSave(text, pending, promptOpen ? prompt : null);
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      submit();
    }
  }

  const brainLabel = t(promptOpen ? "panel.hidePrompt" : "panel.showPrompt");
  const brain = (
    <button type="button" className="btn" tabIndex={-1} data-dot={!!prompt.trim()} aria-pressed={promptOpen} title={brainLabel} aria-label={brainLabel} onClick={togglePrompt}>
      <BrainIcon />
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} titleActions={brain} closeOnOverlay={false} className={styles.modal}>
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <div className={styles.area}>
          <TextArea ref={textRef} className={styles.text} value={text} onChange={(e) => setText(e.target.value)} aria-label={title} />
        </div>

        {promptOpen && (
          <>
            {/* the prompt's head, as the preview's: its name */}
            <div className={styles.promptHead}>{t("panel.prompt")}</div>
            <div className={styles.area}>
              <TextArea ref={promptRef} className={styles.text} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={t("panel.prompt")} />
            </div>
          </>
        )}

        <Attachments
          space={space}
          onPreview={onPreview}
          files={[]}
          pending={pending}
          onAdd={(list) => setPending((p) => [...p, ...list])}
          onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
        />

        <div className={styles.actions}>
          <span className={`muted ${styles.hint}`}>{t(promptOpen ? "editor.executeHint" : "editor.saveHint")}</span>
          <button type="button" className="btn lg" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {saving ? t("editor.saving") : t(promptOpen ? "editor.saveExecute" : "editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
