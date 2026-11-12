import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, TextArea, Checkbox, showToast } from "@ui";
import MachineDot from "@components/MachineDot";
import { StopIcon } from "@components/icons";
import { formatDateTime } from "@utils/task";
import * as api from "../api";
import { duration } from "../duration";
import styles from "./machines.module.css";

const REFRESH_MS = 5000; // how often the machines are asked for while the dialog is open
const RUNS_SHOWN = 5; // the latest runs listed under a machine
// The tm commands a machine can be given, typed as "/restart" (TM_COMMANDS in utils/tmcommand.js).
const COMMANDS = ["restart", "start", "stop", "push", "pull", "status"];
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
// dot, a tick to pick it once its runner is connected (AI_RUNNER=1 in its taskmgrd),
// and under it its latest runs started from here: when, what was asked and how it goes, a click
// showing the run (onOpenRun(run)). Above them the prompt and the run button: it starts Claude Code
// with that prompt on every machine ticked (onRun(machine, prompt), resolving to the run, or null
// when refused), on no task, in the home folder there (⌘ / ctrl + enter runs too). One machine
// started: its run is shown at once. Once run, the prompt is emptied and stays as its placeholder (tab brings it back as text). A run
// still going has a stop button at its right end (onStop(run)). `runs` is every run the server has, by id (see useRuns); the
// ones of this dialog are those on no task (`task.free`).
//
// A prompt that starts with "/" is a tm command, not a prompt for Claude: "/restart" runs `tm restart`
// on every machine whose runner is connected, ticked or not (POST /api/ai/machine/command; each
// machine starts it in a process of its own, so a restart of the daemon that got the command goes
// through). While only "/" and the start of a name are typed, the commands that fit are listed
// under the first line (↑ / ↓ move, enter or tab takes one, a click too). A toast tells which machines started it, and what the
// others answered.
export default function MachinesModal({ isOpen, runs, onRun, onOpenRun, onStop, onClose }) {
  const { t } = useTranslation();
  const [machines, setMachines] = useState(null); // null until first answered
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sent, setSent] = useState(null); // the prompt as it was last run: the placeholder of the emptied box, tab brings it back
  const [picked, setPicked] = useState(readPicked); // names; null: nothing chosen yet, a lone machine is
  const [busy, setBusy] = useState(false);
  const promptRef = useRef(null);
  const [menu, setMenu] = useState({ off: false, index: 0 }); // the commands listed under "/": put away, and the one the keys are on

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

  const isCommand = prompt.trimStart().startsWith("/");
  const canRun = !busy && !!prompt.trim() && (isCommand ? ready : targets).length > 0;
  // Once run, the box is emptied and what was run stays in it as its placeholder, grey and not to be
  // edited; tab in the empty box brings it back as text.
  const ran = () => {
    setSent(prompt);
    setPrompt("");
  };
  const runCommand = async () => {
    const results = await Promise.all(
      ready.map((m) =>
        api.runMachineCommand(m.name, prompt.trim()).then(
          (d) => ({ name: m.name, command: d.command }),
          (e) => ({ name: m.name, error: e.message }),
        ),
      ),
    );
    const ok = results.filter((r) => !r.error);
    const bad = results.filter((r) => r.error);
    if (ok.length) ran();
    const lines = [
      ...(ok.length
        ? [
            t("machines.commandStarted", {
              command: `tm ${ok[0].command}`,
              machines: ok.map((r) => r.name).join(", "),
            }),
          ]
        : []),
      // one refusal said once when every machine answers the same (not a tm command, say)
      ...(bad.length && bad.every((r) => r.error === bad[0].error) && !ok.length ? [bad[0].error] : bad.map((r) => `${r.name}: ${r.error}`)),
    ];
    showToast(lines.join("; "), bad.length ? 6000 : 3000, "bottom", bad.length ? "error" : "");
  };
  // The commands that fit what is typed, while it is only "/" and the start of a name.
  const typed = /^\/[a-z]*$/i.test(prompt) ? prompt.slice(1).toLowerCase() : null;
  const options = typed === null || menu.off ? [] : COMMANDS.filter((c) => c.startsWith(typed) && c !== typed);
  const optionIndex = Math.min(menu.index, options.length - 1);
  const take = (c) => {
    setPrompt(`/${c}`);
    setMenu({ off: true, index: 0 });
    promptRef.current?.focus();
  };
  // esc empties the box first (the list of commands goes with it); in an empty box it closes the dialog.
  const clear = () => {
    setPrompt("");
    setMenu({ off: false, index: 0 });
  };
  const run = async () => {
    if (!canRun) return;
    setBusy(true);
    try {
      if (isCommand) return await runCommand();
      const started = (await Promise.all(targets.map((m) => onRun(m.name, prompt)))).filter(Boolean);
      if (started.length) ran();
      if (started.length === 1) onOpenRun(started[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("machines.runTitle")} className={styles.modal} onEscape={prompt ? clear : undefined}>
      <div className={styles.body}>
        <div className={styles.promptWrap}>
          <TextArea
            ref={promptRef}
            value={prompt}
            className={styles.prompt}
            placeholder={sent || ""}
            minHeight={80}
            aria-label={t("machines.prompt")}
            onChange={(e) => {
              setPrompt(e.target.value);
              setMenu({ off: false, index: 0 });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              } else if (e.key === "Tab" && !e.shiftKey && !prompt && sent) {
                e.preventDefault();
                setPrompt(sent);
                setMenu({ off: true, index: 0 });
              } else if (options.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setMenu({
                  off: false,
                  index: (optionIndex + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length,
                });
              } else if (options.length && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                take(options[optionIndex]);
              }
            }}
          />
          {options.length > 0 && (
            <ul className={styles.commands} role="listbox">
              {options.map((c, i) => (
                <li
                  key={c}
                  role="option"
                  aria-selected={i === optionIndex}
                  className={styles.command}
                  onMouseDown={(e) => {
                    e.preventDefault(); // the prompt keeps the focus
                    take(c);
                  }}
                  onMouseEnter={() => setMenu({ off: false, index: i })}
                >
                  /{c}
                </li>
              ))}
            </ul>
          )}
        </div>

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
                    {(r.status === "running" || r.status === "queued") && (
                      <button type="button" className={styles.stop} tabIndex={-1} onClick={() => onStop(r)} title={t("ai.stop")} aria-label={t("ai.stop")}>
                        <StopIcon />
                      </button>
                    )}
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
