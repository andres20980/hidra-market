// test/baseline_compare.test.js v1.0 - fija el tercer baseline (gasto real del enjambre) y el ahorro reproducible
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

const root = __dirname + '/..';

function readOut() {
  execSync('python3 scripts/baseline_compare.py', { cwd: root, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(root + '/out/baseline_compare.json', 'utf8'));
}

describe('comparacion de 3 baselines de coste por verificado', () => {
  const d = readOut();

  it('fuente: dataset congelado de 22957 ejecuciones, 386 verificadas', () => {
    expect(d.fuente_datos.ejecuciones).toBe(22957);
    expect(d.fuente_datos.verificados).toBe(386);
    expect(d.fuente_datos.tasa_verificados_pct).toBeCloseTo(1.68, 2);
  });

  it('status quo real: 90.55% del gasto no produce resultado verificado', () => {
    const sq = d.status_quo_enjambre;
    expect(sq.coste_total_usd).toBeCloseTo(23.5734, 4);
    expect(sq.coste_por_verificado_usd).toBeCloseTo(0.061071, 6);
    expect(sq.gasto_no_verificado_pct).toBeCloseTo(90.55, 2);
  });

  it('escrow del mercado sobre los mismos outcomes paga solo lo verificado', () => {
    const mk = d.mercado_escrow_mismos_datos;
    expect(mk.coste_total_usd).toBeCloseTo(2.2268, 4);
    expect(mk.coste_por_verificado_usd).toBeCloseTo(0.005769, 6);
    expect(mk.verificados).toBe(386);
  });

  it('ahorro real: factor 10.586x, mismo numero de resultados verificados', () => {
    expect(d.ahorro_real.factor_coste).toBeCloseTo(10.586, 2);
    expect(d.ahorro_real.ahorro_pct).toBeCloseTo(90.55, 2);
  });

  it('gobernanza mercado vs round-robin: factor con IC95 por horizonte', () => {
    const g = d.gobernanza_mercado_vs_round_robin.por_horizonte_rondas;
    expect(g['5000'].factor_coste_media).toBeCloseTo(62.04, 2);
    expect(g['5000'].factor_coste_ic95.length).toBe(2);
  });
});
