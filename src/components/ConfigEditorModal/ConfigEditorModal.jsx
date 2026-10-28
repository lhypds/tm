import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal, TextArea } from "@ui";
import * as api from "@utils/api";
import styles from "./config.module.css";

// Edit taskmgr.json as text. The server checks it before writing, so a broken edit is refused
// with the reason and the file stays as it was.
export default function ConfigEditorModal({ isOpen, onClose, onSaved }) {
  const { t } = useTranslation();
  const [configPath, setConfigPath] = useState("");
  const [text, setText] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
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

  async function save() {
    setSaving(true);
    try {
      onSaved(await api.saveConfig(text));
    } catch (e) {
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
          value={text ?? ""}
          placeholder={text === null ? t("common.loading") : ""}
          disabled={text === null}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (text !== null && !saving) save();
            }
          }}
        />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn lg primary" onClick={save} disabled={saving || text === null}>
            {t("editor.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
