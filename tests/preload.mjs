/**
 * Integration tests only run when TEST_DATABASE_URL is set (or CI/local Postgres — see below).
 * Production DATABASE_URL on a VPS must never be auto-used for tests.
 */
function isLocalDatabaseUrl(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
  if (process.env.CI === 'true' || process.env.CI === '1' || isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
  }
}
