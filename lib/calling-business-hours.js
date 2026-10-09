import { AppError } from './db.js';
import { supportIsOpen, validateSupportPolicy } from './support-rules.js';

export function validateCallingHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('Calling hours must be an object.', 400, 'VALIDATION_ERROR');
  }
  if (value.useSupportPolicy === true) {
    return { useSupportPolicy: true, alwaysOpen: false, timezone: '', windows: [] };
  }
  const alwaysOpen = value.alwaysOpen === true;
  const timezone = typeof value.timezone === 'string' ? value.timezone.trim() : '';
  if (!timezone || timezone.length > 64) {
    throw new AppError('Choose a valid calling time zone.', 400, 'VALIDATION_ERROR');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new AppError('Choose a valid calling time zone.', 400, 'VALIDATION_ERROR');
  }
  const windows = Array.isArray(value.windows) ? value.windows : [];
  const normalized = windows.map((window) => ({
    day: String(window?.day || '').slice(0, 3).toLowerCase(),
    startMinute: window?.startMinute,
    endMinute: window?.endMinute
  }));
  const days = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  if (
    windows.length > 7 ||
    normalized.some((window) => !days.has(window.day) ||
      !Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute) ||
      window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) ||
    new Set(normalized.map((window) => window.day)).size !== normalized.length ||
    (!alwaysOpen && normalized.length === 0)
  ) {
    throw new AppError('Choose one valid calling window per open day.', 400, 'VALIDATION_ERROR');
  }
  return { useSupportPolicy: false, alwaysOpen, timezone, windows: alwaysOpen ? [] : normalized };
}

export async function callingHoursOpen(businessId, supportPolicy, callingHours, at = new Date()) {
  const hours = validateCallingHours(callingHours || { useSupportPolicy: true });
  if (hours.useSupportPolicy) {
    if (!supportPolicy) return true;
    return supportIsOpen(validateSupportPolicy(supportPolicy), at);
  }
  if (hours.alwaysOpen) return true;
  const tz = hours.timezone;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(at);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const day = String(map.weekday || '').slice(0, 3).toLowerCase();
  const minute = Number(map.hour) * 60 + Number(map.minute);
  return hours.windows.some((window) => {
    if (String(window.day || '').slice(0, 3).toLowerCase() !== day) return false;
    const start = Number(window.startMinute);
    const end = Number(window.endMinute);
    return Number.isFinite(start) && Number.isFinite(end) && minute >= start && minute < end;
  });
}
