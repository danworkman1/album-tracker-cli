import { expect, test } from 'vitest';
import { monthBounds, todayInZone, windowMonths } from '../src/window.js';

test('windowMonths is this month then next', () => {
  expect(windowMonths('2026-11-01')).toEqual([
    { monthName: 'November', year: 2026 },
    { monthName: 'December', year: 2026 }
  ]);
});

test('windowMonths rolls the year over after December', () => {
  expect(windowMonths('2026-12-31')).toEqual([
    { monthName: 'December', year: 2026 },
    { monthName: 'January', year: 2027 }
  ]);
});

test('monthBounds gives the first day and the exclusive end', () => {
  expect(monthBounds('December', 2026)).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  expect(monthBounds('February', 2026)).toEqual({ from: '2026-02-01', to: '2026-03-01' });
});

test('todayInZone uses the zone, not UTC', () => {
  const now = new Date('2026-11-01T14:30:00Z');
  // Already the 2nd in Sydney (UTC+11 in November), still the 1st in UTC.
  expect(todayInZone('Australia/Sydney', now)).toBe('2026-11-02');
  expect(todayInZone('UTC', now)).toBe('2026-11-01');
});
