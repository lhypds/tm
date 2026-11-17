'use strict';

// The calendar under the scheduler's page: the events of one day, read from Google Calendar and
// Apple (iCloud) Calendar. Both give a calendar as an ICS feed, an address that answers the whole
// calendar as text, and that is what is read here, so there is no login to keep. The calendars are
// listed in taskmgr.json, as many as there are accounts and calendars (see normalizeCalendars in
// server/config.js), and so are synced between the machines with it:
//
//   "calendars": [
//     { "name": "work", "type": "google", "url": "https://calendar.google.com/calendar/ical/.../basic.ics" },
//     { "name": "home", "type": "apple", "url": "webcal://p12-caldav.icloud.com/published/2/..." }
//   ]
//
//   google  Google Calendar > Settings > the calendar > "Secret address in iCal format"
//   apple   Calendar (iCloud) > the calendar > Share > "Public Calendar", its webcal:// link
//
// An address is a secret (who has it reads the calendar): the browser gets the events only, not
// the address (but for the config editor, which shows taskmgr.json whole). A feed is kept for
// CACHE_MS, so a day asked again (another day, the page read again every few minutes) does not
// fetch it each time; `fresh` reads it anew.

const express = require('express');
const ICAL = require('ical.js');

const CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_OCCURRENCES = 50000; // of one repeating event, from its first day: a daily one of a century

// The moment (ms) the clock of the time zone `tzid` shows y-mo-d h:mi:s, or null when the zone is
// not one Intl knows (the feed's own VTIMEZONE is then used, see msOf).
const zoneFormats = new Map();
function zonedMs(tzid, y, mo, d, h, mi, s) {
  let fmt = zoneFormats.get(tzid);
  if (fmt === undefined) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: tzid, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch (e) {
      fmt = null;
    }
    zoneFormats.set(tzid, fmt);
  }
  if (!fmt) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = {};
    for (const part of fmt.formatToParts(new Date(guess))) p[part.type] = Number(part.value);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (shown === wall) break;
    guess -= shown - wall;
  }
  return guess;
}

// The moment (ms) of an ICAL.Time that has a time of day, written in the zone `tzid` (the TZID of
// its property) unless it is in UTC. A zone Intl does not know is the feed's own (its VTIMEZONE,
// registered in eventsOf); a time without a zone is taken as this machine's.
function msOf(time, tzid) {
  if (time.zone && time.zone.tzid === 'UTC') return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  if (tzid) {
    const ms = zonedMs(tzid, time.year, time.month, time.day, time.hour, time.minute, time.second);
    if (ms !== null) return ms;
  }
  return time.toJSDate().getTime();
}

const p2 = (n) => String(n).padStart(2, '0');
const dayOf = (time) => `${time.year}-${p2(time.month)}-${p2(time.day)}`;
const tzidOf = (component, name) => {
  const prop = component.getFirstProperty(name);
  return (prop && prop.getParameter('tzid')) || null;
};

