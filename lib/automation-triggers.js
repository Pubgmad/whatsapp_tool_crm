import { AppError } from './db.js';

export function safeRegex(pattern) {
  const value = String(pattern || '').trim();
  if (!value || value.length > 200 || /[()*+]|\\[1-9]|\\k<|\{\d+,\}/.test(value)) {
    throw new AppError('Regex triggers must use bounded, non-backtracking patterns.', 400, 'VALIDATION_ERROR');
  }
  for (const match of value.matchAll(/\{(\d+)(?:,(\d+))?\}/g)) {
    const minimum = Number(match[1]), maximum = Number(match[2] ?? match[1]);
    if (minimum > maximum || maximum > 100) throw new AppError('Regex trigger repetition is too large.', 400, 'VALIDATION_ERROR');
  }
  try { return new RegExp(value, 'iu'); } catch { throw new AppError('Regex trigger is invalid.', 400, 'VALIDATION_ERROR'); }
}
