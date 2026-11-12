import { Modal } from "@ui";
import MachineDot from "@components/MachineDot";
import { useWheelSteps } from "@utils/keys";
import styles from "./runOn.module.css";

// Where a task runs, asked once the run button is pressed on a task whose folder two machines sync
// (see openRun in Home), before anything starts, in front of the run's dialog: the machines
// (`machines`, as GET /api/ai/machines says them), and nothing else, no title. Only a machine whose
// runner is connected can be picked: its dot is green and its name plain; the others are greyed
// out, dot and name, and take no click (the dot here says whether the runner is connected, not
// whether the machine syncs). `index` is the one the keyboard is on, shaded (-1: none can be picked);
// the page's keys move it (j / k or the arrows) and enter runs the task there, as a click on a
// machine does (onPick(index)). The mouse wheel moves it too, a notch a machine, wherever the
// pointer is on the screen (nothing else scrolls meanwhile; onMove(1) down, onMove(-1) up), and so
// does the pointer coming onto a machine (onIndex(index)). Esc, × or a click outside closes it
// without running (onClose).
export default function RunOnModal({ machines, index, onIndex, onMove, onPick, onClose }) {
  useWheelSteps(machines ? document : null, onMove);
  return (
    <Modal isOpen={!!machines} onClose={onClose} className={styles.modal}>
      <ul className={styles.machines} role="listbox">
        {(machines || []).map((m, i) => {
          const ready = !!m.runner;
          return (
            <li
              key={m.name}
              role="option"
              aria-selected={i === index}
              aria-disabled={!ready}
              data-selected={i === index}
              data-ready={ready}
              onMouseEnter={() => ready && onIndex(i)}
              onClick={() => ready && onPick(i)}
            >
              <span className={styles.name}>{m.name}</span>
              <MachineDot machine={{ ...m, online: ready }} />
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
