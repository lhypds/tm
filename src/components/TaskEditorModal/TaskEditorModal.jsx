import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea } from "@ui";
import Attachments from "@components/Attachments";
import { BrainIcon } from "@components/icons";
import { isTyping, keyName } from "@utils/keys";
import styles from "./editor.module.css";

// A new task in one text area, the way the terminal opens it in $EDITOR; the first line becomes
// the title. `isOpen` is separate so a closed editor keeps its last text until it reopens. Its
// attachments are kept until it is saved (onSave(text, files, prompt)). With `parent`, the task is a
// subtask of that task, which the title says. An existing task is edited in the task panel instead.
// The brain beside the title, as the task preview's, shows a Prompt area under the text (hidden
// again each time the editor opens): what is typed there becomes the task's prompt.txt, and the
// save button is then "Save & Execute", which creates the task and runs Claude Code on it (`prompt`
// is that text, blank or not; null with the prompt hidden, when the task is only saved). As big as
// the task preview. Esc in a text takes the caret out of it rather than closing the editor (a second
// esc closes it), and the page's keys work then: the text the caret left stays chosen, shaded as the
// text chosen in the task preview is; j / k move between the task's text and the prompt (when
// shown), e / i put the caret back in the one chosen, and g shows the prompt and puts the caret in it.
export default function TaskEditorModal({ isOpen, space, parent, saving, onCancel, onSave, onPreview }) {
  const { t } = useTranslation();
  const title = parent ? t("editor.newSubtask", { name: parent.title || parent.id }) : t("editor.newTask");
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [pending, setPending] = useState([]); // File objects
  const [section, setSection] = useState("task"); // the text the caret is in, or was last: "task" or "prompt"
  const textRef = useRef(null);
  const promptRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setPending([]);
    setText("");
    setPrompt("");
    setPromptOpen(false);
    setSection("task");
    textRef.current?.focus();
  }, [isOpen]);

  // The caret goes to the prompt when it is shown, and back to the task's text when it is hidden.
  function togglePrompt() {
    const open = !promptOpen;
    setPromptOpen(open);
    setTimeout(() => (open ? promptRef : textRef).current?.focus());
  }

  // esc: out of the text first, then (nothing being typed in) the editor closes
  function onEscape() {
    const el = document.activeElement;
    if (el === textRef.current || el === promptRef.current) el.blur();
    else onCancel();
  }

  // With the caret in no text: j / k choose the task's text or the prompt (when shown), e / i edit
  // the one chosen, g the prompt (shown first when hidden).
  const chosen = promptOpen ? section : "task";
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const key = keyName(e).toLowerCase();
      if (!["g", "e", "i", "j", "k", "up", "down"].includes(key)) return;
      e.preventDefault(); // the key is not typed into the text it brings the caret to
      if (key === "g") {
        setPromptOpen(true);
        setTimeout(() => promptRef.current?.focus());
      } else if (key === "e" || key === "i") (chosen === "prompt" ? promptRef : textRef).current?.focus();
      else if (promptOpen) setSection(key === "j" || key === "down" ? "prompt" : "task");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, chosen, promptOpen]);

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
    <Modal isOpen={isOpen} onClose={onCancel} onEscape={onEscape} title={title} titleActions={brain} closeOnOverlay={false} className={styles.modal}>
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <div className={styles.area}>
          <TextArea ref={textRef} className={styles.text} value={text} data-selected={chosen === "task"} onFocus={() => setSection("task")} onChange={(e) => setText(e.target.value)} aria-label={title} />
        </div>

        {promptOpen && (
          <>
            {/* the prompt's head, as the preview's: its name */}
            <div className={styles.promptHead}>{t("panel.prompt")}</div>
            <div className={styles.area}>
              <TextArea ref={promptRef} className={styles.text} value={prompt} data-selected={chosen === "prompt"} onFocus={() => setSection("prompt")} onChange={(e) => setPrompt(e.target.value)} aria-label={t("panel.prompt")} />
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
