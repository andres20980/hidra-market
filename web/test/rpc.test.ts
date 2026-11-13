// rpc.test.ts v1.1
import { describe, it, expect, vi, afterEach } from 'vitest';
import { near, bidNear, callView } from '../src/rpc';

describe('rpc.ts precision', () => {
  it('near() converts yocto string (reward) accurately', () => {
    expect(near('1000000000000000000000000')).toBe(1);
    expect(near('500000000000000000000000')).toBe(0.5);
    expect(near('100000000000000000000000')).toBe(0.1);
    expect(near('10000000000000000000000000')).toBe(10);
    expect(near('123456789012345678901234')).toBeCloseTo(0.123456789, 8);
  });

  it('bidNear() converts a u64 milliNEAR bid', () => {
    expect(bidNear(80)).toBe(0.08);
    expect(bidNear(300)).toBe(0.3);
  });

  it('near() converts yocto number accurately', () => {
    expect(near(1e23)).toBe(0.1);
    expect(near(1.5e23)).toBe(0.15);
  });
});

describe('callView errores legibles', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));

  it('HTTP 400 -> pide revisar el contrato', async () => {
    stub(400, {});
    await expect(callView('http://r', 'x.testnet', 'm')).rejects.toThrow(/rejected.*400.*contract id/);
  });
  it('HTTP 503 -> RPC caído', async () => {
    stub(503, {});
    await expect(callView('http://r', 'x.testnet', 'm')).rejects.toThrow(/down \(HTTP 503\)/);
  });
  it('result.error de cuenta inexistente -> contrato inexistente', async () => {
    stub(200, { result: { error: 'wasm execution failed: account x.testnet does not exist while viewing' } });
    await expect(callView('http://r', 'x.testnet', 'm')).rejects.toThrow(/contract does not exist/);
  });
});
