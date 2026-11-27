/** Post-login marketing header primary action (workspace entry — not Meta connect). */
export function postLoginConnectWhatsApp(page) {
  return page.getByRole('banner').getByRole('link', { name: /Open workspace|Get started/i });
}

export function hasWorkspaceE2ECredentials() {
  return Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
}

export function hasBasicAuthCredentials() {
  return Boolean(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD);
}

export async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) throw new Error('Horizontal overflow detected');
}

export async function signInWorkspace(page, context = page.context(), {
  email = process.env.E2E_EMAIL,
  password = process.env.E2E_PASSWORD
} = {}) {
  const storagePath = process.env.E2E_STORAGE_STATE;
  if (storagePath) {
    // Cookies already applied via playwright storageState / test project.
    await page.goto('/app/dashboard');
    return;
  }
  if (process.env.E2E_SESSION_COOKIE && process.env.E2E_CSRF_COOKIE) {
    const base = process.env.E2E_BASE_URL || page.url() || 'http://127.0.0.1:13001';
    await context.addCookies([
      { name: 'wcrm_session', value: process.env.E2E_SESSION_COOKIE, url: base },
      { name: 'wcrm_csrf', value: process.env.E2E_CSRF_COOKIE, url: base }
    ]);
    await page.goto('/app/dashboard');
    return;
  }
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });
}

export function hasSessionE2ECredentials() {
  return Boolean(process.env.E2E_SESSION_COOKIE && process.env.E2E_CSRF_COOKIE) || Boolean(process.env.E2E_STORAGE_STATE);
}

export async function openWorkspaceApp(page) {
  const path = new URL(page.url()).pathname;
  if (path.startsWith('/app/')) return;
  const entry = postLoginConnectWhatsApp(page);
  if (await entry.count()) {
    await entry.click();
  } else {
    await page.goto('/app/dashboard');
  }
  await page.waitForURL(/\/app\//, { timeout: 60000 });
}

export async function gotoApp(page, path) {
  await page.goto(path);
  await page.waitForURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 60000 });
  await page.getByText('Unable to load this page').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}
