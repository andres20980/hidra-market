// web.test.ts v0.2 — carga el fixture y comprueba que se pintan rondas y titular
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Sim, headline } from '../src/sim';
import { render, renderIntro, renderFooter, loadingSpinner, esc } from '../src/render';

const fixture = fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url));
const sim = JSON.parse(readFileSync(fixture, 'utf8')) as Sim;

describe('web demo', () => {
  it('esc neutraliza HTML de un id de contrato hostil', () => {
    expect(esc('<img src=x onerror=1>')).not.toContain('<');
  });
  it('pinta el titular de coste por resultado verificado', () => {
    expect(headline(sim)).toContain('Coste por resultado verificado');
    expect(headline(sim)).toContain('round-robin');
    expect(render(sim)).toContain(headline(sim));
  });
  it('el h1 no contradice los stats ni deja celdas vacías', () => {
    const html = render({ ...sim, rounds: sim.rounds.map((r) => ({ ...r, task: '', publisher: '' })) });
    expect(html).toMatch(/<h1>[^<]*<\/h1>/);
    expect(html).not.toContain('0.00 vs round-robin 0.00');
    expect(html).toContain('<td>—</td>');
  });
  it('etiqueta de puja sin prefijo worker- y nombre completo en title', () => {
    const html = render({ ...sim, rounds: [{ ...sim.rounds[0], bids: [{ worker: 'worker-32', revealed: false, reveal: '' } as any] }] });
    expect(html).toContain('<li title="worker-32">32:');
  });
  it('pujas en chips y CSS móvil con min-width en td li', () => {
    const html = render(sim);
    expect(html).toMatch(/<td[^>]*>\s*<ul>\s*<li/);
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/max-width: 480px\)[^}]*\}[^}]*td li \{ min-width: 5rem/);
    expect(css).toMatch(/td li \{ min-width: 5rem; max-width: 100%; white-space: normal; overflow-wrap: anywhere;/);
  });
  it('tabla de rondas en móvil conserva tarea y publicador con desplazamiento horizontal', () => {
    expect(render(sim)).toContain('<table class="rounds">');
    expect(render(sim)).toContain('<table class="workers">');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.table-wrap table \{ min-width: 34rem; \}/);
    expect(css).not.toMatch(/table\.rounds th:nth-child\(2\)[^}]*display: none/);
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
  it("envuelve las tablas en regiones desplazables accesibles por teclado", () => {
    const html = render(sim);
    expect((html.match(/class="table-wrap"/g) || []).length).toBe(2);
    expect((html.match(/role="region" aria-label="[^"]+" tabindex="0"/g) || []).length).toBe(2);
    expect(html).toContain('aria-label="Rondas; desplaza horizontalmente');
    expect(html).toContain('aria-label="Reputación de trabajadores; desplaza horizontalmente');
  });
  it('el resumen inicial muestra el ahorro del mercado y los totales', () => {
    const html = renderIntro(sim);
    const c = sim.meta.currency;
    expect(html).toContain('Ahorro del mercado');
    expect(html).toContain(`${sim.stats.marketCostPerVerified.toFixed(2)} ${c}`);
    expect(html).toContain(`${sim.stats.roundRobinCostPerVerified.toFixed(2)} ${c}`);
    expect(html).toContain(`>${sim.stats.verifiedResults}<`);
    expect(html).toContain(`>${sim.rounds.length}<`);
    expect(html).toContain('Arranca solo'); expect(html).toContain('reproducir');
    const saving = 1 - sim.stats.marketCostPerVerified / sim.stats.roundRobinCostPerVerified;
    expect(html).toContain(`${(saving * 100).toFixed(1)} %`);
  });
});

describe('estado de carga inicial', () => {
  it('renderFooter cierra bien el footer y loadingSpinner es un estado accesible', () => {
    expect(renderFooter()).toContain('</footer>');
    expect(renderFooter()).not.toContain('loadingSpinner');
    const s = loadingSpinner();
    expect(s).toContain('class="spinner"');
    expect(s).toContain('role="status"');
    expect(s).toContain('Cargando');
  });
});

describe('barra de stats', () => {
  it('no duplica los costes del titular/tarjetas y conserva verificados', async () => {
    const { renderToolbar } = await import('../src/render');
    const t = renderToolbar(sim);
    expect(t).not.toContain('Coste mercado');
    expect(t).not.toContain('Coste round-robin');
    expect(t).toContain(`Verificados: ${sim.stats.verifiedResults}`);
  });
});
