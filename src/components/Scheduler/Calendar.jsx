import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as api from "@utils/api";
import { formatDateTime } from "@utils/task";
import styles from "./calendar.module.css";

const HOUR = 72; // px an hour: half an hour is a card and its margins (36px), as a task takes on the page
const PAD = 12; // px above midnight, so its hour is not cut
const SLOT = 36; // px a card takes: its 28px and 4px above and under it
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

// The calendar under the scheduler's page, the lower half of the pane, as the prompt is under a
// task's text: a divider that says "Calendar", then the events of the day `date` in the Google and
// Apple calendars the server is given (see server/calendar.js). The day is a column of 24 hours, a
// line across for each with its time at the left, noon's in red; it scrolls, and starts with noon
// in the middle. An event is a card as tall as a task's on the page, on the line of its start: its
// times and its title (the rest, where it is and which calendar it is from, on hover). The events
// of whole days stay above the hours. They are read again whenever `reloadKey` changes (the page's
// refresh, which reads the calendars anew) and every few minutes.
export default function Calendar({ date, reloadKey }) {
  const { t } = useTranslation();
  const [day, setDay] = useState(null); // { date, configured, events, errors } as read last
  const hoursRef = useRef(null);
  const readKey = useRef(reloadKey);

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
    read(readKey.current !== reloadKey);
    readKey.current = reloadKey;
    const id = setInterval(() => document.visibilityState === "visible" && read(false), READ_EVERY);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, [date, reloadKey]);

  const shown = day?.date === date ? day : null;
  const events = shown?.events || [];
  const above = (shown?.configured === false ? 1 : 0) + (shown?.errors.length || 0) + events.filter((e) => e.allDay).length; // what is over the hours

  // noon in the middle, on each day shown (again once what is over the hours has taken its room)
  useLayoutEffect(() => {
    const el = hoursRef.current;
    el.scrollTop = PAD + 12 * HOUR - el.clientHeight / 2;
  }, [date, above]);

  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const whole = events.filter((e) => e.allDay);
  const timed = place(
    events.filter((e) => !e.allDay),
    from,
  );
  const from1 = (e) => [SOURCES[e.source], e.calendar].filter(Boolean).join(" · ");

  return (
    <>
      <div className={styles.divider}>
        <span className={styles.title}>{t("scheduler.calendar")}</span>
      </div>
      {shown && !shown.configured && <div className={`muted ${styles.note}`}>{t("scheduler.calendarOff")}</div>}
      {shown?.errors.map((err, i) => (
        <div key={i} className={styles.note} data-error="true">
          {t("scheduler.calendarError", { source: [SOURCES[err.source], err.calendar].filter(Boolean).join(" · "), error: err.error })}
        </div>
      ))}
      {whole.length > 0 && (
        <div className={styles.whole}>
          {whole.map((e) => (
            <div key={`${e.source}/${e.id}`} className={styles.card} title={[e.title, e.location, from1(e)].filter(Boolean).join("\n")}>
              <span className={styles.time}>{t("scheduler.allDay")}</span>
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
          <div className={styles.lane}>
            {timed.map(({ event: e, top, col, cols }) => (
              <div
                key={`${e.source}/${e.id}`}
                className={styles.card}
                data-timed="true"
                style={{ top: top + 4, left: `${(col / cols) * 100}%`, width: `calc(${100 / cols}% - ${col < cols - 1 ? 4 : 0}px)` }}
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
    </>
  );
}
