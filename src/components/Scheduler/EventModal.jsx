import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Modal } from "@ui";
import { isMac } from "@utils/keys";
import { findUrls } from "@utils/links";
import { formatDateTime } from "@utils/task";
import styles from "./calendar.module.css";

const SOURCES = { google: "Google", apple: "Apple" };

// The last day of an event of whole days, whose `end` ("YYYY-MM-DD") is the day after it.
function dayBefore(key) {
  const [y, m, d] = key.split("-").map(Number);
  const day = new Date(y, m - 1, d - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
}

// An event's description as plain text: Google writes it as HTML (its line breaks and links).
const plain = (text) =>
  text
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

// A link of an event (its meeting, its page, a file of it, an address written in its place or its
// description): underlined, and opened in a new tab by cmd + click (ctrl + click off the Mac), as
// the links of every text of the app are (see @utils/links); a plain click is the text's, to
// select in it.
const Link = ({ href, children }) => (
  <span
    className={styles.link}
    data-link // the hand while cmd is held (see @utils/links)
    onClick={(e) => {
      if (e.button !== 0 || !(isMac ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }}
  >
    {children || href}
  </span>
);

// `text` with the web addresses in it as links.
function linked(text) {
  const out = [];
  let at = 0;
  for (const { start, end, url } of findUrls(text)) {
    if (start > at) out.push(text.slice(at, start));
    out.push(<Link key={start} href={url} />);
    at = end;
  }
  if (!out.length) return text;
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// An event of the calendar, looked at (space on it, or a double click): its title, and under it
// all the feed says of it, each on a row of its own when there is something to say: when it is,
// where, the calendar it is from, its online meeting, who organizes it and who is asked (with
// what each answered), its page and its files, whether it is confirmed and takes the time, how it
// repeats, when it was made and changed, and what is written in it. Space closes it again, as
// esc does.
export default function EventModal({ event, onClose }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!event) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [event, onClose]);
  if (!event) return null;

  let time;
  if (!event.allDay) time = event.end > event.start ? `${formatDateTime(event.start)} – ${formatDateTime(event.end)}` : formatDateTime(event.start);
  else {
    const last = dayBefore(event.end);
    time = `${last > event.start ? `${event.start} – ${last}` : event.start} ${t("scheduler.allDay")}`;
  }
  const person = (who) => [who.name, who.email && who.email !== who.name ? `<${who.email}>` : ""].filter(Boolean).join(" ");
  const answers = { accepted: t("scheduler.eventAccepted"), declined: t("scheduler.eventDeclined"), tentative: t("scheduler.eventTentative"), "needs-action": t("scheduler.eventNoAnswer") };
  const attendees = event.attendees || [];
  const attachments = event.attachments || [];
  const state = [event.status && t(event.status === "tentative" ? "scheduler.eventTentative" : "scheduler.eventConfirmed"), event.busy === false && t("scheduler.eventFree")].filter(Boolean).join(" · ");
  const rows = [
    [t("scheduler.eventTime"), time],
    [t("scheduler.eventLocation"), event.location && linked(event.location)],
    [t("scheduler.calendar"), [SOURCES[event.source], event.calendar].filter(Boolean).join(" · ")],
    [t("scheduler.eventMeeting"), event.conference && linked(event.conference)],
    [t("scheduler.eventOrganizer"), event.organizer && person(event.organizer)],
    [
      t("scheduler.eventAttendees"),
      attendees.length > 0 &&
        attendees.map((who, i) => (
          <div key={i}>
            {person(who)}
            {answers[who.status] && <span className="muted"> · {answers[who.status]}</span>}
          </div>
        )),
    ],
    [t("scheduler.eventLink"), event.url && linked(event.url)],
    [
      t("scheduler.eventAttachments"),
      attachments.length > 0 &&
        attachments.map((file, i) => (
          <div key={i}>
            <Link href={file.url}>{file.name || file.url}</Link>
          </div>
        )),
    ],
    [t("scheduler.eventStatus"), state],
    [t("scheduler.eventRepeats"), event.repeats],
    [t("scheduler.eventCreated"), event.created && formatDateTime(event.created)],
    [t("scheduler.eventUpdated"), event.updated && event.updated !== event.created && formatDateTime(event.updated)],
    [t("scheduler.eventDescription"), linked(plain(event.description || ""))],
  ].filter(([, value]) => value);

  return (
    <Modal isOpen onClose={onClose} title={event.title || t("common.untitled")}>
      <dl className={styles.details}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.detail}>
            <dt className="muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
