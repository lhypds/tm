import { useTranslation } from "react-i18next";
import { XIcon } from "@components/icons";
import { duration, formatDateTime } from "@utils/task";
import styles from "./runs.module.css";

// The runs of Claude Code a task has had, under its prompt, listed as its files are (see Attachments):
// `runs` are the records kept in the task folder (useTaskFiles, newest first), each a row with when
// the run was (to the minute, as a task id reads; a click, onOpen(record), shows it in the run dialog), how it went (done in 12s, failed,
// stopped; and where, when on another machine) and its remove (onRemove(record), which asks first).
// The row of `selectedFolder` is highlighted, as a chosen file's is: the keyboard is on it (j / k).
export default function RunList({ className, runs, selectedFolder, onOpen, onRemove }) {
  const { t } = useTranslation();
  const outcome = (r) => (r.status === "done" ? t("ai.done", { time: duration(r.endedAt - r.startedAt) }) : r.status === "stopped" ? t("ai.stopped") : t("ai.failed"));
  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.title}>{t("ai.runs")}</div>
      <ul className={styles.runs}>
        {runs.map((r) => {
          const when = formatDateTime(r.startedAt);
          return (
            <li key={r.folder} data-selected={r.folder === selectedFolder}>
              <button
                type="button"
                className={styles.name}
                onClick={(e) => {
                  e.currentTarget.blur(); // a focused button would keep space and enter from the page
                  onOpen(r);
                }}
                title={r.error || ""}
              >
                {when}
              </button>
              <span className={`muted ${styles.meta}`}>
                {outcome(r)}
                {r.machine ? ` · ${r.machine}` : ""}
              </span>
              <button type="button" className={styles.remove} onClick={() => onRemove(r)} aria-label={t("ai.forget", { when })}>
                <XIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
