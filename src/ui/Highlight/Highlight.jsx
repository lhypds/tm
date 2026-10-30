import { useRef } from "react";
import styles from "./highlight.module.css";

// `text` colored by `highlight` (text => [{ type, text }], see @utils/highlight), as spans.
export function Highlighted({ text, highlight }) {
  return highlight(text).map((token, i) =>
    token.type ? (
      <span key={i} className={styles[token.type]}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  );
}

// Colors for a textarea, which cannot color its own text: the textarea's text goes transparent
// (its caret and selection do not) and a <pre> under it, in the textarea's box (`className`, the
// class the textarea has: font, padding, border), shows the same text colored, moved as the
// textarea scrolls. The parent of the two is to be position: relative, the textarea's size.
// Returns { layer, className, onScroll }: the layer to put before the textarea, and the class
// and scroll handler for the textarea; all empty without a `highlight`.
export function useHighlight(highlight, value, className) {
  const codeRef = useRef(null);
  if (!highlight) return { layer: null, className: "", onScroll: undefined };
  return {
    layer: (
      <pre aria-hidden className={`${className || ""} ${styles.layer}`}>
        <code ref={codeRef} className={styles.code}>
          <Highlighted text={value ?? ""} highlight={highlight} />
          {"\n"}
        </code>
      </pre>
    ),
    className: styles.overlaid,
    onScroll: (e) => {
      if (codeRef.current) codeRef.current.style.transform = `translate(${-e.target.scrollLeft}px, ${-e.target.scrollTop}px)`;
    },
  };
}
