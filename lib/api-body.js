import { AppError } from './db.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function requireObject(body, code = 'VALIDATION_ERROR') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object.', 400, code);
  }
  return body;
}

export function requireStringField(body, field, { min = 1, max = 2000, code = 'VALIDATION_ERROR' } = {}) {
  const value = clean(body[field]);
  if (value.length < min || value.length > max) {
    throw new AppError(`Field ${field} must be between ${min} and ${max} characters.`, 400, code);
  }
  return value;
}

export function requireEnumField(body, field, allowed, code = 'VALIDATION_ERROR') {
  const value = clean(body[field]);
  if (!allowed.includes(value)) {
    throw new AppError(`Field ${field} is invalid.`, 400, code);
  }
  return value;
}

export function optionalPositiveInt(body, field, { max = 365, fallback = 0 } = {}) {
  if (body[field] === undefined || body[field] === null || body[field] === '') return fallback;
  const value = Number(body[field]);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new AppError(`Field ${field} must be an integer from 0 to ${max}.`, 400, 'VALIDATION_ERROR');
  }
  return value;
}
