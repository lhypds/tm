// A work's income is { monthly: [...], once: [...] }, each a list of { amount, currency }; a monthly
// item may also have "from" and "to", the year and month it starts and the last month it pays
// ("2026-01", "2026-12").

export const INCOME_PERIODS = ["monthly", "once"];

export const INCOME_CURRENCIES = ["JPY", "CNY", "USD", "EUR", "GBP", "HKD", "TWD", "KRW", "SGD", "AUD", "CAD"];

// " (from 2026-01)", " (until 2026-12)" or " (2026-01 – 2026-12)" for a monthly item; "" without either.
function monthsOf({ from, to }, t) {
  if (from && to) return t("income.rangeValue", { from, to });
  if (from) return t("income.fromValue", { from });
  if (to) return t("income.toValue", { to });
  return "";
}

// The items of one period added up per currency and months: "500,000 JPY (from 2026-01) + 1,000 USD".
function total(items, t) {
  const sums = new Map();
  for (const x of items) {
    const key = `${x.currency} ${x.from || ""} ${x.to || ""}`;
    sums.set(key, { ...x, amount: (sums.get(key)?.amount || 0) + x.amount });
  }
  return [...sums.values()]
    .map((x) => `${x.amount.toLocaleString()} ${x.currency}${monthsOf(x, t)}`)
    .join(" + ");
}

// The income in short, in units of 10,000 (万) whatever the currency: the one-time total, then
// "m" and the monthly total, as "44 + m7", "55" or "m70"; "" when there is none.
export function formatIncomeShort(income) {
  if (!income) return "";
  const man = (items) => Number((items.reduce((sum, x) => sum + x.amount, 0) / 10000).toFixed(2)).toLocaleString();
  const parts = [];
  if (income.once?.length) parts.push(man(income.once));
  if (income.monthly?.length) parts.push(`m${man(income.monthly)}`);
  return parts.join(" + ");
}

// "500,000 JPY / month · 100,000 JPY one-time" in the current language; "" when there is none.
export function formatIncome(income, t) {
  if (!income) return "";
  return INCOME_PERIODS.filter((p) => income[p]?.length)
    .map((p) => t(p === "monthly" ? "income.perMonth" : "income.perOnce", { value: total(income[p], t) }))
    .join(" · ");
}

// How many months of a monthly item fall in `year`, counting from its start month and through its
// end month when it has them: all 12 without either, none when it starts after the year or ends before.
export function monthsIn(from, to, year) {
  const index = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return y * 12 + m - 1;
  };
  const first = Math.max(year * 12, from ? index(from) : -Infinity);
  const last = Math.min(year * 12 + 11, to ? index(to) : Infinity);
  return Math.max(0, last - first + 1);
}

// Every currency used by `entries` ({ income } each), most used first.
export function currenciesOf(entries) {
  const counts = new Map();
  for (const e of entries)
    for (const p of INCOME_PERIODS) for (const x of e.income?.[p] || []) counts.set(x.currency, (counts.get(x.currency) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

// The years an analysis can pick: from the earliest start or end month (or last year) to the latest
// (or next year).
export function yearsOf(entries, now = new Date().getFullYear()) {
  const starts = entries.flatMap((e) => (e.income?.monthly || []).flatMap((x) => [x.from, x.to]).filter(Boolean).map((ym) => Number(ym.slice(0, 4))));
  const first = Math.min(now - 1, ...starts);
  const last = Math.max(now + 1, ...starts);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

// One entry's income in `currency` for `year`: the monthly total, that times 12 (annual), what the
// monthly items actually pay in the year given their start and end months, and the one-time total.
export function incomeFigures(income, currency, year) {
  const monthly = (income?.monthly || []).filter((x) => x.currency === currency);
  const once = (income?.once || []).filter((x) => x.currency === currency);
  const perMonth = monthly.reduce((sum, x) => sum + x.amount, 0);
  return {
    perMonth,
    annual: perMonth * 12,
    inYear: monthly.reduce((sum, x) => sum + x.amount * monthsIn(x.from, x.to, year), 0),
    once: once.reduce((sum, x) => sum + x.amount, 0),
  };
}
