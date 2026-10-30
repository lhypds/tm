import { useEffect, useRef } from "react";

// True when a key press belongs to a text field rather than to the page's shortcuts.
export function isTyping(e) {
  const el = e.target;
  if (!el || !el.tagName) return false;
  if (el.tagName === "INPUT") return !["checkbox", "radio", "button"].includes(el.type);
  return el.isContentEditable || ["TEXTAREA", "SELECT"].includes(el.tagName);
}

// Enter and space on a focused button, link or checkbox keep their native click.
const isControl = (el) => !!el?.closest?.("button, a, input, label");

// On mousedown of a text a double click edits: the second press of the double click is stopped,
// so the browser does not select the word under the pointer, which would flash before the editor
// opens. A single press (and a drag that selects text) is left alone.
export function noDoubleClickSelect(e) {
  if (e.detail > 1) e.preventDefault();
}

// Key name in the terminal's terms: "j", "enter", "space", "up", "left", ...
export function keyName(e) {
  switch (e.key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "Enter":
      return "enter";
    case " ":
      return "space";
    case "Escape":
      return "escape";
    default:
      return e.key;
  }
}

// Page-level shortcuts, as in the terminal UI. The handler gets (name, event) for plain key
// presses outside text fields and returns true when it used the key. The one chord is cmd (or
// ctrl) with up / down, as "cmd+up" / "cmd+down": into and out of a folder, as in the macOS
// Finder. The latest handler is read at key time so it can close over fresh state.
export function useShortcuts(handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.altKey || isTyping(e)) return;
      let name = keyName(e);
      if (e.ctrlKey || e.metaKey) {
        if (e.ctrlKey && e.metaKey) return;
        if (name !== "up" && name !== "down") return;
        name = `cmd+${name}`;
      }
      if ((name === "enter" || name === "space") && isControl(e.target)) return;
      if (ref.current(name, e)) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

// In any textarea, as in VS Code: cmd+x (ctrl+x off the Mac) with nothing selected cuts the line
// the caret is on, newline and all, and cmd+a selects the textarea's text. Installed once, on the
// document, so every editor has it. Ctrl on the Mac is left to its Emacs keys (ctrl+a is home).
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function useTextKeys() {
  useEffect(() => {
    const onKeyDown = (e) => {
      const el = e.target;
      if (e.defaultPrevented || el?.tagName !== "TEXTAREA" || el.readOnly || el.disabled) return;
      if (!(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        el.select();
      } else if (key === "x" && el.selectionStart === el.selectionEnd) cutLine(el);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Select the caret's line and let the browser's cut go on, but put the line and one newline on the
// clipboard (the last line has none after it, so the newline before it is the one removed) and
// delete with the edit command, so the change is one undo step and React sees it as typing.
function cutLine(el) {
  const v = el.value;
  if (!v) return;
  const caret = el.selectionStart;
  const start = caret === 0 ? 0 : v.lastIndexOf("\n", caret - 1) + 1;
  const nl = v.indexOf("\n", start);
  const last = nl === -1;
  const line = v.slice(start, last ? v.length : nl) + "\n";
  el.setSelectionRange(last && start > 0 ? start - 1 : start, last ? v.length : nl + 1);
  const onCut = (e) => {
    e.preventDefault();
    e.clipboardData.setData("text/plain", line);
    document.execCommand("delete");
  };
  el.addEventListener("cut", onCut, { once: true });
  // The cut comes right after this keydown; should it not, the next real cut is left alone.
  setTimeout(() => el.removeEventListener("cut", onCut));
}

// Next selection index for j / k / up / down, clamped to the list (-1 for an empty one); null for
// any other key.
export function moveIndex(name, index, length) {
  const down = name === "j" || name === "down";
  if (!down && name !== "k" && name !== "up") return null;
  if (length === 0) return -1;
  return down ? Math.min(length - 1, index + 1) : Math.max(0, index - 1);
}

// Mouse wheel over `el` moves the selection instead of scrolling, as in the terminal UI:
// onStep(1) per notch down, onStep(-1) per notch up. Trackpads send many small deltas, so they
// are summed until they add up to one notch.
const WHEEL_STEP = 50;

export function useWheelSteps(el, onStep) {
  const ref = useRef(onStep);
  useEffect(() => {
    ref.current = onStep;
  });

  useEffect(() => {
    if (!el) return;
    let sum = 0;
    const onWheel = (e) => {
      if (e.ctrlKey || e.deltaY === 0) return; // ctrl+wheel zooms
      e.preventDefault();
      // deltaMode 1 is lines (Firefox), 0 is pixels
      sum += e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      while (Math.abs(sum) >= WHEEL_STEP) {
        const dir = Math.sign(sum);
        sum -= dir * WHEEL_STEP;
        ref.current(dir);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el]);
}

// Mouse wheel over `el` scrolls `el` itself, by script. The browser's own scrolling is not enough
// beside useWheelSteps: Firefox keeps a run of wheel events (a trackpad's go on with no pause) on
// the scroller where the run began, so after the task list the pointer moves onto `el` and its
// wheel events reach it, but the scroll still goes to the list, which takes none.
export function useWheelScroll(el) {
  useEffect(() => {
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey || e.deltaY === 0) return; // ctrl+wheel zooms
      e.preventDefault();
      el.scrollTop += e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el]);
}
