import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

describe('deterministic simulator (seed fija)', () => {
  it('ejecuta el simulador y genera out/sim.json', () => {
    execSync('python3 deterministic_simulator.py', { cwd: __dirname + '/..', stdio: 'pipe' });
    expect(fs.existsSync(__dirname + '/../out/sim.json')).toBe(true);
  });

  it('fija cifras clave del mercado (seed=42, rounds=10)', () => {
    const sim = JSON.parse(fs.readFileSync(__dirname + '/../out/sim.json', 'utf8'));
    expect(sim.seed).toBe(42);
    expect(sim.rounds.length).toBe(10);
    expect(sim.metrics.mercado.coste_total).toBe(100);
    expect(sim.metrics.mercado.verificados).toBe(1);
    expect(sim.metrics.mercado.coste_por_verificado).toBe(100.0);
  });

  it('fija cifras clave de round-robin sobre los mismos datos', () => {
    const sim = JSON.parse(fs.readFileSync(__dirname + '/../out/sim.json', 'utf8'));
    expect(sim.metrics.round_robin.coste_total).toBe(1000);
    expect(sim.metrics.round_robin.verificados).toBe(1);
    expect(sim.metrics.round_robin.coste_por_verificado).toBe(1000.0);
  });
});
