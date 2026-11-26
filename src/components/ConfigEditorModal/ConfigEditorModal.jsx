import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea, showToast, hideToast } from "@ui";
import * as api from "@utils/api";
import { jsonTokens } from "@utils/highlight";
import styles from "./config.module.css";

// Edit taskmgr.json as text. The server checks it before writing, so a broken edit is refused
// with the reason and the file stays as it was. The JSON is colored as typed.
export default function ConfigEditorModal({ isOpen, onClose, onSaved }) {
  const { t } = useTranslation();
  const [configPath, setConfigPath] = useState("");
  const [text, setText] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const keySaved = useRef(false); // saved with cmd/ctrl+s, and not typed on since

  useEffect(() => {
    if (!isOpen) return;
    keySaved.current = false;
    setText(null);
    setError("");
    api
      .getConfig()
      .then((d) => {
        setConfigPath(d.configPath);
        setText(d.text);
      })
      .catch((e) => setError(e.message));
  }, [isOpen]);

  // `keep`: the dialog stays open (cmd/ctrl+s; again, with nothing typed since, it closes); Save closes it.
  async function save(keep = false) {
    if (keep && keySaved.current) return onClose();
    setSaving(true);
    showToast(t("toast.saving"), null);
    try {
      onSaved(await api.saveConfig(text), keep);
      if (keep) keySaved.current = true;
    } catch (e) {
      hideToast(); // the error is shown in the dialog
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("config.title")} className={styles.modal} closeOnOverlay={false}>
      <div className={styles.body}>
        {configPath && (
          <div className={`mono muted ${styles.path}`} title={configPath}>
            {configPath}
          </div>
        )}
        <TextArea
          className={styles.text}
          minHeight={200}
          highlight={jsonTokens}
          value={text ?? ""}
          placeholder={text === null ? t("common.loading") : ""}
          disabled={text === null}
          autoFocus
          onChange={(e) => {
            keySaved.current = false;
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (text !== null && !saving) save(true);
            }
          }}
        />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn lg primary" onClick={() => save()} disabled={saving || text === null}>
            {t("editor.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
