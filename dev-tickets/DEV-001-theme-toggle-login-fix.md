# DEV-001 — ThemeToggle import on login screen

**Status:** Done (on `feature/dev`)  
**Priority:** P0 (blocker for local QA)  
**Type:** Bug fix  

## Problem

`/login` crashed with `ReferenceError: ThemeToggle is not defined` in `AuthScreen` (`components/workspace-app.js`). Super Admin auth already imported `ThemeToggle`; company auth did not.

## Change

Add `import ThemeToggle from './theme-toggle';` in `components/workspace-app.js`.

## Acceptance criteria

- [x] `/login` and `/signup` render without segment error boundary
- [x] Theme toggle visible on auth shell

## References

- `components/super-admin-app.js` (working pattern)
- Local fix during Fazil onboarding session 2026-10-23
