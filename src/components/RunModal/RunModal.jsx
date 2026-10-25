import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { XIcon, PlayIcon, StopIcon } from "@components/icons";
import * as api from "@utils/api";
import { duration } from "@utils/task";
import styles from "./run.module.css";

// The run of Claude Code on a task, in a dialog sized as the task preview's: opened by the run button
// beside the task's prompt, for `task` (null: closed), it shows the task's run (`run`, null while
// the run is being started; see useRuns) as it goes. Without one, it shows the latest of the task's
// runs kept in its folder (`saved`, the records as useTaskFiles lists them, newest first), and with
// `folder`, the record so named, picked from the list under the prompt, whatever run is going; the
// record is read here, transcript and all, through api.getSavedRun, and shown with when it was. The header says
// "Claude: <task>" with the run's state (starting, running, waiting for an answer, done...) at its
// right end, followed by the machine the run is on when it is another (`run.machine`: a task pushed
// from there runs there, and is queued until that machine starts it), and carries, at its left as the
// preview's buttons, the stop button while the run goes (onStop(run)), else run again (onRunAgain(task))
// and clear (onDismiss(run), or onForget(record) for a record). The body is the transcript, followed as
// it grows: Claude's text, the tools it calls (a click shows the output), and what it asks, answered
// right there: a permission, with allow / deny, or a question, with its options and a line for an
// answer of one's own (onAnswer(run, body), body { decision } or { answers }). Closing the dialog
// (esc, ×, onClose) leaves the run going.
export default function RunModal({ task, run, saved, folder, onClose, onStop, onAnswer, onRunAgain, onDismiss, onForget }) {
  const { t } = useTranslation();

  // The record to show: the one picked, while the task still has it; else, without a run going, the
  // latest. Read when it changes.
  const picked = folder && saved?.some((s) => s.folder === folder) ? folder : null;
  const wanted = picked || (!run ? saved?.[0]?.folder : null) || null;
  const [record, setRecord] = useState(null);
  useEffect(() => {
    setRecord(null);
    if (!task || !wanted) return undefined;
    let stale = false;
    api.getSavedRun(task.space, task.rel, wanted).then(
      (d) => {
        if (!stale) setRecord(d.run);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [task?.key, wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = wanted ? record : run;
  const live = run?.status === "running" || run?.status === "queued"; // a run going, shown or not
  const queued = shown?.status === "queued";
  const running = shown?.status === "running" || queued;
  const state = !shown
    ? t(wanted ? "common.loading" : "ai.starting")
    : queued
      ? t("ai.queued", { machine: shown.machine })
      : shown.pending
        ? t("ai.waiting")
        : running
          ? t("ai.running")
          : shown.status === "done"
            ? t("ai.done", { time: duration(shown.endedAt - shown.startedAt) })
            : shown.status === "stopped"
              ? t("ai.stopped")
              : t("ai.failed");
  const where = shown?.machine && !queued ? ` · ${shown.machine}` : "";
  const when = record ? ` · ${new Date(record.startedAt).toLocaleString()}` : "";

  const button = (label, icon, onClick, disabled = false) => (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      disabled={disabled}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
  const actions = (
    <div className={styles.headerButtons}>
      {running
        ? button(t("ai.stop"), <StopIcon />, () => onStop(run))
        : [
            button(t("ai.again"), <PlayIcon />, () => onRunAgain(task), !shown || live),
            button(t("ai.dismiss"), <XIcon />, () => (shown === run ? onDismiss(run) : onForget(record)), !shown),
          ].map((b, i) => <span key={i}>{b}</span>)}
    </div>
  );
  const stateTag = (
    <span className={`muted ${styles.state}`} data-pending={!!shown?.pending} title={shown?.error || ""}>
      {state}
      {where}
      {when}
    </span>
  );

  return (
    <Modal isOpen={!!task} onClose={onClose} title={task ? t("ai.titleOf", { title: task.title }) : ""} className={styles.modal} titleActions={actions} headerActions={stateTag} tight>
      <div className={styles.body}>
        <Transcript run={shown} loading={!!wanted && !record} onAnswer={(body) => onAnswer(run, body)} />
      </div>
    </Modal>
  );
}

// The transcript, scrolled to its end as it grows until it is scrolled up.
// `loading`: a record is being read, nothing to say yet.
function Transcript({ run, loading, onAnswer }) {
  const listRef = useRef(null);
  const follow = useRef(true);
  const items = run?.items;
  useEffect(() => {
    const el = listRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  return (
    <div
      className={styles.list}
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {(items || []).map((item, i) => (
        <Item key={i} item={item} pending={run.pending?.i === i} billed={run.billed} onAnswer={onAnswer} />
      ))}
      {!loading && (!run || ((run.status === "running" || run.status === "queued") && !run.pending)) && <Working run={run} />}
    </div>
  );
}

// The glyphs of the spinner, turned through one after another (as Claude Code's own does).
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const GLYPH_MS = 120;

// What Claude is at while the run goes, under the transcript: a glyph that turns, the tool being
// used (the last one not done) or "thinking", dots that pulse one after the other, and how long the
// run has been going. Still when the reader asked for less motion.
function Working({ run }) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), GLYPH_MS);
    return () => clearInterval(id);
  }, []);
  const items = run?.items || [];
  const tool = [...items].reverse().find((it) => it.type === "tool" && !it.done);
  const what = !run ? t("ai.starting") : run.status === "queued" ? t("ai.queued", { machine: run.machine }) : tool ? t("ai.using", { tool: tool.name }) : t("ai.thinking");
  return (
    <div className={`muted ${styles.working}`}>
      <span className={styles.glyph} aria-hidden="true">
        {GLYPHS[tick % GLYPHS.length]}
      </span>
      <span>
        {what}
        <span className={styles.dots} aria-hidden="true">
          <i>.</i>
          <i>.</i>
          <i>.</i>
        </span>
      </span>
      {run && <span className={styles.elapsed}>{duration(Date.now() - run.startedAt)}</span>}
    </div>
  );
}

function Item({ item, pending, billed, onAnswer }) {
  switch (item.type) {
    case "text":
      return <div className={styles.text}>{item.text}</div>;
    case "tool":
      return <ToolItem item={item} />;
    case "permission":
      return <PermissionItem item={item} pending={pending} onAnswer={onAnswer} />;
    case "question":
      return <QuestionItem item={item} pending={pending} onAnswer={onAnswer} />;
    case "result":
      return <ResultItem item={item} billed={billed} />;
    case "error":
      return <div className={styles.error}>{item.message}</div>;
    default:
      return null;
  }
}

// A tool call: its name and what it is about on one line, with a mark for how it went; a click
// unfolds the whole line and the tool's output.
function ToolItem({ item }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mark = !item.done ? "..." : item.isError ? "✗" : "✓";
  return (
    <div className={styles.tool} data-error={!!item.isError} data-open={open}>
      <button
        type="button"
        className={styles.toolHead}
        tabIndex={-1}
        onClick={(e) => {
          e.currentTarget.blur();
          setOpen((o) => !o);
        }}
        title={t(open ? "ai.hideOutput" : "ai.showOutput")}
      >
        <span className={styles.toolMark}>{mark}</span>
        <span className={styles.toolName}>{item.name}</span>
        <span className={styles.toolSummary}>{item.summary}</span>
      </button>
      {open && item.done && <pre className={styles.toolResult}>{item.result || t("ai.noOutput")}</pre>}
    </div>
  );
}

// A permission Claude asks for a tool: what it wants to do, allow and deny while it waits, then how
// it was answered.
function PermissionItem({ item, pending, onAnswer }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const answer = async (decision) => {
    setBusy(true);
    try {
      await onAnswer({ decision });
    } finally {
      setBusy(false);
    }
  };
  const outcome = item.cancelled ? t("ai.cancelled") : item.decision === "allow" ? t("ai.allowed") : item.decision === "deny" ? t("ai.denied") : "";
  return (
    <div className={styles.ask} data-open={pending}>
      <div className={styles.askTitle}>{t("ai.permission", { tool: item.toolName })}</div>
      {item.summary && <pre className={styles.askBody}>{item.summary}</pre>}
      {item.reason && <div className={`muted ${styles.askNote}`}>{item.reason}</div>}
      {pending ? (
        <div className={styles.askActions}>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={(e) => {
              e.currentTarget.blur();
              answer("deny");
            }}
          >
            {t("ai.deny")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={(e) => {
              e.currentTarget.blur();
              answer("allow");
            }}
          >
            {t("ai.allow")}
          </button>
        </div>
      ) : (
        outcome && <div className={`muted ${styles.askNote}`}>{outcome}</div>
      )}
    </div>
  );
}

// A question of Claude's own (AskUserQuestion): each question with its options, one to pick (or
// several, when it says so) or an answer typed instead; then the answers given.
function QuestionItem({ item, pending, onAnswer }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState({}); // question -> the label picked (a list when several may be)
  const [typed, setTyped] = useState({}); // question -> an answer of one's own
  const [busy, setBusy] = useState(false);
  const questions = item.questions || [];

  const answerOf = (q) => {
    const own = (typed[q.question] || "").trim();
    const p = picked[q.question];
    if (q.multiSelect) return [...(p || []), ...(own ? [own] : [])].join(", ");
    return own || p || "";
  };
  const ready = questions.length > 0 && questions.every((q) => answerOf(q));

  const toggle = (q, label) =>
    setPicked((prev) => {
      if (!q.multiSelect) return { ...prev, [q.question]: label };
      const cur = prev[q.question] || [];
      return { ...prev, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onAnswer({ answers: Object.fromEntries(questions.map((q) => [q.question, answerOf(q)])) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.ask} data-open={pending}>
      {questions.map((q) => (
        <div key={q.question} className={styles.question}>
          <div className={styles.askTitle}>
            {q.header && <span className={`tag ${styles.header}`}>{q.header}</span>}
            {q.question}
          </div>
          {pending ? (
            <>
              <div className={styles.options}>
                {(q.options || []).map((o) => {
                  const on = q.multiSelect ? (picked[q.question] || []).includes(o.label) : picked[q.question] === o.label;
                  return (
                    <label key={o.label} className={styles.option}>
                      <input type={q.multiSelect ? "checkbox" : "radio"} name={q.question} checked={on} onChange={() => toggle(q, o.label)} />
                      <span className={styles.optionText}>
                        {o.label}
                        {o.description && <span className={`muted ${styles.optionDesc}`}>{o.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              <input
                className={`input ${styles.other}`}
                placeholder={t("ai.other")}
                value={typed[q.question] || ""}
                onChange={(e) => setTyped((prev) => ({ ...prev, [q.question]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </>
          ) : (
            <div className={`muted ${styles.askNote}`}>{item.cancelled ? t("ai.cancelled") : item.answers?.[q.question] || ""}</div>
          )}
        </div>
      ))}
      {pending && (
        <div className={styles.askActions}>
          <button
            type="button"
            className="btn primary"
            disabled={!ready || busy}
            onClick={(e) => {
              e.currentTarget.blur();
              submit();
            }}
          >
            {t("ai.submit")}
          </button>
        </div>
      )}
    </div>
  );
}

// How the run ended: its time and turns, or what went wrong. The cost only when it is one (`billed`:
// Claude Code used with an API key); with a claude.ai login the figure is an estimate nobody pays,
// so it is left out, as the terminal leaves it out.
function ResultItem({ item, billed }) {
  const { t } = useTranslation();
  if (item.isError) return <div className={styles.error}>{item.text || item.subtype}</div>;
  const parts = [duration(item.durationMs)];
  if (typeof item.turns === "number") parts.push(t("ai.turns", { count: item.turns }));
  if (billed && typeof item.costUsd === "number") parts.push(`$${item.costUsd.toFixed(2)}`);
  return <div className={`muted ${styles.result}`}>{parts.join(" · ")}</div>;
}
