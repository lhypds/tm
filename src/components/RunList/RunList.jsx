import { useTranslation } from "react-i18next";
import { XIcon } from "@components/icons";
import { duration } from "@utils/task";
import styles from "./runs.module.css";

// The runs of Claude Code a task has had, under its prompt, listed as its files are (see Attachments):
// `runs` are the records kept in the task folder (useTaskFiles, newest first), each a row with when
// the run was (a click, onOpen(record), shows it in the run dialog), how it went (done in 12s, failed,
// stopped; and where, when on another machine) and its remove, which asks first (onRemove(record)).
export default function RunList({ className, runs, onOpen, onRemove }) {
  const { t } = useTranslation();
  const outcome = (r) => (r.status === "done" ? t("ai.done", { time: duration(r.endedAt - r.startedAt) }) : r.status === "stopped" ? t("ai.stopped") : t("ai.failed"));
  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div className={styles.title}>{t("ai.runs")}</div>
      <ul className={styles.runs}>
        {runs.map((r) => {
          const when = new Date(r.startedAt).toLocaleString();
          return (
            <li key={r.folder}>
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
              <button
                type="button"
                className={styles.remove}
                onClick={() => {
                  if (window.confirm(t("ai.forgetConfirm", { when }))) onRemove(r);
                }}
                aria-label={t("ai.forget", { when })}
              >
                <XIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
