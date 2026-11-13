// live.ts v1.0 — refresco del modo en vivo: pinta y sondea sin browser (testeable)
import { Sim } from './sim';

export interface LiveHost {
  schedule(fn: () => void, ms: number): number;
  cancel(t: number): void;
  // opcional: si la pestaña está oculta no gastamos RPC, solo reprogramamos
  visible?(): boolean;
}
export interface LiveSink {
  update(sim: Sim): void;
  status(text: string): void;
  announce?(text: string): void;
}
export interface LiveOptions {
  intervalMs: number;
  label: string;
  load: () => Promise<Sim>;
  now?: () => Date;
  // sostenibilidad: huella estable; si el estado no cambia, el mercado no se repinta
  fingerprint?: (sim: Sim) => string;
}

// bucle: carga, pinta, reprograma; ante error conserva los datos y avisa (sin fallback silencioso)
export class LivePoller {
  private t: number | null = null;
  private stopped = true;
  private failures = 0;
  private inflight = false;
  private lastFingerprint: string | null = null;

  constructor(
    private host: LiveHost,
    private sink: LiveSink,
    private opts: LiveOptions,
  ) {}

  get running(): boolean { return !this.stopped; }
  get failed(): number { return this.failures; }

  start(): void {
    this.stopped = false;
    this.sink.announce?.(`${this.opts.label} · polling started`);
    this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.t !== null) { this.host.cancel(this.t); this.t = null; }
  }

  // refresco inmediato (p. ej. al volver visible la pestaña); ignora si parado o ya hay una carga en curso
  refresh(): void {
    if (this.stopped || this.inflight) return;
    if (this.t !== null) { this.host.cancel(this.t); this.t = null; }
    this.tick();
  }

  private reschedule(): void {
    if (this.stopped) return;
    this.t = this.host.schedule(() => this.tick(), this.opts.intervalMs);
  }

  private tick(): void {
    if (this.stopped) return;
    if (this.host.visible && !this.host.visible()) { this.reschedule(); return; }
    this.inflight = true;
    this.opts
      .load()
      .then((sim) => {
        const fp = this.opts.fingerprint ? this.opts.fingerprint(sim) : null;
        const unchanged = fp !== null && fp === this.lastFingerprint;
        this.lastFingerprint = fp;
        this.inflight = false;
        if (this.stopped) return;
        const recovered = this.failures > 0;
        this.failures = 0;
        if (!unchanged) this.sink.update(sim);
        const now = (this.opts.now ?? (() => new Date()))();
        this.sink.status(`${this.opts.label} ${unchanged ? '· unchanged' : '· updated'} ${now.toLocaleTimeString()}`);
        if (recovered) this.sink.announce?.(`${this.opts.label} · connection restored`);
        this.reschedule();
      })
      .catch(() => {
        this.inflight = false;
        if (this.stopped) return;
        this.failures += 1;
        this.sink.status(`${this.opts.label} · refresh error ${this.failures} (retrying)`);
        if (this.failures === 1) this.sink.announce?.(`${this.opts.label} · connection error, retrying`);
        this.reschedule();
      });
  }
}
