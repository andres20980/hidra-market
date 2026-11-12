// timeline.test.ts v1.0
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSim } from '../src/normalize';
import { frames, stepMs, repOf } from '../src/timeline';
import { render, renderToolbar } from '../src/render';
import { headline } from '../src/sim';

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8'));

describe('timeline (replay del modo demo)', () => {
  it('genera apertura + commit/reveal/cierre por ronda + cierre final', () => {
    const sim = normalizeSim(load('sim.sample.json'));
    const fr = frames(sim);
    expect(fr).toHaveLength(1 + sim.rounds.length * 3 + 1);
    expect(fr[0].phase).toBe('apertura');
    expect(fr.at(-1)!.phase).toBe('cierre');
    expect(fr.at(-1)!.view.rounds).toHaveLength(sim.rounds.length);
    const phases = fr.map((f) => f.phase);
    expect(phases.slice(1, -1).every((p, i) => p === ['compromiso', 'revelado', 'cierre'][i % 3])).toBe(true);
  });

  it('oculta los compromisos antes del reveal y solo muestra el precio en el cierre', () => {
    const sim = normalizeSim(load('sim.swarm.sample.json'));
    const fr = frames(sim);
    const sealed = fr[1];
    expect(sealed.view.rounds[0].bids.every((b) => !b.revealed)).toBe(true);
    expect(sealed.view.rounds[0].winner).toBeNull();
    const revealed = fr[2];
    expect(revealed.view.rounds[0].bids.every((b) => b.revealed)).toBe(true);
    expect(revealed.view.rounds[0].closePrice).toBeNull();
    const closed = fr[3];
    const raw = sim.rounds[0];
    expect(closed.view.rounds[0].winner).toBe(raw.winner);
    expect(closed.view.rounds[0].closePrice).toBe(raw.closePrice);
  });

  it('la reputacion se mueve de forma monotona hacia los valores finales', () => {
    const sim = normalizeSim(load('sim.swarm.sample.json'));
    const fr = frames(sim);
    const last = fr.at(-1)!.view;
    const aWorker = last.workers[0].id;
    const seen: number[] = [];
    for (const f of fr) {
      const w = f.view.workers.find((x) => x.id === aWorker);
      if (w) seen.push(repOf(w));
    }
    expect(seen.length).toBeGreaterThan(1);
    const finalRep = repOf(last.workers.find((x) => x.id === aWorker)!);
    expect(seen.at(-1)).toBeCloseTo(finalRep, 6);
    expect(Math.max(...seen.map((v) => Math.abs(v - finalRep)))).toBeLessThan(1);
  });

  it('el ultimo fotograma reproduce la simulacion completa y el titular', () => {
    const sim = normalizeSim(load('sim.swarm.sample.json'));
    const fr = frames(sim);
    const html = render(fr.at(-1)!.view);
    expect(html).toContain(headline(fr.at(-1)!.view));
    expect(html).toContain(`data-round="${sim.rounds[0].id}"`);
    expect(html).toContain('worker-320');
    expect(renderToolbar(fr.at(-1)!.view, 3)).toContain('x3');
  });

  it('la velocidad acorta el paso y se acota a 1..10', () => {
    expect(stepMs(1)).toBeGreaterThan(stepMs(10));
    expect(stepMs(10)).toBeLessThanOrEqual(120);
    expect(stepMs(0)).toBe(1200);
    expect(stepMs(0.5)).toBe(2400);
    expect(stepMs(99)).toBe(120);
  });

  it('expone el selector de velocidad activo a lectores de pantalla', () => {
    const toolbar = renderToolbar(normalizeSim(load('sim.swarm.sample.json')), 2);
    expect(toolbar).toContain('data-speed="2" aria-pressed="true"');
    expect(toolbar).toContain('data-speed="1" aria-pressed="false"');
  });

  it('no muestra gasto ni cobro antes del cierre de la ronda (pago anticipado)', () => {
    const sim = normalizeSim(load('sim.swarm.sample.json'));
    const paid = sim.rounds.find((r) => (r.payment ?? 0) > 0)!;
    const i = sim.rounds.indexOf(paid);
    const fr = frames(sim);
    const commit = fr[1 + 3 * i];
    const reveal = fr[2 + 3 * i];
    const close = fr[3 + 3 * i];
    const spentBefore = sim.rounds.slice(0, i).reduce((s, r) => s + (r.payment ?? 0), 0);
    expect(commit.view.stats.totalSpent).toBe(spentBefore);
    expect(reveal.view.stats.totalSpent).toBe(spentBefore);
    expect(close.view.stats.totalSpent).toBe(spentBefore + paid.payment);
    const w = paid.winner!;
    expect(commit.view.workers.find((x) => x.id === w)?.earned ?? 0).toBe(0);
    expect(reveal.view.workers.find((x) => x.id === w)?.earned ?? 0).toBe(0);
    expect(close.view.workers.find((x) => x.id === w)?.earned).toBe(paid.payment);
  });
});
