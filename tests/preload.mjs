/**
 * When DATABASE_URL is set (local dev, CI), integration tests use it unless TEST_DATABASE_URL is explicit.
 */
if (process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
}
