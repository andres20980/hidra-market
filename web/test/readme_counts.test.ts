// readme_counts.test.ts v1.2
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

// LIVE_CONTRACT is forced on so the skipIf-gated live-RPC test is always listed: the count no longer depends on the caller's env.
function listed(dir: string): number {
  const out = execFileSync('npx', ['vitest', 'list', '--json'], {
    cwd: resolve(root, dir),
    env: { ...process.env, LIVE_CONTRACT: 'listing-only' },
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return (JSON.parse(out.slice(out.indexOf('['))) as unknown[]).length;
}

it('README test counts match the real suites (N+1: swarm source-ledger test needs HIDRA_LEDGERS_ROOT, web live-RPC test needs LIVE_CONTRACT)', () => {
  const m = readme.match(/(\d+)\+1 swarm tests[^|]*?(\d+)\+1 web tests/);
  expect(m, 'README must state "N+1 swarm tests" and "N+1 web tests"').not.toBeNull();
  expect({ swarm: Number(m![1]) + 1, web: Number(m![2]) + 1 }).toEqual({ swarm: listed('swarm'), web: listed('web') });
}, 180_000);
