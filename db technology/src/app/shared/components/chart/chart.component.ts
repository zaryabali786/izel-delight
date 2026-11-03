import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChartSeries {
  name: string;
  values: (number | null)[];
  /** Categorical slot 1-8 from the shared palette; slots are assigned by entity, never by rank. */
  slot?: number;
  dashed?: boolean;
}

export interface ChartBand {
  lower: (number | null)[];
  upper: (number | null)[];
  label?: string;
}

type Fmt = 'number' | 'money' | 'pct' | 'x';

const W = 640;
const PAD = { l: 64, r: 14, t: 12, b: 26 };

/** Axis bounds and tick step on a 1/2/5 x 10^n grid, so ticks land on readable numbers (negatives included). */
function niceScale(minVal: number, maxVal: number): { min: number; max: number; step: number } {
  const lo = Math.min(0, minVal);
  const hi = Math.max(0, maxVal);
  const range = hi - lo || 1;
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step || step, step };
}

/** Round the axis max up to a 1/2/5 x 10^n step so ticks land on readable numbers. */
function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const exp = Math.floor(Math.log10(max));
  const f = max / 10 ** exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss']
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  title = input<string>('');
  subtitle = input<string>('');
  labels = input<string[]>([]);
  series = input<ChartSeries[]>([]);
  band = input<ChartBand | null>(null);
  type = input<'line' | 'bar'>('line');
  format = input<Fmt>('number');
  currency = input<string>('');
  height = input<number>(220);
  /** Vertical rule at a label index (e.g. the day an experiment started). */
  marker = input<{ index: number; label: string } | null>(null);

  hoverIndex = signal<number | null>(null);
  showTable = signal<boolean>(false);

  readonly PAD = PAD;
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  /** Drawing width follows the container, so text stays the same size on narrow and wide cards. */
  W = signal(W);
  plotW = computed(() => this.W() - PAD.l - PAD.r);

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w >= 200 && Math.abs(w - this.W()) > 1) this.W.set(w);
    });
    this.ro.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }
  plotH = computed(() => this.height() - PAD.t - PAD.b);

  private scale = computed(() => {
    let min = 0;
    let max = 0;
    for (const s of this.series()) {
      for (const v of s.values) {
        if (v === null) continue;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    const b = this.band();
    if (b) {
      for (const v of b.upper) if (v !== null && v > max) max = v;
      for (const v of b.lower) if (v !== null && v < min) min = v;
    }
    return niceScale(min, max);
  });

  yMax = computed(() => this.scale().max);
  yMin = computed(() => this.scale().min);

  yTicks = computed(() => {
    const { min, max, step } = this.scale();
    const out: { value: number; y: number }[] = [];
    for (let v = min; v <= max + step / 1000; v += step) out.push({ value: Math.round(v / step) * step, y: this.yAt(v) });
    return out;
  });

  zeroY = computed(() => this.yAt(0));

  xTicks = computed(() => {
    const n = this.labels().length;
    if (n === 0) return [];
    const target = Math.min(6, n);
    const idx = new Set<number>();
    for (let i = 0; i < target; i++) idx.add(Math.round((i * (n - 1)) / Math.max(target - 1, 1)));
    return [...idx].map((i) => ({ i, x: this.xAt(i), label: this.shortLabel(this.labels()[i]) }));
  });

  paths = computed(() => {
    const out: { name: string; slot: number; d: string; dashed: boolean }[] = [];
    this.series().forEach((s, si) => {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${this.xAt(i).toFixed(1)},${this.yAt(v).toFixed(1)} `;
        pen = true;
      });
      out.push({ name: s.name, slot: s.slot ?? si + 1, d: d.trim(), dashed: !!s.dashed });
    });
    return out;
  });

  bandPath = computed(() => {
    const b = this.band();
    if (!b) return '';
    const up: string[] = [];
    const lo: string[] = [];
    b.upper.forEach((u, i) => {
      const l = b.lower[i];
      if (u === null || l === null || l === undefined) return;
      up.push(`${this.xAt(i).toFixed(1)},${this.yAt(u).toFixed(1)}`);
      lo.unshift(`${this.xAt(i).toFixed(1)},${this.yAt(l).toFixed(1)}`);
    });
    return up.length ? `M${up.join(' L')} L${lo.join(' L')} Z` : '';
  });

  /** One bar per label, from the first series. Data end gets a 4px radius; the baseline end stays flat. */
  bars = computed(() => {
    const s = this.series()[0];
    if (!s) return [];
    const n = this.labels().length;
    const slotW = this.plotW() / Math.max(n, 1);
    const bw = Math.max(2, Math.min(28, slotW * 0.6));
    const base = this.yAt(0);
    return s.values.map((v, i) => {
      if (v === null || v === 0) return { i, d: '', x: 0 };
      const x = PAD.l + slotW * i + (slotW - bw) / 2;
      const y = this.yAt(v);
      const r = Math.min(4, bw / 2, Math.abs(base - y));
      // The data end is rounded, the end on the zero line stays flat; negative bars hang below it.
      const d =
        v > 0
          ? `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z`
          : `M${x},${base} V${y - r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y - r} V${base} Z`;
      return { i, x, d };
    });
  });

  markerX = computed(() => {
    const m = this.marker();
    return m ? this.xAt(m.index) : null;
  });

  tooltip = computed(() => {
    const i = this.hoverIndex();
    if (i === null) return null;
    const rows = this.series().map((s, si) => ({ name: s.name, slot: s.slot ?? si + 1, value: s.values[i] ?? null }));
    const b = this.band();
    return {
      label: this.labels()[i],
      rows,
      band: b && b.lower[i] !== null && b.upper[i] !== null ? `${this.fmt(b.lower[i] as number)} to ${this.fmt(b.upper[i] as number)}` : null,
      bandLabel: b?.label || 'Range',
      x: this.xAt(i),
      leftPct: (this.xAt(i) / this.W()) * 100
    };
  });

  hasData = computed(() => this.series().some((s) => s.values.some((v) => v !== null && v !== 0)));

  tableRows = computed(() =>
    this.labels().map((l, i) => ({ label: l, cells: this.series().map((s) => (s.values[i] === null || s.values[i] === undefined ? '–' : this.fmt(s.values[i] as number))) }))
  );

  private xAt(i: number): number {
    const n = this.labels().length;
    if (this.type() === 'bar') return PAD.l + (this.plotW() / Math.max(n, 1)) * (i + 0.5);
    return PAD.l + (n <= 1 ? this.plotW() / 2 : (this.plotW() * i) / (n - 1));
  }

  private yAt(v: number): number {
    const lo = this.yMin();
    const hi = this.yMax();
    const clamped = Math.max(lo, Math.min(v, hi));
    return PAD.t + this.plotH() * (1 - (clamped - lo) / (hi - lo));
  }

  yPos(v: number): number {
    return this.yAt(v);
  }

  fmt(v: number): string {
    const abs = Math.abs(v);
    const compact = abs >= 1e6 ? `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M` : abs >= 1e4 ? `${(v / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K` : Number.isInteger(v) ? String(v) : v.toFixed(abs < 10 ? 2 : 1);
    switch (this.format()) {
      case 'money':
        return `${this.currency()}${compact}`;
      case 'pct':
        return `${compact}%`;
      case 'x':
        return `${compact}x`;
      default:
        return compact;
    }
  }

  shortLabel(l: string): string {
    // 2026-05-12 -> May 12
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(l);
    if (!m) return l;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  onMove(ev: MouseEvent | TouchEvent): void {
    const el = (ev.currentTarget as SVGElement).getBoundingClientRect();
    const clientX = 'touches' in ev ? ev.touches[0].clientX : (ev as MouseEvent).clientX;
    const px = ((clientX - el.left) / el.width) * this.W();
    const n = this.labels().length;
    if (n === 0) return;
    let i: number;
    if (this.type() === 'bar') i = Math.floor((px - PAD.l) / (this.plotW() / n));
    else i = Math.round(((px - PAD.l) / this.plotW()) * (n - 1));
    this.hoverIndex.set(Math.max(0, Math.min(n - 1, i)));
  }

  onLeave(): void {
    this.hoverIndex.set(null);
  }
}
