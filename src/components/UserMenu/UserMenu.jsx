import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@store";
import { UserIcon } from "@components/icons";
import { withKey } from "@utils/keys";
import styles from "./usermenu.module.css";

// The person who is logged in, as fin shows them: an icon that opens a menu with the name and the
// way to log out. Closes on a click outside, on escape, or when the pointer leaves it.
export default function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (!ref.current?.contains(e.target)) close();
    }
    function handleKey(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  return (
    <div className={styles.wrap} ref={ref} data-open={open} onMouseLeave={close}>
      <button
        type="button"
        className={styles.profile}
        onClick={() => setOpen((v) => !v)}
        aria-label={user}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserIcon />
      </button>
      <div className={styles.menu}>
        <span>@{user}</span>
        <button
          type="button"
          title={withKey(t("login.logout"), ":q")}
          onClick={() => {
            close();
            logout();
          }}
        >
          {t("login.logout")}
        </button>
      </div>
    </div>
  );
}
