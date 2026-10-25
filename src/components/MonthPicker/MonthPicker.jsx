import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon } from "@components/icons";
import styles from "./monthPicker.module.css";

// The time the tasks are filtered by, as in fin: a step back, the entry itself, a step forward.
// `months` are the entries (all, last / this week, then the months, newest first; see taskMonths),
// so "previous" steps down the list and "next" steps up. The entry opens a list: Up
// and Down walk it (and open it from the entry), Enter or Space pick, Escape or a press outside
// closes it. `label` writes an entry.
export default function MonthPicker({ months, index, label, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const monthRef = useRef(null);
  const listRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  // Closes on a press anywhere outside, or on Escape.
  useEffect(() => {
    if (!open) return;
    const handleOutside = (e) => {
      if (!wrapRef.current?.contains(e.target)) close();
    };
    const handleKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  // The list opens with the month on screen focused, so the keys start from it.
  useEffect(() => {
    if (open) listRef.current?.querySelector("[aria-selected='true']")?.focus();
  }, [open]);

  // Picking, and Escape, hand the focus back to the month; a press outside leaves it where it went.
  function pick(key) {
    setOpen(false);
    monthRef.current?.focus();
    onChange(key);
  }

  function handleMonthKey(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setOpen(true);
  }

  function handleListKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      monthRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const options = [...listRef.current.querySelectorAll("[role='option']")];
    const i = options.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : -1);
    options[Math.min(Math.max(i, 0), options.length - 1)]?.focus();
  }

  return (
    <div className={styles.picker}>
      <button
        type="button"
        className={styles.step}
        disabled={index >= months.length - 1}
        onClick={() => onChange(months[index + 1].key)}
        title={t("month.prev")}
        aria-label={t("month.prev")}
      >
        <ChevronLeftIcon />
      </button>
      <div
        ref={wrapRef}
        className={styles.monthWrap}
        data-open={open}
        // A Tab out of the list closes it too.
        onBlur={(e) => {
          if (open && !wrapRef.current.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <button
          type="button"
          ref={monthRef}
          className={styles.month}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={handleMonthKey}
          title={t("month.title")}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {label(months[index])}
        </button>
        {open && (
          <div ref={listRef} className={styles.list} role="listbox" aria-label={t("month.title")} onKeyDown={handleListKey}>
            {months.map((m, i) => (
              <button key={m.key} type="button" role="option" aria-selected={i === index} onClick={() => pick(m.key)}>
                {label(m)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={styles.step}
        disabled={index <= 0}
        onClick={() => onChange(months[index - 1].key)}
        title={t("month.next")}
        aria-label={t("month.next")}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
