import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@ui";
import { currenciesOf, incomeFigures, yearsOf } from "@utils/income";
import styles from "./analysis.module.css";

// One color per source in the pie, in order; they repeat past the tenth source.
const COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];

const money = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// The pie of `slices` ({ name, value, color }), drawn clockwise from the top.
function Pie({ slices }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!total) return null;
  const point = (turn) => [100 + 90 * Math.sin(turn * 2 * Math.PI), 100 - 90 * Math.cos(turn * 2 * Math.PI)];
  let at = 0;
  return (
    <svg className={styles.pie} viewBox="0 0 200 200" role="img">
      {slices.map((s) => {
        const share = s.value / total;
        const start = at;
        at += share;
        // A whole circle cannot be one arc.
        if (share >= 1) return <circle key={s.name} cx="100" cy="100" r="90" fill={s.color} />;
        const [x1, y1] = point(start);
        const [x2, y2] = point(at);
        return (
          <path key={s.name} d={`M100 100 L${x1} ${y1} A90 90 0 ${share > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.color}>
            <title>{`${s.name}: ${money(s.value)} (${(share * 100).toFixed(1)}%)`}</title>
          </path>
        );
      })}
    </svg>
  );
}

// The income of every origin (its own) and work in one currency: per month, annual (monthly × 12),
// what the monthly items actually pay in the chosen year given their start and end months, and one-time;
// with a pie of where the annual or the chosen year's income comes from, one slice per origin (a
// work without an origin is its own source). Hidden works count too.
export default function IncomeAnalysisModal({ isOpen, works, origins, onClose }) {
  const { t } = useTranslation();
  const now = new Date().getFullYear();
  const [year, setYear] = useState(now);
  const [currency, setCurrency] = useState("");
  const [basis, setBasis] = useState("inYear"); // what the pie shows: "inYear" or "annual"

  // Every income: each origin's own, then each work's, with the source it counts toward.
  const entries = useMemo(
    () =>
      [
        ...(origins || []).map((o) => ({ key: `o/${o.origin}`, source: o.origin, label: t("analysis.originOwn", { origin: o.origin }), income: o.income })),
        ...(works || []).map((w) => ({ key: `w/${w.work}`, source: w.origin || w.work, label: w.origin ? `${w.origin} / ${w.work}` : w.work, income: w.income })),
      ].filter((e) => e.income),
    [works, origins, t],
  );
  const currencies = useMemo(() => currenciesOf(entries), [entries]);
  const years = useMemo(() => yearsOf(entries, now), [entries, now]);

  // Start on the most used currency, and keep a chosen one while it is still used.
  useEffect(() => {
    if (!currencies.includes(currency)) setCurrency(currencies[0] || "");
  }, [currencies, currency]);

  const rows = entries.map((e) => ({ ...e, ...incomeFigures(e.income, currency, year) })).filter((r) => r.perMonth || r.once);
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const totals = { perMonth: sum("perMonth"), annual: sum("annual"), inYear: sum("inYear"), once: sum("once") };

  const bySource = new Map();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) || 0) + r[basis]);
  const slices = [...bySource]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }));
  const pieTotal = totals[basis];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("analysis.title")} className={styles.modal}>
      <div className={styles.body}>
        <div className={styles.controls}>
          <label className={styles.control}>
            {t("analysis.year")}
            <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {currencies.length > 1 && (
            <label className={styles.control}>
              {t("income.currency")}
              <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="muted">{t("analysis.none")}</p>
        ) : (
          <>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("analysis.annual")}</span>
                <span className={styles.statValue}>
                  {money(totals.annual)} {currency}
                </span>
                <span className={styles.statNote}>{t("analysis.annualNote", { value: money(totals.perMonth) })}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>{t("analysis.inYear", { year })}</span>
                <span className={styles.statValue}>
                  {money(totals.inYear)} {currency}
                </span>
                <span className={styles.statNote}>{t("analysis.inYearNote")}</span>
              </div>
              {totals.once > 0 && (
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{t("analysis.once")}</span>
                  <span className={styles.statValue}>
                    {money(totals.once)} {currency}
                  </span>
                  <span className={styles.statNote}>{t("analysis.onceNote")}</span>
                </div>
              )}
            </div>

            <div className={styles.sources}>
              <div className={styles.sourcesHead}>
                <span className={styles.statLabel}>{t("analysis.sources")}</span>
                <select className="select" value={basis} onChange={(e) => setBasis(e.target.value)} aria-label={t("analysis.basis")}>
                  <option value="inYear">{t("analysis.inYear", { year })}</option>
                  <option value="annual">{t("analysis.annual")}</option>
                </select>
              </div>
              {slices.length === 0 ? (
                <p className="muted">{t("analysis.noneInYear", { year })}</p>
              ) : (
                <div className={styles.chart}>
                  <Pie slices={slices} />
                  <ul className={styles.legend}>
                    {slices.map((s) => (
                      <li key={s.name}>
                        <span className={styles.swatch} style={{ background: s.color }} />
                        <span className={styles.legendName} title={s.name}>
                          {s.name}
                        </span>
                        <span className={styles.num}>{money(s.value)}</span>
                        <span className={`${styles.num} ${styles.share}`}>{((s.value / pieTotal) * 100).toFixed(1)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("analysis.source")}</th>
                    <th>{t("income.monthly")}</th>
                    <th>{t("analysis.annual")}</th>
                    <th>{year}</th>
                    <th>{t("income.once")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className={styles.legendName} title={r.label}>
                        {r.label}
                      </td>
                      <td>{money(r.perMonth)}</td>
                      <td>{money(r.annual)}</td>
                      <td>{money(r.inYear)}</td>
                      <td>{money(r.once)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t("analysis.total")}</td>
                    <td>{money(totals.perMonth)}</td>
                    <td>{money(totals.annual)}</td>
                    <td>{money(totals.inYear)}</td>
                    <td>{money(totals.once)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
