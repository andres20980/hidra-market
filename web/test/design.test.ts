// design.test.ts v1.60 — pins the redesign: how-it-works, status chips, reputation bars, footer, a11y
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, renderHowItWorks, renderFooter, setWorkersExpanded, acct } from '../src/render';
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
    expect(html).not.toContain('Closed unpaid');
    expect(html).toContain('src-tag');
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
    expect(html).toMatch(/<summary>Rounds <span class="src-tag src-(sim|live)"/);
    expect(html).toMatch(/<details class="round-details worker-details"><summary>Worker reputation <span class="sum-hint">\d+ agents · Beta score<\/span><\/summary>/);
    expect(html).toMatch(/<details class="round-details" open><summary>Rounds/);
    expect(html).toMatch(/<\/summary><p class="rounds-note">Most rounds end <strong>Refunded<\/strong> by design/);
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
    expect(html).toContain('NEAR Hackathon 2026');
    expect(html).not.toMatch(/Hackaton/);
    expect(html).toContain('<span class="foot-sep"> · </span>');
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
    const won = { ...sim, rounds: [{ ...r0, winner: 'worker-9', bids: Array.from({ length: 10 }, (_, i) => ({ ...(r0.bids[0] ?? {}), worker: `worker-${i}`, revealed: true, reveal: 10 + i })) }] } as Sim;
    const wh = render(won);
    expect(wh).toMatch(/<li class="win" title="worker-9: 19">/);
    expect(wh).toContain('adj. price</abbr>');
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

  it('shows the full replay status on two reserved lines and the sandbox winner visible on phones', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.controls #sandbox-badge \{ flex: 1 1 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
    expect(css).not.toMatch(/#sandbox-badge \{[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.controls #replay-status \{ flex: 1 1 100%; white-space: normal;[^}]*min-height: 2\.8em;[^}]*-webkit-line-clamp: 2;/);
    expect(css).not.toMatch(/#replay-status \{[^}]*text-overflow: ellipsis/);
  });
});

describe('section rhythm', () => {
  it('separates the rounds and reputation cards and keeps the desktop sandbox badge unbroken', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('section:has(> .round-details) { margin-bottom: 1rem; }');
    expect(css).toContain('.how > h2, .intro > h2 { margin-top: 0; }');
    expect(css).toContain('.how { margin: 1rem 0; padding: 1rem; }');
    expect(css).toMatch(/#app \{[^}]*padding: 0\.75rem 0\.75rem 0;/);
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
    // verifier-judged workers rank above untouched 0.50 priors when nobody has earned yet
    const judged: Sim = { ...sim, workers: Array.from({ length: 20 }, (_, i) => ({ ...sim.workers[0], id: `worker-${i}`, alpha: 1, beta: i === 17 ? 2 : 1, earned: 0, done: 0, failed: i === 17 ? 1 : 0 })) };
    const out = render(judged);
    expect(out.indexOf('data-worker="worker-17"')).toBeLessThan(out.indexOf('data-worker="worker-0"'));
  });
  it('keeps the highlighted worker visible even outside the top rows', () => {
    expect(render(many, { worker: 'worker-19' })).toMatch(/data-worker="worker-19" class="flash"/);
  });
  it('hides tail rows only while the table is collapsed', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('#view:not(.all-workers) table.workers tr.x { display: none; }');
  });
});

describe('design: static jury sections', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  it('lays out red-team findings as cards and keeps commands scrollable inside their box', () => {
    expect(css).toMatch(/#red-team-list \{[^}]*display: grid;/);
    expect(css).toMatch(/#reproduce-commands \{[^}]*overflow-x: auto;/);
    expect(css).toMatch(/body > section \{[^}]*max-width:/);
  });
});

describe('design: why you can trust it', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  it('shows three stat cards with real figures before the red-team details', () => {
    const trust = html.slice(html.indexOf('id="trust"'), html.indexOf('id="red-team"'));
    expect(trust).toContain('Why you can trust it');
    expect(trust.match(/class="trust-num"/g)).toHaveLength(3);
    for (const n of ['>111<', '>3<', '>8 + 6<']) expect(trust).toContain(n);
    expect(trust).toContain('https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet');
    expect(css).toMatch(/#trust-cards \{[^}]*display: grid;/);
  });
  it('renders the footer after the static sections, not inside #app', () => {
    expect(main).not.toMatch(/renderHowItWorks\(\) \+ renderFooter\(\)/);
    expect(main).toContain("insertAdjacentHTML('afterend', renderFooter())");
  });
});

describe('accessibility polish', () => {
  const many: Sim = { ...sim, workers: Array.from({ length: 20 }, (_, i) => ({ ...sim.workers[0], id: `worker-${i}` })) };
  it('exposes the leaderboard toggle state through aria-expanded across re-renders', () => {
    expect(render(many)).toContain('aria-expanded="false"');
    setWorkersExpanded(true);
    expect(render(many)).toContain('aria-expanded="true"');
    setWorkersExpanded(false);
  });
  it('neutralises every animation and transition under prefers-reduced-motion', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after \{[^}]*animation-duration: 0\.01ms !important[^}]*transition-duration: 0\.01ms !important/);
  });
});

