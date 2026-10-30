import { useRef, forwardRef } from "react";
import { useHighlight } from "../Highlight";
import styles from "./textarea.module.css";

// `highlight` (see @utils/highlight) colors the text, as a code editor does.
const TextArea = forwardRef(function TextArea({ className, minHeight = 80, highlight, onScroll, ...props }, forwardedRef) {
  const localRef = useRef(null);
  const boxClass = `${styles.textarea}${className ? ` ${className}` : ""}`;
  const colors = useHighlight(highlight, props.value, boxClass);

  function setRefs(el) {
    localRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  }

  function onMouseDown(e) {
    e.preventDefault();
    function onMouseMove(e) {
      // Measure the live top on every move rather than anchoring to the position at mousedown:
      // growing the textarea can grow its container (a vertically-centered modal re-centers as it
      // grows taller), shifting the textarea's top out from under a fixed anchor and decoupling
      // the handle from the cursor.
      const top = localRef.current.getBoundingClientRect().top;
      localRef.current.style.height = Math.max(minHeight, e.clientY - top) + "px";
    }
    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div className={styles.wrapper}>
      {colors.layer}
      <textarea
        ref={setRefs}
        className={`${boxClass} ${colors.className}`}
        onScroll={(e) => {
          colors.onScroll?.(e);
          onScroll?.(e);
        }}
        {...props}
      />
      <div className={styles.handle} onMouseDown={onMouseDown} />
    </div>
  );
});

export default TextArea;
