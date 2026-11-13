// design.test.ts v1.0 — pins the v1.3 redesign: how-it-works, colored status chips, reputation bars, footer links
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, renderHowItWorks, renderFooter } from '../src/render';
import { DEMO_CONTRACT } from '../src/rpc';
import { Sim } from '../src/sim';

const sim = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/sim.sample.json', import.meta.url)), 'utf8')) as Sim;

describe('how it works', () => {
  const html = renderHowItWorks();
  it('lists the four lifecycle steps with icons', () => {
    expect(html).toContain('How it works');
    for (const t of ['Commit', 'Reveal', 'Attest', 'Pay / refund']) expect(html).toContain(t);
    expect((html.match(/<svg/g) ?? []).length).toBe(4);
  });
});

describe('round status chips', () => {
  const html = render(sim);
  it('renders colored chips, not bare text', () => {
    expect(html).toMatch(/class="chip (settled|refunded|open|closed)"/);
  });
});

describe('worker reputation bars', () => {
  const html = render(sim);
  it('shows a bar per worker instead of only a number', () => {
    expect(html).toContain('class="rep-fill"');
    expect((html.match(/class="rep-fill"/g) ?? []).length).toBe(sim.workers.length);
  });
});

describe('collapsible round details', () => {
  const html = render(sim);
  it('wraps the rounds table in a details/summary disclosure', () => {
    expect(html).toContain('<details class="round-details"');
    expect(html).toContain('worker-details');
    expect(html).toContain('<summary>Rounds</summary>');
    expect(html).toContain('<summary>Worker reputation</summary>');
    expect(html).not.toContain('<h2>Worker reputation</h2>');
    expect(html).toMatch(/<details[^>]*>[\s\S]*data-testid="rounds"[\s\S]*<\/details>/);
  });
});

describe('footer links', () => {
  const html = renderFooter();
  it('links repo, RULES, SECURITY and the testnet contract', () => {
    expect(html).toContain('github.com/andres20980/hidra-market');
    expect(html).toContain('RULES.md');
    expect(html).toContain('SECURITY.md');
    expect(html).toContain(DEMO_CONTRACT);
    expect(html).toContain('</footer>');
  });
});

import { describe as d2, it as i2, expect as e2 } from 'vitest';
import { render as rb } from '../src/render';
d2('empty state', () => {
  i2('shows text when no rows', () => {
    const sim: any = { meta: { currency: 'NEAR' }, rounds: [], workers: [], stats: { marketCostPerVerified: 0, roundRobinCostPerVerified: 0 } };
    let h = ''; h = rb(sim);
    e2(h).toContain('Round 1 is open');
    e2(h).not.toContain('No rounds yet');
    e2(h).toContain('class="live-dot" aria-hidden="true"');
  });
  i2('fills the empty state with shimmer skeleton rows', () => {
    const sim: any = { meta: { currency: 'NEAR' }, rounds: [], workers: [], stats: { marketCostPerVerified: 0, roundRobinCostPerVerified: 0 } };
    const h = rb(sim);
    e2((h.match(/skel-row/g) || []).length).toBe(4);
    e2(h).toContain('aria-hidden="true"');
  });
});

import { readFileSync as _rf } from 'node:fs';
describe('rounds mobile cards', () => {
  it('labels every round cell and stacks rounds as cards under 480px', () => {
    const css = _rf(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/table\.rounds td::before \{ content: attr\(data-label\)/);
    const src = _rf(new URL('../src/render.ts', import.meta.url), 'utf8');
    for (const l of ['#', 'task', 'publisher', 'bids', 'winner', 'price', 'status']) expect(src).toContain(`data-label="${l}"`);
  });
});

describe('bid cloud on phones', () => {
  it('marks bids beyond 5 as collapsible and adds a +N counter', () => {
    const r0 = sim.rounds[0];
    const many = { ...sim, rounds: [{ ...r0, bids: Array.from({ length: 10 }, (_, i) => ({ ...(r0.bids[0] ?? {}), worker: `worker-${i}` })) }] } as Sim;
    const html = render(many);
    expect((html.match(/<li class="x"/g) ?? []).length).toBe(5);
    expect(html).toContain('<li class="more" aria-hidden="true">+5</li>');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/table\.rounds td li\.x \{ display: none; \}/);
  });
});

