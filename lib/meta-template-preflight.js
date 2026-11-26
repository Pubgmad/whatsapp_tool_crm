import { AppError } from './db.js';

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Local checks that mirror Meta Cloud API template creation rules so we fail
 * before Graph with a clear message (avoids redeploy loops for policy rejects).
 */
export function assertMetaTemplateBodyRules(body, { field = 'body' } = {}) {
  const text = String(body || '').trim();
  if (!text) return { variableCount: 0 };

  const indexes = [];
  let match;
  const re = new RegExp(PLACEHOLDER.source, 'g');
  while ((match = re.exec(text))) indexes.push(Number(match[1]));

  if (!indexes.length) return { variableCount: 0 };

  const unique = [...new Set(indexes)].sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i += 1) {
    if (unique[i] !== i + 1) {
      throw new AppError(
        `Template ${field} variables must be sequential starting at {{1}} (found {{${unique.join('}}, {{')}}}).`,
        400,
        'TEMPLATE_VARIABLE_SEQUENCE'
      );
    }
  }

  if (/^\{\{\s*\d+\s*\}\}/.test(text)) {
    throw new AppError(
      `Template ${field} cannot start with a variable. Add fixed text before {{1}}.`,
      400,
      'TEMPLATE_VARIABLE_AT_START'
    );
  }

  const withoutTrailingPunct = text.replace(/[.!?…]+$/u, '').trimEnd();
  if (/\{\{\s*\d+\s*\}\}$/.test(withoutTrailingPunct)) {
    throw new AppError(
      `Template ${field} cannot end with a variable. Add a short fixed sentence after the last {{n}}.`,
      400,
      'TEMPLATE_VARIABLE_AT_END'
    );
  }

  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(text)) {
    throw new AppError(
      `Template ${field} cannot place two variables next to each other. Separate them with fixed words.`,
      400,
      'TEMPLATE_VARIABLE_ADJACENT'
    );
  }

  const stripped = text.replace(PLACEHOLDER, ' ');
  const variableCount = unique.length;
  const fixedWords = stripped
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  // Meta 2388293 is stricter than published partner docs; keep a conservative buffer.
  const minFixedWords = variableCount * 4 + 2;
  if (fixedWords.length < minFixedWords) {
    throw new AppError(
      `This template has too many variables for its length (Meta rule). Use fewer {{n}} placeholders or add more fixed wording in the ${field} (need about ${minFixedWords}+ words of fixed text for ${variableCount} variables).`,
      400,
      'TEMPLATE_VARIABLE_RATIO'
    );
  }

  return { variableCount, fixedWordCount: fixedWords.length };
}

export function assertMetaTemplateSubmissionRules({ body = '', headerText = '', category = '' } = {}) {
  if (String(category || '').toUpperCase() === 'AUTHENTICATION') return;
  assertMetaTemplateBodyRules(body, { field: 'body' });
  if (String(headerText || '').trim() && /\{\{/.test(String(headerText))) {
    throw new AppError(
      'Dynamic variables are not supported in the text header for this submit path. Keep variables in the body only.',
      400,
      'TEMPLATE_HEADER_VARIABLES'
    );
  }
}
