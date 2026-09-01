import { formatUKDate, formatUKDateTime, ukDateToISO } from './dates';

test('dates are day-first and calendar dates do not change with timezone', () => {
  expect(formatUKDate('2026-09-01')).toBe('01/09/2026');
  expect(ukDateToISO('01/09/2026')).toBe('2026-09-01');
  expect(formatUKDate('2026-08-31T23:30:00Z')).toBe('01/09/2026');
  expect(formatUKDateTime('2026-08-31T23:30:00Z')).toContain('01/09/2026');
  expect(formatUKDateTime('2026-08-31T23:30:00Z')).toContain('00:30');
});

test('invalid dates are rejected, including non-leap-year February 29', () => {
  expect(ukDateToISO('29/02/2026')).toBe('');
  expect(ukDateToISO('29/02/2028')).toBe('2028-02-29');
  expect(ukDateToISO('12/31/2026')).toBe('');
  expect(formatUKDate('2026-02-30')).toBe('-');
});
