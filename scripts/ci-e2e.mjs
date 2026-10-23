import { spawn } from 'node:child_process';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const port = Number(process.env.E2E_PORT || 3100);
// Use localhost (not 127.0.0.1) so browser Origin matches Next request.url and APP_URL.
const base = `http://localhost:${port}`;
const e2eEnv = {
  ...process.env,
  E2E_BASE_URL: base,
  APP_URL: base,
  LOGIN_RATE_LIMIT: process.env.LOGIN_RATE_LIMIT || '1000'
};
process.env.E2E_BASE_URL = e2eEnv.E2E_BASE_URL;
process.env.APP_URL = e2eEnv.APP_URL;
process.env.LOGIN_RATE_LIMIT = e2eEnv.LOGIN_RATE_LIMIT;

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`))));
  });
}

async function waitForServer(timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${base}/login`, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server did not become ready at ${base}/login within ${timeoutMs}ms`);
}

const server = spawn('npm', ['run', 'start', '--', '-p', String(port)], {
  env: e2eEnv,
  stdio: 'inherit',
  shell: true
});

let exitCode = 1;
try {
  await waitForServer();
  await run('node', ['--import', './tests/preload.mjs', '--test', 'tests/production.integration.test.mjs']);
  await run('npx', ['playwright', 'test', 'e2e/a11y-public.spec.js', '--project=chromium-desktop']);
  await run('npx', ['playwright', 'test', 'e2e/workspace-mobile.spec.js', '--project=android']);
  exitCode = 0;
} catch (error) {
  console.error(error.message || error);
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    server.on('exit', resolve);
    setTimeout(resolve, 5000);
  });
  process.exit(exitCode);
}
