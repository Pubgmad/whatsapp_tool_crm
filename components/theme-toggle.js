'use client';

import { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export const WCRM_THEME_KEY = 'wcrm_theme';
const MODES = ['system', 'light', 'dark'];

function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyThemePreference(mode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(mode));
}

function readStoredMode() {
  try {
    const value = localStorage.getItem(WCRM_THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* ignore */
  }
  // Light is the product default; users can still opt into system or dark.
  return 'light';
}

const MODE_LABELS = {
  system: 'Theme: system (click for light)',
  light: 'Theme: light (click for dark)',
  dark: 'Theme: dark (click for system)'
};

export default function ThemeToggle({ className = 'iconButton' }) {
  const [mode, setMode] = useState('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredMode();
    setMode(stored);
    applyThemePreference(stored);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemePreference('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, mounted]);

  const cycle = useCallback(() => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    setMode(next);
    try {
      localStorage.setItem(WCRM_THEME_KEY, next);
    } catch {
      /* ignore */
    }
    applyThemePreference(next);
  }, [mode]);

  const Icon = !mounted ? Sun : mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  const label = MODE_LABELS[mode] || MODE_LABELS.system;

  return (
    <button type="button" className={className} onClick={cycle} title={label} aria-label={label}>
      <Icon size={18} aria-hidden />
    </button>
  );
}
