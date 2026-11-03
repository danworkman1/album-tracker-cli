import { MONTH_NAMES } from '../../src/calendar.js';

const pad = (n) => String(n).padStart(2, '0');

/** Today's date as YYYY-MM-DD in the given IANA zone (a Worker runs in UTC). */
export function todayInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The month of `today` and the one after it, rolling the year after December. */
export function windowMonths(today) {
  const year = Number(today.slice(0, 4));
  const idx = Number(today.slice(5, 7)) - 1;
  return [
    { monthName: MONTH_NAMES[idx], year },
    { monthName: MONTH_NAMES[(idx + 1) % 12], year: idx === 11 ? year + 1 : year }
  ];
}

/** First day of the month, and the first day of the next month (exclusive end). */
export function monthBounds(monthName, year) {
  const idx = MONTH_NAMES.indexOf(monthName);
  const nextYear = idx === 11 ? year + 1 : year;
  return {
    from: `${year}-${pad(idx + 1)}-01`,
    to: `${nextYear}-${pad(((idx + 1) % 12) + 1)}-01`
  };
}