describe('single live CTA', () => {
  it('hides the toolbar Live link when the hero already shows it', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.hero ~ \.controls \.btn-live \{ display: none; \}/);
  });
});

describe('how it works on phones', () => {
  it('packs the four steps into a 2x2 grid at 480 px and below', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.how-steps { grid-template-columns: repeat(2, minmax(0, 1fr));');
  });
});

describe('worker leaderboard at 375 px', () => {
  it('fits the five columns without horizontal scroll (fixed layout, show-all row spans the table)', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.table-wrap table.workers { table-layout: fixed; }');
    expect(css).toContain('table.workers tr.more-row td { display: table-cell; }');
  });
});

describe('worker leaderboard on desktop', () => {
  it('caps the rep bar and right-aligns numeric columns', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('table.workers .rep-track { max-width: 8rem; }');
    expect(css).toMatch(/table\.workers td:nth-child\(n\+3\) \{ text-align: right;/);
  });
  it('fixes column widths on wide screens so the rep bar has no dead gap', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(min-width: 481px\) \{\s*table\.workers \{ table-layout: fixed; \}/);
    expect(css).toContain('table.workers th:nth-child(2) { width: 22%; }');
  });
});

describe('empty round columns', () => {
  const r0 = sim.rounds[0];
  it('hides task/publisher columns when no round carries them', () => {
    const h = render({ ...sim, rounds: [{ ...r0, task: '', publisher: '' }] } as Sim);
    expect(h).toContain('class="rounds no-task no-publisher"');
  });
  it('starts hidden before the first round (no layout jump)', () => {
    const h = render({ ...sim, rounds: [] } as Sim);
    expect(h).toContain('class="rounds no-task no-publisher"');
  });
  it('keeps the columns when data is present', () => {
    const h = render({ ...sim, rounds: [{ ...r0, task: 'sum', publisher: 'alice.testnet' }] } as Sim);
    expect(h).toContain('class="rounds" data-testid="rounds"');
  });
});

describe('rounds list height', () => {
  it('renders newest round first', () => {
    const h = render(sim);
    const ids = [...h.matchAll(/data-round="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids[0]).toBeGreaterThanOrEqual(ids[ids.length - 1]);
  });
  it('caps the rounds table height with a vertical scroll', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toContain('.round-details:not(.worker-details) > .table-wrap { max-height: 26rem; overflow-y: auto;');
  });
});

describe('bid cloud', () => {
  it('collapses to 5 chips + "+N" on every width', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/^table\.rounds td li\.x \{ display: none; \}/m);
    expect(css).toMatch(/^table\.rounds td li\.more \{ display: inline-block;/m);
  });
});

