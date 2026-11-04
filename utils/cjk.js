// Utilities for handling CJK character width
// helper: treat common CJK characters as width 2 for display alignment
function isCJKChar(ch) {
  try {
    return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(ch);
  } catch (e) {
    // fallback: basic heuristic - treat characters outside single-byte range as wide
    return ch.codePointAt(0) > 0xFF;
  }
}

module.exports = { isCJKChar };
