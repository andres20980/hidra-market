// test/reproducibilidad_desde_fuente.test.js v1.0 - el dataset se regenera byte-identico desde los ledgers fuente
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

describe('reproducibilidad del dataset desde ledgers fuente', () => {
  it('re-export produce hidra_week.jsonl con mismo sha256', () => {
    const out = execFileSync('python3', ['scripts/reproducibilidad_desde_fuente.py'], {
      cwd: __dirname + '/..',
      encoding: 'utf8',
      timeout: 300000,
    });
    expect(out).toContain('OK dataset reproducible desde fuente');
    expect(out).not.toContain('FALLA');
  });
});
