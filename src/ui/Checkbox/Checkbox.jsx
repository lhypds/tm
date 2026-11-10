import styles from "./checkbox.module.css";

// A checkbox drawn like the task list's done box, with its label after it. `disabled`: it cannot
// be changed, and says so by its cursor.
export default function Checkbox({ checked, onChange, className, disabled = false, children }) {
  return (
    <label className={[styles.check, className].filter(Boolean).join(" ")} data-disabled={disabled}>
      <input type="checkbox" className={styles.input} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.box} aria-hidden="true" />
      {children}
    </label>
  );
}