describe('active round on phones', () => {
  it('flags the hot round row and highlights the whole card', () => {
    const id = sim.rounds[0].id;
    expect(render(sim, { round: id })).toMatch(/<tr data-round="\d+" class="flash"/);
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/table\.rounds tr\.flash \{ border-color: var\(--accent\)/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*table\.rounds tr, table\.rounds tr\.flash \{ transition: none; animation: none; \}/);
  });
});

describe('hero factor chip on phones', () => {
  it('never splits the "N× cheaper" chip across lines', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.factor-chip \{[^}]*white-space: nowrap; flex-shrink: 0;/);
  });
  it('packs hero guarantee tags into two rows on phones', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/@media \(max-width: 480px\) \{ \.hero-badges \{ gap: 0\.3rem; \} \.hero-badges li \{[^}]*white-space: nowrap;/);
  });
  it('fits phone controls in two rows with short labels', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.controls \.toolbar \{ flex-wrap: nowrap;/);
    expect(css).toMatch(/\.controls \.lbl-long \{ display: none; \}/);
  });

  it('keeps replay status on one line and the sandbox winner visible on phones', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.controls #sandbox-badge \{ flex: 1 1 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    expect(css).not.toMatch(/#sandbox-badge \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.controls #replay-status \{ flex: 1 1 100%; white-space: nowrap;/);
  });
});

describe('section rhythm', () => {
  it('separates the rounds and reputation cards and keeps the desktop sandbox badge unbroken', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('section:has(> .round-details) { margin-bottom: 1rem; }');
    expect(css).toContain('.how > h2 { margin-top: 0.25rem; }');
    expect(css).toMatch(/\.controls #sandbox-badge \{ flex: 1 1 100%; white-space: nowrap; \}/);
  });
});

describe('hero bars', () => {
  it('keeps the small market bar visible as a glowing dot', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('.bar-fill { min-width: 1.1rem; }');
    expect(css).toMatch(/\.bar-fill\.good \{[^}]*box-shadow:/);
  });
});
import { readFileSync as rf18 } from 'node:fs';
d2('live empty state', () => {
  i2('pulsing dot respects prefers-reduced-motion', () => {
    const css = rf18(new URL('../src/style.css', import.meta.url), 'utf8');
    e2(css).toMatch(/\.live-dot\s*\{[^}]*animation:\s*livepulse/);
    e2(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.live-dot\s*\{\s*animation:\s*none/);
  });
});

describe('worker leaderboard', () => {
  const many: Sim = { ...sim, workers: Array.from({ length: 20 }, (_, i) => ({ ...sim.workers[0], id: `worker-${i}`, earned: i === 13 ? 50 : 0, done: i === 13 ? 1 : 0, failed: 0 })) };
  const html = render(many);
  it('puts the top earner first and hides the tail behind a toggle', () => {
    expect(html.indexOf('data-worker="worker-13"')).toBeLessThan(html.indexOf('data-worker="worker-0"'));
    expect((html.match(/<tr data-worker="[^"]+" class="x"/g) ?? []).length).toBe(12);
    expect(html).toContain('data-action="all-workers"');
    expect(html).toContain('Show all 20 workers');
  });
  it('keeps the highlighted worker visible even outside the top rows', () => {
    expect(render(many, { worker: 'worker-19' })).toMatch(/data-worker="worker-19" class="flash"/);
  });
  it('hides tail rows only while the table is collapsed', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('#view:not(.all-workers) table.workers tr.x { display: none; }');
  });
});
