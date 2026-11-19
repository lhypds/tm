import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import { EditIcon } from "@components/icons";
import MachineDot from "@components/MachineDot";
import { formatIncome } from "@utils/income";
import { withKey } from "@utils/keys";
import styles from "./space.module.css";

// What a row of the tree is of, opened with space on it: `entry` is { group } for an origin (see
// groupWorksByOrigin), { item } for a work and { item, repository } for a repository of it. Its
// description comes first (this is where it is read), then what else it has: where it is in the
// tree, its folders, its income, the machines that sync it (what is under it is in the tree, and not
// repeated here). The pencil (i) goes on to its edit dialog.
export default function SpacePreviewModal({ entry, onClose, onEdit }) {
  const { t } = useTranslation();
  if (!entry) return null;
  const { group: g, item: w, repository: p } = entry;
  const kind = p ? "repository" : w ? "work" : "origin";
  const of = p || w || g;
  const path = (value) => value && <span className="mono">{value}</span>;
  const machines = of.remote ? of.machines || [] : [];

  const rows = [
    [t("work.description"), of.description || <span className="muted">{t("space.noDescription")}</span>],
    [t("add.origin"), kind !== "origin" && w.origin],
    [t("add.work"), kind === "repository" && w.work],
    [t("add.sourcePath"), kind === "repository" && path(p.paths?.source)],
    // a repository without a tasks folder of its own has the one in its source folder
    [t("work.tasksPath"), kind === "repository" ? path(p.paths?.tasks || (p.paths?.source ? "" : p.shownPath)) : kind === "work" && path(w.shownPath)],
    [
      t("space.machines"),
      machines.length > 0 &&
        machines.map((m) => (
          <span key={m.name} className={styles.machine}>
            {m.name}
            <MachineDot machine={m} />
          </span>
        )),
    ],
    [t("space.income"), kind !== "repository" && formatIncome(of.income, t)],
    [t("space.hidden"), kind !== "origin" && w.hidden && t("space.yes")],
  ].filter(([, value]) => value);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={kind === "origin" ? g.origin : kind === "work" ? w.work : p.name}
      className={styles.modal}
      titleActions={
        <button type="button" className="btn" onClick={onEdit} title={withKey(t(`${kind}.edit`), "i")} aria-label={t(`${kind}.edit`)}>
          <EditIcon />
        </button>
      }
    >
      <dl className={styles.details}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.detail}>
            <dt className="muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
