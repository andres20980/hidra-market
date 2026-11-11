import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';

describe('deterministic simulator (seed fija)', () => {
  it('ejecuta el simulador y genera out/sim.json', () => {
    execSync('python3 deterministic_simulator.py', { cwd: __dirname + '/..', stdio: 'pipe' });
    expect(fs.existsSync(__dirname + '/../out/sim.json')).toBe(true);
  });

  it('fija cifras clave del mercado (seed=42, rounds=200)', () => {
    const sim = JSON.parse(fs.readFileSync(__dirname + '/../out/sim.json', 'utf8'));
    expect(sim.seed).toBe(42);
    expect(sim.rounds.length).toBe(200);
    expect(sim.metrics.mercado.coste_total).toBe(200);
    expect(sim.metrics.mercado.verificados).toBe(2);
    expect(sim.metrics.mercado.coste_por_verificado).toBe(100.0);
  });

  it('dataset anonimo: solo los 6 campos permitidos y alias worker-N', () => {
    const raw = fs.readFileSync(__dirname + '/../data/hidra_week.jsonl', 'utf8').trim().split('\n');
    const allowed = ['coste_estimado', 'resultado', 'segundos', 't', 'tipo_tarea', 'worker'];
    expect(raw.length).toBe(23782);
    for (const line of raw) {
      const rec = JSON.parse(line);
      expect(Object.keys(rec).sort()).toEqual(allowed);
      expect(rec.worker).toMatch(/^worker-\d+$/);
      expect(rec.tipo_tarea).not.toMatch(/[\/.]/);
    }
    const results = raw.map((l) => JSON.parse(l).resultado);
    expect(results.filter((r) => r === 'LOCKED').length).toBe(372);
  });

  it('fija cifras clave de round-robin sobre los mismos datos', () => {
    const sim = JSON.parse(fs.readFileSync(__dirname + '/../out/sim.json', 'utf8'));
    expect(sim.metrics.round_robin.coste_total).toBe(20000);
    expect(sim.metrics.round_robin.verificados).toBe(2);
    expect(sim.metrics.round_robin.coste_por_verificado).toBe(10000);
  });
});
