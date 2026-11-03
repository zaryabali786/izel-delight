import { Component, EventEmitter, Output, computed, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AttributionResult, FunnelResult, MarketingService } from '../../../core/services/marketing.service';
import { ChartComponent, ChartSeries } from '../../../shared/components/chart/chart.component';
import { channelLabel, money, num, pct, ratio } from './format';

const MODEL_INFO: Record<string, { label: string; help: string }> = {
  last_click: { label: 'Last click', help: 'All credit to the last marketing touch before purchase (direct visits are ignored when an earlier campaign exists).' },
  first_click: { label: 'First click', help: 'All credit to the touch that first brought the visitor in.' },
  linear: { label: 'Linear', help: 'Credit split equally across every touch in the 30 days before purchase.' },
  time_decay: { label: 'Time decay', help: 'More credit to touches closer to purchase (7-day half-life).' },
  position_based: { label: 'Position based', help: '40% to the first touch, 40% to the last, 20% shared across the middle.' }
};

@Component({
  selector: 'app-attribution-tab',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (error()) {<div class="notice error">{{ error() }}</div>}

    @if (attr(); as a) {
      @if (a.tracked_purchases === 0) {
        <div class="notice">
          No purchases were recorded by the storefront pixel in this period, so attribution cannot be computed yet.
          Install the pixel on your Shopify theme, then come back.
          <button type="button" class="btn small primary" (click)="goto.emit('connect')">Get the pixel snippet</button>
        </div>
      }

      <div class="row">
        <div class="seg">
          @for (m of a.models; track m) {
            <button type="button" [class.on]="model() === m" (click)="model.set(m)" [title]="info[m].help">{{ info[m].label }}</button>
          }
        </div>
        <span class="muted">{{ info[model()].help }}</span>
      </div>

      <div class="grid cols-4 mt">
        <div class="mk-card kpi"><div class="label">Tracked purchases</div><div class="value">{{ num(a.tracked_purchases) }}</div><div class="hint">of {{ num(a.store_orders) }} store orders</div></div>
        <div class="mk-card kpi"><div class="label">Pixel match rate</div><div class="value">{{ pct(a.pixel_match_rate_pct, 0) }}</div><div class="hint">Share of orders the pixel saw</div></div>
        <div class="mk-card kpi"><div class="label">Touches before purchase</div><div class="value">{{ num(a.avg_touches_before_purchase, 1) }}</div><div class="hint">Average sessions in the path</div></div>
        <div class="mk-card kpi"><div class="label">Days to purchase</div><div class="value">{{ num(a.avg_days_to_purchase, 1) }}</div><div class="hint">First touch to order</div></div>
      </div>

      <div class="mk-card mt">
        <h3>Revenue by channel · {{ info[model()].label }}</h3>
        <p class="lead">Compare what the pixel attributes with what each ad platform claims for itself. A big gap means the platform is counting sales it did not cause or that the pixel is missing.</p>
        @if (a.channels.length === 0) {
          <div class="empty">Nothing to show yet.</div>
        } @else {
          <app-chart title="Attributed revenue" [labels]="chLabels()" [series]="chSeries()" type="bar" format="money" [currency]="currency()" [height]="200" />
          <div class="table-scroll mt">
            <table class="data">
              <thead><tr><th>Channel</th><th>Orders</th><th>Attributed revenue</th><th>Share</th><th>Spend</th><th>ROAS (attributed)</th><th>CAC</th><th>Platform-reported revenue</th><th>Platform ROAS</th></tr></thead>
              <tbody>
                @for (c of a.channels; track c.channel) {
                  <tr>
                    <td>{{ label(c.channel) }}</td><td>{{ num(c.orders, 1) }}</td><td>{{ money(c.revenue) }}</td><td>{{ pct(c.share_pct, 0) }}</td>
                    <td>{{ money(c.spend) }}</td><td>{{ ratio(c.roas) }}</td><td>{{ money(c.cac) }}</td>
                    <td>{{ money(c.platform_reported_revenue) }}</td><td>{{ ratio(c.platform_reported_roas) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="grid cols-2 mt">
        <div class="mk-card">
          <h3>Top conversion paths</h3>
          <p class="lead">Channel sequences of buyers (consecutive repeats merged).</p>
          @if (a.top_paths.length === 0) {<div class="empty">No paths yet.</div>}
          @for (p of a.top_paths; track p.path) {
            <div class="path"><span>{{ pathLabel(p.path) }}</span><b>{{ p.purchases }}</b></div>
          }
        </div>
        <div class="mk-card">
          <h3>Top campaigns</h3>
          <p class="lead">By attributed revenue (UTM campaign).</p>
          @if (a.campaigns.length === 0) {<div class="empty">No campaigns tracked. Add utm_campaign to your ad URLs.</div>}
          <div class="table-scroll">
            <table class="data">
              @for (c of a.campaigns.slice(0, 8); track $index) {
                <tr><td class="name">{{ c.campaign }} <span class="muted">· {{ label(c.channel) }}</span></td><td>{{ money(c.revenue) }}</td></tr>
              }
            </table>
          </div>
        </div>
      </div>
    }

    @if (funnel(); as f) {
      <div class="mk-card mt">
        <h3>Visitor funnel</h3>
        <p class="lead">Sessions that reached each step, by first-touch channel.</p>
        @if (f.total.sessions === 0) {
          <div class="empty">No pixel sessions in this period.</div>
        } @else {
          <app-chart title="All traffic" [labels]="funnelLabels" [series]="funnelSeries()" type="bar" format="number" [height]="190" />
          <div class="table-scroll mt">
            <table class="data">
              <thead><tr><th>Channel</th><th>Sessions</th><th>Product views</th><th>Add to cart</th><th>Checkout</th><th>Purchases</th><th>Add-to-cart rate</th><th>Conversion rate</th></tr></thead>
              <tbody>
                @for (r of f.channels; track r.name) {
                  <tr><td>{{ label(r.name) }}</td><td>{{ num(r.sessions) }}</td><td>{{ num(r.product_view) }}</td><td>{{ num(r.add_to_cart) }}</td><td>{{ num(r.checkout_started) }}</td><td>{{ num(r.purchase) }}</td><td>{{ pct(r.add_to_cart_rate_pct, 1) }}</td><td>{{ pct(r.conversion_rate_pct, 2) }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
    @if (loading() && !attr()) {<div class="empty">Loading…</div>}
  `,
  styles: [
    `
      .seg { display: inline-flex; border: 1px solid var(--app-card-border); border-radius: 9px; overflow: hidden; flex-wrap: wrap; }
      .seg button { background: transparent; color: inherit; border: 0; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
      .seg button.on { background: rgba(99, 102, 241, 0.22); color: var(--ink-accent); font-weight: 600; }
      .path { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--app-card-border); font-size: 12.5px; }
    `
  ]
})
export class AttributionTab {
  from = input.required<string>();
  to = input.required<string>();
  currency = input<string>('');
  storeKey = input<string>('');
  @Output() goto = new EventEmitter<'connect'>();

  readonly info = MODEL_INFO;
  readonly funnelLabels = ['Sessions', 'Product views', 'Add to cart', 'Checkout', 'Purchases'];

  model = signal<string>('time_decay');
  attr = signal<AttributionResult | null>(null);
  funnel = signal<FunnelResult | null>(null);
  loading = signal<boolean>(false);
  error = signal<string>('');

  readonly money = (v: number | null | undefined) => money(v, this.currency());
  readonly num = num;
  readonly pct = pct;
  readonly ratio = ratio;
  readonly label = channelLabel;

  constructor(private mk: MarketingService) {
    effect(() => {
      this.storeKey();
      this.load(this.from(), this.to(), this.model());
    });
  }

  private async load(from: string, to: string, model: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [a, f] = await Promise.all([this.mk.attribution({ from, to, model }), this.mk.funnel({ from, to })]);
      this.attr.set(a);
      this.funnel.set(f);
    } catch (e) {
      this.error.set(this.mk.errorMessage(e, 'Could not load attribution.'));
    } finally {
      this.loading.set(false);
    }
  }

  chLabels = computed(() => (this.attr()?.channels ?? []).map((c) => channelLabel(c.channel)));
  chSeries = computed<ChartSeries[]>(() => [{ name: 'Attributed revenue', values: (this.attr()?.channels ?? []).map((c) => c.revenue), slot: 1 }]);
  funnelSeries = computed<ChartSeries[]>(() => {
    const t = this.funnel()?.total;
    return [{ name: 'Sessions', values: t ? [t.sessions, t.product_view, t.add_to_cart, t.checkout_started, t.purchase] : [], slot: 1 }];
  });

  pathLabel(path: string): string {
    return path.split(' → ').map(channelLabel).join(' → ');
  }
}
