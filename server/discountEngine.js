/** @typedef {{ id: number, label: string, percent: number, rule_type: string, rule_value: string, active: number }} DiscountRow */

/**
 * Pick the highest applicable discount percent for ISO date yyyy-mm-dd
 * @param {DiscountRow[]} rows
 * @param {string} isoDate
 * @returns {{ percent: number, label?: string }}
 */
function bestDiscountForDate(rows, isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  if (Number.isNaN(d.getTime())) return { percent: 0 };
  const month = d.getMonth() + 1;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${day}`;

  let best = { percent: 0, label: undefined };

  for (const r of rows) {
    if (!r.active) continue;
    let pct = 0;
    try {
      const val = JSON.parse(r.rule_value);
      if (r.rule_type === "month_range") {
        const sm = Number(val.startMonth);
        const em = Number(val.endMonth);
        if (!sm || !em) continue;
        if (sm <= em) {
          if (month >= sm && month <= em) pct = r.percent;
        } else {
          /* wrap e.g. Nov–Feb */
          if (month >= sm || month <= em) pct = r.percent;
        }
      } else if (r.rule_type === "fixed_dates") {
        const dates = Array.isArray(val.dates) ? val.dates.map(String) : [];
        if (dates.includes(iso)) pct = r.percent;
      }
    } catch {
      continue;
    }
    if (pct > best.percent)
      best = { percent: pct, label: r.label };
  }

  return best;
}

module.exports = { bestDiscountForDate };
