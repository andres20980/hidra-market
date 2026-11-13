// replay.ts v1.2
import { Frame, frames as buildFrames, stepMs } from './timeline';
import { render, renderIntro } from './render';
import { Sim } from './sim';

export interface El {
  innerHTML: string;
  textContent: string | null;
  ariaPressed: string | null;
  value?: string;
  addEventListener(type: string, fn: () => void): void;
}
export interface Dom {
  id(id: string): El | null;
  query(sel: string): El | null;
}
export interface Host {
  dom: Dom;
  schedule(fn: () => void, ms: number): number;
  cancel(t: number): void;
  // sostenibilidad: el reloj solo avanza con la pagina visible (ahorra CPU/red/energia)
  visible?: () => boolean;
  onVisibilityChange?: (fn: () => void) => void;
}

// motor del replay: commit -> reveal -> cierre, inyectado el DOM y el reloj (testeable sin navegador)
export class Replay {
  private fr: Frame[] = [];
  private idx = -1;
  private playing = false;
  private t: number | null = null;
  private sim: Sim | null = null;
  private suspended = false;

  constructor(private host: Host, private speed: () => number) {
    host.onVisibilityChange?.(() => this.syncVisibility());
  }

  get length(): number { return this.fr.length; }
  get index(): number { return this.idx; }
  get running(): boolean { return this.playing; }

  load(sim: Sim): void {
    this.stop();
    this.fr = buildFrames(sim);
    this.idx = -1;
    this.sim = sim;
    this.drawIntro();
    this.btn();
  }

  replay(sim: Sim): void { this.load(sim); this.start(); }

  private draw(f: Frame | null): void {
    const v = this.host.dom.id('view');
    if (v) v.innerHTML = f ? render(f.view, f.flash) : '';
    const s = this.host.dom.id('replay-status');
    if (s) s.textContent = f ? `${f.i + 1}/${this.fr.length} \u00b7 ${f.label}` : '';
  }

  private btn(): void {
    const b = this.host.dom.id('replay-toggle');
    if (b) {
      b.textContent = this.playing ? '\u23f8 pausa' : '\u25b6 reproducir';
      b.ariaPressed = String(this.playing);
    }
  }

  private tick(): void {
    if (!this.playing) return;
    if (this.hidden()) { this.suspended = true; this.cancel(); return; }
    if (this.idx >= this.fr.length - 1) { this.stop(); return; }
    this.idx += 1;
    this.draw(this.fr[this.idx]);
    this.timer();
  }

  // oculta: no reprograma; visible: reanuda donde estaba
  private syncVisibility(): void {
    if (!this.playing) { this.suspended = false; return; }
    if (this.hidden()) { this.suspended = true; this.cancel(); }
    else if (this.suspended) { this.suspended = false; this.timer(); }
  }

  private hidden(): boolean { return this.host.visible?.() === false; }

  private timer(): void {
    this.t = this.host.schedule(() => this.tick(), stepMs(this.speed()));
  }

  start(): void {
    if (!this.fr.length || this.playing) return;
    this.playing = true;
    this.btn();
    if (this.hidden()) { this.suspended = true; return; }
    if (this.idx === -1) { this.idx = 0; this.draw(this.fr[0]); }
    this.timer();
  }

  stop(): void {
    this.playing = false;
    this.cancel();
    this.btn();
  }

  // cambio de velocidad en caliente: reprograma el paso pendiente
  reschedule(): void {
    if (!this.playing || this.suspended) return;
    this.cancel();
    this.timer();
  }

  private cancel(): void {
    if (this.t !== null) { this.host.cancel(this.t); this.t = null; }
  }

  toggle(): void {
    if (this.playing) this.stop();
    else if (this.idx >= this.fr.length - 1) { this.idx = -1; this.start(); }
    else this.start();
  }

  private drawIntro(): void {
    const v = this.host.dom.id('view');
    if (v && this.sim) v.innerHTML = renderIntro(this.sim);
    const s = this.host.dom.id('replay-status');
    if (s) s.textContent = `listo - ${this.fr.length} pasos - pulsa reproducir`;
  }
}