describe('sandbox proof chip', () => {
  it('styles the near-sandbox badge as a separate pill, not as replay status text', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.controls #sandbox-badge\.status \{ flex: 0 1 auto;[^}]*border: 1px solid[^}]*border-radius: 999px;/);
    expect(css).toContain('.controls #sandbox-badge.status::before { content: "contract e2e');
  });
  it('watch-replay link jumps smoothly to the replay card with top margin', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/html \{ scroll-behavior: smooth; \}/);
    expect(css).toMatch(/#replay \{ scroll-margin-top: 5rem; \}/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*scroll-behavior: auto !important/);
  });
});
describe('footer on phones', () => {
  it('stacks credit and links centered at 375 px', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/max-width: 480px\) \{ \.footer-content \{ flex-direction: column; align-items: center;/);
  });
});
describe('playback card order', () => {
  it('puts play/restart before speed/theme in DOM (focus order) and moves the divider to the toolbar', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main.indexOf('id="replay-restart"')).toBeLessThan(main.indexOf('renderToolbar(sim, currentSpeed)'));
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.controls \.toolbar \{ margin: 0; padding-top: 0\.65rem; border-top: 1px solid var\(--line\); \}/);
  });
});
describe('trust card commands', () => {
  it('keeps inline commands on one line at 375 px', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('.trust-note code { white-space: nowrap; }');
  });
  describe('sandbox chip wrap', () => {
    it('keeps near-sandbox whole and the separator visible on phones', () => {
      const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
      expect(main).toContain(`.replace(' · ', ' <span class="sb-sep" aria-hidden="true">·</span> ')`);
      const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
      expect(main).toContain(`.replace('on near-sandbox', 'on <span class="nw">near-sandbox</span>')`);
      expect(css).toContain('.controls #sandbox-badge.status { overflow-wrap: normal; }');
      expect(css).not.toContain('.sb-sep { display: none; }');
    });
  });
});
describe('round flash per theme', () => {
  it('uses a softer highlight in light theme than in dark', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('--flash: color-mix(in srgb, var(--accent) 14%, transparent);');
    expect(css).toContain('--flash: color-mix(in srgb, var(--accent) 22%, transparent);');
    expect(css).toContain('@keyframes flash { from { background: var(--flash); }');
  });
});

describe('reproduce commands on phones', () => {
  it('splits command and comment so phones show the comment on its own line', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(html.match(/<span class="cmd">[^<]+<\/span><span class="note"># [^<]+<\/span>/g)?.length).toBe(3);
    expect(css).toMatch(/@media \(max-width: 480px\) \{\s*#reproduce-commands \.cmd[^}]*\}\s*#reproduce-commands \.note \{[^}]*display: block;/);
  });
});

describe('reproduce commands size', () => {
  it('keeps the inner code at the pre size instead of 0.8em of 0.8rem', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/#reproduce-commands code \{ font-size: inherit; \}/);
  });
});

describe('inline code in section cards', () => {
  it('keeps test paths and commands legible (>= 0.9em, not 0.8em)', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const m = css.match(/body > section code \{ font: ([\d.]+)em var\(--mono\);/);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(0.9);
  });
});

describe('red team test paths', () => {
  it('break only at path separators on phones (<wbr> after each /)', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const paths = [...html.matchAll(/<code>(contract\/[^<]*(?:<wbr>[^<]*)*)<\/code>/g)].map(m => m[1]);
    expect(paths.length).toBe(3);
    for (const p of paths) expect(p).toMatch(/^contract\/<wbr>tests\/<wbr>test_\w+\.rs$/);
  });
});

describe('skeleton alignment', () => {
  it('centres skeleton bars and fills the reputation track', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.skel-row td > \.skel \{ display: block; \}/);
    expect(css).toMatch(/\.rep-track > \.skel \{ display: block; height: 100%; \}/);
  });
});

describe('reputation baseline', () => {
  it('aligns the reputation number with the other worker cells', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/table\.workers td \{ vertical-align: baseline; \}/);
    expect(css).toMatch(/\.rep \{ display: flex; align-items: baseline;/);
    expect(css).toMatch(/\.rep > \.rep-track \{ align-self: center; \}/);
  });
  it("hero badges fit one line on desktop", () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.hero \{ grid-template-columns: 1\.3fr 1fr;/);
    expect(css).toMatch(/\.hero-badges li \{ font: 0\.68rem var\(--mono\);/);
  });
  it("toolbar speed segment and theme toggle share one height", () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.controls \.toolbar \.speed-controls, \.controls \.toolbar #theme-toggle \{ box-sizing: border-box; height: 2\.05rem; \}/);
    expect(css).toMatch(/\.controls \.toolbar \.speed-controls \.btn-speed \{ height: 100%; \}/);
  });
  it("worker header unit is screen-reader only on phones", () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(max-width: 480px\) \{ table\.workers th \.unit \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0 0 0 0\);/);
  });
  it("hero figure label never splits; chip wraps whole", () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.hero-figure-head \{ flex-wrap: wrap; row-gap: 0\.4rem; \}/);
    expect(css).toMatch(/\.hero-figure-head \.k \{ white-space: nowrap; \}/);
    expect(css).toMatch(/\.hero-figure-head \.k \{ font-size: 0\.72rem; letter-spacing: 0\.01em; \}/);
  });
});

describe('earned unit shown once', () => {
  it('cell currency is visually hidden (header carries the unit), still read by screen readers', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).toMatch(/table\.workers td \.cur \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0 0 0 0\);/);
    expect(css).not.toMatch(/table\.workers \.cur \{ display: none; \}/);
  });
});

