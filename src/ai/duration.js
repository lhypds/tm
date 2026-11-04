// A length of time in ms as "12s" or "1m 5s" (how long a run of Claude Code took).
export function duration(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
