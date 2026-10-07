import { getPlatformSettingValue } from './platform.js';

export const A11Y_E2E_PROJECTS = Object.freeze([
  'chromium-desktop',
  'firefox-desktop',
  'webkit-desktop',
  'android',
  'iphone'
]);

export const A11Y_BASELINE_CHECKS = Object.freeze([
  { id: 'login_labels', label: 'Login form has associated labels' },
  { id: 'mobile_nav', label: 'Mobile workspace navigation is keyboard reachable' },
  { id: 'main_landmarks', label: 'Workspace views expose headings and primary actions' },
  { id: 'alert_roles', label: 'Errors use role=alert or status regions' }
]);

export async function platformA11yCertificationStatus() {
  const lastRun = await getPlatformSettingValue('a11y_e2e_last_run', null);
  const projects = await getPlatformSettingValue('a11y_e2e_projects_passed', []);
  const passedSet = new Set(Array.isArray(projects) ? projects : []);
  const projectChecks = A11Y_E2E_PROJECTS.map((project) => ({
    id: project,
    label: project,
    pass: passedSet.has(project)
  }));
  const baselinePass = A11Y_BASELINE_CHECKS.every((item) => passedSet.has(item.id));
  const allProjectsPass = A11Y_E2E_PROJECTS.every((project) => passedSet.has(project));
  return {
    certified: Boolean(lastRun) && allProjectsPass && baselinePass,
    lastRunAt: lastRun || null,
    projects: projectChecks,
    baseline: A11Y_BASELINE_CHECKS.map((item) => ({ ...item, pass: passedSet.has(item.id) })),
    operatorNote:
      'Run npm run test:e2e on CI or your VPS. Playwright records pass markers via A11Y_E2E_REPORT=1 to platform_settings.'
  };
}
