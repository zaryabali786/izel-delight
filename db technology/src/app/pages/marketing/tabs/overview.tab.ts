import { Component, EventEmitter, Output, computed, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BlendedResult, ChannelsResult, MarketingService } from '../../../core/services/marketing.service';
import { ChartComponent, ChartSeries } from '../../../shared/components/chart/chart.component';
import { money, num, pct, ratio, channelLabel } from './format';

interface Kpi {
  key: string;
  label: string;
  value: string;
  delta: number | null;
  prev: string;
  /** For cost metrics (CAC, spend) a decrease is the good direction. */
  lowerIsBetter: boolean;
  hint: string;
}

@Component({
  selector: 'app-overview-tab',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (error()) {<div class="notice error">{{ error() }}</div>}
    @if (data(); as d) {
      @for (n of d.data_quality.notes; track n) {<div class="notice">{{ n }}</div>}

      <div class="grid cols-4">
        @for (k of kpis(); track k.key) {
          <div class="mk-card kpi" [title]="k.hint">
            <div class="label">{{ k.label }}</div>
            <div class="value">{{ k.value }}</div>
            <div>
              <span class="delta" [class.up]="trend(k) === 'good'" [class.down]="trend(k) === 'bad'" [class.flat]="trend(k) === 'flat'">
                {{ k.delta === null ? '–' : (k.delta > 0 ? '▲ ' : k.delta < 0 ? '▼ ' : '') + (k.delta < 0 ? -k.delta : k.delta) + '%' }}
              </span>
              <span class="prev">was {{ k.prev }}</span>
            </div>
          </div>
        }
      </div>

      <div class="row mt">
        <h3 style="margin:0">Blended performance</h3>
        <span class="spacer"></span>
        <div class="seg">
          @for (g of grains; track g) {
            <button type="button" [class.on]="granularity() === g" (click)="granularity.set(g)">{{ g }}</button>
          }
        </div>
      </div>

      <div class="grid cols-2 mt">
        <div class="mk-card">
          <app-chart title="Ad spend" [subtitle]="'Per ' + granularity()" [labels]="labels()" [series]="spendSeries()" type="bar" format="money" [currency]="currency()" />
        </div>
        <div class="mk-card">
          <app-chart title="Blended CAC" subtitle="Ad spend per new customer" [labels]="labels()" [series]="cacSeries()" format="money" [currency]="currency()" />
        </div>
        <div class="mk-card">
          <app-chart title="Total sales" [subtitle]="'Per ' + granularity()" [labels]="labels()" [series]="salesSeries()" type="bar" format="money" [currency]="currency()" />
        </div>
        <div class="mk-card">
          <app-chart title="Return on ad spend" subtitle="MER = revenue / spend, POAS = profit / spend" [labels]="labels()" [series]="roasSeries()" format="x" />
        </div>
      </div>
    }

    <div class="mk-card mt">
      <div class="row">
        <div>
          <h3>Channels</h3>
          <p class="lead">What each ad platform spent and claims it drove. Platform-reported results are the platform's own attribution; compare with the Attribution tab.</p>
        </div>
        <span class="spacer"></span>
        <div class="seg">
          <button type="button" [class.on]="!showCampaigns()" (click)="showCampaigns.set(false)">Platforms</button>
          <button type="button" [class.on]="showCampaigns()" (click)="showCampaigns.set(true)">Campaigns</button>
        </div>
      </div>

      @if (rows().length === 0) {
        <div class="empty">
          No ad spend in this period.
          <button type="button" class="btn small primary" (click)="goto.emit('connect')">Connect or import ad spend</button>
        </div>
      } @else {
        <div class="table-scroll">
          <table class="data">
            <thead>
              <tr>
                <th>{{ showCampaigns() ? 'Campaign' : 'Platform' }}</th><th>Spend</th><th>Share</th><th>Platform ROAS</th><th>Conversions</th><th>Cost / conv.</th><th>CPC</th><th>CTR</th><th>CPM</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track $index) {
                <tr>
                  <td class="name">{{ showCampaigns() ? r.campaign_name + ' · ' + label(r.platform) : r.label }}</td>
                  <td>{{ money(r.spend) }}</td><td>{{ pct(r.spend_share_pct, 0) }}</td><td>{{ ratio(r.platform_roas) }}</td>
                  <td>{{ num(r.conversions) }}</td><td>{{ money(r.cost_per_conversion) }}</td><td>{{ money(r.cpc, currency(), 1) }}</td><td>{{ pct(r.ctr, 2) }}</td><td>{{ money(r.cpm) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (loading() && !data()) {<div class="empty">Loading…</div>}
  `,
  styles: [
    `
      .seg { display: inline-flex; border: 1px solid var(--app-card-border); border-radius: 9px; overflow: hidden; }
      .seg button { background: transparent; color: inherit; border: 0; padding: 5px 12px; font-size: 12px; text-transform: capitalize; cursor: pointer; }
      .seg button.on { background: rgba(99, 102, 241, 0.22); color: var(--ink-accent); font-weight: 600; }
    `
  ]
})
export class OverviewTab {
  from = input.required<string>();
  to = input.required<string>();
  currency = input<string>('');
  storeKey = input<string>('');
  @Output() goto = new EventEmitter<'connect'>();

  readonly grains = ['day', 'week', 'month'] as const;
  granularity = signal<'day' | 'week' | 'month'>('day');
  showCampaigns = signal<boolean>(false);

  data = signal<BlendedResult | null>(null);
  channelData = signal<ChannelsResult | null>(null);
  loading = signal<boolean>(false);
  error = signal<string>('');

  readonly money = (v: number | null | undefined, cur = this.currency(), dp = 0) => money(v, cur, dp);
  readonly num = num;
  readonly pct = pct;
  readonly ratio = ratio;
  readonly label = channelLabel;

  constructor(private mk: MarketingService) {
    effect(() => {
      this.storeKey();
      this.load(this.from(), this.to(), this.granularity());
    });
  }

  private async load(from: string, to: string, granularity: string): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [b, c] = await Promise.all([this.mk.blended({ from, to, granularity }), this.mk.channels({ from, to })]);
      this.data.set(b);
      this.channelData.set(c);
    } catch (e) {
      this.error.set(this.mk.errorMessage(e, 'Could not load marketing data.'));
    } finally {
      this.loading.set(false);
    }
  }

  labels = computed(() => (this.data()?.series ?? []).map((s) => s.date));
  private col(key: 'spend' | 'cac' | 'revenue' | 'mer' | 'poas'): (number | null)[] {
    return (this.data()?.series ?? []).map((s) => s[key] as number | null);
  }
  spendSeries = computed<ChartSeries[]>(() => [{ name: 'Spend', values: this.col('spend'), slot: 1 }]);
  cacSeries = computed<ChartSeries[]>(() => [{ name: 'Blended CAC', values: this.col('cac'), slot: 2 }]);
  salesSeries = computed<ChartSeries[]>(() => [{ name: 'Total sales', values: this.col('revenue'), slot: 3 }]);
  roasSeries = computed<ChartSeries[]>(() => [
    { name: 'MER', values: this.col('mer'), slot: 1 },
    { name: 'POAS', values: this.col('poas'), slot: 2 }
  ]);

  rows = computed(() => {
    const c = this.channelData();
    return c ? (this.showCampaigns() ? c.campaigns : c.platforms) : [];
  });

  kpis = computed<Kpi[]>(() => {
    const d = this.data();
    if (!d) return [];
    const t = d.totals;
    const cur = this.currency();
    const dl = d.deltas;
    const mk = (key: string, label: string, value: string, prevVal: number | null, fmt: (v: number | null) => string, lowerIsBetter: boolean, hint: string): Kpi => ({
      key, label, value, delta: dl[key]?.change_pct ?? null, prev: fmt(prevVal), lowerIsBetter, hint
    });
    const m = (v: number | null) => money(v, cur);
    return [
      mk('cac', 'Blended CAC', m(t.cac), dl['cac'].previous, m, true, 'Ad spend / new customers'),
      mk('mer', 'Blended ROAS (MER)', ratio(t.mer), dl['mer'].previous, ratio, false, 'Total revenue / total ad spend'),
      mk('poas', 'POAS', ratio(t.poas), dl['poas'].previous, ratio, false, 'Profit on ad spend: (revenue - COGS) / spend'),
      mk('nc_roas', 'New-customer ROAS', ratio(t.nc_roas), dl['nc_roas'].previous, ratio, false, 'First-order revenue / ad spend'),
      mk('revenue', 'Total sales', m(t.revenue), dl['revenue'].previous, m, false, 'Gross order revenue'),
      mk('spend', 'Ad spend', m(t.spend), dl['spend'].previous, m, true, 'All imported / synced ad spend'),
      mk('orders', 'Orders', num(t.orders), dl['orders'].previous, (v) => num(v), false, 'Non-cancelled orders'),
      mk('aov', 'Average order value', m(t.aov), dl['aov'].previous, m, false, 'Revenue / orders')
    ];
  });

  trend(k: Kpi): 'good' | 'bad' | 'flat' {
    if (k.delta === null || k.delta === 0) return 'flat';
    return (k.delta > 0) !== k.lowerIsBetter ? 'good' : 'bad';
  }
}
