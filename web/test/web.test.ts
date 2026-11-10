// web.test.ts v0.1 — carga el fixture y comprueba que se pintan rondas y titular
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Sim, headline } from '../src/sim';
import { render } from '../src/render';

const fixture = fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url));
const sim = JSON.parse(readFileSync(fixture, 'utf8')) as Sim;

describe('web demo', () => {
  it('pinta el titular de coste por resultado verificado', () => {
    expect(headline(sim)).toContain('Coste por resultado verificado');
    expect(headline(sim)).toContain('round-robin');
    expect(render(sim)).toContain(headline(sim));
  });
  it('pinta todas las rondas del fixture', () => {
    const html = render(sim);
    for (const r of sim.rounds) expect(html).toContain(`data-round="${r.id}"`);
    expect(html).toContain('worker-3');
  });
  it('pinta la reputación de cada trabajador', () => {
    const html = render(sim);
    for (const w of sim.workers) expect(html).toContain(`data-worker="${w.id}"`);
  });
});
