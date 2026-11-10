// The colors an origin can have (taskmgr.json's "color"), as the color dialog shows them: around the hue wheel and then the greys.
export const ORIGIN_COLORS = [
  "#fca5a5",
  "#fdba74",
  "#fcd34d",
  "#fde047",
  "#bef264",
  "#86efac",
  "#6ee7b7",
  "#5eead4",
  "#67e8f9",
  "#7dd3fc",
  "#93c5fd",
  "#a5b4fc",
  "#c4b5fd",
  "#d8b4fe",
  "#f0abfc",
  "#f9a8d4",
  "#fda4af",
  "#d6b89c",
  "#d6d3d1",
  "#cbd5e1",
  "#d4d4d4",
];

// An origin's color as it is shown (a task's from tag, the origin's square in the tree): much lighter, mixed into the
// page's white. "" for no color.
export const lightColor = (color) => (color ? `color-mix(in srgb, ${color} 22%, var(--bg))` : "");
