import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Checkbox, Modal, TextArea } from "@ui";
import * as api from "@utils/api";
import IncomeFields, { useIncomeFields, readIncome } from "@components/IncomeFields";
import ColorPicker from "@components/ColorPicker";
import styles from "./work.module.css";

// Edit one work: its name, its description (several lines; shown in its preview, space on its row in the tree), its tasks folder, whether it is hidden from the tree, and whether it has income; if it
// does, its income as two lists, monthly and one-time, each of amount and currency. All are written
// into taskmgr.json; "no income" removes the income. Given an `origin` ({ origin, description, income, color })
// instead, it edits that origin's name, description, color and income the same way. onSaved gets the new { works, origins } and
// the new name.
export default function WorkEditModal({ work, origin, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tasksPath, setTasksPath] = useState("");
  const [hidden, setHidden] = useState(false);
  const [color, setColor] = useState("");
  const income = useIncomeFields();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // saved with cmd/ctrl+s, and not edited since; kept while the dialog is reset to what was saved
  const keySaved = useRef(false);

  const { reset } = income;
  useEffect(() => {
    if (!work && !origin) {
      keySaved.current = false;
      return;
    }
    setName(origin ? origin.origin : work.work);
    setDescription((origin || work).description || "");
    setTasksPath(origin ? "" : work.shownPath || "");
    setHidden(!origin && !!work.hidden);
    setColor(origin?.color || "");
    reset((origin || work).income);
    setError("");
  }, [work, origin, reset]);

  // `keep`: the dialog stays open (cmd/ctrl+s; again, with nothing edited since, it closes); Save closes it.
  async function save(keep = false) {
    if (keep && keySaved.current) return onClose();
    const newName = name.trim();
    if (!newName) {
      setError(t("work.nameEmpty"));
      return;
    }
    const read = readIncome(income);
    if (read.error) {
      setError(t(read.error));
      return;
    }
    setSaving(true);
    try {
      const spaces = origin
        ? await api.saveOrigin(origin.origin, { name: newName, income: read.income, color, description })
        : await api.saveWork(work.work, { name: newName, income: read.income, hidden, tasksPath, description });
      onSaved(spaces, newName, keep);
      if (keep) keySaved.current = true;
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!work || !!origin} onClose={onClose} title={origin ? origin.origin : work?.work || ""} className={styles.modal}>
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
          <span className={styles.label}>{t("work.name")}</span>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t("work.description")}</span>
          <TextArea rows={6} minHeight={48} value={description} placeholder={t("add.optional")} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {!origin && (
          <label className={styles.field}>
            <span className={styles.label}>{t("work.tasksPath")}</span>
            <input className="input mono" value={tasksPath} placeholder={t("add.optional")} onChange={(e) => setTasksPath(e.target.value)} />
          </label>
        )}

        {!origin && (
          <Checkbox className={styles.check} checked={hidden} onChange={setHidden}>
            {t("work.hide")}
          </Checkbox>
        )}

        {origin && <ColorPicker value={color} onChange={setColor} />}

        <IncomeFields fields={income} />

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
