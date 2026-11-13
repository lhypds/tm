import { useTranslation } from "react-i18next";
import { PlayIcon } from "@components/icons";
import { withKey } from "@utils/keys";

// The run button on the Prompt divider of the Task panel: a click (onClick) starts Claude Code on
// the task and opens the run's dialog, or, while the task has a run going (`run`, from useRuns, running
// or queued; see RunModal), opens that run's dialog, with a dot on the button meanwhile, as the brain
// has one while the task has a prompt. The dot goes when the run is over, and the next click starts a
// new run (the past runs are listed under the prompt). `disabled` greys it out (no prompt to run),
// and so does `reason`, a text saying why the task cannot run now (its machine is not connected; it
// is the tooltip then), unless there is a run going to show. Not kept focused, as the other buttons
// there, so the page's keys stay the page's. `keys` is the key that starts a run, shown in the tooltip.
export default function RunButton({ run, disabled, reason, keys, onClick }) {
  const { t } = useTranslation();
  const going = !!run && (run.status === "running" || run.status === "queued");
  const label = t(going ? "ai.show" : "ai.run");
  const blocked = !going && !!reason;
  return (
    <button
      type="button"
      className="btn"
      tabIndex={-1}
      disabled={!going && (disabled || blocked)}
      data-dot={going}
      onClick={(e) => {
        e.currentTarget.blur();
        onClick();
      }}
      title={blocked ? reason : withKey(label, !going && keys)}
      aria-label={label}
    >
      <PlayIcon />
    </button>
  );
}
