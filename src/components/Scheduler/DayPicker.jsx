import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@components/icons";
import styles from "./dayPicker.module.css";

const p2 = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

// The first day of the week where `language` is spoken (0 Sunday .. 6 Saturday): Monday when the
// browser does not say.
function firstDayOf(language) {
  try {
    const locale = new Intl.Locale(language);
    const info = locale.getWeekInfo?.() || locale.weekInfo;
    return info ? info.firstDay % 7 : 1;
  } catch {
    return 1;
  }
}

// The days to pick one from, under the day the scheduler shows (a click on it): a month, its year
// and month between the buttons that step a month back and forward, then its weeks, a square a
// day, with the days of the months around it that fill its first and last week (fainter). The day
// shown (`date`, "YYYY-MM-DD") is shaded and today is bold; a click on a day picks it
// (`onPick(day)`), and a press anywhere else or esc lets the picker go (`onClose`).
export default function DayPicker({ date, onPick, onClose }) {
  const { t, i18n } = useTranslation();
  const [y, m] = date.split("-").map(Number);
  const [month, setMonth] = useState({ y, m: m - 1 }); // the month on screen
  const ref = useRef(null);

  useEffect(() => {
    // the button that opened it closes it itself (see Scheduler): a press on it is not "outside"
    const onDown = (e) => !ref.current?.parentNode.contains(e.target) && onClose();
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation(); // not the page's esc too
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const first = firstDayOf(i18n.language);
  const start = new Date(month.y, month.m, 1);
  const lead = (start.getDay() - first + 7) % 7; // the days of the month before, in the first week
  const count = Math.ceil((lead + new Date(month.y, month.m + 1, 0).getDate()) / 7) * 7;
  const days = Array.from({ length: count }, (_, i) => new Date(month.y, month.m, 1 - lead + i));
  const names = new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" });
  const now = keyOf(new Date());
  const step = (n) => setMonth(({ y: yy, m: mm }) => ({ y: new Date(yy, mm + n, 1).getFullYear(), m: new Date(yy, mm + n, 1).getMonth() }));

  return (
    <div ref={ref} className={styles.picker} role="dialog" aria-label={t("scheduler.pick")}>
      <div className={styles.head}>
        <button type="button" className={styles.step} tabIndex={-1} onClick={() => step(-1)} title={t("month.prev")} aria-label={t("month.prev")}>
          <ChevronLeftIcon />
        </button>
        <span className={styles.month}>
          {month.y}-{p2(month.m + 1)}
        </span>
        <button type="button" className={styles.step} tabIndex={-1} onClick={() => step(1)} title={t("month.next")} aria-label={t("month.next")}>
          <ChevronRightIcon />
        </button>
      </div>
      <div className={styles.grid}>
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className={`muted ${styles.name}`}>
            {names.format(d)}
          </span>
        ))}
        {days.map((d) => {
          const key = keyOf(d);
          return (
            <button
              key={key}
              type="button"
              className={styles.day}
              tabIndex={-1}
              data-other={d.getMonth() !== month.m}
              data-today={key === now}
              aria-pressed={key === date}
              onClick={() => onPick(key)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
