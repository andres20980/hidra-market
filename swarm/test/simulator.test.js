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
    expect(sim.metrics.mercado.coste_total).toBe(400);
    expect(sim.metrics.mercado.verificados).toBe(4);
    expect(sim.metrics.mercado.coste_por_verificado).toBe(100.0);
  });

  it('dataset anonimo: solo los 6 campos permitidos y alias worker-N', () => {
    // The ledgers are live (agents keep appending lines), so absolute counts are not frozen:
    // the committed dataset is a real snapshot and the manifest (written by scripts/export_ledger.py)
    // is its fingerprint. We assert structure, anonymity and manifest/dataset agreement.
    const manifest = JSON.parse(fs.readFileSync(__dirname + '/../data/hidra_week.manifest.json', 'utf8'));
    const raw = fs.readFileSync(__dirname + '/../data/hidra_week.jsonl', 'utf8').trim().split('\n');
    const allowed = ['coste_estimado', 'resultado', 'segundos', 't', 'tipo_tarea', 'worker'];
    // Anonymity: no filesystem paths, ledger artefacts, prompts or credentials leak out.
    const forbidden = ['/home/', 'copias', 'polipasto', 'ledger.jsonl', 'stderr_preview', 'plan_fingerprint', 'prompt', 'run_id', 'span_id', 'api_key', 'secret'];
    // One pass over the whole text: cheaper than 23k x 11 substring assertions.
    const rawText = fs.readFileSync(__dirname + '/../data/hidra_week.jsonl', 'utf8').toLowerCase();
    for (const bad of forbidden) {
      expect(rawText.includes(bad)).toBe(false);
    }
    const recs = raw.map((line) => {
      const rec = JSON.parse(line);
      expect(Object.keys(rec).sort()).toEqual(allowed);
      expect(rec.worker).toMatch(/^worker-\d+$/);
      expect(rec.tipo_tarea).not.toMatch(/[\/.]/);
      expect(rec.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof rec.segundos).toBe('number');
      expect(typeof rec.coste_estimado).toBe('number');
      return rec;
    });
    const workers = new Set(recs.map((r) => r.worker));
    const taskTypes = new Set(recs.map((r) => r.tipo_tarea));
    expect(recs.length).toBe(manifest.lineas_exportadas);
    expect(manifest.lineas_leidas).toBeGreaterThanOrEqual(manifest.lineas_exportadas);
    expect(manifest.ficheros_ledger).toBeGreaterThan(0);
    expect(workers.size).toBe(manifest.workers);
    expect([...taskTypes].sort()).toEqual(manifest.tipos_tarea);
    expect(Object.values(manifest.reparto_resultado).reduce((a, b) => a + b, 0)).toBe(recs.length);
    const results = recs.map((r) => r.resultado);
    expect(results.filter((r) => r === 'LOCKED').length).toBe(manifest.reparto_resultado.LOCKED);
    expect(manifest.reparto_resultado.LOCKED).toBeGreaterThan(0);
  });

  it('fija cifras clave de round-robin sobre los mismos datos', () => {
    const sim = JSON.parse(fs.readFileSync(__dirname + '/../out/sim.json', 'utf8'));
    expect(sim.metrics.round_robin.coste_total).toBe(20000);
    expect(sim.metrics.round_robin.verificados).toBe(5);
    expect(sim.metrics.round_robin.coste_por_verificado).toBe(4000);
  });

  it('ordena precios ajustados con fracciones exactas', () => {
    const result = execSync(
      'python3 -c "import deterministic_simulator as s; print(s.effective_price(1, 1, 0) < s.effective_price(10000000000000001, 10000000000000000, 0))"',
      { cwd: __dirname + '/..', encoding: 'utf8' }
    ).trim();
    expect(result).toBe('True');
  });
});
