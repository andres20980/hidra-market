// task_to_round.test.ts v1.1
import { describe, it, expect } from 'vitest';
import { taskToRound } from '../src/rpc';

const base = { id: 't', publisher: 'p', verifier: 'v', reward: '1000000000000000000000000', commit_end: 1, reveal_end: 2,
  commitments: [] as any[], bids: [] as any[], winner: null as string | null, result_hash: null as string | null };

describe('taskToRound', () => {
  it('reveal without commit is kept as revealed bid with empty commit', () => {
    const r = taskToRound({ ...base, state: 'Revealing', bids: [{ worker: 'x', price: 300 }] } as any, 0);
    expect(r.bids).toEqual([{ worker: 'x', commit: '', reveal: 0.3, revealed: true }]);
    expect(r.status).toBe('closed');
  });
  it('commit without reveal stays unrevealed', () => {
    const r = taskToRound({ ...base, state: 'Open', commitments: [{ worker: 'y', hash: 'h' }] } as any, 2);
    expect(r.bids[0].revealed).toBe(false);
    expect(r.bids[0].reveal).toBeUndefined();
    expect(r.id).toBe(3);
    expect(r.status).toBe('open');
  });
  it('Refunded maps to refunded, not verified nor paid', () => {
    const r = taskToRound({ ...base, state: 'Refunded', winner: 'x', bids: [{ worker: 'x', price: 300 }] } as any, 0);
    expect(r.status).toBe('refunded');
    expect(r.verified).toBe(false);
    expect(r.paid).toBe(false);
    expect(r.payment).toBe(0);
  });
  it('Closed without attest is closed, unverified and unpaid', () => {
    const r = taskToRound({ ...base, state: 'Closed', winner: 'x', bids: [{ worker: 'x', price: 300 }] } as any, 0);
    expect(r.status).toBe('closed');
    expect(r.closePrice).toBe(0.3);
    expect(r.verified).toBe(false);
    expect(r.paid).toBe(false);
    expect(r.payment).toBe(0);
  });
});
