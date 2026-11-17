import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, EditIcon, PlusIcon } from "@components/icons";
import CalendarsModal from "@components/Scheduler/CalendarsModal";
import { firstDayOf } from "@components/Scheduler/DayPicker";
import EventModal from "@components/Scheduler/EventModal";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { lightColor } from "@utils/colors";
import styles from "./monthCalendar.module.css";

const READ_EVERY = 5 * 60 * 1000; // as long as the server keeps a calendar it has read

const p2 = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hm = (ms) => {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

// The events of each of `days` (their keys, "YYYY-MM-DD"): { [day]: [event] }, those of whole days
// first, then by their start. An event is on every day it has a part of.
function byDay(events, days) {
  const out = Object.fromEntries(days.map((day) => [day, []]));
  for (const event of events) {
    for (const day of days) {
      let on;
      if (event.allDay) on = event.start <= day && day < event.end;
      else {
        const [y, m, d] = day.split("-").map(Number);
        const from = new Date(y, m - 1, d).getTime();
        const to = new Date(y, m - 1, d + 1).getTime();
        on = event.start < to && (event.end > from || event.start >= from);
      }
      if (on) out[day].push(event);
    }
  }
  return out;
}

// The months to pick one from, under the month the calendar shows (a click on it): a year between
// the buttons that step a year back and forward, then its twelve months. The month shown
// (`month`, { y, m }) is shaded and this month is bold; a click on a month picks it
// (`onPick({ y, m })`), and a press anywhere else or esc lets the picker go (`onClose`).
function MonthSelect({ month, onPick, onClose }) {
  const { t } = useTranslation();
  const [year, setYear] = useState(month.y);
  const ref = useRef(null);
  useEffect(() => {
    // the button that opened it closes it itself: a press on it is not "outside"
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
  const now = new Date();
  return (
    <div ref={ref} className={styles.select} role="dialog" aria-label={t("month.title")}>
      <div className={styles.selectHead}>
        <button type="button" className={styles.step} tabIndex={-1} onClick={() => setYear((y) => y - 1)}>
          <ChevronLeftIcon />
        </button>
        <span className={styles.year}>{year}</span>
        <button type="button" className={styles.step} tabIndex={-1} onClick={() => setYear((y) => y + 1)}>
          <ChevronRightIcon />
        </button>
      </div>
      <div className={styles.selectGrid}>
        {Array.from({ length: 12 }, (_, m) => (
          <button
            key={m}
            type="button"
            className={styles.selectMonth}
            tabIndex={-1}
            data-now={year === now.getFullYear() && m === now.getMonth()}
            aria-pressed={year === month.y && m === month.m}
            onClick={() => onPick({ y: year, m })}
          >
            {p2(m + 1)}
          </button>
        ))}
      </div>
    </div>
  );
}

// The calendar view, in place of the task list (v, or c): a whole month of the Google and Apple
// calendars the server is given (see server/calendar.js). Under its title, a row says which month
// is shown, between the buttons that step a month back and forward; a click on the month picks
// another (see MonthSelect), and the page's refresh (r; `loading` while it lasts) is back on this
// month, reads the calendars anew, and covers the view under its bar with "Loading..." meanwhile,
// as the task list says it. The month is a grid, a week a row and a day a square (the days of the months around
// it that fill its first and last week are fainter, today's number is framed), each with its
// events one under another, thin as a tag of the task list and in their calendar's color: its
// start and its title; a square with more than fit scrolls. A click on an event chooses it (as the
// keys do, see below; the scheduler goes to its day, and the event chosen is the page's,
// `chosenEvent` changed with `onEvent(id)`, so the timetable shows it chosen too, and one chosen
// there is chosen here) and a double click shows its details (see EventModal), a click anywhere else on a day shows that day in the scheduler at the right,
// with its timetable (`onDay(day)`), and the day the scheduler shows (`chosenDay`, "YYYY-MM-DD",
// or null while it is not on screen) is shaded. The pencil at the right of the title adds and removes calendars (see
// CalendarsModal), and the plus at its left makes a new event in Apple's Calendar (on the server's
// machine, a Mac), open there for its time to be chosen, on the day the keyboard is on, else the one the scheduler shows,
// else today (the first of another month); a does the same. The events are read again whenever `reloadKey` changes (the page's refresh,
// which reads the calendars anew) and every few minutes. While `focused` (the keyboard is on the
// middle of the page) the title is shaded (and the row of the weekdays while h j k l move a day) and the keys are its own (`keysRef` is given them; each
// answers true when it was one of them). The keyboard is first on the view itself: j (or enter)
// goes into the month, onto a day (the one the scheduler shows, else today, else the first); h j
// k l and the arrows then move a day and a week, the month following a day of another one, and
// the scheduler shows each day the keyboard comes on (so it is the shaded one, as after a click);
// enter goes into the day, where j and k walk its events and space shows the one chosen (see EventModal); esc is back out of the
// day, then out of the month.
export default function MonthCalendar({ reloadKey, loading, focused, keysRef, chosenDay, onDay, chosenEvent, onEvent }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }));
  const [read, setRead] = useState(null); // { range, events, errors } as read last
  const [looked, setLooked] = useState(null); // the event whose details are shown
  const [editing, setEditing] = useState(false); // the calendars dialog is open
  const [edits, setEdits] = useState(0); // how many times it saved
  const [refreshes, setRefreshes] = useState(0); // how many times the page was refreshed while this is shown
  const readKey = useRef(`${reloadKey}/0/0`);
  const [picking, setPicking] = useState(false); // the months to pick one from are shown
  const closePicker = useCallback(() => setPicking(false), []);

  const first = firstDayOf(i18n.language);
  const lead = (new Date(month.y, month.m, 1).getDay() - first + 7) % 7; // the days of the month before, in the first week
  const count = Math.ceil((lead + new Date(month.y, month.m + 1, 0).getDate()) / 7) * 7;
  const dates = Array.from({ length: count }, (_, i) => new Date(month.y, month.m, 1 - lead + i));
  const days = dates.map(keyOf);
  const range = `${days[0]}/${days[days.length - 1]}`;

  useEffect(() => {
    let stale = false;
    const [from, until] = range.split("/");
    const get = async (fresh) => {
      try {
        const got = await api.getCalendarDays(from, until, fresh);
        if (!stale) setRead({ range, events: got.events, errors: got.errors });
      } catch (e) {
        if (!stale) setRead({ range, events: [], errors: [{ source: "", calendar: "", error: e.message }] });
      }
    };
    get(readKey.current !== `${reloadKey}/${edits}/${refreshes}`);
    readKey.current = `${reloadKey}/${edits}/${refreshes}`;
    const id = setInterval(() => document.visibilityState === "visible" && get(false), READ_EVERY);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [range, reloadKey, edits, refreshes]);

  // the page's refresh (its button, r: `loading` while it lasts) is back on this month, and reads
  // the calendars anew, whatever else it read (there may be no task list to read)
  useEffect(() => {
    if (!loading) return;
    setMonth({ y: new Date().getFullYear(), m: new Date().getMonth() });
    setRefreshes((n) => n + 1);
  }, [loading]);

  const step = (n) => setMonth(({ y, m }) => ({ y: new Date(y, m + n, 1).getFullYear(), m: new Date(y, m + n, 1).getMonth() }));
  const now = new Date();

  const shown = read?.range === range ? read : null;
  const events = byDay(shown?.events || [], days);

  // Where the keyboard is in the month: on no day (it is on the view itself), on a day (`cursor`,
  // its key), or in that day (`inDay`), on one of its events (`eventId`) or on none yet.
  const [cursor, setCursor] = useState(null);
  const [inDay, setInDay] = useState(false);
  const eventId = chosenEvent ?? null; // the page's: the timetable shows the same one chosen, and one chosen there is chosen here
  // The day the keyboard is on is the one the scheduler shows (the shaded one): when the scheduler
  // goes to another by itself (the refresh is back on today, its own buttons and keys), the
  // keyboard goes with it, so the next key starts from the day that is shaded.
  useEffect(() => {
    if (!chosenDay || !cursor || cursor === chosenDay) return;
    setCursor(chosenDay);
    setInDay(false);
    onEvent?.(null);
  }, [chosenDay]); // eslint-disable-line react-hooks/exhaustive-deps
  // a month shown that the day is not in (a step, a month picked, the refresh) lets it go
  const cursorShown = cursor && days.includes(cursor) ? cursor : null;
  const dayEvents = cursorShown ? events[cursorShown] : [];
  const chosenRef = useRef(null);
  useEffect(() => {
    if (eventId) chosenRef.current?.scrollIntoView({ block: "nearest" });
  }, [eventId]);
  // A new event in Apple's Calendar (the plus of the bar, a): on the day the keyboard is on, else
  // the one the scheduler shows, else today (the first of another month).
  const addEvent = () => {
    const inMonth = (day) => !!day && days.includes(day);
    const now1 = new Date();
    const day = cursorShown || (inMonth(chosenDay) ? chosenDay : month.y === now1.getFullYear() && month.m === now1.getMonth() ? keyOf(now1) : keyOf(new Date(month.y, month.m, 1)));
    api.newCalendarEvent(day, t("scheduler.newEventTitle")).catch((err) => showToast(err.message, 6000));
  };
  useEffect(() => {
    if (!keysRef) return undefined;
    keysRef.current = (name) => {
      if (name === "a") {
        addEvent();
        return true;
      }
      const to = (day) => {
        // onto another day, the month following it when it is in another one; the scheduler
        // shows it, with its timetable, as a click on it does (the day is then shaded)
        const [y, m] = day.split("-").map(Number);
        onDay?.(day);
        setCursor(day);
        setInDay(false);
        onEvent?.(null);
        if (y !== month.y || m - 1 !== month.m) setMonth({ y, m: m - 1 });
      };
      if (!cursorShown) {
        // into the month: on the day the scheduler shows, else today, else the first of the month
        if (!["j", "down", "enter"].includes(name)) return false;
        const inMonth = (day) => !!day && days.includes(day) && Number(day.split("-")[1]) - 1 === month.m;
        to(inMonth(chosenDay) ? chosenDay : inMonth(today) ? today : keyOf(new Date(month.y, month.m, 1)));
        return true;
      }
      if (name === "escape") {
        // out of the day, then out of the month
        if (inDay) {
          setInDay(false);
          onEvent?.(null);
        } else setCursor(null);
        return true;
      }
      if (inDay) {
        const at = dayEvents.findIndex((e) => e.id === eventId);
        if (["j", "down"].includes(name)) {
          if (dayEvents[at + 1]) onEvent?.(dayEvents[at + 1].id);
        } else if (["k", "up"].includes(name)) {
          if (at > 0) onEvent?.(dayEvents[at - 1].id);
          else {
            // above its first event: back on the day itself
            setInDay(false);
            onEvent?.(null);
          }
        } else if (name === "space") {
          if (dayEvents[at]) setLooked(dayEvents[at]);
        } else return ["h", "l", "left", "right", "enter"].includes(name); // nothing to do in a day
        return true;
      }
      const days1 = { h: -1, left: -1, l: 1, right: 1, k: -7, up: -7, j: 7, down: 7 }[name];
      if (days1) {
        const [y, m, d] = cursorShown.split("-").map(Number);
        to(keyOf(new Date(y, m - 1, d + days1)));
        return true;
      }
      if (name === "enter") {
        // into the day: the keys walk its events
        setInDay(true);
        onEvent?.(dayEvents[0]?.id ?? null);
        return true;
      }
      return name === "space"; // nothing to look at on a day
    };
    return () => {
      keysRef.current = null;
    };
  });

  const names = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
  const today = keyOf(now);
  const let1 = (e) => e.currentTarget.blur(); // let go after the click, so the keys stay the page's

  return (
    <section className={styles.calendar} aria-label={t("calendar.title")}>
      <div className={styles.bar} data-focused={!!focused}>
        <h2 className={styles.barTitle}>{t("calendar.title")}</h2>
        <span className={styles.barButtons}>
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            onClick={(e) => {
              let1(e);
              addEvent();
            }}
            title={t("scheduler.newEvent")}
            aria-label={t("scheduler.newEvent")}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="btn"
            tabIndex={-1}
            onClick={(e) => {
              let1(e);
              setEditing(true);
            }}
            title={t("scheduler.calendars")}
            aria-label={t("scheduler.calendars")}
          >
            <EditIcon />
          </button>
        </span>
      </div>
      <div className={styles.months}>
        <div className={styles.steps}>
          <button type="button" className={styles.step} tabIndex={-1} onClick={(e) => (let1(e), step(-1))} title={t("month.prev")} aria-label={t("month.prev")}>
            <ChevronLeftIcon />
          </button>
          <span className={styles.monthBox}>
            <button
              type="button"
              className={styles.month}
              tabIndex={-1}
              title={t("month.title")}
              data-current={month.y === now.getFullYear() && month.m === now.getMonth()} // shaded on this month
              aria-expanded={picking}
              onClick={(e) => {
                let1(e);
                setPicking((v) => !v);
              }}
            >
              {month.y}-{p2(month.m + 1)}
            </button>
            {picking && (
              <MonthSelect
                month={month}
                onClose={closePicker}
                onPick={(picked) => {
                  setPicking(false);
                  setMonth(picked);
                }}
              />
            )}
          </span>
          <button type="button" className={styles.step} tabIndex={-1} onClick={(e) => (let1(e), step(1))} title={t("month.next")} aria-label={t("month.next")}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      {shown?.errors.map((err, i) => (
        <div key={i} className={styles.note}>
          {t("scheduler.calendarError", { source: [{ google: "Google", apple: "Apple" }[err.source], err.calendar].filter(Boolean).join(" · "), error: err.error })}
        </div>
      ))}
      <div className={styles.names} data-focused={!!focused && !!cursorShown && !inDay}>
        {dates.slice(0, 7).map((d) => (
          <span key={d.getDay()} className={`muted ${styles.name}`}>
            {names.format(d)}
          </span>
        ))}
      </div>
      <div className={styles.grid} style={{ gridTemplateRows: `repeat(${count / 7}, minmax(0, 1fr))` }}>
        {dates.map((d, i) => (
          <div
            key={days[i]}
            className={styles.day}
            data-other={d.getMonth() !== month.m}
            data-today={days[i] === today}
            data-chosen={days[i] === chosenDay}
            // anywhere on the day but on an event of it, which shows itself
            onClick={(e) => !e.target.closest("button") && onDay?.(days[i])}
          >
            <span className={styles.number}>{d.getDate()}</span>
            <div className={styles.events}>
              {events[days[i]].map((e) => (
                <button
                  key={e.id}
                  ref={e.id === eventId ? chosenRef : undefined}
                  data-chosen={e.id === eventId}
                  type="button"
                  className={styles.event}
                  tabIndex={-1}
                  style={e.color ? { "--event": lightColor(e.color) } : undefined}
                  title={e.title}
                  // a click chooses it, as the keys do (the keyboard is then in its day); a double click shows it
                  onClick={(ev) => {
                    let1(ev);
                    onDay?.(days[i]); // its day in the scheduler, where the timetable shows it chosen too
                    setCursor(days[i]);
                    setInDay(true);
                    onEvent?.(e.id);
                  }}
                  onDoubleClick={() => setLooked(e)}
                >
                  {!e.allDay && <span className={styles.time}>{hm(e.start)}</span>}
                  <span className={styles.title}>{e.title || t("common.untitled")}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {loading && <div className={`muted ${styles.loading}`}>{t("common.loading")}</div>}
      <EventModal event={looked} onClose={() => setLooked(null)} />
      <CalendarsModal
        isOpen={editing}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          setEdits((n) => n + 1);
        }}
      />
    </section>
  );
}
