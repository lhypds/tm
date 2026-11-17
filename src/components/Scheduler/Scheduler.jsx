import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "@components/icons";
import { DoneBox } from "@components/TaskList";
import { withKey } from "@utils/keys";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { copyText } from "@utils/clipboard";
import { dragTitle } from "@utils/drag";
import { TASKS_DRAG_TYPE, describe } from "@utils/task";
import Calendar from "./Calendar";
import DayPicker from "./DayPicker";
import styles from "./scheduler.module.css";

// A day as its file is named: "2026-11-17", in local time.
const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => dayKey(new Date());
const shift = (key, days) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + days));
};

const SAVE_DELAY = 600; // ms after the last key before the page is written
const CARD_DRAG_TYPE = "application/x-taskmgr-scheduled"; // a card of the page, dragged to another line

const cardKey = (c) => `${c.work}/${c.repository}/${c.ids.join("/")}`;

// A line of the page's text that is a task, shown as a card (see server/scheduler.js):
// "[title](tm://<work>/<repository>#<id>/<id>)", and the task of such a line (null for any other).
const TASK_RE = /^\[(.*)\]\(tm:\/\/([^/#()\s]*)\/([^/#()\s]*)#([^#()\s]+)\)$/;
const enc = (v) => encodeURIComponent(v).replace(/\(/g, "%28").replace(/\)/g, "%29");
const taskLine = (c) => `[${c.title}](tm://${enc(c.work)}/${enc(c.repository)}#${c.ids.map(enc).join("/")})`;
function taskOf(line) {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  try {
    return { work: decodeURIComponent(m[2]), repository: decodeURIComponent(m[3]), ids: m[4].split("/").map(decodeURIComponent), title: m[1] };
  } catch {
    return null;
  }
}

// The page as it is kept and copied, one text: the lines typed (`text`) with each card's line
// among them, after as many of them as its `line`. A page of cards only is their lines alone.
function compose(text, cards) {
  const lines = text === "" && cards.every((c) => !(c.line > 0)) ? [] : text.split("\n");
  const out = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const c of cards) if (Math.max(0, Math.min(c.line || 0, lines.length)) === i) out.push(taskLine(c));
    if (i < lines.length) out.push(lines[i]);
  }
  return out.join("\n");
}

// The other way: { text, cards } of a page, each card on its `line`. A task is on a page once:
// its line again is left out.
function parse(page) {
  const lines = [];
  const cards = [];
  for (const line of page.split("\n")) {
    const task = taskOf(line);
    if (!task) lines.push(line);
    else if (!cards.some((c) => cardKey(c) === cardKey(task))) cards.push({ ...task, line: lines.length });
  }
  return { text: lines.join("\n"), cards };
}

// `cards` with what `tasks` (the same tasks, as the server found them) say of each now: its title,
// path and status, or that it is missing.
const withLive = (cards, tasks) =>
  cards.map((c) => {
    const now = tasks.find((x) => cardKey(x) === cardKey(c));
    return now ? { ...c, title: now.title, details: now.details, rel: now.rel, status: now.status, missing: now.missing } : c;
  });

// What `cards` show of their tasks, as one text: two of them are the same when nothing shown differs.
const liveOf = (cards) => JSON.stringify(cards.map((c) => [cardKey(c), c.title, c.details || "", c.rel ?? null, c.status ?? null, !!c.missing]));

// The cards in the page's order: by line (none past the last line of the text), those on one line
// as they were.
const arrange = (cards, lineCount) =>
  cards
    .map((c, i) => ({ c: { ...c, line: Math.max(0, Math.min(c.line || 0, lineCount)) }, i }))
    .sort((a, b) => a.c.line - b.c.line || a.i - b.i)
    .map((x) => x.c);

// How tall each of `lines` is in the text box `el`, where a long one wraps onto several rows:
// measured in a hidden copy with the box's width and font.
function lineHeights(el, lines) {
  const cs = getComputedStyle(el);
  const copy = document.createElement("div");
  Object.assign(copy.style, {
    position: "absolute",
    visibility: "hidden",
    left: "0",
    top: "0",
    width: `${el.clientWidth}px`,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  for (const line of lines) {
    const row = document.createElement("div");
    row.textContent = line || "​";
    copy.appendChild(row);
  }
  el.parentNode.appendChild(copy);
  const heights = [...copy.children].map((row) => row.offsetHeight);
  copy.remove();
  return heights;
}

// Whether the caret of the text box `el` is on its first row and on its last one, a long line
// wrapping onto several: measured in a hidden copy, as lineHeights does.
function caretRows(el) {
  const cs = getComputedStyle(el);
  const copy = document.createElement("div");
  Object.assign(copy.style, {
    position: "absolute",
    visibility: "hidden",
    left: "0",
    top: "0",
    width: `${el.clientWidth}px`,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  const caret = document.createElement("span");
  caret.textContent = "\u200b";
  copy.append(el.value.slice(0, el.selectionStart), caret, `${el.value.slice(el.selectionStart)}\u200b`);
  el.parentNode.appendChild(copy);
  const row = parseFloat(cs.lineHeight) || caret.offsetHeight;
  const rows = { first: caret.offsetTop < row / 2, last: caret.offsetTop + row * 1.5 > copy.offsetHeight };
  copy.remove();
  return rows;
}

// Where the caret before the character at `p` of the text box `el` is drawn, in the box's parent:
// { left, top, height }. Measured in a hidden copy, as lineHeights does.
function caretBox(el, p) {
  const cs = getComputedStyle(el);
  const copy = document.createElement("div");
  Object.assign(copy.style, {
    position: "absolute",
    visibility: "hidden",
    left: "0",
    top: "0",
    width: `${el.clientWidth}px`,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    letterSpacing: cs.letterSpacing,
    lineHeight: cs.lineHeight,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  const at = document.createElement("span");
  at.textContent = "\u200b";
  copy.append(el.value.slice(0, p), at, `${el.value.slice(p)}\u200b`);
  el.parentNode.appendChild(copy);
  const box = { left: el.offsetLeft + at.offsetLeft, top: el.offsetTop + at.offsetTop, height: at.offsetHeight };
  copy.remove();
  return box;
}

// A run of the page's text, between two cards (or an end of the page): as tall as what is in it,
// so the page scrolls, not the text. `fill` is the last one, which takes what is left of the page.
function Lines({ value, fill, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} className={styles.text} data-fill={fill} rows={1} value={value} spellCheck={false} {...props} />;
}

// The scheduler, in place of the task panel: one page a day. Under its title, a row says which day is shown, between
// the buttons that step a day back and a day forward (a click on the day picks another, see DayPicker); the page's refresh (r) is back on today. The page is squared paper to write on
// (saved as it is typed; kept as one text, a task a line of it, see compose) with the tasks dragged onto it from the list or the board (`tasks` are
// those, found by the keys the drag carries), each a card of one line: the status box the list has (a click
// marks the task done, or todo again: `onStatus(entry, status)`) and its title. A card sits on
// the line it was dropped on, the text flowing around it: the lines above it stay above, the rest
// go under it, and close up again when it is dragged to another line (a line across the page shows
// where it would go). A click on a card chooses it, a double click (or space) opens the task (`onOpen(entry)`), its × takes it off the
// day. The text is edited as in vim, in a NORMAL and an INSERT mode (see
// `normalKey`; the cursor is only where there is text), the cards being stops on the way: j / k (the arrows, while typing) walk the cursor
// from the text onto a card and off it again, and backspace, delete and x take a card off the day
// (see `cross` and the page's keys, which `keysRef` is given). `focused` says the keyboard is on this pane (its bar is shaded, as the task panel's is). The day is read again whenever `reloadKey` changes (a task renamed or deleted elsewhere); while `loading` (the page's refresh) the pane under its bar is covered and says "Loading...", as the task list does, and the day shown is today again.
// The days are synced between the machines (see server/scheduler.js), so a page may have a task that is not on this one: its card is as any other, with the title of its line, but has no box and opens nothing.
// See server/scheduler.js for what is kept.
// The calendar at the right of the title (d, for the day, while the keyboard is on this pane and
// not on a card; `onToggleCalendar`) shows and hides the day's timetable
// (`calendarOpen`): the pane is then split in two, as the task panel is with its prompt, the page
// above and under it the events the day has in Google and Apple Calendar (see Calendar, which is
// called "Timetable" on the page: "Calendar" is the month in the middle, see MonthCalendar).
// `goTo` ({ date }, a new one each time) is a day asked for from outside, a day clicked in the
// calendar view: the scheduler shows it, and starts on it when it comes on screen with one;
// `chosenEvent` and `onEvent(id)` are the event chosen in the calendars, the timetable's and the
// calendar view's alike (see Calendar).
// `onDate(date)` is told the day shown, whenever it changes. `onCommand()` opens the page's command
// line: ":" in the text in NORMAL mode, as in vim (elsewhere on the pane the key is the page's own).
export default function Scheduler({ tasks, reloadKey, loading, focused, keysRef, onOpen, onStatus, calendarOpen, onToggleCalendar, goTo, onDate, onCommand, chosenEvent, onEvent }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(() => goTo?.date || today());
  const [loaded, setLoaded] = useState(false); // the day shown has been read
  const [text, setText] = useState("");
  const [cards, setCards] = useState([]); // in the page's order (see arrange)
  const [mark, setMark] = useState(null); // where a drag would drop: the page's y of that line
  const pending = useRef(null); // { date, text } changed and not written yet: the page as one text (see compose)
  const changes = useRef(0); // how many changes were made here (see change)
  const dateRef = useRef(date); // the day shown now, for what comes back later
  dateRef.current = date;
  const [all, setAll] = useState(false); // the whole page is selected (cmd + a), to be copied
  const timer = useRef(null);
  const pageRef = useRef(null);
  const [picking, setPicking] = useState(false); // the days to pick one from are shown (see DayPicker)
  const closePicker = useCallback(() => setPicking(false), []);
  const slotsRef = useRef(null); // the lines a drag can drop on, measured once per drag

  const lines = text.split("\n");

  // What is pending is written, after whatever is still being written (one at a time, in their
  // order): resolves once it is all on the server.
  const saving = useRef(Promise.resolve());
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return saving.current;
    pending.current = null;
    saving.current = saving.current.then(async () => {
      try {
        const day = await api.saveSchedulerPage(p.date, p.text);
        // a task pasted in as its line is now known as it is
        if (day.date === dateRef.current) setCards((was) => withLive(was, day.tasks));
      } catch (e) {
        showToast(e.message, 4000);
      }
    });
    return saving.current;
  }, []);

  const show = (day) => {
    const page = parse(day.text);
    setText(page.text);
    setCards(arrange(withLive(page.cards, day.tasks), page.text.split("\n").length));
  };

  useEffect(() => {
    let stale = false;
    (async () => {
      await flush();
      try {
        const was = changes.current;
        const day = await api.getSchedulerDay(date, date === today()); // today starts with what yesterday left
        if (stale) return;
        setLoaded(true);
        // what was changed here meanwhile (typed, or a task dropped on the page) is not written
        // over by the day as it was read before
        if (changes.current === was && !pending.current) show(day);
      } catch (e) {
        if (!stale) showToast(e.message, 4000);
      }
    })();
    return () => {
      stale = true;
    };
  }, [date, reloadKey, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // The day is read again every ten seconds while the tab is visible, as the page reads its tasks
  // again: a pull (tm pull, or taskmgrd) may have brought the day as another machine left it. It
  // is shown only when it is not the page as it is here, and nothing here waits to be written.
  const pageNow = useRef("");
  pageNow.current = compose(text, cards);
  const liveNow = useRef("");
  liveNow.current = liveOf(cards);
  useEffect(() => {
    if (!loaded) return undefined;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      const was = changes.current;
      try {
        const day = await api.getSchedulerDay(date);
        if (day.date !== dateRef.current || changes.current !== was || pending.current) return;
        await saving.current; // a write under way answers the day itself
        if (changes.current !== was || pending.current) return;
        const page = parse(day.text);
        const next = arrange(withLive(page.cards, day.tasks), page.text.split("\n").length);
        if (compose(page.text, next) !== pageNow.current || liveOf(next) !== liveNow.current) show(day);
      } catch {
        /* the next one may go through */
      }
    }, 10 * 1000);
    return () => clearInterval(id);
  }, [date, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // What was changed last is written when the scheduler goes away too.
  useEffect(() => () => void flush(), [flush]);

  const go = (next) => {
    if (next === date) return;
    flush();
    setLoaded(false);
    history.current = [];
    undone.current = [];
    setChosen(null);
    setAll(false);
    backTo.current = null;
    setText("");
    setCards([]);
    setDate(next);
  };

  useEffect(() => {
    if (goTo) go(goTo.date);
  }, [goTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onDate?.(date);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // The page's refresh (its button, r: `loading` while it lasts) is back on today, as a page
  // opened anew is.
  useEffect(() => {
    if (loading) go(today());
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The page as changed here: shown at once, written `now` or a moment after the last key.
  const change = (nextText, nextCards, now = false) => {
    const arranged = arrange(nextCards, nextText.split("\n").length);
    setText(nextText);
    setCards(arranged);
    changes.current += 1;
    pending.current = { date, text: compose(nextText, arranged) };
    clearTimeout(timer.current);
    if (now) flush();
    else timer.current = setTimeout(flush, SAVE_DELAY);
  };

  // What the page was before each change made here ({ text, cards }, the latest last), and what
  // was undone: cmd / ctrl + z goes back one change (a card put on the day, moved or taken off, or
  // a stretch of typing), with shift (or ctrl + y) forward again. A new change drops what was
  // undone; another day starts over.
  const undone = useRef([]);
  const history = useRef([]);
  const typedAt = useRef(0);
  const record = () => {
    history.current.push({ text, cards });
    if (history.current.length > 200) history.current.shift();
    undone.current = [];
    typedAt.current = 0; // the typing after this is a change of its own
  };
  const travel = (from, to) => {
    const was = from.current.pop();
    if (!was) return;
    to.current.push({ text, cards });
    typedAt.current = 0;
    change(was.text, was.cards, true);
  };

  // The page top to bottom: the lines of the text in runs, the cards between them, each card after
  // as many lines as its `line`. The last run is always there (empty when the last card is under
  // all the text) so there is somewhere to type; an empty run anywhere else is left out.
  const blocks = [];
  let at = 0;
  cards.forEach((card, index) => {
    if (card.line > at) blocks.push({ from: at, to: card.line, before: index });
    at = Math.max(at, card.line);
    blocks.push({ card, index });
  });
  blocks.push({ from: at, to: lines.length, before: cards.length, last: true });

  // A run typed in: its lines replace those it had, and the cards under it move with the text.
  const type = (block, value, recorded = false) => {
    // typing is one change until it pauses for a second (`recorded`: the caller recorded it)
    const now = Date.now();
    if (!recorded && now - typedAt.current > 1000) record();
    typedAt.current = now;
    const typed = block.from === block.to && value === "" ? [] : value.split("\n");
    const next = [...lines.slice(0, block.from), ...typed, ...lines.slice(block.to)];
    const delta = typed.length - (block.to - block.from);
    const moved = cards.map((c, i) => (i >= block.before ? { ...c, line: c.line + delta } : c));
    if (typed.some(taskOf)) {
      // a task's line typed or pasted in is a card from here on
      const page = parse(compose(next.join("\n"), arrange(moved, next.length)));
      change(page.text, withLive(page.cards, cards), true);
      return;
    }
    change(next.join("\n"), moved);
  };

  // The text is edited as in vim, in two modes. NORMAL: the keys move the cursor (the caret, before
  // its character) and nothing is typed. The cursor is only where there is text, as in vim: on a
  // character of a line (the start of an empty one), never past the end of a line nor under the
  // last one. h and l go along the line and stop at its ends, j and k to the line under and above
  // (at the column the cursor had before it went through shorter lines) and off the run onto the
  // card beside it, backspace back as h and up to the end of the line above, enter to the start of
  // the line under, 0 and $ to the ends of the line; i and a start typing before and after the
  // cursor, I and A at the ends of the line, o and O on a new line under and above; x deletes the
  // character, u undoes; : opens the page's command line; esc leaves the text (the keys are then the page's again, see below).
  // INSERT: the keys type, esc is back to NORMAL. The arrows do as h j k l in NORMAL. A click in
  // the text types.
  const [mode, setModeState] = useState("normal");
  const modeRef = useRef("normal"); // the mode now, for what runs before the next render
  const setMode = (m) => {
    modeRef.current = m;
    setModeState(m);
  };
  // The NORMAL cursor before the character at `p` of a text box: the box's own caret goes there,
  // unseen (it blinks), and a line that does not blink is drawn in its place (`cursorBox`, see
  // caretBox), following whatever moves the text (see below).
  const [cursorBox, setCursorBox] = useState(null);
  const [inText, setInText] = useState(false); // the keyboard is in the text
  const boxAt = (el) => caretBox(el, Math.min(el.selectionStart, el.value.length));
  // The column j and k keep to while they go through shorter lines (Infinity after $: the end of
  // each line); null once anything else has moved the cursor.
  const want = useRef(null);
  // The NORMAL cursor to `p`, or to the last character of its line when `p` is past it.
  const block1 = (el, p) => {
    const v = el.value;
    let at = Math.max(0, Math.min(p, v.length));
    const start = v.lastIndexOf("\n", at - 1) + 1;
    if (at > start && (at === v.length || v[at] === "\n")) at -= 1;
    el.setSelectionRange(at, at);
    setCursorBox(boxAt(el));
  };
  useLayoutEffect(() => {
    const el = document.activeElement;
    const box = modeRef.current === "normal" && el?.tagName === "TEXTAREA" && pageRef.current?.contains(el) ? boxAt(el) : null;
    setCursorBox((was) => (JSON.stringify(was) === JSON.stringify(box) ? was : box));
  });
  // Where the cursor goes once an edit made in NORMAL mode is on the page: { block, pos, insert }.
  const cursorTo = useRef(null);
  useLayoutEffect(() => {
    const to = cursorTo.current;
    if (!to) return;
    cursorTo.current = null;
    const el = pageRef.current?.querySelector(`textarea[data-block="${to.block}"]`);
    if (!el) return;
    el.focus();
    if (to.insert) el.setSelectionRange(to.pos, to.pos);
    else block1(el, to.pos);
  });
  const normalKey = (e, at) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // cmd + s and the like
    const el = e.currentTarget;
    const k = { ArrowLeft: "h", ArrowRight: "l", ArrowUp: "k", ArrowDown: "j" }[e.key] || e.key;
    if (k === "Escape") {
      e.preventDefault();
      el.blur();
      return;
    }
    if (k.length !== 1 && !["Backspace", "Delete", "Enter"].includes(k)) return; // tab and the like
    e.preventDefault(); // nothing is typed
    if (k === ":" || k === "：") {
      // the page's command line (:h for the help), which takes the keyboard
      onCommand?.();
      return;
    }
    const v = el.value;
    const p = Math.min(el.selectionStart, v.length);
    const start = v.lastIndexOf("\n", p - 1) + 1; // of the cursor's line
    const end = v.indexOf("\n", p) < 0 ? v.length : v.indexOf("\n", p); // its line break, or the end
    const col = want.current ?? p - start; // the column j and k keep to
    want.current = k === "j" || k === "k" ? col : k === "$" ? Infinity : null;
    const block = blocks[at];
    const above = blocks[at - 1]?.card;
    const under = blocks[at + 1]?.card;
    const choose = (card) => {
      setChosen(cardKey(card));
      el.blur();
    };
    const insert = (pos) => {
      setMode("insert");
      el.setSelectionRange(pos, pos);
    };
    const edit = (value, pos, typing) => {
      record();
      cursorTo.current = { block: at, pos, insert: typing };
      if (typing) setMode("insert");
      type(block, value, true);
    };
    // onto the line from..to at the column kept, or on its last character when it is shorter
    const place = (from, to) => block1(el, Math.min(from + col, to));
    if (k === "h") block1(el, Math.max(start, p - 1));
    else if (k === "Backspace") {
      // back one place, as h, and from the start of a line up to the end of the one above it (the
      // card above, from the first line)
      if (p > start) block1(el, p - 1);
      else if (start > 0) block1(el, start - 1);
      else if (above) choose(above);
    } else if (k === "Enter") {
      // to the start of the next line (the card under the last one of a run)
      if (end < v.length) block1(el, end + 1);
      else if (under) choose(under);
    } else if (k === "l") block1(el, Math.min(end, p + 1));
    else if (k === "0") block1(el, start);
    else if (k === "$") block1(el, end);
    else if (k === "j") {
      if (end < v.length) place(end + 1, v.indexOf("\n", end + 1) < 0 ? v.length : v.indexOf("\n", end + 1));
      else if (under) choose(under);
    } else if (k === "k") {
      if (start > 0) place(v.lastIndexOf("\n", start - 2) + 1, start - 1);
      else if (above) choose(above);
    } else if (k === "i") insert(p);
    else if (k === "a") insert(Math.min(end, p + 1));
    else if (k === "I") insert(start);
    else if (k === "A") insert(end);
    else if (k === "o") edit(`${v.slice(0, end)}\n${v.slice(end)}`, end + 1, true);
    else if (k === "O") edit(`${v.slice(0, start)}\n${v.slice(start)}`, start, true);
    else if (k === "x") {
      if (p < end) edit(v.slice(0, p) + v.slice(p + 1), p, false);
    } else if (k === "u") {
      cursorTo.current = { block: at, pos: p, insert: false }; // the cursor stays about where it was
      travel(history, undone);
    }
  };

  // The keys of a run of the text while typing (INSERT). The page is edited as a document with pictures in it is: the
  // caret walks off the run onto the card beside it, which is then chosen (the text loses the
  // caret, and the page's keys below go on from the card): up on the first row and left at the very
  // start for the card above, down on the last row and right at the very end for the card under
  // it. Backspace at the very start chooses the card above too (an empty line under that card is
  // deleted on the way), and delete at the very end the card under it: the same key again takes
  // the card off the day, and the caret is back where it was. Esc leaves the text (what was typed
  // is written on the blur).
  const cross = (e, at) => {
    const el = e.currentTarget;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // an input method's own keys
    if (modeRef.current === "normal") return normalKey(e, at);
    if (e.key === "Escape") {
      // insert -> normal, the cursor on the character before the caret, as in vim
      e.preventDefault();
      const p = el.selectionStart;
      setMode("normal");
      block1(el, Math.max(el.value.lastIndexOf("\n", p - 1) + 1, p - 1));
      return;
    }
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || el.selectionStart !== el.selectionEnd) return;
    const above = blocks[at - 1]?.card;
    const under = blocks[at + 1]?.card;
    const atStart = el.selectionStart === 0;
    const atEnd = el.selectionStart === el.value.length;
    const choose = (card) => {
      e.preventDefault();
      setChosen(cardKey(card));
      el.blur();
    };
    if (e.key === "Backspace" && above && atStart) {
      // an empty line under the card goes first, the text under it moving up (the page's only
      // line stays, but under the cards that were below it)
      const block = blocks[at];
      if (block.to > block.from && lines[block.from] === "") {
        record();
        change(
          lines.length > 1 ? lines.filter((_, i) => i !== block.from).join("\n") : text,
          cards.map((c, i) => (i >= block.before ? { ...c, line: c.line - 1 } : c)),
          true,
        );
      }
      choose(above);
    } else if (e.key === "Delete" && under && atEnd) choose(under);
    else if (e.key === "ArrowLeft" && above && atStart) choose(above);
    else if (e.key === "ArrowRight" && under && atEnd) choose(under);
    else if (e.key === "ArrowUp" && above && caretRows(el).first) choose(above);
    else if (e.key === "ArrowDown" && under && caretRows(el).last) choose(under);
  };

  // Where a drag can drop: before each line of the text and before each card, and under it all,
  // each { y, line, index }: its top in the page, the line a card dropped there is on and its
  // place among the cards.
  const measure = () => {
    const page = pageRef.current;
    const top = (el) => el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
    const slots = [];
    let end = 0;
    for (const el of page.querySelectorAll("[data-block]")) {
      const block = blocks[Number(el.dataset.block)];
      if (!block) continue;
      let y = top(el);
      if (block.card) {
        slots.push({ y, line: block.card.line, index: block.index });
        end = y + el.offsetHeight;
        continue;
      }
      const heights = lineHeights(el, lines.slice(block.from, block.to));
      heights.forEach((h, i) => {
        slots.push({ y, line: block.from + i, index: block.before });
        y += h;
      });
      end = y;
    }
    // under it all, unless the text ends in an empty line: the drop takes that row then (the top
    // of an empty page)
    if (lines[lines.length - 1] !== "" || blocks[blocks.length - 1].from === lines.length) slots.push({ y: end, line: lines.length, index: cards.length });
    return slots;
  };

  // The line under the pointer: a card dropped there takes that row, the line going under it.
  const slotAt = (e) => {
    const page = pageRef.current;
    if (!slotsRef.current) slotsRef.current = measure();
    const y = e.clientY - page.getBoundingClientRect().top + page.scrollTop;
    const slots = slotsRef.current;
    let slot = slots[0];
    for (const s of slots) if (s.y <= y) slot = s;
    return slot;
  };

  const endDrag = () => {
    slotsRef.current = null;
    setMark(null);
  };

  const isOurs = (e) => e.dataTransfer.types.includes(TASKS_DRAG_TYPE) || e.dataTransfer.types.includes(CARD_DRAG_TYPE);

  const drop = (e) => {
    if (!isOurs(e)) return;
    e.preventDefault(); // the text takes no dropped title
    e.stopPropagation(); // see the page's dragover
    const slot = slotAt(e);
    endDrag();
    const moved = e.dataTransfer.getData(CARD_DRAG_TYPE);
    if (moved) {
      // a card of the page, to another line
      const from = cards.findIndex((c) => cardKey(c) === moved);
      if (from < 0) return;
      record();
      const rest = cards.filter((_, i) => i !== from);
      rest.splice(slot.index > from ? slot.index - 1 : slot.index, 0, { ...cards[from], line: slot.line });
      change(text, rest, true);
      return;
    }
    let keys = [];
    try {
      keys = JSON.parse(e.dataTransfer.getData(TASKS_DRAG_TYPE));
    } catch {
      /* not ours after all */
    }
    // each as the page keeps it: its space and its ids, its own after those of the tasks it is
    // under, which are the rows before it in the list, one level up each (see flattenTasks)
    const dropped = tasks.flatMap((task, i) => {
      if (!keys.includes(task.key)) return [];
      const ids = [task.id];
      for (let j = i - 1, depth = task.depth; j >= 0 && depth > 0; j--) {
        if (tasks[j].depth !== depth - 1) continue;
        ids.unshift(tasks[j].id);
        depth -= 1;
      }
      return [{ work: task.space.work, repository: task.space.repository || "", ids, title: task.title, details: task.details, rel: task.rel, status: task.status, missing: false, line: slot.line }];
    });
    const added = dropped.filter((x) => !cards.some((c) => cardKey(c) === cardKey(x)));
    if (!added.length) {
      // on the day already: its card is shown as the one meant
      if (dropped.length) setChosen(cardKey(dropped[0]));
      return;
    }
    record();
    const next = [...cards];
    next.splice(slot.index, 0, ...added);
    change(text, next, true);
  };

  const remove = (entry) => {
    record();
    change(
      text,
      cards.filter((c) => cardKey(c) !== cardKey(entry)),
      true,
    );
  };

  // The card the keyboard is on, by its key: none once it is off the day. `backTo` is the card a
  // key is taking off the day ({ key, line }): once it is gone, the caret goes to the start of the
  // line it was on.
  const [chosen, setChosen] = useState(null);
  // The keyboard is on the calendar under the page (see the page's keys), while it is shown.
  const [inCalendar, setInCalendar] = useState(false);
  const calendarKeys = useRef(null); // the calendar's keys (see Calendar)
  const onCalendar = inCalendar && !!calendarOpen;
  useEffect(() => {
    if (!calendarOpen) setInCalendar(false);
  }, [calendarOpen]);
  // An event of the timetable clicked: the keyboard is on the timetable, off the page's card.
  const chooseInCalendar = () => {
    setChosen(null);
    setInCalendar(true);
  };
  const chosenIndex = cards.findIndex((c) => cardKey(c) === chosen);
  const backTo = useRef(null);
  // The cursor into a run of the text, on `line` of the page (past the run's last line: its end)
  // at `col`: a caret while typing, the NORMAL cursor else.
  const caretTo = (blockIndex, line, col = 0) => {
    const el = pageRef.current?.querySelector(`textarea[data-block="${blockIndex}"]`);
    if (!el) return;
    const block = blocks[blockIndex];
    const start = Math.min(lines.slice(block.from, line).reduce((n, l) => n + l.length + 1, 0), el.value.length);
    const length = line < block.to ? lines[line].length : 0;
    el.focus();
    if (modeRef.current === "insert") el.setSelectionRange(start + Math.min(col, length), start + Math.min(col, length));
    else block1(el, start + Math.max(0, Math.min(col, length - 1)));
  };
  // Where the cursor was when the text lost it ({ line, col }), for the keys that go back in.
  const spot = useRef({ line: 0, col: 0 });
  const leave = (e, block) => {
    const before = e.currentTarget.value.slice(0, e.currentTarget.selectionStart).split("\n");
    spot.current = { line: block.from + before.length - 1, col: before[before.length - 1].length };
    want.current = null;
    flush();
  };
  // Into the text where the cursor was, in mode `m` (`after`: one character on, as vim's a).
  const enter = (m, after = 0) => {
    setChosen(null);
    setInCalendar(false);
    setMode(m);
    const line = Math.min(spot.current.line, lines.length - 1);
    caretTo(
      blocks.findIndex((b) => !b.card && line >= b.from && (b.last || line < b.to)),
      line,
      spot.current.col + after,
    );
  };
  useEffect(() => {
    const back = backTo.current;
    if (!back) return;
    if (cards.some((c) => cardKey(c) === back.key)) return; // still on the day
    backTo.current = null;
    caretTo(
      blocks.findIndex((b) => !b.card && back.line >= b.from && (b.last || back.line < b.to)),
      back.line,
    );
  });
  useEffect(() => {
    if (chosen) pageRef.current?.querySelector('[data-chosen="true"]')?.scrollIntoView({ block: "nearest" });
  }, [chosen, chosenIndex]);

  // The page's keys, as Home names them, while the keyboard is on the pane and not in the text;
  // true when the key was one of them. With no card chosen (the keyboard just came onto the pane,
  // or esc left the text; no cursor is shown): k, l and enter go
  // back into the text in NORMAL mode, i (or e) and a typing, where the cursor was; j (and down)
  // goes on to the calendar under the page when it is shown (`inCalendar`: the keys are then the
  // calendar's, see Calendar, until k on the calendar itself, above its events, or esc is back here;
  // h and l there step a day back and forward), and into the
  // text as k does when it is not; h is
  // the page's (back to the list). On a card (j / k and the arrows get there from the text): k and
  // up go into the text above it, j and down into the text under it, or on to the next card when
  // there is no text between, in the mode the text was left in; a card is a line of its own, so h
  // and l stay on it (as do left and right, but while typing, where they walk on as in the text);
  // backspace, delete and d
  // take the card off the day, x, p and w mark its task, space opens its task, enter starts a new
  // line under it, esc lets it go.
  useEffect(() => {
    if (!keysRef) return undefined;
    keysRef.current = (name) => {
      // d (the day) shows and hides the timetable under the page, as the button in the bar does;
      // on a card it is the card's (it takes it off the day, see below)
      if (name === "d" && !cards[chosenIndex]) {
        onToggleCalendar();
        return true;
      }
      if (onCalendar) {
        // h and l (and the arrows) step a day back and forward, the keyboard staying on the calendar
        const days = ["h", "left"].includes(name) ? -1 : ["l", "right"].includes(name) ? 1 : 0;
        if (days) {
          go(shift(date, days));
          return true;
        }
        const did = calendarKeys.current?.(name);
        if (did === "leave") setInCalendar(false);
        return !!did;
      }
      const card = cards[chosenIndex];
      if (!card) {
        if (calendarOpen && ["j", "down"].includes(name)) setInCalendar(true);
        else if (["j", "k", "l", "enter", "down", "up", "right"].includes(name)) enter("normal");
        else if (["i", "e"].includes(name)) enter("insert");
        else if (name === "a") enter("insert", 1);
        else return false;
        return true;
      }
      const typing = modeRef.current === "insert";
      if (["h", "l"].includes(name) || (!typing && ["left", "right"].includes(name))) return true;
      const step = ["j", "down", "right"].includes(name) ? 1 : ["k", "up", "left"].includes(name) ? -1 : 0;
      if (step) {
        const at = blocks.findIndex((b) => b.card === card);
        const beside = blocks[at + step];
        if (beside && !beside.card) {
          setChosen(null);
          // under the card: the first line; above it: the last line (its end, while typing)
          if (step > 0) caretTo(at + step, beside.from);
          else if (modeRef.current === "insert") caretTo(at + step, beside.to);
          else caretTo(at + step, Math.max(beside.from, beside.to - 1));
        } else {
          const next = cards[chosenIndex + step];
          if (next) setChosen(cardKey(next));
        }
        return true;
      }
      if (name === "enter") {
        // a new line under the card, as enter after a picture in a document, and typing goes on there
        const at = blocks.findIndex((b) => b.card === card);
        record();
        setChosen(null);
        setMode("insert");
        cursorTo.current = { block: at + 1, pos: 0, insert: true };
        change(
          [...lines.slice(0, card.line), "", ...lines.slice(card.line)].join("\n"),
          cards.map((c, i) => (i > chosenIndex ? { ...c, line: c.line + 1 } : c)),
        );
        return true;
      }
      if (name === "space") {
        if (!card.missing && card.rel) onOpen(card);
        return true;
      }
      if (name === "escape") {
        setChosen(null);
        return true;
      }
      // x, p and w mark the task as they do in the list: done, pending, aborted, or back to todo
      const status = { x: "done", p: "pending", w: "aborted" }[name];
      if (status) {
        if (!card.missing && card.rel) onStatus(card, status);
        return true;
      }
      if (["backspace", "Delete", "d"].includes(name)) {
        backTo.current = { key: cardKey(card), line: card.line };
        remove(card);
        return true;
      }
      return ["i", "a", "e"].includes(name); // nothing to type on a card
    };
    return () => {
      keysRef.current = null;
    };
  });


  // cmd / ctrl + s, in the text or with the keyboard on the pane, writes the page as it is now (the
  // text and where the cards sit) and says so; cmd / ctrl + z and its redo go through the page's
  // changes (see `record`). Not while a dialog has the keyboard: the key is its own.
  const sectionRef = useRef(null);
  useEffect(() => {
    const onKeyDown = async (e) => {
      const k = e.key.toLowerCase();
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || !["s", "z", "y", "a", "c"].includes(k)) return;
      const inside = sectionRef.current?.contains(e.target);
      // with the keyboard on the pane, wherever the focus was left (a row of the list, a link),
      // but not in another text field nor in a dialog
      if (!inside && !(focused && !e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
      if (k === "c") {
        // the whole page when it is selected, the chosen card's line else; any other copy is the
        // browser's (the text selected in a run) or the page's (the list's task)
        const card = cards[chosenIndex];
        const copied = all ? compose(text, cards) : card && e.target.tagName !== "TEXTAREA" ? taskLine(card) : null;
        if (copied === null) return;
        e.preventDefault();
        if (!(await copyText(copied))) showToast(t("toast.copyFailed"), 1800, "bottom", "error");
        return;
      }
      e.preventDefault();
      if (!loaded) return;
      if (k === "a") {
        setChosen(null);
        setAll(true);
        return;
      }
      if (k !== "s") {
        // the page's own undo and redo, in place of the text box's
        if (k === "z" && !e.shiftKey) travel(history, undone);
        else travel(undone, history);
        return;
      }
      clearTimeout(timer.current);
      pending.current = null;
      try {
        const day = await api.saveSchedulerPage(date, compose(text, cards));
        if (day.date === dateRef.current) setCards((was) => withLive(was, day.tasks));
        showToast(t("toast.saved"));
      } catch (err) {
        showToast(err.message, 4000);
      }
    };
    // before the keys every text box has (cmd + a, see useTextKeys) and the list's copy
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  // The page is copied as the one text it is kept as, its tasks lines of it (pasted into a page,
  // such a line is a card again): cmd / ctrl + a selects the whole page, text and cards, and
  // cmd / ctrl + c then copies it all; on a card, it copies its line (see the keys above). Any
  // other key, or a click, lets the selection go. A copy inside a run of the text is the text
  // box's own.
  useEffect(() => {
    const letGo = (e) => {
      if (e.type === "keydown" && (["Meta", "Control", "Shift", "Alt"].includes(e.key) || ((e.metaKey || e.ctrlKey) && ["a", "c"].includes(e.key.toLowerCase())))) return;
      setAll(false);
    };
    if (all) {
      document.addEventListener("keydown", letGo, true);
      document.addEventListener("mousedown", letGo, true);
    }
    return () => {
      document.removeEventListener("keydown", letGo, true);
      document.removeEventListener("mousedown", letGo, true);
    };
  });

  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(y, m - 1, d));

  return (
    <section
      ref={sectionRef}
      className={styles.scheduler}
      aria-label={t("scheduler.title")}
    >
      {/* not shaded while the keyboard is on the calendar: its divider is then */}
      {/* a press on the bar or the day's row, as one on the page, takes the keyboard back from the timetable */}
      <div className={styles.bar} data-focused={focused && !onCalendar} onMouseDown={() => setInCalendar(false)}>
        <h2 className={styles.barTitle}>{t("scheduler.title")}</h2>
        {/* let go after the click, so space and enter are the page's again (as the panel's buttons) */}
        <button
          type="button"
          className="btn"
          tabIndex={-1}
          aria-pressed={!!calendarOpen}
          onClick={(e) => {
            e.currentTarget.blur();
            onToggleCalendar();
          }}
          title={withKey(t(calendarOpen ? "scheduler.hideCalendar" : "scheduler.showCalendar"), "d")}
          aria-label={t(calendarOpen ? "scheduler.hideCalendar" : "scheduler.showCalendar")}
        >
          <CalendarIcon />
        </button>
      </div>
      <div className={styles.days} onMouseDown={() => setInCalendar(false)}>
        <div className={styles.steps}>
          {/* let go after the click, as the bar's button: space and enter stay the page's (and the calendar's) */}
          <button type="button" className={styles.step} tabIndex={-1} onClick={(e) => (e.currentTarget.blur(), go(shift(date, -1)))} title={t("scheduler.prev")} aria-label={t("scheduler.prev")}>
            <ChevronLeftIcon />
          </button>
          {/* the day shown: a click shows the days to pick another from, under it (see DayPicker) */}
          <span className={styles.dayBox}>
            <button
              type="button"
              className={styles.day}
              tabIndex={-1}
              title={t("scheduler.pick")}
              data-current={date === today()} // shaded on today
              aria-expanded={picking}
              onClick={(e) => {
                e.currentTarget.blur();
                setPicking((v) => !v);
              }}
            >
              {date} {weekday}
            </button>
            {picking && (
              <DayPicker
                date={date}
                onClose={closePicker}
                onPick={(day) => {
                  setPicking(false);
                  go(day);
                }}
              />
            )}
          </span>
          <button type="button" className={styles.step} tabIndex={-1} onClick={(e) => (e.currentTarget.blur(), go(shift(date, 1)))} title={t("scheduler.next")} aria-label={t("scheduler.next")}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div
        ref={pageRef}
        className={styles.page}
        data-mode={mode}
        data-all={all}
        // a press anywhere but on a card (the text, the blank of the page) lets the chosen card go
        onMouseDown={(e) => {
          setInCalendar(false);
          if (!e.target.closest("[data-card]")) setChosen(null);
        }}
        onFocus={(e) => e.target.tagName === "TEXTAREA" && setInText(true)}
        onBlur={(e) => e.target.tagName === "TEXTAREA" && setInText(false)}
        onDragOver={(e) => {
          if (!isOurs(e)) return;
          e.preventDefault();
          // The drag is the page's alone, here and in the drop: a browser extension that takes
          // every drag of a text left to the document (drag to search) makes it a copy, which the
          // list and the board do not allow their drags, and the drop then never comes.
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move"; // the only effect the list and the board allow their drags
          const slot = slotAt(e);
          setMark((v) => (v === slot.y ? v : slot.y));
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && endDrag()}
        onDrop={drop}
      >
        {blocks.map((block, i) =>
          block.card ? (
            <div
              key={cardKey(block.card)}
              className={styles.card}
              data-card
              data-block={i}
              data-status={block.card.status}
              data-missing={block.card.missing}
              data-chosen={focused && block.index === chosenIndex}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(CARD_DRAG_TYPE, cardKey(block.card));
                dragTitle(e, block.card.title || t("common.untitled"));
              }}
              onDragEnd={endDrag}
            >
              {/* a task that is not on this machine (the days are synced, see server/scheduler.js) is
                  shown as any other, by the title of its line, without the box: there is nothing here to mark */}
              {!block.card.missing && block.card.rel && (
                <DoneBox
                  checked={block.card.status === "done"}
                  pending={block.card.status === "pending"}
                  aborted={block.card.status === "aborted"}
                  onChange={() => onStatus(block.card, "done")}
                  title={withKey(t(block.card.status === "done" ? "list.markTodo" : "list.markDone"), "x")}
                />
              )}
              <button
                type="button"
                className={styles.cardTitle}
                title={block.card.missing ? t("scheduler.missing") : undefined}
                // a click chooses the card, as it selects a row of the list; a double click opens it
                onClick={(e) => {
                  setChosen(cardKey(block.card));
                  e.currentTarget.blur(); // the keys go on from the card (space opens it), not from the button
                }}
                onDoubleClick={() => !block.card.missing && block.card.rel && onOpen(block.card)}
              >
                {block.card.title || t("common.untitled")}
                {/* its description, as the list has it after the title */}
                {describe(block.card.details) && <span className={styles.cardDetail}>{describe(block.card.details)}</span>}
              </button>
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(block.card)}
                title={t("scheduler.remove")}
                aria-label={t("scheduler.remove")}
              >
                <XIcon />
              </button>
            </div>
          ) : (
            <Lines
              key={`text-${block.before}`}
              data-block={i}
              fill={!!block.last}
              value={lines.slice(block.from, block.to).join("\n")}
              // NORMAL mode only reads: an input method (Chinese, Japanese) then leaves the keys
              // alone, so h j k l come as themselves, not as the start of a composition
              readOnly={!loaded || mode === "normal"}
              aria-label={t("scheduler.notes")}
              // nothing is typed in NORMAL mode, by an input method or a paste either
              onBeforeInput={(e) => modeRef.current === "normal" && e.preventDefault()}
              onChange={(e) => modeRef.current === "insert" && type(block, e.target.value)}
              onKeyDown={(e) => cross(e, i)}
              onMouseDown={() => setMode("insert")} // a click in the text types
              onBlur={(e) => leave(e, block)}
            />
          ),
        )}
        {mark !== null && <div className={styles.mark} style={{ top: mark }} aria-hidden="true" />}
        {inText && mode === "normal" && cursorBox && <div className={styles.cursor} style={cursorBox} aria-hidden="true" />}
      </div>
      {calendarOpen && <Calendar date={date} reloadKey={reloadKey} loading={loading} focused={focused && onCalendar} keysRef={calendarKeys} onChoose={chooseInCalendar} chosenEvent={chosenEvent} onEvent={onEvent} />}
      {loading && <div className={`muted ${styles.loading}`}>{t("common.loading")}</div>}
    </section>
  );
}