describe('round card header on phones', () => {
  it('shows "Round N" as the card header instead of a "#" form row', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/table\.rounds td\[data-label="#"\]::before \{ content: "Round "/);
  });
});

describe('hero CTAs on phones', () => {
  it('stretches both hero buttons to equal full-width rows when they wrap', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.hero-cta \.btn \{[^}]*flex: 1 1 auto; justify-content: center;/);
  });
});

describe('hero CTAs equal width when stacked on tablets', () => {
  it('gives both hero buttons a shared min-width and resets it on phones', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.hero-cta \.btn \{ min-width: 13\.7rem; justify-content: center; \}/);
    expect(css).toMatch(/flex: 1 1 auto; justify-content: center; min-width: 0; \}/);
  });
});

describe('how it works grid never leaves an orphan card', () => {
  it('uses 2 columns below 900px and 4 above (no 3+1 at tablet widths)', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.how-steps \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(min-width: 900px\) \{ \.how-steps \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/);
  });
});

describe('trust and red-team grids never leave an orphan card', () => {
  it('stack in 1 column and switch to 3 from 720px (no 2+1)', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/#red-team-list \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/#trust-cards \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(min-width: 720px\) \{ #trust-cards, #red-team-list \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
  });
});

describe('footer links never orphan on phones', () => {
  it('lays the 4 footer links out as a 2x2 grid at <=480px', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/max-width: 480px\) \{ \.footer-links \{ display: grid; grid-template-columns: repeat\(2, auto\)/);
  });
});

describe('red-team tx links aligned at the card bottom', () => {
  it('wraps each testnet line in .rt-tx pushed down with margin-top auto', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    expect(css).toMatch(/#red-team-list li \{ display: flex; flex-direction: column; \}/);
    expect(css).toMatch(/#red-team-list \.rt-tx \{ display: block; margin-top: auto;/);
    expect(html.match(/<span class="rt-tx">Testnet:[^<]*<a href="https:\/\/testnet\.nearblocks\.io\/txns\//g)?.length).toBe(3);
    expect(html.match(/<\/strong> <span class="rt-desc">/g)?.length).toBe(3);
  });
  it('testnet line reads as a card footer with a divider', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/#red-team-list \.rt-tx \{[^}]*border-top: 1px solid var\(--line\);/);
    expect(css).toMatch(/#red-team-list \.rt-desc \{ margin-bottom: 0\.75rem; \}/);
  });
  it('control card is a single row on desktop', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/@media \(min-width: 900px\) \{\s*\.controls \{ flex-direction: row;/);
    expect(css).toMatch(/\.controls \.toolbar \{ flex: 0 0 auto; flex-wrap: nowrap; padding-top: 0; border-top: 0; \}/);
  });
  it('round prices are mono figures', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/table\.rounds td\[data-label="price"\] \{ font-family: var\(--mono\); font-variant-numeric: tabular-nums; \}/);
    expect(css).toMatch(/table\.rounds th:nth-child\(6\), table\.rounds td\[data-label="price"\] \{ text-align: right;/);
  });
});

describe('live testnet accounts', () => {
  it('shows the first label of long sub-accounts, keeps the full id for screen readers and title', () => {
    const h = acct('worker-2.hidra-mkt-221016.testnet');
    expect(h).toBe('<span class="acct" title="worker-2.hidra-mkt-221016.testnet">worker-2<span class="sr-only">.hidra-mkt-221016.testnet</span></span>');
    expect(acct('a.testnet')).toBe('a.testnet');
    expect(acct('worker-0')).toBe('worker-0');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.acct \{ white-space: nowrap; position: relative; \}/);
    expect(css).toMatch(/table\.rounds td\[data-label="task"\] \{ white-space: normal; overflow-wrap: anywhere;/);
  });
  it('hero figure keeps decimals for sub-NEAR live costs', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/render.ts', import.meta.url)), 'utf8');
    expect(src).toContain('v.toFixed(v >= 10 ? 0 : v >= 1 ? 1 : 2)');
    expect(src).toContain('(v / r.perRunUsd) * 100');
  });
});

describe('live intro copy', () => {
  it('live view drops the replay hint and titles itself live', async () => {
    const { renderIntro } = await import('../src/render');
    const html = renderIntro(sim, '12:34');
    expect(html).toContain('Live market');
    expect(html).not.toContain('Starts on its own');
    expect(html).toContain('refreshes every 10 s');
    expect(renderIntro(sim)).toContain('Starts on its own');
  });
  it('intro title has no top gap inside its card', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('.intro > h2 { margin-top: 0; }');
  });
});

