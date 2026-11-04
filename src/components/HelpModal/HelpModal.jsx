import { useTranslation } from "react-i18next";
import { Modal } from "@ui";
import styles from "./help.module.css";

// The same bindings as the terminal UI (cli.js), with the web's meaning where it differs.
// Each is help.<id>.keys and help.<id>.desc in the translations.
const SHORTCUTS = ["move", "nav", "toTree", "fromTree", "tab", "add", "unselect", "edit", "open", "into", "copy", "text", "preview", "files", "prompt", "done", "pending", "aborted", "delete", "refresh", "command", "quit"];

export default function HelpModal({ isOpen, onClose }) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("help.title")} className={styles.modal}>
      <dl className={styles.list}>
        {SHORTCUTS.map((id) => (
          <div key={id} className={styles.item}>
            <dt className="mono">{t(`help.${id}.keys`)}</dt>
            <dd>{t(`help.${id}.desc`)}</dd>
          </div>
        ))}
      </dl>
      <p className={`muted ${styles.hint}`}>{t("help.hint")}</p>
    </Modal>
  );
}
