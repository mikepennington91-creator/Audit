export const UK_TIME_ZONE = 'Europe/London';

export const ukDateToISO = (value) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
  if (!match) return '';
  const [, day, month, year] = match;
  if (Number(year) < 1) return '';
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
};

export const formatUKDate = (value, missing = '-') => {
  if (!value) return missing;
  const text = String(value);
  if (ukDateToISO(text)) return text;
  // A calendar date must not move to another day in a different time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-');
    return ukDateToISO(`${day}/${month}/${year}`) ? `${day}/${month}/${year}` : missing;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? missing : date.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: UK_TIME_ZONE,
  });
};

export const formatUKDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: UK_TIME_ZONE,
  });
};

export const ukToday = () => ukDateToISO(formatUKDate(new Date()));
export const ukNowTime = () => new Date().toLocaleTimeString('en-GB', {
  timeZone: UK_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
});
