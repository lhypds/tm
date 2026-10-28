import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Modal } from "@ui";
import * as api from "@utils/api";
import IncomeFields, { useIncomeFields, readIncome } from "@components/IncomeFields";
import styles from "./add.module.css";

const TYPES = ["origin", "work", "repository"];

// Add an origin, a work or a repository to taskmgr.json, chosen at the top. `add` is what to start
// with: { type, origin } (a work, into that origin) or { type, work } (a repository, into that
// work), and may come with a `name`, a work with a `tasksPath`, a repository with a `sourcePath` (a
// folder dropped on the tree). An origin has a name and income; a work an origin, name, tasks folder and income; a
// repository a work, name, source folder and tasks folder (one of them at least; the tasks folder
// defaults to the source folder's "tasks"). onSaved gets the new
// { works, origins } and what was added ({ type, name, origin, work }).
export default function AddSpaceModal({ add, origins, works, onClose, onSaved }) {
  const { t } = useTranslation();
  const [type, setType] = useState("origin");
  const [origin, setOrigin] = useState("");
  const [work, setWork] = useState("");
  const [name, setName] = useState("");
  const [tasksPath, setTasksPath] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const income = useIncomeFields();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const { reset } = income;
  useEffect(() => {
    if (!add) return;
    setType(add.type);
    setOrigin(add.origin || origins?.[0]?.origin || "");
    setWork(add.work || works?.[0]?.work || "");
    setName(add.name || "");
    setTasksPath(add.tasksPath || "");
    setSourcePath(add.sourcePath || "");
    reset(null);
    setError("");
    // the lists are only read when the modal opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, reset]);

  async function save() {
    const newName = name.trim();
    if (!newName) return setError(t("work.nameEmpty"));
    if (type === "work" && !origin) return setError(t("work.originEmpty"));
    if (type === "repository" && !work) return setError(t("add.workEmpty"));
    if (type === "repository" && !tasksPath.trim() && !sourcePath.trim()) return setError(t("add.pathEmpty"));
    const read = type === "repository" ? { income: null } : readIncome(income);
    if (read.error) return setError(t(read.error));
    setSaving(true);
    try {
      const spaces =
        type === "origin"
          ? await api.addOrigin({ name: newName, income: read.income })
          : type === "work"
            ? await api.addWork({ name: newName, origin, tasksPath, income: read.income })
            : await api.addRepository({ work, name: newName, tasksPath, sourcePath });
      onSaved(spaces, { type, name: newName, origin, work });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!add} onClose={onClose} title={t("add.title")} className={styles.modal}>
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) save();
        }}
      >
        <div className={styles.choices} role="radiogroup" aria-label={t("add.type")}>
          {TYPES.map((x) => (
            <label key={x} className={styles.choice}>
              <input
                type="radio"
                name="addType"
                checked={type === x}
                onChange={() => {
                  setType(x);
                  setError("");
                }}
              />
              {t(`add.${x}`)}
            </label>
          ))}
        </div>

        {type === "work" && (
          <label className={styles.field}>
            <span className={styles.label}>{t("work.origin")}</span>
            <select className="select" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {(origins || []).map((o) => (
                <option key={o.origin} value={o.origin}>
                  {o.origin}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "repository" && (
          <label className={styles.field}>
            <span className={styles.label}>{t("add.work")}</span>
            <select className="select" value={work} onChange={(e) => setWork(e.target.value)}>
              {(works || []).map((w) => (
                <option key={w.work} value={w.work}>
                  {w.origin ? `${w.origin} / ${w.work}` : w.work}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.field}>
          <span className={styles.label}>{t("work.name")}</span>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>

        {type === "work" && (
          <label className={styles.field}>
            <span className={styles.label}>{t("work.tasksPath")}</span>
            <input className="input mono" value={tasksPath} placeholder={t("add.optional")} onChange={(e) => setTasksPath(e.target.value)} />
          </label>
        )}

        {type === "repository" && (
          <>
            <label className={styles.field}>
              <span className={styles.label}>{t("add.sourcePath")}</span>
              <input className="input mono" value={sourcePath} placeholder={t("add.optional")} onChange={(e) => setSourcePath(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t("work.tasksPath")}</span>
              <input className="input mono" value={tasksPath} placeholder={t("add.tasksPathDefault")} onChange={(e) => setTasksPath(e.target.value)} />
            </label>
          </>
        )}

        {type !== "repository" && <IncomeFields fields={income} />}

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving}>
            {t("add.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
