export function getNextRelease(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now).reduce((values, part) => {
    values[part.type] = Number(part.value);
    return values;
  }, {});

  let year = parts.year;
  let month = parts.month;
  if (parts.day >= 25) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return wallTimeToUtc(year, month, 25, timezone);
}

export function getCurrentMonthKey(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}-01`;
}

function wallTimeToUtc(year, month, day, timezone) {
  let timestamp = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(timestamp)).reduce((values, part) => {
      values[part.type] = Number(part.value);
      return values;
    }, {});
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    timestamp += Date.UTC(year, month - 1, day) - displayed;
  }
  return new Date(timestamp);
}
