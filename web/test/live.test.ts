// live.test.ts v1.1 — el modo en vivo reintenta y avisa, nunca inventa datos
import { describe, it, expect } from 'vitest';
import { LivePoller, LiveHost } from '../src/live';
import { Sim } from '../src/sim';
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
  it('no pinta ni anuncia una carga que termina después de detenerse', async () => {
    const c = fakeHost();
    const status: string[] = [];
    const announcements: string[] = [];
    let painted = 0;
    let finish!: (value: Sim) => void;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s), announce: (s) => announcements.push(s) },
      { intervalMs: 10000, label: 'en vivo', load: () => new Promise((resolve) => { finish = resolve; }) });
    p.start();
    p.stop();
    finish(sim);
    await flush();
    expect(painted).toBe(0);
    expect(status).toEqual([]);
    expect(announcements).toEqual(['en vivo · sondeo iniciado']);
  });

  it('pinta y reprograma el siguiente sondeo', async () => {
    const c = fakeHost();
    let loads = 0;
    const status: string[] = [];
    const announcements: string[] = [];
    let painted = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s), announce: (s) => announcements.push(s) },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; return sim; }, now: () => new Date(0) });
    p.start();
    await flush();
    expect(loads).toBe(1); expect(painted).toBe(1);
    expect(status[0]).toContain('en vivo'); expect(status[0]).toContain('actualizado');
    expect(announcements).toEqual(['en vivo · sondeo iniciado']);
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
    const announcements: string[] = [];
    let loads = 0;
    let painted = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s), announce: (s) => announcements.push(s) },
      { intervalMs: 10000, label: 'en vivo', load: async () => { loads += 1; if (loads < 3) throw new Error('rpc caído'); return sim; } });
    p.start();
    await flush();
    expect(painted).toBe(0); expect(p.failed).toBe(1);
    expect(status[0]).toContain('error de refresco');
    expect(announcements).toEqual(['en vivo · sondeo iniciado', 'en vivo · error de conexión, se reintenta']);
    c.advance(10000);
    await flush();
    expect(p.failed).toBe(2);
    expect(announcements).toHaveLength(2);
    c.advance(10000);
    await flush();
    expect(p.failed).toBe(0);
    expect(announcements).toEqual([
      'en vivo · sondeo iniciado',
      'en vivo · error de conexión, se reintenta',
      'en vivo · conexión recuperada',
    ]);
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

  it('si la huella del estado no cambia, el mercado no se repinta (0 DOM por sondeo)', async () => {
    const c = fakeHost();
    const status: string[] = [];
    let painted = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s), announce: () => {} },
      { intervalMs: 10000, label: 'en vivo', fingerprint: () => 'misma-huella', load: async () => sim });
    p.start();
    await flush();
    expect(painted).toBe(1);
    c.advance(10000);
    await flush();
    expect(painted).toBe(1);
    expect(status[1]).toContain('sin cambios');
    p.stop();
  });

  it('si la huella cambia, repinta y avisa de actualizacion', async () => {
    const c = fakeHost();
    const status: string[] = [];
    let painted = 0;
    let n = 0;
    const p = new LivePoller(c.host,
      { update: () => { painted += 1; }, status: (s) => status.push(s), announce: () => {} },
      {
        intervalMs: 10000, label: 'en vivo',
        fingerprint: (x) => String(x.stats.verifiedResults),
        load: async () => { n += 1; return { ...sim, stats: { ...sim.stats, verifiedResults: n } }; },
      });
    p.start();
    await flush();
    c.advance(10000);
    await flush();
    expect(painted).toBe(2);
    expect(status.every((t) => t.includes('actualizado'))).toBe(true);
    p.stop();
  });
});
