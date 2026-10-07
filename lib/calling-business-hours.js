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
  const timezone = String(value.timezone || 'UTC').slice(0, 64);
  const windows = Array.isArray(value.windows) ? value.windows : [];
  if (!alwaysOpen && windows.length > 8) {
    throw new AppError('At most 8 calling windows.', 400, 'VALIDATION_ERROR');
  }
  return { useSupportPolicy: false, alwaysOpen, timezone, windows };
}

export async function callingHoursOpen(businessId, supportPolicy, callingHours, at = new Date()) {
  const hours = validateCallingHours(callingHours || { useSupportPolicy: true });
  if (hours.useSupportPolicy) {
    if (!supportPolicy) return true;
    return supportIsOpen(validateSupportPolicy(supportPolicy));
  }
  if (hours.alwaysOpen) return true;
  if (!hours.windows.length) return true;
  const tz = hours.timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(at);
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
