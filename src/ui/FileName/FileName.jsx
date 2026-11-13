import styles from "./filename.module.css";

// A file name that keeps its extension when it is cut short: the part before the extension takes
// the ellipsis ("a long na….pdf"). A name without an extension (or a dot file) is cut at its end.
// The element around it gives the width (min-width: 0, overflow: hidden).
export default function FileName({ name }) {
  const dot = name.lastIndexOf(".");
  const split = dot > 0 && dot < name.length - 1;
  return (
    <span className={styles.root}>
      <span className={styles.stem}>{split ? name.slice(0, dot) : name}</span>
      {split && <span className={styles.ext}>{name.slice(dot)}</span>}
    </span>
  );
}
