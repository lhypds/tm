import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea } from "@ui";
import Attachments from "@components/Attachments";
import styles from "./editor.module.css";

// A new task in one text area, the way the terminal opens it in $EDITOR; the first line becomes
// the title. `isOpen` is separate so a closed editor keeps its last text until it reopens. Its
// attachments are kept until it is saved (onSave(text, files)). With `parent`, the task is a
// subtask of that task, which the title says. An existing task is edited in the task panel instead.
export default function TaskEditorModal({ isOpen, space, parent, saving, onCancel, onSave, onPreview }) {
  const { t } = useTranslation();
  const title = parent ? t("editor.newSubtask", { name: parent.title || parent.id }) : t("editor.newTask");
  const [text, setText] = useState("");
  const [pending, setPending] = useState([]); // File objects
  const textRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setPending([]);
    setText("");
    textRef.current?.focus();
  }, [isOpen]);

  function submit(e) {
    e?.preventDefault();
    if (saving) return;
    onSave(text, pending);
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} closeOnOverlay={false} className={styles.modal}>
      <form className={styles.form} onSubmit={submit} onKeyDown={onKeyDown}>
        <TextArea
          ref={textRef}
          className={styles.text}
          minHeight={320}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={title}
        />

        <Attachments
          space={space}
          onPreview={onPreview}
          files={[]}
          pending={pending}
          onAdd={(list) => setPending((p) => [...p, ...list])}
          onRemovePending={(i) => setPending((p) => p.filter((_, j) => j !== i))}
        />

        <div className={styles.actions}>
          <span className={`muted ${styles.hint}`}>{t("editor.saveHint")}</span>
          <button type="button" className="btn lg" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {saving ? t("editor.saving") : t("editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
