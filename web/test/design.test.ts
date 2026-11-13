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
    expect(html).toContain('<summary>Show round details</summary>');
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
