// replay.test.ts v1.0
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSim } from '../src/normalize';
import { Replay, El, Host } from '../src/replay';
import { stepMs } from '../src/timeline';

function stub(speed = () => 1) {
  const els: Record<string, El> = {};
  const el = (): El => ({ innerHTML: '', textContent: '', ariaPressed: null, value: '', addEventListener: () => {} });
  for (const id of ['view', 'replay-status', 'replay-toggle', 'replay-restart']) els[id] = el();
  let now = 0; let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const host: Host = {
    dom: { id: (id) => els[id] ?? null, query: () => null },
    schedule: (fn, ms) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    cancel: (t) => { pending.delete(t as number); },
  };
  return {
    els, host, r: new Replay(host, speed),
    now: () => now,
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

const sim = normalizeSim(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sim.swarm.sample.json'), 'utf8')));

describe('replay del modo demo (motor)', () => {
  it('arranca con el resumen y no reproduce solo', () => {
    const s = stub();
    s.r.load(sim);
    expect(s.els['view'].innerHTML).toContain('Ahorro del mercado');
    expect(s.els['view'].innerHTML).toContain('Resultados verificados');
    expect(s.els['view'].innerHTML).not.toContain('data-round=');
    expect(s.els['replay-status'].textContent).toContain('pulsa reproducir');
    expect(s.r.running).toBe(false);
    expect(s.els['replay-toggle'].textContent).toBe('\u25b6 reproducir');
    expect(s.els['replay-toggle'].ariaPressed).toBe('false');
  });

  it('ignora un arranque duplicado mientras ya reproduce', () => {
    const s = stub();
    s.r.load(sim);
    s.r.start();
    s.r.start();
    expect(s.r.index).toBe(0);
    expect(s.els['replay-toggle'].ariaPressed).toBe('true');
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(1);
  });

  it('pinta ya el primer fotograma y luego avanza commit -> reveal -> cierre', () => {
    const s = stub();
    s.r.load(sim);
    s.r.start();
    expect(s.r.index).toBe(0);
    expect(s.els['view'].innerHTML).toContain('Coste por resultado verificado');
    s.advance(stepMs(1) - 1);
    expect(s.r.index).toBe(0);
    s.advance(2);
    expect(s.r.index).toBe(1);
    expect(s.els['view'].innerHTML).toContain('data-round="1"');
    expect(s.els['view'].innerHTML).toContain('abierta');
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(2);
    expect(s.els['view'].innerHTML).not.toContain('abierta');
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(3);
    expect(s.els['view'].innerHTML).toMatch(/cobrado|reembolsada/);
  });

  it('un cambio de velocidad reprograma el paso pendiente', () => {
    let speed = 1;
    const s = stub(() => speed);
    s.r.load(sim);
    s.r.start();
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(1);
    speed = 10;
    s.r.reschedule();
    s.advance(stepMs(10) + 1);
    expect(s.r.index).toBe(2);
    s.advance(stepMs(10) * 2);
    expect(s.r.index).toBe(4);
  });

  it('pausa y reanuda', () => {
    const s = stub();
    s.r.load(sim);
    s.r.start();
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(1);
    s.r.toggle();
    expect(s.r.running).toBe(false);
    expect(s.els['replay-toggle'].textContent).toBe('\u25b6 reproducir');
    expect(s.els['replay-toggle'].ariaPressed).toBe('false');
    s.advance(stepMs(1) * 3);
    expect(s.r.index).toBe(1);
    s.r.toggle();
    s.advance(stepMs(1) + 1);
    expect(s.r.index).toBe(2);
  });

  it('termina en el ultimo fotograma y toggle reinicia', () => {
    const s = stub();
    s.r.load(sim);
    s.r.start();
    s.advance(stepMs(1) * (s.r.length + 1) + 10);
    expect(s.r.index).toBe(s.r.length - 1);
    expect(s.r.running).toBe(false);
    expect(s.els['view'].innerHTML).toContain('worker-208');
    expect(s.els['view'].innerHTML).toContain('data-round="3"');
    s.r.toggle();
    expect(s.r.index).toBe(0);
    expect(s.r.running).toBe(true);
  });
});
