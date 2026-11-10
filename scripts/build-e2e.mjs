#!/usr/bin/env node
// Cross-platform: build the E2E variant (host access pre-granted for 127.0.0.1) into .output-e2e.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['wxt', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, RECALL_E2E: '1' },
});
process.exit(r.status ?? 1);
