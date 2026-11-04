import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Highlighted, Modal, showToast, useHighlight } from "@ui";
import { DownloadIcon, TrashIcon } from "@components/icons";
import { fileUrl, saveFile } from "@utils/api";
import { highlighterFor } from "@utils/highlight";
import { noDoubleClickSelect } from "@utils/keys";
import { previewKind } from "@utils/task";
import styles from "./preview.module.css";

// A text file in a textarea, caret at the end, as the task preview edits task.txt: a blur saves
// (onSave(text), when it changed) and ends the edit, and so does esc; cmd/ctrl+s saves and keeps editing.
// With `highlight` the text is colored as typed.
function Editor({ value, highlight, textRef, onSave, onEndEdit }) {
  const [draft, setDraft] = useState(value);
  const colors = useHighlight(highlight, draft, styles.text);

  useEffect(() => {
    const el = textRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [textRef]);

  const save = () => {
    if (draft !== value) onSave(draft);
  };

  return (
    <div className={styles.editor}>
      {colors.layer}
      <textarea
        ref={textRef}
        className={`${styles.text} ${colors.className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onScroll={colors.onScroll}
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
    </div>
  );
}

// A text file (txt, md, ...) as it is, read from `url`. With `editing` it is in the editor instead
// (a double click on the text asks for that through onEdit; onEndEdit says the edit is over), and
// onSave(text) writes it, resolving to whether it did: the text shown is then the saved one.
// `highlight` colors it, read or edited.
function TextView({ url, highlight, editing, onEdit, onEndEdit, onSave, textRef }) {
  const { t } = useTranslation();
  const [text, setText] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => !stale && setText(t))
      .catch((e) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [url]);

  if (error) return <p className={styles.note}>{error}</p>;
  if (text === null) return <p className={`muted ${styles.note}`}>{t("common.loading")}</p>;
  if (editing) {
    return (
      <Editor value={text} highlight={highlight} textRef={textRef} onSave={(draft) => onSave(draft).then((ok) => ok && setText(draft))} onEndEdit={onEndEdit} />
    );
  }
  return (
    <pre className={styles.text} onMouseDown={noDoubleClickSelect} onDoubleClick={onEdit}>
      {highlight ? <Highlighted text={text} highlight={highlight} /> : text}
    </pre>
  );
}

// An attachment shown in the page: a PDF in the browser's own viewer, an image that zooms to full
// size on a click, or a text file as it is, in the font and over the grid the task's text has, and
// editable as that is in the task preview: a double click on the text (or `onEdit`, e / i in Home)
// turns it into a textarea; `editing` says it is one, onEndEdit that the edit is over (a blur, or
// esc). The text is written as typed, and onSaved is called so the file's size is re-read. Beside
// the name, download and delete (onDelete, which asks first; greyed out without it). `file` is
// { name, rel } from a task's files, with `url` when its content is from elsewhere than the file
// at `rel` (a run's copy of a text, see RunModal).
export default function FilePreviewModal({ space, file, editing, onEdit, onEndEdit, onSaved, onDelete, onClose }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(false);
  const textRef = useRef(null); // the textarea while the text is edited
  useEffect(() => setZoom(false), [file]);

  const kind = file ? previewKind(file.name) : null;
  const url = file ? file.url || fileUrl(space, file.rel) : "";

  // Write the text as typed; says whether it did (a failure is shown as a toast).
  async function save(text) {
    try {
      await saveFile(space, file.rel, text);
      onSaved?.();
      return true;
    } catch (e) {
      showToast(e.message, 4000);
      return false;
    }
  }

  return (
    <Modal
      isOpen={!!file}
      onClose={onClose}
      onEscape={editing ? () => textRef.current?.blur() : undefined}
      title={file?.name}
      className={styles.modal}
      tight
      titleActions={
        file && (
          <>
            {/* neither keeps the focus, so space, enter and q stay the preview's keys */}
            <a
              className="btn"
              href={file.url || fileUrl(space, file.rel, true)}
              download={file.url ? file.name : undefined}
              tabIndex={-1}
              onClick={(e) => e.currentTarget.blur()}
              title={t("preview.download")}
              aria-label={t("preview.download")}
            >
              <DownloadIcon />
            </a>
            <button
              type="button"
              className="btn"
              tabIndex={-1}
              disabled={!onDelete}
              onClick={(e) => {
                e.currentTarget.blur();
                onDelete();
              }}
              title={t("attach.deleteTitle")}
              aria-label={t("attach.deleteTitle")}
            >
              <TrashIcon />
            </button>
          </>
        )
      }
    >
      {file && (
        <div className={styles.body}>
          {kind === "pdf" && <iframe className={styles.frame} src={url} title={file.name} />}
          {kind === "image" && (
            <div className={styles.image} data-zoom={zoom} onClick={() => setZoom((z) => !z)}>
              <img src={url} alt={file.name} draggable={false} />
            </div>
          )}
          {kind === "text" && (
            <TextView url={url} highlight={highlighterFor(file.name)} editing={editing} onEdit={onEdit} onEndEdit={onEndEdit} onSave={save} textRef={textRef} />
          )}
        </div>
      )}
    </Modal>
  );
}