// The events of the ICS `text` on one day: `date` is the day ("2026-11-17") and `from` .. `to` its
// bounds (ms) where it is asked from. Each is { id, title, location, allDay, start, end }: start
// and end are ms, or for an event of whole days (`allDay`) its days, the last one not included.
// An event that repeats is here once for each time it falls on the day; one time of it changed or
// moved (its RECURRENCE-ID) is an event of its own, and a cancelled one is left out.
function eventsOf(text, { date, from, to }) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(zone); } catch (e) { /* the times in it fall back to Intl's zone */ }
  }
  const out = [];

  // One time of an event: `start` and `end` as ICAL.Time, written in the zones startTz and endTz.
  // Returns false once it is past the day, so a repeating event stops there.
  const add = (event, start, end, startTz, endTz) => {
    const component = event.component;
    if (String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return true;
    const base = { id: `${event.uid}/${start.toString()}`, title: String(event.summary || ''), location: String(event.location || '') };
    if (start.isDate) {
      const first = dayOf(start);
      let last = end ? dayOf(end) : first;
      if (last <= first) { // a day without an end is that day
        const next = start.clone();
        next.adjust(1, 0, 0, 0);
        last = dayOf(next);
      }
      if (first > date) return false;
      if (last > date) out.push({ ...base, allDay: true, start: first, end: last });
      return true;
    }
    const startMs = msOf(start, startTz);
    const endMs = Math.max(startMs, end ? msOf(end, endTz) : startMs);
    if (startMs >= to) return false;
    if (endMs > from || startMs >= from) out.push({ ...base, allDay: false, start: startMs, end: endMs });
    return true;
  };

  const single = (event) => {
    if (!event.startDate) return;
    const startTz = tzidOf(event.component, 'dtstart');
    add(event, event.startDate, event.endDate, startTz, tzidOf(event.component, 'dtend') || startTz);
  };

  // by uid: the event itself, and the times of it that were changed
  const byUid = new Map();
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    const group = byUid.get(event.uid) || { master: null, exceptions: [] };
    if (event.isRecurrenceException()) group.exceptions.push(event);
    else group.master = event;
    byUid.set(event.uid, group);
  }

  for (const { master, exceptions } of byUid.values()) {
    for (const exception of exceptions) single(exception);
    if (!master || !master.startDate) continue;
    if (!master.isRecurring()) {
      single(master);
      continue;
    }
    for (const exception of exceptions) master.relateException(exception);
    const tz = tzidOf(master.component, 'dtstart');
    const iterator = master.iterator();
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
      const next = iterator.next();
      if (!next) break;
      const details = master.getOccurrenceDetails(next);
      if (details.item !== master) { // changed: counted above, where it is now
        if (next.isDate ? dayOf(next) > date : msOf(next, tz) >= to) break;
        continue;
      }
      if (!add(master, details.startDate, details.endDate, tz, tz)) break;
    }
  }
  return out;
}

// `calendars()` answers the calendars of taskmgr.json as they are now ([{ name, type, url }]);
// `fetchText(url)` resolves to a feed's text (the tests give their own).
function createCalendarApp({ calendars = () => [], fetchText = defaultFetch, log = () => {} } = {}) {
  const app = express.Router();
  const cache = new Map(); // url -> { at, text } or { at, promise }

  async function feedText(url, fresh) {
    const kept = cache.get(url);
    if (kept && !fresh && Date.now() - kept.at < CACHE_MS) return kept.promise || kept.text;
    const promise = fetchText(url);
    cache.set(url, { at: Date.now(), promise });
    try {
      const text = await promise;
      cache.set(url, { at: Date.now(), text });
      return text;
    } catch (e) {
      if (cache.get(url)?.promise === promise) cache.delete(url);
      throw e;
    }
  }

  // ?date=2026-11-17&from=&to= (the day's bounds, ms, in the browser's time zone), fresh=1 to read
  // the feeds anew. { configured, events, errors }: the events of every calendar in the order of
  // the day (those of whole days first), each with its `source` ('google' | 'apple' | '') and
  // `calendar` (its name in taskmgr.json, or the feed's own); `errors` the calendars that could not
  // be read, each { source, calendar, error }, the events of the others being there all the same.
  // `configured` is false with no calendar listed.
  app.get('/api/calendar', async (req, res) => {
    const date = String(req.query.date || '');
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      res.status(400).json({ error: 'Invalid day.' });
      return;
    }
    const list = calendars();
    const events = [];
    const errors = [];
    await Promise.all(list.map(async ({ name, type: source, url }, index) => {
      try {
        const text = await feedText(url, !!req.query.fresh);
        let calendar = name;
        if (!calendar) try { calendar = String(new ICAL.Component(ICAL.parse(text)).getFirstPropertyValue('x-wr-calname') || ''); } catch (e) { calendar = ''; }
        for (const event of eventsOf(text, { date, from, to })) events.push({ ...event, id: `${index}:${event.id}`, source, calendar }); // the id is the event's in its feed
      } catch (e) {
        // the address is a secret: the message alone, never the url
        const error = String((e && e.message) || e).replace(/https?:\/\/\S+/gi, '<url>');
        log(`calendar: ${name || source}: ${error}`);
        errors.push({ source, calendar: name, error });
      }
    }));
    events.sort((a, b) => (b.allDay - a.allDay) || (a.allDay ? a.start.localeCompare(b.start) : a.start - b.start) || a.title.localeCompare(b.title));
    res.json({ configured: list.length > 0, events, errors });
  });

  return app;
}

async function defaultFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Not a calendar (ICS) feed.');
  return text;
}

module.exports = { createCalendarApp, eventsOf };
