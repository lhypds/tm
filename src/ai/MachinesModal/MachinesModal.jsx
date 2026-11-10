import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, TextArea, Checkbox } from "@ui";
import MachineDot from "@components/MachineDot";
import { formatDateTime } from "@utils/task";
import * as api from "../api";
import { duration } from "../duration";
import styles from "./machines.module.css";

const REFRESH_MS = 5000; // how often the machines are asked for while the dialog is open
const RUNS_SHOWN = 5; // the latest runs listed under a machine
const PICKED_KEY = "machines.picked"; // the names of the machines ticked, kept for the next time

function readPicked() {
  try {
    const v = JSON.parse(localStorage.getItem(PICKED_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch (e) {
    return null;
  }
}

// The machines Claude Code can be run on from here, opened from the header: the machines that sync
// with this server (GET /api/ai/machines, asked again every few seconds while open), each with its
// dot, a tick to pick it once its runner is connected (AI_RUNNER=1 in its taskmgrd; said when not),
// and under it its latest runs started from here: when, what was asked and how it goes, a click
// showing the run (onOpenRun(run)). Above them the prompt and the run button: it starts Claude Code
// with that prompt on every machine ticked (onRun(machine, prompt), resolving to the run, or null
// when refused), on no task, in the home folder there (⌘ / ctrl + enter runs too). One machine
// started: its run is shown at once. `runs` is every run the server has, by id (see useRuns); the
// ones of this dialog are those on no task (`task.free`).
export default function MachinesModal({ isOpen, runs, onRun, onOpenRun, onClose }) {
  const { t } = useTranslation();
  const [machines, setMachines] = useState(null); // null until first answered
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [picked, setPicked] = useState(readPicked); // names; null: nothing chosen yet, a lone machine is
  const [busy, setBusy] = useState(false);
  const promptRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let stale = false;
    const load = () =>
      api.getMachines().then(
        (d) => {
          if (stale) return;
          setMachines(d.machines);
          setError("");
        },
        (e) => {
          if (!stale) setError(e.message);
        },
      );
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) promptRef.current?.focus();
  }, [isOpen]);

  const ready = (machines || []).filter((m) => m.runner);
  const isPicked = (m) => m.runner && (picked ? picked.includes(m.name) : ready.length === 1);
  const targets = ready.filter(isPicked);
  const toggle = (m, on) => {
    const next = [...new Set([...(picked || targets.map((x) => x.name)).filter((n) => n !== m.name), ...(on ? [m.name] : [])])];
    setPicked(next);
    try {
      localStorage.setItem(PICKED_KEY, JSON.stringify(next));
    } catch (e) {
      /* not kept, then */
    }
  };

  // The runs started from here, newest first, by machine.
  const runsOf = useMemo(() => {
    const by = {};
    for (const r of Object.values(runs || {})) {
      if (!r.task?.free || !r.machine) continue;
      (by[r.machine] ||= []).push(r);
    }
    for (const list of Object.values(by)) list.sort((a, b) => b.startedAt - a.startedAt);
    return by;
  }, [runs]);

  const stateOf = (r) =>
    r.status === "queued"
      ? t("ai.queued", { machine: r.machine })
      : r.pending
        ? t("ai.waiting")
        : r.status === "running"
          ? t("ai.running")
          : r.status === "done"
            ? t("ai.done", { time: duration(r.endedAt - r.startedAt) })
            : r.status === "stopped"
              ? t("ai.stopped")
              : t("ai.failed");

  const canRun = !busy && !!prompt.trim() && targets.length > 0;
  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    try {
      const started = (await Promise.all(targets.map((m) => onRun(m.name, prompt)))).filter(Boolean);
      if (started.length === targets.length) setPrompt(""); // a refusal keeps the prompt, to try again
      if (started.length === 1) onOpenRun(started[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("machines.title")} className={styles.modal}>
      <div className={styles.body}>
        <TextArea
          ref={promptRef}
          value={prompt}
          className={styles.prompt}
          minHeight={80}
          aria-label={t("machines.prompt")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              run();
            }
          }}
        />

        {error && <div className={styles.error}>{error}</div>}
        {machines === null && !error && <div className="muted">{t("common.loading")}</div>}
        {machines?.length === 0 && <div className={`muted ${styles.hint}`}>{t("machines.none")}</div>}

        {machines?.length > 0 && (
          <ul className={styles.machines}>
            {machines.map((m) => (
              <li key={m.name} className={styles.machine} data-ready={m.runner}>
                <div className={styles.row}>
                  <Checkbox checked={isPicked(m)} disabled={!m.runner} onChange={(on) => toggle(m, on)}>
                    <span className={styles.name}>{m.name}</span>
                  </Checkbox>
                  <MachineDot machine={m} />
                  {!m.runner && <span className={`muted ${styles.note}`}>{t("machines.noRunner")}</span>}
                </div>
                {(runsOf[m.name] || []).slice(0, RUNS_SHOWN).map((r) => (
                  <div key={r.id} className={styles.run}>
                    <span className={`muted ${styles.when}`}>{formatDateTime(r.startedAt)}</span>
                    <button
                      type="button"
                      className={styles.runTitle}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        onOpenRun(r);
                      }}
                      title={r.task.title}
                    >
                      {r.task.title}
                    </button>
                    <span className={`muted ${styles.state}`} data-pending={!!r.pending} title={r.error || ""}>
                      {stateOf(r)}
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn primary lg" disabled={!canRun} onClick={run} title={t("machines.runHint")}>
            {t("machines.run")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
