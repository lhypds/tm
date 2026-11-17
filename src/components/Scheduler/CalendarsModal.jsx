import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@ui";
import { HelpCircleIcon, PlusIcon, XIcon } from "@components/icons";
import ColorPicker from "@components/ColorPicker";
import * as api from "@utils/api";
import styles from "./calendars.module.css";

const TYPES = { google: "Google", apple: "Apple" };

// Whether the address `url` is a Google or an Apple calendar's ("" when it is neither), as the
// server tells it (see normalizeCalendars in server/config.js).
const typeOf = (url) => (/icloud\.com/i.test(url) ? "apple" : /google\.com/i.test(url) ? "google" : "");

// Each row being edited gets its own key, so removing one does not shift the inputs of the others.
// `was` is the calendar the row was read from ({ type, url }), whose kind stays while its address does.
let nextKey = 0;
const row = (name = "", url = "", type = "", color = "") => ({ key: nextKey++, name, url, color, was: { type, url } });
const kindOf = (x) => typeOf(x.url) || (x.url.trim() === x.was.url ? x.was.type : "");

// The calendars under the scheduler's page (the pencil at the right of "Calendar"), added and taken
// off: a row for each, as the income of a work is edited, with its name (optional: the calendar's
// own when left empty) and the address of its ICS feed; whether it is a Google or an Apple one is
// told from the address (the address says which on hover); the two fields take the row's width.
// The small square at the right of a row, before the button that removes it, is the color of the
// calendar's events: a click shows the colors an origin can have in a popup under it, to choose
// one (or none); a press anywhere else or esc lets the popup go.
// The list is read when the dialog opens and written into taskmgr.json ("calendars", see
// server/calendar.js) by Save; a row without an address is left out. The question mark beside the
// close button shows how to get a calendar's address, in a tooltip under it (a click again, a
// press anywhere else or esc lets it go). `onSaved` is told once the list
// is written.
export default function CalendarsModal({ isOpen, onClose, onSaved }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null); // null until the list is read
  const [help, setHelp] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const helpRef = useRef(null);
  // the row whose colors are shown, and where: { key, top, right } (in the window)
  const [coloring, setColoring] = useState(null);
  const colorsRef = useRef(null);
  // they go with a press anywhere but on them and on a row's square (which shows its own)
  useEffect(() => {
    if (!coloring) return undefined;
    const letGo = (e) => !colorsRef.current?.contains(e.target) && !e.target.closest?.("[data-color-button]") && setColoring(null);
    document.addEventListener("mousedown", letGo, true);
    return () => document.removeEventListener("mousedown", letGo, true);
  }, [coloring]);

  // the tooltip goes with a press anywhere but on it and its button
  useEffect(() => {
    if (!help) return undefined;
    const letGo = (e) => !helpRef.current?.contains(e.target) && setHelp(false);
    document.addEventListener("mousedown", letGo, true);
    return () => document.removeEventListener("mousedown", letGo, true);
  }, [help]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let stale = false;
    setRows(null);
    setHelp(false);
    setColoring(null);
    setError("");
    (async () => {
      try {
        const { calendars } = await api.getCalendars();
        if (stale) return;
        // one row to fill in when there is none yet
        setRows(calendars.length ? calendars.map((c) => row(c.name, c.url, c.type, c.color || "")) : [row()]);
      } catch (e) {
        if (stale) return;
        setRows([]);
        setError(e.message);
      }
    })();
    return () => {
      stale = true;
    };
  }, [isOpen]);

  const setRow = (key, change) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...change } : x)));
  const addRow = () => setRows((r) => [...r, row()]);

  async function save() {
    const calendars = rows.filter((x) => x.url.trim()).map((x) => ({ name: x.name.trim(), type: kindOf(x), url: x.url.trim(), color: x.color }));
    setSaving(true);
    try {
      await api.saveCalendars(calendars);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("scheduler.calendars")}
      className={styles.modal}
      onEscape={coloring ? () => setColoring(null) : help ? () => setHelp(false) : undefined}
      headerActions={
        <span ref={helpRef} className={styles.helpBox}>
          <button type="button" className={styles.help} aria-pressed={help} onClick={() => setHelp((v) => !v)} aria-label={t("scheduler.calendarHelp")}>
            <HelpCircleIcon />
          </button>
          {help && (
            <div className={styles.how} role="tooltip">
              <p>{t("scheduler.calendarHelpIntro")}</p>
              <p>
                <b>Google</b> {t("scheduler.calendarHelpGoogle")}
              </p>
              <p>
                <b>Apple</b> {t("scheduler.calendarHelpApple")}
              </p>
              <p>{t("scheduler.calendarHelpSecret")}</p>
            </div>
          )}
        </span>
      }
    >
      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving && rows) save();
        }}
      >
        <div className={styles.list}>
          {rows?.map((x) => (
            <div key={x.key} className={styles.item}>
              <input
                className={`input ${styles.name}`}
                value={x.name}
                placeholder={t("scheduler.calendarName")}
                aria-label={t("scheduler.calendarName")}
                onChange={(e) => setRow(x.key, { name: e.target.value })}
              />
              <input
                className="input mono"
                value={x.url}
                placeholder="https://… / webcal://…"
                title={TYPES[kindOf(x)]} // what the address was told to be
                aria-label={t("scheduler.calendarUrl")}
                spellCheck={false}
                onChange={(e) => setRow(x.key, { url: e.target.value })}
              />
              <button
                type="button"
                className={styles.color}
                data-color-button
                data-none={!x.color}
                aria-expanded={coloring?.key === x.key}
                style={x.color ? { background: x.color } : undefined}
                title={t("origin.color")}
                aria-label={t("origin.color")}
                onClick={(e) => {
                  // under the square, its right edge on the square's (the dialog's own scroll would cut it)
                  const r = e.currentTarget.getBoundingClientRect();
                  setColoring((c) => (c?.key === x.key ? null : { key: x.key, top: r.bottom + 6, right: window.innerWidth - r.right }));
                }}
              />
              <button
                type="button"
                className={`btn ${styles.remove}`}
                title={t("scheduler.removeCalendar")}
                aria-label={t("scheduler.removeCalendar")}
                onClick={() => setRows((r) => r.filter((y) => y.key !== x.key))}
              >
                <XIcon />
              </button>
              {coloring?.key === x.key && (
                <div ref={colorsRef} className={styles.colors} style={{ top: coloring.top, right: coloring.right }}>
                  <ColorPicker
                    value={x.color}
                    onChange={(c) => {
                      setRow(x.key, { color: c });
                      setColoring(null);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
          {rows ? (
            <button type="button" className={`btn ${styles.addRow}`} onClick={addRow}>
              <PlusIcon />
              {t("scheduler.addCalendar")}
            </button>
          ) : (
            <p className="muted">{t("common.loading")}</p>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn lg" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn lg primary" disabled={saving || !rows}>
            {t("editor.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
