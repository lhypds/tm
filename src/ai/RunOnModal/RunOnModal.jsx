import { Modal } from "@ui";
import MachineDot from "@components/MachineDot";
import styles from "./runOn.module.css";

// Where a task runs, asked once the run button is pressed on a task whose folder two machines sync
// (see openRun in Home), before anything starts, in front of the run's dialog: the machines (`machines`, as GET /api/spaces says
// them), and nothing else, no title. `index` is the one the keyboard is on, shaded; the page's keys
// move it (j / k or the arrows) and enter runs the task there, as a click on a machine does
// (onPick(index)). Esc, × or a click outside closes it without running (onClose). A machine whose
// runner is not connected is greyed out, its dot saying when it was last heard from.
export default function RunOnModal({ machines, index, onPick, onClose }) {
  return (
    <Modal isOpen={!!machines} onClose={onClose} className={styles.modal}>
      <ul className={styles.machines} role="listbox">
        {(machines || []).map((m, i) => (
          <li key={m.name} role="option" aria-selected={i === index} data-selected={i === index} data-ready={!!m.runner} onClick={() => onPick(i)}>
            <span className={styles.name}>{m.name}</span>
            <MachineDot machine={m} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}
