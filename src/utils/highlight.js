// JSON cut into colored pieces, for the Highlight in @ui: [{ type, text }], the type one of "key",
// "string", "number", "literal" (true, false, null) and "punct", or none for what is between
// them. It reads the text as it is while being typed, broken or not: an unclosed string ends at
// the line's end, and anything it does not know is left uncolored.
const JSON_TOKEN = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function jsonTokens(text) {
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    if (m[1]) {
      tokens.push({ type: m[2] ? "key" : "string", text: m[1] });
      if (m[2]) tokens.push({ type: "punct", text: m[2] });
    } else tokens.push({ type: m[3] ? "number" : m[4] ? "literal" : "punct", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}

// The highlighter for a file name: JSON for a .json file, none for the rest.
export function highlighterFor(name) {
  return /\.json$/i.test(name || "") ? jsonTokens : null;
}
