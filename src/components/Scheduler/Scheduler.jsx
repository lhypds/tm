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
// day. With the keyboard on the pane (`keysRef` is given its keys, see below), j / k walk the
// cards, space or enter opens the one chosen, esc lets it go, backspace takes it off the day, and e or i (enter too, with no card
// chosen) put the caret at the end of the text. `focused` says the keyboard is on this pane (its bar is shaded, as the task panel's is). The day is read again whenever `reloadKey` changes (a task renamed or deleted elsewhere).
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
  const type = (block, value) => {
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
  // Esc leaves the text (what was typed is written on the blur). Backspace at the very start of a
  // run under a card leaves it too, for that card, which is chosen (the line, when it is empty, is
  // deleted on the way): backspace again takes it off
  // the day (see the page's keys), and the caret is back where it was.
  const cross = (e, at) => {
    const el = e.currentTarget;
    const above = blocks[at - 1]?.card;
    if (e.key === "Backspace" && above && el.selectionStart === 0 && el.selectionEnd === 0 && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // an empty line under the card goes first, the text under it moving up
      const block = blocks[at];
      // (the page's only line stays, but under the cards that were below it)
      if (block.to > block.from && lines[block.from] === "") {
        change(
          lines.length > 1 ? lines.filter((_, i) => i !== block.from).join("\n") : text,
          cards.map((c, i) => (i >= block.before ? { ...c, line: c.line - 1 } : c)),
          true,
        );
      }
      backTo.current = { key: cardKey(above), line: above.line };
      setChosen(cardKey(above));
      el.blur();
      return;
    }
    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      el.blur();
      return;
    }
    const up = e.key === "ArrowUp" && el.selectionEnd === 0;
    const down = e.key === "ArrowDown" && el.selectionStart === el.value.length;
    if ((!up && !down) || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const runs = [...pageRef.current.querySelectorAll("textarea")];
    const to = runs[runs.indexOf(el) + (up ? -1 : 1)];
    if (!to) return;
    e.preventDefault();
    to.focus();
    const caret = up ? to.value.length : 0;
    to.setSelectionRange(caret, caret);
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
    try {
      await flush();
      show(await api.scheduleTasks(date, dropped, slot.line, slot.index));
    } catch (err) {
      showToast(err.message, 4000);
    }
  };

  const remove = async (entry) => {
    try {
      await flush();
      show(await api.unscheduleTask(date, entry));
    } catch (e) {
      showToast(e.message, 4000);
    }
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

  // The card the keyboard is on, by its key: none once it is off the day. `backTo` is the card
  // chosen by a backspace in the text under it ({ key, line }): once it is off the day, the caret
  // goes back to the start of that line.
  const [chosen, setChosen] = useState(null);
  const backTo = useRef(null);
  useEffect(() => {
    const back = backTo.current;
    if (!back) return;
    if (cards.some((c) => cardKey(c) === back.key)) {
      if (chosen !== back.key) backTo.current = null; // still on the day, and another card chosen or this one let go
      return;
    }
    backTo.current = null;
    const i = blocks.findIndex((b) => !b.card && back.line >= b.from && (b.last || back.line < b.to));
    const el = i < 0 ? null : pageRef.current?.querySelector(`textarea[data-block="${i}"]`);
    if (!el) return;
    const caret = lines.slice(blocks[i].from, back.line).reduce((n, line) => n + line.length + 1, 0);
    el.focus();
    el.setSelectionRange(Math.min(caret, el.value.length), Math.min(caret, el.value.length));
  });
  const chosenIndex = cards.findIndex((c) => cardKey(c) === chosen);
  useEffect(() => {
    if (chosen) pageRef.current?.querySelector('[data-chosen="true"]')?.scrollIntoView({ block: "nearest" });
  }, [chosen, chosenIndex]);

  // The page's keys, as Home names them; true when the key was one of them.
  useEffect(() => {
    if (!keysRef) return undefined;
    keysRef.current = (name) => {
      const step = ["j", "down"].includes(name) ? 1 : ["k", "up"].includes(name) ? -1 : 0;
      if (step) {
        if (cards.length) {
          // from no card, j starts at the first one and k at the last; the ends stop
          const next = chosenIndex < 0 ? (step > 0 ? 0 : cards.length - 1) : Math.max(0, Math.min(cards.length - 1, chosenIndex + step));
          setChosen(cardKey(cards[next]));
        }
        return true;
      }
      const card = cards[chosenIndex];
      if (card && ["space", "enter"].includes(name)) {
        if (!card.missing) onOpen(card);
        return true;
      }
      if (card && name === "escape") {
        setChosen(null);
        return true;
      }
      if (name === "backspace") {
        if (!card) return false;
        remove(card);
        return true;
      }
      if (["e", "i", "enter"].includes(name)) {
        const texts = pageRef.current.querySelectorAll("textarea");
        const el = texts[texts.length - 1];
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        return true;
      }
      return false;
    };
    return () => {
      keysRef.current = null;
    };
  });

  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(y, m - 1, d));
  const isToday = date === today();

  return (
    <section className={styles.scheduler} aria-label={t("scheduler.title")}>
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
              onChange={(e) => type(block, e.target.value)}
              onKeyDown={(e) => cross(e, i)}
              onBlur={flush}
            />
          ),
        )}
        {mark !== null && <div className={styles.mark} style={{ top: mark }} aria-hidden="true" />}
      </div>
    </section>
  );
}
