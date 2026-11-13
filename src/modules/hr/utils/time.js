/**
 * Asia/Karachi helpers (UTC+5, no DST). Timezone is configurable via HrSettings.
 */

const DEFAULT_TZ = 'Asia/Karachi';
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

const offsetMsFor = (timezone = DEFAULT_TZ) => {
  if (timezone === 'Asia/Karachi' || timezone === 'PKT') return KARACHI_OFFSET_MS;
  // Fallback: try Intl offset for "now" (good enough for non-DST zones)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
    const m = raw.match(/GMT([+-])(\d+)(?::(\d+))?/i);
    if (!m) return KARACHI_OFFSET_MS;
    const sign = m[1] === '-' ? -1 : 1;
    const hours = Number(m[2] || 0);
    const mins = Number(m[3] || 0);
    return sign * (hours * 60 + mins) * 60 * 1000;
  } catch {
    return KARACHI_OFFSET_MS;
  }
};

const toLocalParts = (date = new Date(), timezone = DEFAULT_TZ) => {
  const local = new Date(date.getTime() + offsetMsFor(timezone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
};

const toLocalDateString = (date = new Date(), timezone = DEFAULT_TZ) => {
  const p = toLocalParts(date, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/**
 * Attendance month window: from cutoff day of previous calendar month
 * through (cutoff-1) of named month... Spec:
 * August 2026 = 26 Jul 2026 through 25 Aug 2026 when cutoff=26.
 * A date on or after the 26th belongs to the next attendance month.
 */
const attendanceMonthForDate = (dateInput, cutoffDay = 26, timezone = DEFAULT_TZ) => {
  const ymd = typeof dateInput === 'string' ? dateInput : toLocalDateString(dateInput, timezone);
  const [y, m, d] = ymd.split('-').map(Number);
  if (d >= cutoffDay) {
    // belongs to next calendar month's attendance month
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return { year: ny, month: nm, key: `${ny}-${pad(nm)}` };
  }
  return { year: y, month: m, key: `${y}-${pad(m)}` };
};

const attendanceMonthRange = (year, month, cutoffDay = 26) => {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const start = `${prevYear}-${pad(prevMonth)}-${pad(cutoffDay)}`;
  const end = `${year}-${pad(month)}-${pad(cutoffDay - 1)}`;
  return { start, end, key: `${year}-${pad(month)}` };
};

const addMonths = (year, month, delta) => {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};

const parseYmd = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return { y, m, d };
};

const ymdCompare = (a, b) => String(a).localeCompare(String(b));

/** Probation ends 6 months after joining (calendar), unless ended early. */
const probationEndDate = (joiningYmd) => {
  const { y, m, d } = parseYmd(joiningYmd);
  const nm = m + 6;
  const year = y + Math.floor((nm - 1) / 12);
  const month = ((nm - 1) % 12) + 1;
  return `${year}-${pad(month)}-${pad(d)}`;
};

const isOnProbation = (employee, todayYmd) => {
  if (!employee?.joiningDate) return false;
  if (employee.probationEndedOn) {
    return ymdCompare(todayYmd, employee.probationEndedOn) < 0;
  }
  const end = probationEndDate(employee.joiningDate);
  return ymdCompare(todayYmd, end) < 0;
};

module.exports = {
  DEFAULT_TZ,
  offsetMsFor,
  toLocalParts,
  toLocalDateString,
  attendanceMonthForDate,
  attendanceMonthRange,
  addMonths,
  parseYmd,
  ymdCompare,
  probationEndDate,
  isOnProbation,
};
