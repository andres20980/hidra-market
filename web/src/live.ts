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
}

// bucle: carga, pinta, reprograma; ante error conserva los datos y avisa (sin fallback silencioso)
export class LivePoller {
  private t: number | null = null;
  private stopped = true;
  private failures = 0;
  private inflight = false;

  constructor(
    private host: LiveHost,
    private sink: LiveSink,
    private opts: LiveOptions,
  ) {}

  get running(): boolean { return !this.stopped; }
  get failed(): number { return this.failures; }

  start(): void {
    this.stopped = false;
    this.sink.announce?.(`${this.opts.label} · sondeo iniciado`);
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
        this.inflight = false;
        if (this.stopped) return;
        const recovered = this.failures > 0;
        this.failures = 0;
        this.sink.update(sim);
        const now = (this.opts.now ?? (() => new Date()))();
        this.sink.status(`${this.opts.label} · actualizado ${now.toLocaleTimeString()}`);
        if (recovered) this.sink.announce?.(`${this.opts.label} · conexión recuperada`);
        this.reschedule();
      })
      .catch(() => {
        this.inflight = false;
        if (this.stopped) return;
        this.failures += 1;
        this.sink.status(`${this.opts.label} · error de refresco ${this.failures} (se reintenta)`);
        if (this.failures === 1) this.sink.announce?.(`${this.opts.label} · error de conexión, se reintenta`);
        this.reschedule();
      });
  }
}
