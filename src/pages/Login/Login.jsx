import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@components";
import { useAuth, rememberedUsername } from "@store";
import styles from "./login.module.css";

// The gap between the message under the field and the way out of the step at the end of it: an
// en space, a character rather than a margin, since it is a space in a line of type (see fin).
const SPACE = " ";

// Logging in, in two steps, the way fin's login page does it: the name first, on its own, then
// the password in the same field with the same button. The page keeps its wordmark; the second
// step is a step of this screen rather than a screen of its own. There is no account to create
// here, so the name step does not ask the server anything: a name nobody has is found out at the
// password step, which is also what back is for.
export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [name, setName] = useState(rememberedUsername);
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("name");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef(null);

  const naming = step === "name";

  // The password field is what the second step is for, so it takes the cursor as it arrives; a
  // frame late, because the field is not in the document yet when the step changes.
  useEffect(() => {
    if (naming) return;
    const frame = requestAnimationFrame(() => passwordRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [naming]);

  function submitName() {
    const username = name.trim();
    // An empty field is nothing to answer: the field says what it is for.
    if (!username) return;
    setName(username);
    setError("");
    setStep("password");
  }

  async function submitPassword() {
    if (submitting) return;
    if (!password) return setError(t("login.passwordEmpty"));
    setSubmitting(true);
    setError("");
    try {
      await login(name, password);
      // Dismiss a mobile keyboard before the page gives way to the workspace.
      document.activeElement?.blur();
    } catch (err) {
      setError(err.status === 401 ? t("login.invalid") : err.message);
      setSubmitting(false);
    }
  }

  function back() {
    setStep("name");
    setPassword("");
    setError("");
  }

  // Whether the words on the line need a space before the way out at the end of them: only
  // full-width punctuation brings its own separation; anything else would run straight into it.
  const spaced = Boolean(error) && !/[。！？]$/.test(error);

  return (
    <div className={styles.page}>
      <div className={styles.lang}>
        <LanguageSwitcher />
      </div>
      <main className={styles.hero}>
        <h1 className={styles.title}>taskmgr</h1>
        <div className={styles.form}>
          <div className={styles.row}>
            {naming ? (
              <input
                className={styles.input}
                name="username"
                value={name}
                placeholder={t("login.username")}
                aria-label={t("login.username")}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                enterKeyHint="next"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) submitName();
                }}
              />
            ) : (
              <input
                ref={passwordRef}
                className={styles.input}
                name="password"
                type="password"
                value={password}
                placeholder={t("login.password")}
                aria-label={t("login.password")}
                autoComplete="current-password"
                enterKeyHint="go"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) submitPassword();
                }}
              />
            )}
            <button type="button" className={styles.go} onClick={naming ? submitName : submitPassword} disabled={submitting}>
              {t(naming ? "login.next" : "login.go")}
            </button>
          </div>

          {/* The one line under the field, the same on both steps: what went wrong with what it
              was given, and, on the password step, the way back at the end of it. */}
          <p className={styles.message}>
            {error}
            {!naming && spaced && SPACE}
            {!naming && (
              <button type="button" className={styles.word} onClick={back} disabled={submitting}>
                {t("login.back")}
              </button>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
