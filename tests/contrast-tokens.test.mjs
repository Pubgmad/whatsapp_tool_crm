import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Relative luminance (sRGB), WCAG 2.x. */
function luminance(hex) {
  const raw = String(hex).replace('#', '').trim();
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(full, 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function readPaletteTokens() {
  const file = fs.readFileSync(path.join(process.cwd(), 'app', 'palette.css'), 'utf8');
  const root = file.split('[data-theme="dark"]')[0];
  const pick = (name) => {
    const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
    return match?.[1] || null;
  };
  return {
    ink: pick('text-primary') || pick('ink'),
    body: pick('text-secondary') || pick('ink-soft'),
    muted: pick('text-muted') || pick('muted'),
    canvas: pick('bg-primary') || pick('canvas'),
    surface: pick('bg-secondary') || pick('surface'),
    brand: pick('brand') || pick('cta'),
    softBlue: pick('surface-soft-blue') || pick('brand-soft') || pick('blue-soft')
  };
}

test('premium palette body and heading contrast meet WCAG AA on light surfaces', () => {
  const t = readPaletteTokens();
  assert.ok(t.ink && t.surface && t.canvas && t.brand && t.softBlue);

  assert.ok(contrastRatio(t.ink, t.surface) >= 4.5, `heading on white ${contrastRatio(t.ink, t.surface)}`);
  assert.ok(contrastRatio(t.ink, t.canvas) >= 4.5, `heading on canvas ${contrastRatio(t.ink, t.canvas)}`);
  assert.ok(contrastRatio(t.body || t.ink, t.surface) >= 4.5, `body on white`);
  assert.ok(contrastRatio(t.muted || t.body, t.surface) >= 4.5, `muted on white ${contrastRatio(t.muted, t.surface)}`);
  // White label on brand CTA
  assert.ok(contrastRatio('#ffffff', t.brand) >= 4.5, `white on brand ${contrastRatio('#ffffff', t.brand)}`);
  // Dark ink on soft blue Meta surfaces (the screenshot failure mode)
  assert.ok(contrastRatio(t.ink, t.softBlue) >= 4.5, `ink on soft blue ${contrastRatio(t.ink, t.softBlue)}`);
  // White on soft blue must FAIL — guards against regressions of the Meta hero bug
  assert.ok(contrastRatio('#ffffff', t.softBlue) < 3, 'white-on-pale-blue must remain insufficient');
});
