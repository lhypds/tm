import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import * as api from "@utils/api";
import TreeLines from "@components/TreeLines";
import { describe, formatStamp } from "@utils/task";
import styles from "./tasklist.module.css";

// The status box: a tick for done, a "p" for pending, an "a" for aborted, empty for todo.
function DoneBox({ checked, pending, aborted, onChange, title }) {
  return (
    <label className={styles.check} title={title} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className={styles.checkInput} checked={checked} onChange={onChange} />
      <span className={styles.box} data-letter={pending || aborted} aria-hidden="true">
        {pending ? "p" : aborted ? "a" : null}
      </span>
    </label>
  );
}

// Where a task is from: its repository (or work) name, a link to that space. A long name is cut
// short with an ellipsis, and the whole work / repository path shows on hover. Clicking it must not
// select (or, doubled, preview) the row around it.
export function FromTag({ task }) {
  if (!task.from) return null;
  const { origin, work, repository } = task.space;
  const stop = (e) => e.stopPropagation();
  return (
    <Link
      className={`tag ${styles.from}`}
      to={api.spacePath(origin, work, repository)}
      title={task.from}
      onClick={stop}
      onDoubleClick={stop}
    >
      {task.fromParts.map((part, i) => (
        <span key={i} className={styles.fromPart}>
          {i > 0 && <span className={styles.fromSep}>/</span>}
          <span className={styles.fromName}>{part}</span>
        </span>
      ))}
    </Link>
  );
}

// The tasks as a tree, like the origins tree: `tasks` are the rows in order, each subtask under
// its task with its `depth`, `through` and `last` (see flattenTasks), drawn with tree lines before
// its title. `selectedKey` is the row the keyboard shortcuts act on; it is kept scrolled into
// view. A click selects a row, a double click opens its preview (`onPreview`). A task's `from` (the
// work or repository it lives in, in a list of several) shows before its title, on its subtasks
// too (they are from the same place). With no rows the column header still shows, and `empty`
// (the "no tasks" message) sits centred under it.
export default function TaskList({ tasks, selectedKey, focused, onSelect, onPreview, onToggleDone, empty }) {
  const { t: tr } = useTranslation();
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  return (
    <div className={styles.table} role="table" data-empty={tasks.length === 0}>
      <div className={`${styles.row} ${styles.head}`} data-focused={focused} role="row">
        <div />
        <div>{tr("field.created")}</div>
        <div>{tr("field.task")}</div>
      </div>
      {tasks.map((t) => {
        const detail = describe(t.details);
        return (
          <div
            key={t.key}
            ref={t.key === selectedKey ? selectedRef : null}
            className={`${styles.row}${t.key === selectedKey ? ` ${styles.selected}` : ""}`}
            data-status={t.status}
            data-depth={t.depth}
            role="button"
            tabIndex={0}
            onFocus={() => onSelect(t)}
            onClick={() => onSelect(t)}
            onDoubleClick={() => onPreview(t)}
          >
            <div>
              <DoneBox
                checked={t.status === "done"}
                pending={t.status === "pending"}
                aborted={t.status === "aborted"}
                onChange={() => onToggleDone(t)}
                title={tr(t.status === "done" ? "list.markTodo" : "list.markDone")}
              />
            </div>
            <div className="mono">{formatStamp(t.id)}</div>
            <div className={styles.title} style={{ "--depth": t.depth }}>
              <TreeLines depth={t.depth} through={t.through} last={t.last} />
              <div className={styles.titleLines}>
                <FromTag task={t} />
                <span className={styles.titleText}>
                  {t.title || <span className="muted">{tr("common.untitled")}</span>}
                  {detail && <span className={styles.detail}>{detail}</span>}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      {tasks.length === 0 && empty && <div className={styles.empty}>{empty}</div>}
    </div>
  );
}
