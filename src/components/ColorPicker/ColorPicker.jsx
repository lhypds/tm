import { useTranslation } from "react-i18next";
import { ORIGIN_COLORS } from "@utils/colors";
import styles from "./colorPicker.module.css";

// Choose an origin's color: "no color" first, then the colors of ORIGIN_COLORS. `value` is
// the color ("#rrggbb", "" for none); one written by hand in taskmgr.json that is not among them
// is shown too, last.
export default function ColorPicker({ value, onChange }) {
  const { t } = useTranslation();
  const colors = value && !ORIGIN_COLORS.includes(value) ? [...ORIGIN_COLORS, value] : ORIGIN_COLORS;
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t("origin.color")}</span>
      <div className={styles.swatches} role="radiogroup" aria-label={t("origin.color")}>
        {["", ...colors].map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            className={styles.swatch}
            data-none={!c}
            style={c ? { background: c } : undefined}
            title={c || t("origin.noColor")}
            aria-label={c || t("origin.noColor")}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}
