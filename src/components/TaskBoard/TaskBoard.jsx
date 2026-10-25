import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { FromTag } from "@components/TaskList";
import { describe, formatStamp } from "@utils/task";
import styles from "./board.module.css";

// Every column the board can have, in order; the "aborted" column shows only when aborted tasks
// are shown (`statuses` says which columns a board has).
export const BOARD_STATUSES = ["todo", "done", "pending", "aborted"];

// The column a task sits in: that of its status; anything that is not done, pending or aborted is
// still to do.
export const boardStatus = (task) => (BOARD_STATUSES.includes(task.status) ? task.status : "todo");

// The progress view: a column per status in `statuses` with the tasks as cards. Only the tasks at
// the top of the folder are cards (`tasks`, in order): a task's subtasks are not shown under it,
// as the list does; its card has a subtasks button instead (how many, at its bottom right), which opens that task's
// folder (`onSubtasks`), so its subtasks show on a board of their own. Dragging a card into another
// column sets the task to that status (`onMove`). As in the list, a click only selects and a double
// click opens the preview (`onPreview`).
export default function TaskBoard({
  tasks,
  statuses = BOARD_STATUSES,
  selectedKey,
  focusedStatus,
  onFocusStatus,
  onSelect,
  onPreview,
  onMove,
  onSubtasks,
}) {
  const [dragKey, setDragKey] = useState(null);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  function drop(status) {
    const task = tasks.find((t) => t.key === dragKey);
    setDragKey(null);
    if (task && boardStatus(task) !== status) onMove(task, status);
  }

  return (
    <div className={styles.board} style={{ "--columns": statuses.length }}>
      {statuses.map((status) => (
        <Column
          key={status}
          status={status}
          cards={tasks.filter((t) => boardStatus(t) === status)}
          selectedKey={selectedKey}
          selectedRef={selectedRef}
          focused={status === focusedStatus}
          dragKey={dragKey}
          onFocus={() => onFocusStatus(status)}
          onDragOver={(e) => {
            if (!dragKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            drop(status);
          }}
          onDragStart={(e, t) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", t.title || t.id);
            setDragKey(t.key);
            onSelect(t);
          }}
          onDragEnd={() => setDragKey(null)}
          onSelect={onSelect}
          onPreview={onPreview}
          onSubtasks={onSubtasks}
        />
      ))}
    </div>
  );
}

// One column: its head with the number of cards, then the cards.
function Column({
  status,
  cards,
  selectedKey,
  selectedRef,
  focused,
  dragKey,
  onFocus,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
  onPreview,
  onSubtasks,
}) {
  const { t: tr } = useTranslation();

  return (
    <section
      className={styles.column}
      data-status={status}
      data-focused={focused}
      onMouseDown={(e) => {
        e.stopPropagation();
        onFocus();
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className={styles.columnHead}>
        <span>{tr(`status.${status}`)}</span>
        <span className={styles.count}>{cards.length}</span>
      </header>
      <div className={styles.cards}>
        {cards.map((t) => {
          const detail = describe(t.details);
          const count = t.subtaskCount || 0;
          return (
            <div
              key={t.key}
              ref={t.key === selectedKey ? selectedRef : null}
              className={styles.card}
              data-selected={t.key === selectedKey}
              data-dragging={t.key === dragKey}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => onDragStart(e, t)}
              onDragEnd={onDragEnd}
              onFocus={() => onSelect(t)}
              onClick={() => onSelect(t)}
              onDoubleClick={() => onPreview(t)}
            >
              <div className={styles.cardTitle}>
                <FromTag task={t} />
                <span className={styles.cardName}>{t.title || <span className="muted">{tr("common.untitled")}</span>}</span>
                {detail && <span className={styles.cardDetail}>{detail}</span>}
              </div>
              <div className={styles.cardFoot}>
                <span className={`mono ${styles.cardStamp}`}>{formatStamp(t.id)}</span>
                {count > 0 && (
                  <button
                    type="button"
                    className={styles.subtasks}
                    title={tr("board.showSubtasks", { name: t.title || t.id })}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      // the button is in the card, which is draggable: a press on it must not pick the card up
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSubtasks(t);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {count}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
