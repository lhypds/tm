import { useEffect } from "react";
import { isMac } from "@utils/keys";

// The urls in a text that is not being edited are links: the one under the pointer is underlined,
// and cmd+click (ctrl+click off the Mac) opens it in a new tab, the pointer a hand while the key
// is held. The texts are every textarea without the focus (focused, it is edited: a click places
// the caret as ever) or read-only, and every element marked `data-links` (a <pre> showing a text).
// Installed once, on the document (useTextLinks), so every text has it.

// http(s) up to a space, a quote, a bracket of markup or CJK punctuation.
const URL_RE = /https?:\/\/[^\s<>"`　-〿＀-￯]+/g;
const CLOSERS = { ")": "(", "]": "[", "}": "{" };

const count = (s, c) => s.split(c).length - 1;

// [{ start, end, url }] for the urls in `text`, without the punctuation that ends a sentence
// after one, or a closing bracket whose opening one is before the url.
export function findUrls(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    for (;;) {
      const c = url[url.length - 1];
      const open = CLOSERS[c];
      if (".,;:!?'*".includes(c) || (open && count(url, c) > count(url, open))) url = url.slice(0, -1);
      else break;
    }
    if (/^https?:\/\/./.test(url)) out.push({ start: m.index, end: m.index + url.length, url });
  }
  return out;
}

// What makes a textarea lay its text out as it does, copied onto its mirror.
const MIRRORED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "textAlign",
  "tabSize",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
  "direction",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

// A textarea does not say where its letters are, so an unseen copy of it is laid over it: a box
// the size of the textarea's inside (without its border and scrollbar), holding the same text in
// the same font, scrolled as far.
function makeMirror(el) {
  const mirror = document.createElement("div");
  const cs = getComputedStyle(el);
  for (const p of MIRRORED) mirror.style[p] = cs[p];
  Object.assign(mirror.style, {
    position: "fixed",
    boxSizing: "border-box",
    margin: "0",
    border: "0",
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
  });
  mirror.textContent = el.value;
  document.body.appendChild(mirror);
  return mirror;
}

function placeMirror(mirror, el, box) {
  mirror.style.left = `${box.left + el.clientLeft}px`;
  mirror.style.top = `${box.top + el.clientTop}px`;
  mirror.style.width = `${el.clientWidth}px`;
  mirror.style.height = `${el.clientHeight}px`;
  mirror.scrollTop = el.scrollTop;
  mirror.scrollLeft = el.scrollLeft;
}

// The boxes of the letters from `start` to `end` of the text under `root`, one a line.
function rangeRects(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let begun = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.data.length;
    if (!begun && start < at + len) {
      range.setStart(node, start - at);
      begun = true;
    }
    if (begun && end <= at + len) {
      range.setEnd(node, end - at);
      return Array.from(range.getClientRects());
    }
    at += len;
  }
  return [];
}

const isEditing = (el) => document.activeElement === el && !el.readOnly;

// The text the pointer's element belongs to, when its urls are links now.
function linkable(target) {
  const el = target?.closest?.("textarea, [data-links]");
  if (!el) return null;
  if (el.tagName === "TEXTAREA" && (el.disabled || isEditing(el))) return null;
  return el;
}

