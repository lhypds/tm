import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "@utils/api";
import TreeLines from "@components/TreeLines";
import { TASKS_DRAG_TYPE, describe, formatStamp } from "@utils/task";
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

// A press with ctrl / cmd or shift adds to the chosen tasks on its click: the row must not take the
// focus first, which would select it alone (nor shift select text).
export const keepFocus = (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey) e.preventDefault();
};

// The tasks as a tree, like the origins tree: `tasks` are the rows in order, each subtask under
// its task with its `depth`, `through` and `last` (see flattenTasks), drawn with tree lines before
// its title. `selectedKey` is the row the keyboard shortcuts act on; it is kept scrolled into
// view. A click selects a row (onSelect(task, click), the click saying whether ctrl / cmd or shift
// were held, see Home), a double click opens its preview (`onPreview`); `chosenKeys` are the rows
// chosen together, shaded as the selected one is. A task's `from` (the
// work or repository it lives in, in a list of several) shows before its title, on its subtasks
// too (they are from the same place). With no rows the column header still shows, and `empty`
// (the "no tasks" message) sits centred under it.
// Dragging a row onto another of the same space makes it a subtask of that one, dragging it onto
// the blank area of the list (or its header) takes it out to the top of the list
// (`onMove(tasks, target)`, target null for the top); dragging one of the rows chosen together
// takes them all along, each subtask among them going with its task. A row does not take a task
// that is dragged, nor one under it.
export default function TaskList({ tasks, selectedKey, chosenKeys, focused, onSelect, onPreview, onToggleDone, onMove, empty }) {
  const { t: tr } = useTranslation();
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const [dragKeys, setDragKeys] = useState([]);
  const [over, setOver] = useState(null); // the row the drag would drop into, "" the top of the list
  const dragged = tasks.filter((t) => dragKeys.includes(t.key));
  const under = (t, of) => t.key.startsWith(`${of.key}/`); // keys start with the space, then the rel
  const sameSpace = (a, b) => a.space.work === b.space.work && (a.space.repository || "") === (b.space.repository || "");
  const takes = (target) =>
    target
      ? dragged.length > 0 && dragged.every((d) => d.key !== target.key && !under(target, d) && sameSpace(d, target))
      : dragged.some((d) => d.depth > 0);

  const dragOver = (e, target) => {
    e.stopPropagation();
    if (!dragged.length) return;
    if (!takes(target)) return setOver(null);
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(target ? target.key : "");
  };
  const drop = (e, target) => {
    e.stopPropagation();
    e.preventDefault();
    const ok = takes(target);
    const moving = dragged.filter((d) => !dragged.some((a) => under(d, a)));
    setDragKeys([]);
    setOver(null);
    if (ok) onMove(moving, target);
  };

  return (
    <div
      className={styles.table}
      role="table"
      data-empty={tasks.length === 0}
      data-drop={over === ""}
      onDragOver={(e) => dragOver(e, null)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null)}
      onDrop={(e) => drop(e, null)}
    >
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
            className={`${styles.row}${chosenKeys.has(t.key) ? ` ${styles.selected}` : ""}`}
            data-status={t.status}
            data-depth={t.depth}
            data-dragging={dragKeys.includes(t.key)}
            data-drop={over === t.key}
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.title || t.id);
              const keys = chosenKeys.has(t.key) ? [...chosenKeys] : [t.key];
              e.dataTransfer.setData(TASKS_DRAG_TYPE, JSON.stringify(keys)); // for a drop on the tree
              setDragKeys(keys);
              onSelect(t); // a row not chosen is selected alone; the chosen ones stay chosen
            }}
            onDragEnd={() => {
              setDragKeys([]);
              setOver(null);
            }}
            onDragOver={(e) => dragOver(e, t)}
            onDrop={(e) => drop(e, t)}
            onMouseDown={keepFocus}
            onFocus={() => onSelect(t)}
            onClick={(e) => onSelect(t, e)}
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
