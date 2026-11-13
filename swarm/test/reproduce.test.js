// test/reproduce.test.js v1.2 - the published figures are re-derived and checked against the artefacts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

describe('reproducibilidad de las cifras publicadas', () => {
  it('npm run reproduce:check valida dataset, titular, intervalo, horizonte, tasas del ledger y anonimato', () => {
    const out = execFileSync('python3', ['scripts/reproduce_checks.py', '--no-regen'], {
      cwd: __dirname + '/..',
      encoding: 'utf8',
    });
    const lineas = out.trim().split('\n');
    expect(lineas.filter((l) => l.startsWith('OK   ')).length).toBe(6);
    expect(out).not.toContain('FALLA');
    expect(lineas[lineas.length - 1]).toBe('reproduce_checks: 6/6 OK');
    expect(out).toContain('tasas del ledger');
    expect(out).toContain('dataset anonimo');
  });
});
