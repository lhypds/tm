// The app's tooltips: every `title` in the page is shown by one box drawn here and not by the
// browser, whose own tooltip is not to be relied on (it waits for a pointer that is quite still,
// stays away once a key was pressed, and never shows in a window that is not the active one).
//
// The element under the pointer that has a `title` (the nearest one, as the browser takes it) loses
// the attribute while the pointer is in it, which is what keeps the browser's tooltip away, and
// gets it back when the pointer leaves; meanwhile the text is kept in `data-tip`. The box comes up
// under the pointer a moment after it came in, at once when another tooltip was up just before.
// A key, a scroll or the window losing focus takes it away until the pointer moves again; a press
// on the element takes it away until the pointer has left.
//
// An svg's <title> element (the pie of the income analysis) is still the browser's.

const DELAY = 500; // from the pointer coming in to the tooltip
const WARM = 300; // after a tooltip went, the next one comes at once for this long
const BELOW = 20; // from the pointer down to the box: the height of the cursor
const ABOVE = 8; // from the box down to the pointer, where there is no room below
const EDGE = 4; // kept between the box and the window's edge

export function installTooltips() {
  const canHover = window.matchMedia("(hover: hover)");
  let box = null; // made with the first tooltip
  let current = null; // the element the pointer is in, its title taken
  let text = "";
  let timer = 0;
  let shown = false;
  let quiet = false; // pressed: nothing more until the pointer leaves
  let wentAt = 0;
  let x = 0;
  let y = 0;

  const place = () => {
    const { width, height } = box.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE));
    const top = y + BELOW + height > window.innerHeight - EDGE ? y - ABOVE - height : y + BELOW;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(Math.max(EDGE, top))}px`;
  };

  const hide = () => {
    clearTimeout(timer);
    timer = 0;
    if (!shown) return;
    shown = false;
    wentAt = Date.now();
    box.hidden = true;
  };

  // Give the element its title back, unless it was given a new one meanwhile.
  const leave = () => {
    hide();
    if (!current) return;
    watch.disconnect();
    if (!current.hasAttribute("title") && current.dataset.tip !== undefined) current.setAttribute("title", current.dataset.tip);
    delete current.dataset.tip;
    current = null;
    quiet = false;
  };

  const show = () => {
    timer = 0;
    if (!current?.isConnected) return leave(); // gone from the page under the pointer
    if (!box) {
      box = document.createElement("div");
      box.className = "tooltip";
      box.setAttribute("role", "tooltip");
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.hidden = false;
    shown = true;
    place();
  };

  const arm = () => {
    clearTimeout(timer);
    timer = 0;
    if (text) timer = setTimeout(show, Date.now() - wentAt < WARM ? 0 : DELAY);
  };

  // Take the element's title, for the box to show.
  const take = () => {
    text = current.getAttribute("title") || "";
    current.dataset.tip = text;
    current.removeAttribute("title");
  };

  // A title set while the pointer is in the element (the page was drawn again with another text)
  // is taken as the first was, and the box up shows it.
  const watch = new MutationObserver(() => {
    if (!current?.hasAttribute("title")) return;
    take();
    if (!shown) return;
    if (!text) return hide();
    box.textContent = text;
    place();
  });

  const onOver = (e) => {
    if (!canHover.matches) return; // a touch screen: a tap is not a hover
    const el = e.target.closest?.("[title], [data-tip]") || null;
    if (el === current) return;
    leave();
    if (!el || el.tagName === "IFRAME") return; // a frame's title is its name, not a tooltip
    current = el;
    x = e.clientX;
    y = e.clientY;
    take();
    watch.observe(el, { attributes: true, attributeFilter: ["title"] });
    arm();
  };

  const onMove = (e) => {
    x = e.clientX;
    y = e.clientY;
    if (!current) return;
    if (!current.isConnected) return leave();
    if (!shown && !timer && !quiet) arm(); // back after a key or a scroll
  };

  const onDown = () => {
    quiet = true;
    hide();
  };

  const opts = { capture: true };
  document.addEventListener("mouseover", onOver);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mousedown", onDown, opts);
  document.addEventListener("keydown", hide, opts);
  document.addEventListener("scroll", hide, opts);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
  document.documentElement.addEventListener("mouseleave", leave);
  window.addEventListener("blur", leave);
}
