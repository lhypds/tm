import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { FromTag, keepFocus } from "@components/TaskList";
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
// column sets the task to that status (`onMove(tasks, status)`); dragging one of the cards chosen
// together (`chosenKeys`, by ctrl / cmd and shift clicks as in the list) takes them all along. As
// in the list, a click only selects (onSelect(task, click)) and a double click opens the preview
// (`onPreview`).
export default function TaskBoard({
  tasks,
  statuses = BOARD_STATUSES,
  selectedKey,
  chosenKeys,
  focusedStatus,
  onFocusStatus,
  onSelect,
  onPreview,
  onMove,
  onSubtasks,
}) {
  const [dragKeys, setDragKeys] = useState([]);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  function drop(status) {
    const moving = tasks.filter((t) => dragKeys.includes(t.key) && boardStatus(t) !== status);
    setDragKeys([]);
    if (moving.length) onMove(moving, status);
  }

  return (
    <div className={styles.board} style={{ "--columns": statuses.length }}>
      {statuses.map((status) => (
        <Column
          key={status}
          status={status}
          cards={tasks.filter((t) => boardStatus(t) === status)}
          selectedKey={selectedKey}
          chosenKeys={chosenKeys}
          selectedRef={selectedRef}
          focused={status === focusedStatus}
          dragKeys={dragKeys}
          onFocus={() => onFocusStatus(status)}
          onDragOver={(e) => {
            if (!dragKeys.length) return;
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
            setDragKeys(chosenKeys.has(t.key) ? [...chosenKeys] : [t.key]);
            onSelect(t); // a card not chosen is selected alone; the chosen ones stay chosen
          }}
          onDragEnd={() => setDragKeys([])}
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
  chosenKeys,
  selectedRef,
  focused,
  dragKeys,
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
              data-selected={chosenKeys.has(t.key)}
              data-dragging={dragKeys.includes(t.key)}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => onDragStart(e, t)}
              onDragEnd={onDragEnd}
              onMouseDown={keepFocus}
              onFocus={() => onSelect(t)}
              onClick={(e) => onSelect(t, e)}
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
