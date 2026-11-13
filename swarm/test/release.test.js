// test/release.test.js v1.1 - locks the secret-free publishable package (juez improvement: publish without keys)
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = __dirname + '/..';
const outDir = root + '/out/release';

describe('paquete publicable sin secretos', () => {
  const stdout = execSync('python3 scripts/package_release.py', { cwd: root, stdio: 'pipe' }).toString();
  const summary = JSON.parse(stdout);
  const manifest = JSON.parse(fs.readFileSync(outDir + '/manifest.json', 'utf8'));
  const tarball = fs.readFileSync(outDir + '/swarm-release.tar.gz');

  it('construye el tarball con sha256 reproducible y escaneo limpio', () => {
    expect(summary.ok).toBe(true);
    expect(manifest.secret_scan).toBe('clean');
    const sha = crypto.createHash('sha256').update(tarball).digest('hex');
    expect(sha).toBe(manifest.tarball.sha256);
  });

  it('no incluye .env, *.key ni node_modules', () => {
    const names = manifest.files.map((f) => f.path);
    expect(names.some((p) => p.split('/').pop() === '.env')).toBe(false);
    expect(names.some((p) => p.endsWith('.key'))).toBe(false);
    expect(names.some((p) => p.includes('node_modules'))).toBe(false);
    expect(manifest.dropped.some((p) => p.endsWith('.key'))).toBe(true);
  });

  it('incluye el dataset real (<5 MB) con su sha256 correcto', () => {
    const ds = manifest.files.find((f) => f.path === 'data/hidra_week.jsonl');
    expect(ds).toBeTruthy();
    expect(ds.bytes).toBeLessThan(5 * 1024 * 1024);
    const real = crypto.createHash('sha256').update(fs.readFileSync(root + '/data/hidra_week.jsonl')).digest('hex');
    expect(ds.sha256).toBe(real);
  });

  it('el archivo tar no contiene credenciales', () => {
    const listing = execSync(
      `python3 -c "import sys,tarfile;print('\\n'.join(tarfile.open(sys.argv[1]).getnames()))" ${outDir}/swarm-release.tar.gz`,
      { cwd: root, stdio: 'pipe' }
    ).toString();
    expect(listing).not.toMatch(/\.env$/m);
    expect(listing).not.toMatch(/\.key$/m);
    expect(listing).not.toMatch(/node_modules/);
  });
  // v1.1 (hallazgo juez enjambre #3): caso explicito "clon limpio": el empaquetado debe
  // construir y descartar su propia sonda .release_probe.key sin ningun *.key local.
  it('autocontenido: empaqueta y descarta la sonda sin ningun *.key local', () => {
    const tmp = fs.mkdtempSync('/tmp/swarm-nokeys-');
    const keep = (src) => {
      const rel = path.relative(root, src);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.some((x) => x === 'node_modules' || x === 'out' || x === '.git')) return false;
      return !rel.endsWith('.key');
    };
    fs.cpSync(root, tmp, { recursive: true, filter: keep });
    const keys = execSync(`find ${tmp} -name '*.key' -not -name '.release_probe.key'`, { stdio: 'pipe' })
      .toString().trim();
    expect(keys).toBe('');
    const summary2 = JSON.parse(execSync('python3 scripts/package_release.py', { cwd: tmp, stdio: 'pipe' }).toString());
    const manifest2 = JSON.parse(fs.readFileSync(tmp + '/out/release/manifest.json', 'utf8'));
    expect(summary2.ok).toBe(true);
    expect(manifest2.secret_scan).toBe('clean');
    expect(manifest2.dropped.some((p) => p.endsWith('.release_probe.key'))).toBe(true);
    expect(manifest2.files.some((f) => f.path.split('/').pop().endsWith('.key'))).toBe(false);
    expect(fs.existsSync(tmp + '/.release_probe.key')).toBe(false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
