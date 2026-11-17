// What follows the pointer while a task is dragged: its title alone (with "+N" when `count` tasks
// go with it), in place of the picture of the whole row, which is as wide as its pane. Called in
// the dragstart, with its event.
export function dragTitle(e, title, count = 1) {
  const el = document.createElement("div");
  el.textContent = count > 1 ? `${title} +${count - 1}` : title;
  const font = getComputedStyle(e.currentTarget);
  Object.assign(el.style, {
    position: "fixed",
    top: "-1000px",
    left: "0",
    maxWidth: "320px",
    padding: "4px 8px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontFamily: font.fontFamily,
    fontSize: font.fontSize,
    color: "var(--fg)",
    background: "var(--bg)",
    border: "var(--line, 1px) solid var(--fg)",
  });
  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 12, 12);
  setTimeout(() => el.remove()); // the browser has its picture by then
}
