// live.test.ts v1.0 — el modo en vivo reintenta y avisa, nunca inventa datos
import { describe, it, expect } from 'vitest';
import { LivePoller, LiveHost } from '../src/live';
import { normalizeSim } from '../src/normalize';
import fs from 'node:fs';
import path from 'node:path';

function fakeHost() {
  let seq = 0;
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const host: LiveHost & { visible: () => boolean; setVisible: (v: boolean) => void } = {
    schedule: (fn, ms) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    cancel: (t) => { pending.delete(t as number); },
    visible: () => true,
    setVisible: (v) => { host.visible = () => v; },
  };
  return {
    host,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let next: { id: number; at: number; fn: () => void } | null = null;
        for (const [id, p] of pending) if (p.at <= target && (!next || p.at < next.at)) next = { id, at: p.at, fn: p.fn };
        if (!next) break;
        pending.delete(next.id); now = next.at; next.fn();
      }
      now = target;
    },
  };
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); };
const sim = normalizeSim(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sim.sample.json'), 'utf8')));

describe('refresco del modo en vivo', () => {
  it('pinta y reprograma el siguiente sondeo', async () => {
    const c = fakeHost();
    let loads = 0;
    const status: string[] = [];
    let painted = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s) },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; return sim; }, now: () => new Date(0) });
    p.start();
    await flush();
    expect(loads).toBe(1); expect(painted).toBe(1);
    expect(status[0]).toContain('en vivo'); expect(status[0]).toContain('actualizado');
    c.advance(10000);
    await flush();
    expect(loads).toBe(2);
    p.stop();
    c.advance(60000);
    expect(loads).toBe(2); expect(p.running).toBe(false);
  });

  it('ante error RPC conserva los datos y avisa del error', async () => {
    const c = fakeHost();
    const status: string[] = [];
    let painted = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s) },
      { intervalMs: 10000, label: 'en vivo', load: async () => { throw new Error('rpc caído') } });
    p.start();
    await flush();
    expect(painted).toBe(0); expect(p.failed).toBe(1);
    expect(status[0]).toContain('error de refresco');
    c.advance(10000);
    await flush();
    expect(p.failed).toBe(2);
    p.stop();
  });

  it('con la pestaña oculta no gasta RPC', async () => {
    const c = fakeHost();
    let loads = 0;
    const p = new LivePoller(c.host, { update: () => {}, status: () => {} },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; return sim; } });
    c.host.setVisible(false);
    p.start();
    await flush();
    expect(loads).toBe(0);
    c.advance(30000);
    expect(loads).toBe(0);
    p.stop();
  });

  it('al volver a mostrarse la pestaña retoma el sondeo en el siguiente intervalo', async () => {
    const c = fakeHost();
    let loads = 0;
    const p = new LivePoller(c.host, { update: () => {}, status: () => {} },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; return sim; } });
    c.host.setVisible(false);
    p.start();
    c.advance(20000);
    expect(loads).toBe(0);
    c.host.setVisible(true);
    c.advance(10000);
    await flush();
    expect(loads).toBe(1);
    p.stop();
  });
  it('refresh() carga ya, sin duplicar si hay carga en curso ni si está parado', async () => {
    const c = fakeHost();
    let loads = 0;
    const p = new LivePoller(c.host,
      { update: () => {}, status: () => {} },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; return sim; } });
    p.refresh();
    expect(loads).toBe(0);
    p.start();
    await flush();
    p.refresh();
    p.refresh();
    expect(loads).toBe(2);
    await flush();
    c.advance(10000);
    await flush();
    expect(loads).toBe(3);
  });
});
