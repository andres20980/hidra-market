// test/reproducibilidad_desde_fuente.test.js v1.0 - el dataset se regenera byte-identico desde los ledgers fuente
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

// Source ledgers live outside this repo; set HIDRA_LEDGERS_ROOT to run this check.
const ledgers = process.env.HIDRA_LEDGERS_ROOT;

describe('reproducibilidad del dataset desde ledgers fuente', () => {
  it('re-export produce hidra_week.jsonl con mismo sha256', (ctx) => {
    if (!ledgers || !existsSync(ledgers)) return ctx.skip();
    const out = execFileSync('python3', ['scripts/reproducibilidad_desde_fuente.py'], {
      cwd: __dirname + '/..',
      encoding: 'utf8',
      timeout: 300000,
    });
    expect(out).toContain('OK dataset reproducible desde fuente');
    expect(out).not.toContain('FALLA');
  });
});
