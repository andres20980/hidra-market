// sandbox.test.ts v1.1
import { describe, it, expect } from 'vitest';
import { sandboxBadge, loadSandboxBadge } from '../src/sandbox';

describe('sandbox badge', () => {
  const ok = { network: 'near-sandbox', market: 'm.test.near', winner: 'w0.test.near', state: 'Settled' };
  it('renders for settled sandbox round', () => expect(sandboxBadge(ok)).toContain('settled on near-sandbox'));
  it('renders for closed sandbox round', () => expect(sandboxBadge({ ...ok, state: 'Closed' })).toContain('closed on near-sandbox'));
  it('empty for invalid', () => { expect(sandboxBadge(null)).toBe(''); expect(sandboxBadge({ ...ok, state: 'Open' })).toBe(''); });
  it('empty on fetch failure', async () => expect(await loadSandboxBadge((async () => { throw new Error('x'); }) as never)).toBe(''));
});
