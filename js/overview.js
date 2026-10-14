import { el, icon } from './ui.js';

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function localStamp(date) {
  return `${localDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function utcStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function eventLines(event, stamp) {
  const lines = ['BEGIN:VEVENT', `UID:${event.uid}@viaro`, `DTSTAMP:${stamp}`];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${localDate(event.start)}`, `DTEND;VALUE=DATE:${localDate(event.end)}`);
  } else if (event.utc) {
    lines.push(`DTSTART:${utcStamp(event.start)}`, `DTEND:${utcStamp(event.end)}`);
  } else {
    lines.push(`DTSTART:${localStamp(event.start)}`, `DTEND:${localStamp(event.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.geo) lines.push(`GEO:${event.geo.lat.toFixed(6)};${event.geo.lon.toFixed(6)}`);
  if (event.allDay) lines.push('TRANSP:TRANSPARENT');
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(name, events) {
  const stamp = utcStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Viaro//Reiseplaner//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.filter((event) => event.calendar).flatMap((event) => eventLines(event.calendar, stamp)),
    'END:VCALENDAR'
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function shareText(title, events, footer) {
  const lines = [title, ''];
  for (const event of events) {
    const detail = [event.title, event.meta].filter(Boolean).join(' – ');
    lines.push(event.when ? `${event.when}: ${detail}` : detail);
  }
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

export function overviewList(events) {
  return el('ol', { class: 'overview' }, events.map((event) => el('li', { class: `overview__item overview__item--${event.type}${event.warn ? ' is-warn' : ''}`, style: event.color ? `--c:${event.color}` : null },
    el('span', { class: 'overview__icon', 'aria-hidden': 'true' }, icon(event.icon)),
    el('span', { class: 'overview__text' },
      event.when ? el('span', { class: 'overview__when', text: event.when }) : null,
      el('span', { class: 'overview__title', text: event.title }),
      event.meta ? el('span', { class: 'overview__meta', text: event.meta }) : null))));
}
