import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal, TextArea } from "@ui";
import * as api from "@utils/api";
import styles from "./repository.module.css";

// Edit one repository: its name, description (several lines; shown in its preview, space on its row in the tree), source folder and
// tasks folder (either folder may be left empty, not both). `repository` is
// { work, name, description, paths: { source, tasks } }; the changes are written into
// taskmgr.json and passed to onSaved as the new { works, origins }, along with the new name.
export default function RepositoryEditModal({ repository, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [tasksPath, setTasksPath] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // saved with cmd/ctrl+s, and not edited since; kept while the dialog is reset to what was saved
  const keySaved = useRef(false);

  useEffect(() => {
    if (!repository) {
      keySaved.current = false;
      return;
    }
    setName(repository.name);
    setDescription(repository.description || "");
    setSourcePath(repository.paths?.source || "");
    setTasksPath(repository.paths?.tasks || "");
    setError("");
  }, [repository]);

  // `keep`: the dialog stays open (cmd/ctrl+s; again, with nothing edited since, it closes); Save closes it.
  async function save(keep = false) {
    if (keep && keySaved.current) return onClose();
    const newName = name.trim();
    if (!newName) {
      setError(t("repository.nameEmpty"));
      return;
    }
    if (!tasksPath.trim() && !sourcePath.trim()) {
      setError(t("add.pathEmpty"));
      return;
    }
    setSaving(true);
    try {
      onSaved(await api.saveRepository(repository.work, repository.name, { newName, sourcePath, tasksPath, description }), newName, keep);
      if (keep) keySaved.current = true;
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!repository} onClose={onClose} title={repository?.name || ""} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
        // any edit (a field typed in, a button such as a color or an income row) is unsaved again
        onChange={() => (keySaved.current = false)}
        onClick={(e) => {
          if (e.target.closest("button[type=button]")) keySaved.current = false;
        }}
        // cmd+s (ctrl+s) saves and leaves the dialog open; again, with nothing edited since, closes it
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "s") return;
          e.preventDefault();
          if (!saving) save(true);
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>{t("repository.name")}</span>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("work.description")}</span>
          <TextArea rows={6} minHeight={48} value={description} placeholder={t("add.optional")} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("add.sourcePath")}</span>
          <input className="input mono" value={sourcePath} placeholder={t("add.optional")} onChange={(e) => setSourcePath(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t("work.tasksPath")}</span>
          <input className="input mono" value={tasksPath} placeholder={t("add.tasksPathDefault")} onChange={(e) => setTasksPath(e.target.value)} />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {t("editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
