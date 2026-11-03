import { Component, computed, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CohortsResult, MarketingService, ProductRow, RfmResult } from '../../../core/services/marketing.service';
import { DASH, money, num, pct } from './format';

@Component({
  selector: 'app-customers-tab',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (error()) {<div class="notice error">{{ error() }}</div>}

    @if (cohorts(); as c) {
      <div class="grid cols-4">
        <div class="mk-card kpi"><div class="label">Identified customers</div><div class="value">{{ num(c.summary.identified_customers) }}</div><div class="hint">With an email or phone</div></div>
        <div class="mk-card kpi"><div class="label">Repeat purchase rate</div><div class="value">{{ pct(c.summary.repeat_rate_pct) }}</div><div class="hint">Bought more than once</div></div>
        <div class="mk-card kpi"><div class="label">Orders per customer</div><div class="value">{{ num(c.summary.avg_orders_per_customer, 2) }}</div><div class="hint">Lifetime average</div></div>
        <div class="mk-card kpi"><div class="label">Revenue per customer</div><div class="value">{{ money(c.summary.avg_revenue_per_customer) }}</div><div class="hint">Lifetime average</div></div>
      </div>

      <div class="mk-card mt">
        <div class="row">
          <div><h3>Cohorts</h3><p class="lead">Customers grouped by the month of their first order. Darker means higher.</p></div>
          <span class="spacer"></span>
          <div class="seg">
            <button type="button" [class.on]="mode() === 'ltv'" (click)="mode.set('ltv')">Cumulative LTV</button>
            <button type="button" [class.on]="mode() === 'retention'" (click)="mode.set('retention')">Retention %</button>
          </div>
        </div>
        @if (c.cohorts.length === 0) {
          <div class="empty">No customers with an email or phone yet, so cohorts cannot be built.</div>
        } @else {
          <div class="table-scroll">
            <table class="data cohort">
              <thead><tr><th>Cohort</th><th>Customers</th>@for (m of monthHeads(); track m) {<th>M{{ m }}</th>}</tr></thead>
              <tbody>
                @for (r of c.cohorts; track r.cohort) {
                  <tr>
                    <td>{{ r.cohort }}</td><td>{{ num(r.customers) }}</td>
                    @for (v of cells(r); track $index) {
                      <td class="cell" [style.background]="shade(v)" [class.light]="intensity(v) > 0.55">{{ v === null ? '' : mode() === 'ltv' ? money(v) : pct(v, 0) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }

    <div class="grid cols-2 mt">
      <div class="mk-card">
        <h3>Customer segments (RFM)</h3>
        <p class="lead">Scored on how recently, how often and how much each customer buys.</p>
        @if (!rfm() || rfm()!.segments.length === 0) {
          <div class="empty">No identified customers yet.</div>
        } @else {
          @for (s of rfm()!.segments; track s.segment) {
            <div class="seg-row">
              <div class="seg-top"><b>{{ s.segment }}</b><span>{{ num(s.customers) }} customers · {{ money(s.revenue) }}</span></div>
              <div class="bar"><span [style.width.%]="segWidth(s.revenue)"></span></div>
            </div>
          }
        }
      </div>

      <div class="mk-card">
        <h3>Top products</h3>
        <p class="lead">Revenue, margin and stock cover for the selected period.</p>
        @if (products().length === 0) {
          <div class="empty">No product sales in this period.</div>
        } @else {
          <div class="table-scroll">
            <table class="data">
              <thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Margin</th><th>Stock cover</th></tr></thead>
              <tbody>
                @for (p of products().slice(0, 10); track p.title) {
                  <tr>
                    <td class="name">{{ p.title }}</td><td>{{ num(p.units) }}</td><td>{{ money(p.revenue) }}</td>
                    <td>{{ p.margin_pct === null ? dash : pct(p.margin_pct, 0) }}</td>
                    <td>@if (p.days_of_stock === null) {<span>{{ dash }}</span>} @else {<span class="pill" [class.bad]="p.days_of_stock < 14" [class.ok]="p.days_of_stock >= 14">{{ p.days_of_stock }}d</span>}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
    @if (loading()) {<div class="empty">Loading…</div>}
  `,
  styles: [
    `
      .seg { display: inline-flex; border: 1px solid var(--app-card-border); border-radius: 9px; overflow: hidden; }
      .seg button { background: transparent; color: inherit; border: 0; padding: 5px 12px; font-size: 12px; cursor: pointer; }
      .seg button.on { background: rgba(99, 102, 241, 0.22); color: var(--ink-accent); font-weight: 600; }
      .cohort td.cell { text-align: center; font-size: 11.5px; min-width: 62px; }
      .cohort td.cell.light { color: #fff; }
      .seg-row { margin-bottom: 12px; }
      .seg-top { display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px; span { color: var(--app-subtext); } }
      .bar { height: 8px; border-radius: 4px; background: rgba(148, 163, 184, 0.15); span { display: block; height: 100%; border-radius: 4px; background: #6366f1; } }
    `
  ]
})
export class CustomersTab {
  from = input.required<string>();
  to = input.required<string>();
  currency = input<string>('');
  storeKey = input<string>('');

  readonly dash = DASH;
  readonly num = num;
  readonly pct = pct;
  readonly money = (v: number | null | undefined) => money(v, this.currency());

  mode = signal<'ltv' | 'retention'>('ltv');
  cohorts = signal<CohortsResult | null>(null);
  rfm = signal<RfmResult | null>(null);
  products = signal<ProductRow[]>([]);
  loading = signal<boolean>(false);
  error = signal<string>('');

  constructor(private mk: MarketingService) {
    effect(() => {
      this.storeKey();
      this.load(this.from(), this.to());
    });
  }

  private async load(from: string, to: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [c, r, p] = await Promise.all([this.mk.cohorts(), this.mk.rfm(), this.mk.products({ from, to })]);
      this.cohorts.set(c);
      this.rfm.set(r);
      this.products.set(p.products);
    } catch (e) {
      this.error.set(this.mk.errorMessage(e, 'Could not load customer data.'));
    } finally {
      this.loading.set(false);
    }
  }

  monthHeads = computed(() => Array.from({ length: this.cohorts()?.months ?? 0 }, (_, i) => i));

  cells(r: { ltv_by_month: (number | null)[]; retention_by_month: (number | null)[] }): (number | null)[] {
    return this.mode() === 'ltv' ? r.ltv_by_month : r.retention_by_month;
  }

  private maxFor = computed(() => {
    const c = this.cohorts();
    if (!c) return 1;
    let max = 0;
    for (const r of c.cohorts) for (const v of this.cells(r)) if (v !== null && v > max) max = v;
    return max || 1;
  });

  /** One hue, light to dark: magnitude only, no second hue. */
  intensity(v: number | null): number {
    return v === null ? 0 : Math.min(1, v / this.maxFor());
  }

  shade(v: number | null): string {
    return v === null ? 'transparent' : `rgba(99, 102, 241, ${(0.08 + this.intensity(v) * 0.85).toFixed(2)})`;
  }

  segWidth(revenue: number): number {
    const max = Math.max(...(this.rfm()?.segments ?? []).map((s) => s.revenue), 1);
    return Math.max(2, (revenue / max) * 100);
  }
}
