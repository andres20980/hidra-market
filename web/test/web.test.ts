// web.test.ts v0.2 — carga el fixture y comprueba que se pintan rondas y titular
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Sim, headline } from '../src/sim';
import { render, renderIntro, renderFooter, renderReplayToggle, renderSkipLink, loadingSpinner, esc } from '../src/render';

const fixture = fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url));
const sim = JSON.parse(readFileSync(fixture, 'utf8')) as Sim;

describe('web demo', () => {
  it('esc neutraliza HTML de un id de contrato hostil', () => {
    expect(esc('<img src=x onerror=1>')).not.toContain('<');
  });
  it('pinta el titular de coste por resultado verificado', () => {
    expect(headline(sim)).toContain('Cost per verified result');
    expect(headline(sim)).toContain('round-robin');
    expect(render(sim)).toContain(headline(sim));
  });
  it('nombra el control de reproducción como toggle con etiqueta estable', () => {
    const button = renderReplayToggle();
    expect(button).toContain('aria-label="play or pause the simulation"');
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain('>▶ play</button>');
  });
  it('ofrece un salto de teclado al contenido principal', () => {
    expect(renderSkipLink()).toContain('href="#view">Skip to main content</a>');
  });
  it('el destino del salto recibe foco y conserva un indicador visible', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(main).toMatch(/<main id="view" tabindex="-1">/);
    expect(css).toMatch(/#view:focus\s*\{\s*outline:\s*3px solid var\(--accent\)/);
  });
  it('muestra la divisa del mercado en el cobro de cada trabajador', () => {
    const currency = 'TST';
    const html = render({ ...sim, meta: { ...sim.meta, currency } });
    expect(html).toContain(`${sim.workers[0].earned.toFixed(2)} ${currency}`);
    expect(html).not.toContain('undefined');
  });
  it('el h1 no contradice los stats ni deja celdas vacías', () => {
    const html = render({ ...sim, rounds: sim.rounds.map((r) => ({ ...r, task: '', publisher: '' })) });
    expect(html).toMatch(/<h1[^>]*>[^<]*<\/h1>/);
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
    expect(render(sim)).toContain('<table class="rounds"');
    expect(render(sim)).toContain('<table class="workers"');
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
    expect(html).toContain('aria-label="Rounds; scroll horizontally');
    expect(html).toContain('aria-label="Worker reputation; scroll horizontally');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('.table-wrap:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }');
  });
  it('asocia todos los encabezados de tabla a sus columnas', () => {
    const html = render(sim);
    expect((html.match(/<th scope="col">/g) || []).length).toBe(12);
    expect(html).not.toMatch(/<th(?! scope="col">)[ >]/);
  });
  it('el resumen inicial muestra el ahorro del mercado y los totales', () => {
    const html = renderIntro(sim);
    const c = sim.meta.currency;
    expect(html).toContain('Market savings');
    expect(html).toContain(`${sim.stats.marketCostPerVerified.toFixed(2)} ${c}`);
    expect(html).toContain(`${sim.stats.roundRobinCostPerVerified.toFixed(2)} ${c}`);
    expect(html).toContain(`>${sim.stats.verifiedResults}<`);
    expect(html).toContain(`>${sim.rounds.length}<`);
    expect(html).toContain('Starts on its own'); expect(html).toContain('play');
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
    expect(s).toContain('Loading');
  });
});

describe('barra de stats', () => {
  it('no duplica los costes del titular/tarjetas y conserva verificados', async () => {
    const { renderToolbar } = await import('../src/render');
    const t = renderToolbar(sim);
    expect(t).not.toContain('Market cost');
    expect(t).not.toContain('Round-robin cost');
    expect(t).toContain(`Verified: ${sim.stats.verifiedResults}`);
    expect(t).toContain('role="group" aria-label="Playback controls"');
    expect(t).not.toContain('role="toolbar"');
  });
  it('mantiene los controles de velocidad en el orden de tabulación nativo', async () => {
    const { renderToolbar } = await import('../src/render');
    const t = renderToolbar(sim);
    const controls = t.match(/<button[^>]*data-speed="[^"]+"[^>]*>/g) ?? [];
    expect(controls.map((control) => control.match(/data-speed="([^"]+)"/)?.[1])).toEqual([
      '0.5', '1', '2', '3',
    ]);
    expect(controls.every((control) => /^<button type="button" /.test(control))).toBe(true);
    expect(t).not.toMatch(/tabindex="[1-9]\d*"/);
  });
});
describe('renderIntro con modo live', () => {
  it('muestra "Última actualización" cuando se pasa updatedAt', () => {
    const html = renderIntro(sim, '12:34');
    expect(html).toContain('Last update');
    expect(html).toContain('12:34');
  });
  it('no muestra "Última actualización" sin updatedAt', () => {
    const html = renderIntro(sim);
    expect(html).not.toContain('Last update');
  });
});
