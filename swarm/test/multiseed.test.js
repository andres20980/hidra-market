// test/multiseed.test.js v1.1 - locks the multi-seed interval of the headline figure (juez improvement)
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

const root = __dirname + '/..';

function readOut() {
  execSync('python3 scripts/multiseed_ci.py', { cwd: root, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(root + '/out/multiseed.json', 'utf8'));
}

describe('intervalo multi-semilla de la cifra principal', () => {
  const data = readOut();

  it('cubre 5 semillas x 3 horizontes', () => {
    expect(data.semillas).toEqual([42, 7, 1234, 2024, 11]);
    expect(data.filas.length).toBe(15);
  });

  it('mercado: coste por verificado constante (escrow paga solo Settled)', () => {
    const s = data.resumen['200'].mercado_coste_por_verificado;
    expect(s.min).toBe(100);
    expect(s.max).toBe(100);
    expect(s.media).toBe(100);
    expect(data.resumen['5000'].mercado_coste_por_verificado.max).toBe(100);
  });

  it('round-robin a 200 rondas: intervalo 4000-10000 y una semilla sin verificados', () => {
    const s = data.resumen['200'].rr_coste_por_verificado;
    expect(s.min).toBe(4000);
    expect(s.max).toBe(10000);
    expect(data.resumen['200'].rr_semillas_sin_verificado).toBe(1);
  });

  it('cada media declara IC95% t-Student, no solo minimo-maximo', () => {
    const f = data.resumen['200'].factor_coste;
    expect(f.ic95[0]).toBeCloseTo(30.43, 2);
    expect(f.ic95[1]).toBeCloseTo(122.9, 2);
    expect(f.desv).toBeCloseTo(29.06, 2);
    expect(data.resumen['1000'].factor_coste.ic95).toEqual([50.93, 71.37]);
    expect(data.resumen['5000'].factor_coste.ic95).toEqual([54.52, 69.56]);
    expect(data.resumen['5000'].ratio_verificados.ic95).toEqual([3.13, 3.89]);
  });

  it('a 5000 rondas el mercado verifica mas que round-robin (media 3,51x)', () => {
    const s = data.resumen['5000'].ratio_verificados;
    expect(s.min).toBeCloseTo(3.19, 2);
    expect(s.max).toBeCloseTo(3.93, 2);
    expect(s.media).toBeCloseTo(3.51, 2);
  });
});
