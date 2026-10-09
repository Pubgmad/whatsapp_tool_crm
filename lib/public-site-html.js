import * as cheerio from 'cheerio';
import { designMarkupSrcDoc, isDesignHtmlMessage } from './public-site-html-shared.js';

export { designMarkupSrcDoc, isDesignHtmlMessage };
export const DESIGN_HTML_MAX_CHARS = 200_000;

// Server-only sanitizer. Do not import this file from client components — use public-site-html-shared.js.
function fail() {
  const error = new Error('Invalid public site content.');
  error.status = 400;
  error.code = 'SITE_INVALID';
  throw error;
}

function allowResourceUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  if (value.startsWith('data:image/')) return true;
  if (value.startsWith('data:')) return false;
  if (value.startsWith('//')) return false;
  if (/^https:\/\//i.test(value)) return true;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('tel:')) return true;
  return false;
}

/**
 * Normalize pasted marketing HTML/CSS/JS for Super Admin design blocks.
 * Scripts are allowed only because rendering uses a sandboxed iframe (no parent access).
 */
export function sanitizeDesignMarkup(input) {
  if (typeof input !== 'string' || input.length > DESIGN_HTML_MAX_CHARS || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input)) fail();
  const trimmed = input.trim();
  if (!trimmed) fail();

  const $ = cheerio.load(trimmed);
  $('object,embed,applet,frame,frameset,base,iframe').remove();
  $('meta').each((_, element) => {
    if ((($(element).attr('http-equiv') || '').toLowerCase()) === 'refresh') $(element).remove();
  });

  $('script[src]').each((_, element) => {
    if (!allowResourceUrl($(element).attr('src'))) $(element).remove();
  });
  $('link').each((_, element) => {
    const rel = ($(element).attr('rel') || '').toLowerCase();
    if (rel !== 'stylesheet' || !allowResourceUrl($(element).attr('href'))) $(element).remove();
  });
  $('[src]').each((_, element) => {
    const src = $(element).attr('src');
    if (src && !allowResourceUrl(src) && element.tagName !== 'script') $(element).removeAttr('src');
  });
  $('a[href],area[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    if (/^\s*javascript:/i.test(href)) $(element).attr('href', '#');
  });

  const headExtras = [];
  $('head').children('style,link,script').each((_, element) => {
    headExtras.push($.html(element));
  });
  const body = $('body');
  const bodyHtml = body.length ? (body.html() || '') : '';
  const markup = `${headExtras.join('\n')}\n${bodyHtml || ($('html').length ? '' : $.root().html() || '')}`.trim();
  if (!markup) fail();
  return markup;
}
