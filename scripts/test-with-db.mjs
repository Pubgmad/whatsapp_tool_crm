import { spawn } from 'node:child_process';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env.local or the environment before running test:db.');
  process.exit(1);
}

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true, env: process.env });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

await run('node', ['scripts/db-init.mjs']);
await run('node', ['--import', './tests/preload.mjs', '--test', 'tests/*.test.mjs']);