describe('live controls', () => {
  it('live view swaps dead replay controls for a way back to the demo', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(main).toContain("controls${live ? ' is-live' : ''}");
    expect(main).toContain('↺ Back to replay');
    expect(css).toContain('.controls.is-live .speed-controls { display: none; }');
  });
  it('live theme toggle shares the row with Back to replay below 900 px', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/max-width: 899px\) \{\s*\.controls\.is-live \{ flex-direction: row;/);
    expect(css).toContain('.controls.is-live .toolbar { flex: 0 0 auto; padding-top: 0; border-top: 0; }');
  });

  it('section headings outrank card titles (h2 and collapsible summaries share one size)', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('h2 { font-size: clamp(1.1rem, 4vw, 1.25rem);');
    expect(css).toContain('.round-details > summary { cursor: pointer; font-size: clamp(1.1rem, 4vw, 1.25rem); font-weight: 700;');
  });
});

describe('trust card link spacing', () => {
  it('separates the source link from the note', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/#trust-cards a \{[^}]*margin-top: 0\.45rem;/);
  });
});

describe('rounds bids column', () => {
  it('shrinks to its chips on desktop so winner sits next to them', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('table.rounds td[data-label="bids"] { width: 1%; white-space: nowrap;');
  });
});

describe('replay status line', () => {
  it('never starts a wrapped line with a dangling separator', () => {
    const main = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(main).toContain("replace(/ · /g, '\\u00a0· ')");
    expect(main).toContain('new MutationObserver');
    expect(main).toContain(".replace(/-(?=\\d)/g, '-\\u2060')");
  });
});

describe('footer alignment', () => {
  it('footer row spans the same column as the cards', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('.footer-content { box-sizing: border-box; max-width: calc(960px - 1.5rem); padding: 0 1rem; }');
  });
});

describe('real headline section', () => {
  it('reads as the receipt of the hero figure, not a second headline', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(html).toContain('How the real-ledger estimate is calculated');
    expect(html).toContain('<span class="hr-kicker">10.6x cheaper per verified result on real swarm data (22,957 runs)<span class="sr-only">: </span></span>How the');
    expect(css).toContain('.hr-kicker { display: block;');
    expect(html).not.toContain('cheaper per verified result: escrow rule replayed on our real ledger');
    expect(css).toContain('#headline-real > h2 { font-size: 1rem;');
    expect(css).toContain('#headline-real-cmd { margin: 0; background: var(--bg);');
  });
});

describe('round stages on phones', () => {
  it('keeps equal stage columns (labels may wrap, never collide) and the scenario dot glued', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).not.toContain('repeat(5, auto)');
    expect(css).toContain('.stages li { line-height: 1.25; hyphens: none; }');
    const ts = readFileSync(fileURLToPath(new URL('../src/render.ts', import.meta.url)), 'utf8');
    expect(ts).toContain('${c}&nbsp;&middot; ');
  });
});

describe('round stages on wide screens', () => {
  it('gives the last stage a wider column, keeps it on one line on desktop, and clips absolute children inside table scrollers', () => {
    const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.4fr)');
    expect(css).toContain('@media (min-width: 1000px) { .stages li[data-end] { white-space: nowrap; } }');
    expect(css).toContain('@media (min-width: 481px) { table.rounds td[data-label="bids"] { width: 1%;');
    expect(css).toContain('.table-wrap { position: relative; overflow-x: auto;');
  });
});

describe('real testnet rounds section', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const out = JSON.parse(readFileSync(fileURLToPath(new URL('../../swarm/out/testnet_market.json', import.meta.url)), 'utf8'));
  it('links the attest tx of every testnet round and says it is not the simulation', () => {
    const sec = html.slice(html.indexOf('id="testnet-rounds"'), html.indexOf('id="red-team"'));
    for (const r of out.rounds) expect(sec).toContain(`https://testnet.nearblocks.io/txns/${r.txs.attest}`);
    expect(sec.match(/<li class="tr-/g)?.length).toBe(out.rounds.length);
    expect(sec).toMatch(/Not the simulated replay/);
    expect(sec).toContain('https://testnet.nearblocks.io/address/market.hidra-mkt-221016.testnet');
  });
});
