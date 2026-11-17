import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "@components/icons";
import { FromTag } from "@components/TaskList";
import { showToast } from "@ui";
import * as api from "@utils/api";
import { TASKS_DRAG_TYPE } from "@utils/task";
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

// The scheduler, in place of the task panel: one page a day. Under its title, a row steps a day back, goes to
// today, steps a day forward, and says which day is shown. The page is squared paper to write on
// (saved as it is typed) with the tasks dragged onto it from the list or the board (`tasks` are
// those, found by the keys the drag carries), each a card of one line: where it is from (the tag
// the list has, in its origin's color, from `works` and `origins`) and its title. A card sits on
// the line it was dropped on, the text flowing around it: the lines above it stay above, the rest
// go under it, and close up again when it is dragged to another line (a line across the page shows
// where it would go). A click on a card opens the task (`onOpen(entry)`), its × takes it off the
// day. The text is edited as in vim, in a NORMAL and an INSERT mode (see
// `normalKey`), the cards being stops on the way: j / k (the arrows, while typing) walk the cursor
// from the text onto a card and off it again, and backspace, delete and x take a card off the day
// (see `cross` and the page's keys, which `keysRef` is given). `focused` says the keyboard is on this pane (its bar is shaded, as the task panel's is). The day is read again whenever `reloadKey` changes (a task renamed or deleted elsewhere).
// See server/scheduler.js for what is kept.
export default function Scheduler({ tasks, works, origins, reloadKey, focused, keysRef, onOpen }) {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(today);
  const [loaded, setLoaded] = useState(false); // the day shown has been read
  const [text, setText] = useState("");
  const [cards, setCards] = useState([]); // in the page's order (see arrange)
  const [mark, setMark] = useState(null); // where a drag would drop: the page's y of that line
  const pending = useRef(null); // { date, text, cards } changed and not written yet
  const timer = useRef(null);
  const pageRef = useRef(null);
  const slotsRef = useRef(null); // the lines a drag can drop on, measured once per drag

  const lines = text.split("\n");

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    try {
      await api.saveSchedulerPage(p.date, p.text, p.cards);
    } catch (e) {
      showToast(e.message, 4000);
    }
  }, []);

  const show = (day) => {
    setText(day.text);
    setCards(arrange(day.tasks, day.text.split("\n").length));
  };

  useEffect(() => {
    let stale = false;
    (async () => {
      await flush();
      try {
        const day = await api.getSchedulerDay(date);
        if (stale) return;
        setLoaded(true);
        if (!pending.current) show(day); // what is being typed is not written over
      } catch (e) {
        if (!stale) showToast(e.message, 4000);
      }
    })();
    return () => {
      stale = true;
    };
  }, [date, reloadKey, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // What was changed last is written when the scheduler goes away too.
  useEffect(() => () => void flush(), [flush]);

  const go = (next) => {
    if (next === date) return;
    flush();
    setLoaded(false);
    history.current = [];
    undone.current = [];
    setChosen(null);
    backTo.current = null;
    setText("");
    setCards([]);
    setDate(next);
  };

  // The page as changed here: shown at once, written `now` or a moment after the last key.
  const change = (nextText, nextCards, now = false) => {
    const arranged = arrange(nextCards, nextText.split("\n").length);
    setText(nextText);
    setCards(arranged);
    pending.current = { date, text: nextText, cards: arranged };
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
    change(
      next.join("\n"),
      cards.map((c, i) => (i >= block.before ? { ...c, line: c.line + delta } : c)),
    );
  };

  // Up on the first character of a run goes to the end of the run above the card, down on the last
  // one to the start of the run under it.
  // The text is edited as in vim, in two modes. NORMAL: the
  // keys move the cursor (the caret, before its character) and nothing is typed: h and
  // l along the line, j and k to the line under and above (off the run onto the card beside it,
  // see below), 0 and $ to the ends of the line; i and a start typing before and after the cursor,
  // I and A at the ends of the line, o and O on a new line under and above; x deletes the
  // character, u undoes; esc leaves the text (h / l are then the page's again). INSERT: the keys
  // type, esc is back to NORMAL. The arrows do as h j k l in NORMAL. A click in the text types.
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
  const block1 = (el, p) => {
    const at = Math.max(0, Math.min(p, el.value.length));
    el.setSelectionRange(at, at);
    setCursorBox(caretBox(el, at));
  };
  useLayoutEffect(() => {
    const el = document.activeElement;
    const box = modeRef.current === "normal" && el?.tagName === "TEXTAREA" && pageRef.current?.contains(el) ? caretBox(el, el.selectionStart) : null;
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
    const v = el.value;
    const p = Math.min(el.selectionStart, v.length);
    const start = v.lastIndexOf("\n", p - 1) + 1; // of the cursor's line
    const end = v.indexOf("\n", p) < 0 ? v.length : v.indexOf("\n", p); // its line break, or the end
    const col = p - start;
    const last = (from, to) => Math.max(from, to - 1); // the last character of a line
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
    if (k === "h") block1(el, Math.max(start, p - 1));
    else if (k === "l") block1(el, Math.min(last(start, end), p + 1));
    else if (k === "0") block1(el, start);
    else if (k === "$") block1(el, last(start, end));
    else if (k === "j") {
      if (end < v.length) {
        const to = v.indexOf("\n", end + 1) < 0 ? v.length : v.indexOf("\n", end + 1);
        block1(el, Math.min(end + 1 + col, last(end + 1, to)));
      } else if (under) choose(under);
    } else if (k === "k") {
      if (start > 0) {
        const from = v.lastIndexOf("\n", start - 2) + 1;
        block1(el, Math.min(from + col, last(from, start - 1)));
      } else if (above) choose(above);
    } else if (k === "i") insert(p);
    else if (k === "a") insert(end > start ? p + 1 : p);
    else if (k === "I") insert(start);
    else if (k === "A") insert(end);
    else if (k === "o") edit(`${v.slice(0, end)}\n${v.slice(end)}`, end + 1, true);
    else if (k === "O") edit(`${v.slice(0, start)}\n${v.slice(start)}`, start, true);
    else if (k === "x") {
      if (p < end) edit(v.slice(0, p) + v.slice(p + 1), Math.min(p, last(start, end - 1)), false);
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
    slots.push({ y: end, line: lines.length, index: cards.length });
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

  const drop = async (e) => {
    if (!isOurs(e)) return;
    e.preventDefault(); // the text takes no dropped title
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
    const dropped = tasks.filter((task) => keys.includes(task.key));
    if (!dropped.length) return;
    record();
    try {
      await flush();
      show(await api.scheduleTasks(date, dropped, slot.line, slot.index));
    } catch (err) {
      showToast(err.message, 4000);
    }
  };

  const remove = (entry) => {
    record();
    change(
      text,
      cards.filter((c) => cardKey(c) !== cardKey(entry)),
      true,
    );
  };

  // Where a card is from, as the list's tag says it: its repository, or its work, on a tint of
  // its origin's color; the whole path on hover.
  const fromOf = (entry) => {
    const origin = (works || []).find((w) => w.work === entry.work)?.origin || "";
    const path = [entry.work, entry.repository].filter(Boolean);
    return {
      space: { origin, work: entry.work, repository: entry.repository },
      from: path.join(" / "),
      fromParts: path.slice(-1),
      fromColor: (origins || []).find((o) => o.origin === origin)?.color || "",
    };
  };

  // The card the keyboard is on, by its key: none once it is off the day. `backTo` is the card a
  // key is taking off the day ({ key, line }): once it is gone, the caret goes to the start of the
  // line it was on.
  const [chosen, setChosen] = useState(null);
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
    flush();
  };
  // Into the text where the cursor was, in mode `m` (`after`: one character on, as vim's a).
  const enter = (m, after = 0) => {
    setChosen(null);
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
  // or esc left the text; no cursor is shown): j, k and enter go
  // back into the text in NORMAL mode, i (or e) and a typing, where the cursor was; h and l are
  // the page's (to the pane beside). On a card (j / k and the arrows get there from the text): k,
  // up and left go into the text above it, j, down and right into the text under it, or on to the
  // next card when there is no text between, in the mode the text was left in; backspace, delete
  // and x take the card off the day, space and enter open its task, esc lets it go.
  useEffect(() => {
    if (!keysRef) return undefined;
    keysRef.current = (name) => {
      const card = cards[chosenIndex];
      if (!card) {
        if (["j", "k", "enter", "down", "up"].includes(name)) enter("normal");
        else if (["i", "e"].includes(name)) enter("insert");
        else if (name === "a") enter("insert", 1);
        else return false;
        return true;
      }
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
      if (["space", "enter"].includes(name)) {
        if (!card.missing) onOpen(card);
        return true;
      }
      if (name === "escape") {
        setChosen(null);
        return true;
      }
      if (["backspace", "Delete", "x"].includes(name)) {
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
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || !["s", "z", "y"].includes(k)) return;
      const inside = sectionRef.current?.contains(e.target);
      // with the keyboard on the pane, wherever the focus was left (a row of the list, a link),
      // but not in another text field nor in a dialog
      if (!inside && !(focused && !e.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
      e.preventDefault();
      if (!loaded) return;
      if (k !== "s") {
        // the page's own undo and redo, in place of the text box's
        if (k === "z" && !e.shiftKey) travel(history, undone);
        else travel(undone, history);
        return;
      }
      clearTimeout(timer.current);
      pending.current = null;
      try {
        await api.saveSchedulerPage(date, text, cards);
        showToast(t("toast.saved"));
      } catch (err) {
        showToast(err.message, 4000);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(y, m - 1, d));
  const isToday = date === today();

  return (
    <section
      ref={sectionRef}
      className={styles.scheduler}
      aria-label={t("scheduler.title")}
    >
      <div className={styles.bar} data-focused={focused}>
        <h2 className={styles.barTitle}>{t("scheduler.title")}</h2>
      </div>
      <div className={styles.days}>
        <div className={styles.steps}>
          <button type="button" className={styles.step} onClick={() => go(shift(date, -1))} title={t("scheduler.prev")} aria-label={t("scheduler.prev")}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className={styles.today} data-current={isToday} onClick={() => go(today())}>
            {t("scheduler.today")}
          </button>
          <button type="button" className={styles.step} onClick={() => go(shift(date, 1))} title={t("scheduler.next")} aria-label={t("scheduler.next")}>
            <ChevronRightIcon />
          </button>
        </div>
        <span className={styles.date}>
          {date} {weekday}
        </span>
      </div>
      <div
        ref={pageRef}
        className={styles.page}
        data-mode={mode}
        onFocus={(e) => e.target.tagName === "TEXTAREA" && setInText(true)}
        onBlur={(e) => e.target.tagName === "TEXTAREA" && setInText(false)}
        onDragOver={(e) => {
          if (!isOurs(e)) return;
          e.preventDefault();
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
              data-block={i}
              data-status={block.card.status}
              data-missing={block.card.missing}
              data-chosen={focused && block.index === chosenIndex}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(CARD_DRAG_TYPE, cardKey(block.card));
              }}
              onDragEnd={endDrag}
            >
              <FromTag task={fromOf(block.card)} />
              <button
                type="button"
                className={styles.cardTitle}
                disabled={block.card.missing}
                title={block.card.missing ? t("scheduler.missing") : undefined}
                onClick={() => onOpen(block.card)}
              >
                {block.card.title || t("common.untitled")}
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
              readOnly={!loaded}
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
    </section>
  );
}
