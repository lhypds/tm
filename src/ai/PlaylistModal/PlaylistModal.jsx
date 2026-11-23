import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { StopIcon } from "@components/icons";
import { formatDateTime } from "@utils/task";
import styles from "./playlist.module.css";

// The playlist, opened from the header: every run of Claude Code still going (`runs`, oldest first,
// see useRuns `going`: on a task, or on none, from the new task dialog's Execute; not the Machines
// dialog's own, which it lists itself),
// each a row with what it runs on (the task's title, or the prompt's first line), where (the work
// and repository, and the machine when it is another), since when, and how it goes (running,
// waiting for an answer, or queued on its machine). A click on one shows the run (onOpenRun(run));
// the square at its right end stops it (onStop(run)). With none going it says so.
export default function PlaylistModal({ isOpen, runs, onOpenRun, onStop, onClose }) {
  const { t } = useTranslation();
  const stateOf = (r) => (r.status === "queued" ? t("ai.queued", { machine: r.machine }) : r.pending ? t("ai.waiting") : t("ai.running"));
  const whereOf = (r) => [[r.task.work, r.task.repository].filter(Boolean).join("/"), r.machine].filter(Boolean).join(" · ");
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("playlist.title")} className={styles.modal}>
      {runs.length === 0 ? (
        <p className={`muted ${styles.none}`}>{t("playlist.none")}</p>
      ) : (
        <ul className={styles.runs}>
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={styles.name}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onOpenRun(r);
                }}
              >
                <span className={styles.title}>{r.task.title}</span>
                <span className={`muted ${styles.meta}`}>{[whereOf(r), formatDateTime(r.startedAt)].filter(Boolean).join(" · ")}</span>
              </button>
              <span className={`muted ${styles.state}`} data-pending={!!r.pending}>
                {stateOf(r)}
              </span>
              <button type="button" className={styles.stop} tabIndex={-1} onClick={() => onStop(r)} title={t("ai.stop")} aria-label={t("ai.stop")}>
                <StopIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
