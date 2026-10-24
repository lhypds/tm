import { useTranslation } from "react-i18next";
import { PlayIcon } from "@components/icons";

// The run button on the Prompt divider of the Task panel: a click (onClick) starts Claude Code on
// the task and opens the run's dialog, or opens the dialog of the run the task already has (`run`,
// from useRuns; see RunModal), with a dot on the button while the task has a run, going or finished, as the
// brain has one while the task has a prompt. `disabled` greys it out (no prompt to run), and so does
// `reason`, a text saying why the task cannot run now (its machine is not connected; it is the
// tooltip then), unless there is a run to show. Not kept focused, as the other buttons there, so the
// page's keys stay the page's.
export default function RunButton({ run, disabled, reason, onClick }) {
  const { t } = useTranslation();
  const label = t(run ? "ai.show" : "ai.run");
  const blocked = !run && !!reason;
  return (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      disabled={!run && (disabled || blocked)}
      data-dot={!!run}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      title={blocked ? reason : label}
      aria-label={label}
    >
      <PlayIcon />
    </button>
  );
}
