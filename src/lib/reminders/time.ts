/**
 * Lightweight natural-language time parser for reminders.
 * Supports RU/EN phrases used daily.
 */
export function parseRelativeTime(input: string, _timezone = "UTC"): Date {
  const text = input.trim().toLowerCase();
  const now = new Date();

  // in N minutes/hours/days — через N минут/часов/дней
  let m =
    text.match(/(?:in|через)\s+(\d+)\s*(minutes?|mins?|минут[уы]?|мин|hours?|hrs?|час(?:а|ов)?|ч|days?|дня|дней|день)/i) ||
    text.match(/(\d+)\s*(minutes?|mins?|минут[уы]?|мин|hours?|hrs?|час(?:а|ов)?|ч)\s*(?:later)?/i);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const d = new Date(now);
    if (/min|мин/.test(unit)) d.setMinutes(d.getMinutes() + n);
    else if (/hour|час|hr|ч/.test(unit)) d.setHours(d.getHours() + n);
    else d.setDate(d.getDate() + n);
    return d;
  }

  const timeMatch = text.match(/(\d{1,2})[:\.](\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 9;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  const target = new Date(now);
  target.setSeconds(0, 0);

  if (/послезавтра|day after tomorrow/.test(text)) {
    target.setDate(target.getDate() + 2);
    target.setHours(hour, minute, 0, 0);
    return target;
  }
  if (/завтра|tomorrow/.test(text)) {
    target.setDate(target.getDate() + 1);
    target.setHours(hour, minute, 0, 0);
    return target;
  }
  if (/сегодня|today/.test(text) || timeMatch) {
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    воскресенье: 0,
    понедельник: 1,
    вторник: 2,
    среда: 3,
    среду: 3,
    четверг: 4,
    пятница: 5,
    пятницу: 5,
    суббота: 6,
    субботу: 6,
  };

  for (const [name, dow] of Object.entries(weekdays)) {
    if (text.includes(name)) {
      const current = target.getDay();
      let delta = (dow - current + 7) % 7;
      if (delta === 0) delta = 7;
      target.setDate(target.getDate() + delta);
      target.setHours(hour, minute, 0, 0);
      return target;
    }
  }

  // ISO-ish
  const iso = Date.parse(input);
  if (!Number.isNaN(iso)) return new Date(iso);

  // default: +1 hour
  target.setHours(now.getHours() + 1, now.getMinutes(), 0, 0);
  return target;
}