export function useTextLinks() {
  useEffect(() => {
    let cur = null; // the text the pointer is on: { el, text, urls, mirror, sig, rects }
    let shown = null; // the link underlined: { el, start, sig }
    let marks = []; // its underline, a piece a line
    let handEl = null; // the element given the hand
    let mod = false; // cmd / ctrl held
    let x = -1;
    let y = -1;
    let frame = 0;

    const modOf = (e) => (isMac ? e.metaKey : e.ctrlKey);

    function drop() {
      cur?.mirror?.remove();
      cur = null;
    }

    function unmark() {
      for (const m of marks) m.remove();
      marks = [];
      shown = null;
    }

    function hand(el) {
      if (handEl === el) return;
      if (handEl) handEl.style.cursor = "";
      handEl = el;
      if (el) el.style.cursor = "pointer";
    }

    // The link of `el` at the pointer: { link, rects, sig }, or null.
    function hit(el) {
      const isArea = el.tagName === "TEXTAREA";
      const text = isArea ? el.value : el.textContent;
      if (!cur || cur.el !== el || cur.text !== text) {
        drop();
        const urls = findUrls(text);
        cur = { el, text, urls, mirror: isArea && urls.length ? makeMirror(el) : null, sig: "", rects: new Map() };
      }
      if (!cur.urls.length) return null;
      const box = el.getBoundingClientRect();
      // the letters stay where they were measured until the text moves or its box changes
      const sig = [box.left, box.top, box.width, box.height, el.scrollLeft, el.scrollTop].join();
      if (sig !== cur.sig) {
        cur.sig = sig;
        cur.rects.clear();
        if (cur.mirror) placeMirror(cur.mirror, el, box);
      }
      for (const link of cur.urls) {
        let rects = cur.rects.get(link.start);
        if (!rects) {
          rects = rangeRects(cur.mirror || el, link.start, link.end).filter((r) => r.width > 0 && r.top >= box.top && r.bottom <= box.bottom);
          cur.rects.set(link.start, rects);
        }
        if (rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return { link, rects, sig, box };
      }
      return null;
    }

    function mark(el, found) {
      if (shown && shown.el === el && shown.start === found.link.start && shown.sig === found.sig) return;
      unmark();
      // a colored textarea's own text is transparent (see useHighlight)
      const own = getComputedStyle(el).color;
      const color = /^rgba\(.*,\s*0\)$|^transparent$/.test(own) ? "var(--fg)" : own;
      for (const r of found.rects) {
        const left = Math.max(r.left, found.box.left);
        const right = Math.min(r.right, found.box.right);
        if (right <= left) continue;
        const m = document.createElement("div");
        m.className = "link-underline";
        m.style.left = `${left}px`;
        m.style.top = `${Math.round(r.bottom) - 2}px`;
        m.style.width = `${right - left}px`;
        m.style.color = color;
        document.body.appendChild(m);
        marks.push(m);
      }
      shown = { el, start: found.link.start, sig: found.sig };
    }

    // The link under the pointer, as of now: underlined, and null when there is none.
    function update() {
      frame = 0;
      const el = x < 0 ? null : linkable(document.elementFromPoint(x, y));
      const found = el && hit(el);
      if (!found) {
        if (!el) drop();
        unmark();
        hand(null);
        return null;
      }
      mark(el, found);
      hand(mod ? el : null);
      return found.link;
    }

    const later = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const onMove = (e) => {
      x = e.clientX;
      y = e.clientY;
      mod = modOf(e);
      later();
    };
    const onOut = (e) => {
      if (e.relatedTarget) return;
      x = y = -1; // left the window
      later();
    };
    const onKey = (e) => {
      const held = modOf(e);
      if (held === mod) return;
      mod = held;
      later();
    };
    const onBlur = () => {
      mod = false;
      later();
    };
    // A press with the key on a link is the link's: it neither focuses the text nor selects in it.
    const onDown = (e) => {
      if (e.button !== 0 || !modOf(e)) return;
      x = e.clientX;
      y = e.clientY;
      mod = true;
      if (update()) e.preventDefault();
    };
    const onClick = (e) => {
      if (e.button !== 0 || !modOf(e)) return;
      x = e.clientX;
      y = e.clientY;
      const link = update();
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(link.url, "_blank", "noopener,noreferrer");
    };

    const opts = { capture: true };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    document.addEventListener("mousedown", onDown, opts);
    document.addEventListener("click", onClick, opts);
    // what moves the text under a still pointer, or makes it an edited one
    document.addEventListener("scroll", later, opts);
    document.addEventListener("input", later);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    window.addEventListener("resize", later);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("mousedown", onDown, opts);
      document.removeEventListener("click", onClick, opts);
      document.removeEventListener("scroll", later, opts);
      document.removeEventListener("input", later);
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
      window.removeEventListener("resize", later);
      window.removeEventListener("blur", onBlur);
      cancelAnimationFrame(frame);
      unmark();
      hand(null);
      drop();
    };
  }, []);
}
