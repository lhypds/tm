import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditIcon } from "@components/icons";
import * as api from "@utils/api";
import { lightColor } from "@utils/colors";
import { formatDateTime } from "@utils/task";
import CalendarsModal from "./CalendarsModal";
import EventModal from "./EventModal";
import styles from "./calendar.module.css";

const HOUR = 40; // px an hour: half an hour is a card and its margins (20px), so an hour is two events high
const PAD = 12; // px above midnight, so its hour is not cut
const SLOT = 20; // px a card takes: its 16px and 2px above and under it
const READ_EVERY = 5 * 60 * 1000; // as long as the server keeps a calendar it has read

const SOURCES = { google: "Google", apple: "Apple" };
const p2 = (n) => String(n).padStart(2, "0");
const hm = (ms) => {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

// Where each of `events` (those with a time, in their order) goes on the day that starts at
// `from`: { event, top, col, cols }. A card is one height whatever the event lasts, its top on the
// line of its start (the day's first line for one that started before); those that would then
// cover one another share the width, `cols` of them side by side, this one the `col`th.
function place(events, from) {
  const placed = [];
  let group = [];
  let ends = []; // the bottom of the last card of each column of the group
  const close = () => {
    for (const item of group) item.cols = ends.length;
    group = [];
    ends = [];
  };
  for (const event of events) {
    const d = new Date(event.start);
    const minutes = event.start <= from ? 0 : d.getHours() * 60 + d.getMinutes();
    const top = PAD + (minutes * HOUR) / 60;
    if (ends.length && ends.every((end) => end <= top)) close();
    let col = ends.findIndex((end) => end <= top);
    if (col < 0) col = ends.length;
    ends[col] = top + SLOT;
    const item = { event, top, col, cols: 1 };
    group.push(item);
    placed.push(item);
  }
  close();
  return placed;
}

// The timetable under the scheduler's page, the lower half of the pane, as the prompt is under a
// task's text: a divider that says "Timetable", then the events of the day `date` in the Google and
// Apple calendars the server is given (see server/calendar.js). The day is a column of 24 hours, a
// line across for each with its time at the left, noon's in red, and a dashed one at each half hour; it scrolls, and starts with noon
// in the middle. An event is a card as thin as a tag of the task list, in its small type, on the line of its start: its
// times and its title (the rest, where it is and which calendar it is from, on hover), in the
// color its calendar was given, as light as an origin's is on a task's tag. The events
// of whole days stay above the hours. They are read again whenever `reloadKey` changes (the page's
// refresh, which reads the calendars anew, and puts noon back in the middle) and every few minutes.
// While `focused` (the keyboard came down from the page, see Scheduler) its divider is shaded, as
// the scheduler's bar, and the keys are its own (`keysRef` is given them; each answers true when
// it was one of them, "leave" when the keyboard goes back to the page): the keyboard is first on
// the calendar itself, on no event; j / k and the arrows walk the events from there, those of
// whole days first, the one the keyboard is on shaded and scrolled to; k above the first one is
// back on the calendar itself, and k there, and esc, leave; space shows the event's details (see EventModal), as a
// double click on an event does; a click on an event chooses it, and a press anywhere on the
// timetable puts the keyboard on it (`onChoose()` tells the scheduler so).
// The pencil at the right of the divider (as the one beside "Origins") opens the dialog that adds and removes calendars (see
// CalendarsModal); the day is read anew once it has saved.
export default function Calendar({ date, reloadKey, loading, focused, keysRef, onChoose }) {
  const { t } = useTranslation();
  const [day, setDay] = useState(null); // { date, configured, events, errors } as read last
  const hoursRef = useRef(null);
  const readKey = useRef(`${reloadKey}/0`);
  const [editing, setEditing] = useState(false); // the calendars dialog is open
  const [edits, setEdits] = useState(0); // how many times it saved

  useEffect(() => {
    let stale = false;
    const read = async (fresh) => {
      try {
        const got = await api.getCalendarDay(date, fresh);
        if (!stale) setDay({ date, ...got });
      } catch (e) {
        if (!stale) setDay({ date, configured: true, events: [], errors: [{ source: "", error: e.message }] });
      }
    };
    read(readKey.current !== `${reloadKey}/${edits}`);
    readKey.current = `${reloadKey}/${edits}`;
    const id = setInterval(() => document.visibilityState === "visible" && read(false), READ_EVERY);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [date, reloadKey, edits]);

  const shown = day?.date === date ? day : null;
  const events = shown?.events || [];
  const above = (shown?.errors.length || 0) + events.filter((e) => e.allDay).length; // what is over the hours

  // noon in the middle, on each day shown (again once what is over the hours has taken its room)
  // and on the page's refresh (`loading` while it lasts)
  useLayoutEffect(() => {
    const el = hoursRef.current;
    el.scrollTop = PAD + 12 * HOUR - el.clientHeight / 2;
  }, [date, above, loading]);

  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const whole = events.filter((e) => e.allDay);
  const timed = place(
    events.filter((e) => !e.allDay),
    from,
  );
  const from1 = (e) => [SOURCES[e.source], e.calendar].filter(Boolean).join(" · ");

  // The event the keyboard is on, by its key: none as the keyboard comes (it is on the calendar
  // itself, j then goes to the first event) and once it left.
  const eventKey = (e) => `${e.source}/${e.id}`;
  const ordered = [...whole, ...timed.map((x) => x.event)];
  const order = ordered.map(eventKey);
  const [looked, setLooked] = useState(null); // the event whose details are shown
  const [chosen, setChosen] = useState(null);
  useEffect(() => {
    if (!focused) setChosen(null);
  }, [focused]);
  useEffect(() => setChosen(null), [date]);
  const chosenRef = useRef(null);
  useEffect(() => {
    if (chosen) chosenRef.current?.scrollIntoView({ block: "nearest" });
  }, [chosen]);
  useEffect(() => {
    if (!keysRef) return undefined;
    keysRef.current = (name) => {
      if (name === "escape") return "leave";
      const step = ["j", "down"].includes(name) ? 1 : ["k", "up"].includes(name) ? -1 : 0;
      if (step) {
        const at = order.indexOf(chosen);
        if (step < 0 && at < 0) return "leave";
        if (step < 0 && at === 0) setChosen(null); // back on the calendar itself
        else if (order[at + step]) setChosen(order[at + step]);
        return true;
      }
      if (name === "space") {
        const event = ordered[order.indexOf(chosen)];
        if (event) setLooked(event);
        return true;
      }
      return ["enter", "i", "a", "e"].includes(name); // nothing to do on an event (h and l are the scheduler's: the days)
    };
    return () => {
      keysRef.current = null;
    };
  });
  const mark = (e) => (focused && eventKey(e) === chosen ? { "data-chosen": "true", ref: chosenRef } : {});
  const tint = (e) => (e.color ? { "--event": lightColor(e.color) } : undefined);
  // a click on an event chooses it, as the keys do: the keyboard is then on the timetable
  // (`onChoose()` says so to the scheduler)
  const choose = (e) => {
    onChoose?.();
    setChosen(eventKey(e));
  };

  return (
    <>
      {/* a press anywhere on the timetable, its divider or what is under it, puts the keyboard on it */}
      <div className={styles.divider} data-focused={!!focused} onMouseDown={() => onChoose?.()}>
        <span className={styles.title}>{t("scheduler.calendar")}</span>
        {/* let go after the click, so the keys are the page's again (as the bar's buttons) */}
        <button
          type="button"
          className="btn"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            setEditing(true);
          }}
          title={t("scheduler.calendars")}
          aria-label={t("scheduler.calendars")}
        >
          <EditIcon />
        </button>
      </div>
      <EventModal event={looked} onClose={() => setLooked(null)} />
      <CalendarsModal
        isOpen={editing}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          setEdits((n) => n + 1);
        }}
      />
      {/* what is under the divider is one box, half the pane with the page: the events of whole
          days (and what could not be read) take their room from the hours, not from the page */}
      <div className={styles.body} onMouseDown={() => onChoose?.()}>
        {shown?.errors.map((err, i) => (
          <div key={i} className={styles.note} data-error="true">
            {t("scheduler.calendarError", { source: [SOURCES[err.source], err.calendar].filter(Boolean).join(" · "), error: err.error })}
          </div>
        ))}
        {whole.length > 0 && (
          <div className={styles.whole}>
            {whole.map((e) => (
              <div key={eventKey(e)} className={styles.card} {...mark(e)} style={tint(e)} onClick={() => choose(e)} onDoubleClick={() => setLooked(e)} title={[e.title, e.location, from1(e)].filter(Boolean).join("\n")}>
                <span className={styles.name}>{e.title || t("common.untitled")}</span>
              </div>
            ))}
          </div>
        )}
        <div ref={hoursRef} className={styles.hours}>
          <div className={styles.day} style={{ height: PAD + 24 * HOUR + SLOT }}>
            {Array.from({ length: 25 }, (_, h) => (
              <div key={h} className={styles.hour} data-noon={h === 12} style={{ top: PAD + h * HOUR }}>
                <span className={styles.label}>{p2(h)}:00</span>
              </div>
            ))}
            {/* each half hour: a dashed line, with no time */}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className={styles.hour} data-half="true" style={{ top: PAD + (h + 0.5) * HOUR }} />
            ))}
            <div className={styles.lane}>
              {timed.map(({ event: e, top, col, cols }) => (
                <div
                  key={eventKey(e)}
                  className={styles.card}
                  {...mark(e)}
                  data-timed="true"
                  onClick={() => choose(e)}
                onDoubleClick={() => setLooked(e)}
                  style={{ ...tint(e), top: top + 2, left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - ${col < cols - 1 ? 4 : 0}px)` }}
                  title={[e.title, `${formatDateTime(e.start)} – ${formatDateTime(e.end)}`, e.location, from1(e)].filter(Boolean).join("\n")}
                >
                  <span className={styles.time}>{e.end > e.start ? `${hm(e.start)}–${hm(e.end)}` : hm(e.start)}</span>
                  <span className={styles.name}>{e.title || t("common.untitled")}</span>
                  {e.location && <span className={styles.where}>{e.location}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
