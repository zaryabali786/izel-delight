import { Component, computed, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Experiment, ExperimentAnalysis, ExperimentSuggestion, MarketingService } from '../../../core/services/marketing.service';
import { ChartBand, ChartComponent, ChartSeries } from '../../../shared/components/chart/chart.component';
import { channelLabel, money, num, pct, ratio } from './format';

type Role = 'exclude' | 'treatment' | 'control';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => ymd(new Date(Date.now() + n * 86400000));

@Component({
  selector: 'app-incrementality-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ChartComponent],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (error()) {<div class="notice error">{{ error() }}</div>}

    @if (view() === 'list') {
      <div class="row">
        <div>
          <h3 style="margin:0">Incrementality experiments</h3>
          <p class="muted" style="margin:4px 0 0">Geo holdouts that show how many orders a channel really causes, instead of how many it claims.</p>
        </div>
        <span class="spacer"></span>
        <button type="button" class="btn primary" (click)="openDesigner()">+ Design an experiment</button>
      </div>

      @if (experiments().length === 0 && !loading()) {
        <div class="mk-card mt">
          <div class="empty">
            No experiments yet. A geo holdout switches a channel off in some cities for a few weeks and compares them with cities where it stays on.
            <br /><button type="button" class="btn primary small" style="margin-top:10px" (click)="openDesigner()">Design your first experiment</button>
          </div>
        </div>
      }

      <div class="grid cols-2 mt">
        @for (e of experiments(); track e.id) {
          <div class="mk-card exp" (click)="open(e)" tabindex="0" (keydown.enter)="open(e)">
            <div class="row">
              <b>{{ e.name }}</b><span class="spacer"></span>
              <span class="pill" [class.ok]="e.status === 'completed'" [class.warn]="e.status === 'running'" [class.info]="e.status === 'scheduled'">{{ e.status }}</span>
            </div>
            <div class="muted">{{ label(e.platform) }} · {{ e.metric }} · {{ e.start_date }} to {{ e.end_date }}</div>
            <div class="muted">{{ e.treatment_cities.length }} treatment / {{ e.control_cities.length }} control cities</div>
            @if (e.hypothesis) {<div class="muted">“{{ e.hypothesis }}”</div>}
          </div>
        }
      </div>
    }

    @if (view() === 'design') {
      <div class="row"><button type="button" class="btn small" (click)="view.set('list')">← Back</button><h3 style="margin:0">Design an experiment</h3></div>

      <div class="grid cols-2 mt">
        <div class="mk-card">
          <h3>Setup</h3>
          <div class="grid" style="gap:12px">
            <label class="field">Name<input type="text" [ngModel]="form().name" (ngModelChange)="patch({ name: $event })" placeholder="Meta top of funnel" /></label>
            <label class="field">Hypothesis (optional)<input type="text" [ngModel]="form().hypothesis" (ngModelChange)="patch({ hypothesis: $event })" placeholder="Meta prospecting drives incremental first orders" /></label>
            <div class="grid cols-2" style="gap:12px">
              <label class="field">Channel being tested
                <select [ngModel]="form().platform" (ngModelChange)="patch({ platform: $event })">
                  @for (p of platforms; track p) {<option [value]="p">{{ label(p) }}</option>}
                </select>
              </label>
              <label class="field">Outcome
                <select [ngModel]="form().metric" (ngModelChange)="patch({ metric: $event })"><option value="orders">Orders</option><option value="revenue">Revenue</option></select>
              </label>
              <label class="field">Start date<input type="date" [ngModel]="form().start_date" (ngModelChange)="patch({ start_date: $event })" /></label>
              <label class="field">End date<input type="date" [ngModel]="form().end_date" (ngModelChange)="patch({ end_date: $event })" /></label>
              <label class="field">Pre-period (days of history used)<input type="number" min="14" max="120" [ngModel]="form().pre_period_days" (ngModelChange)="patch({ pre_period_days: +$event })" /></label>
            </div>
          </div>
        </div>

        <div class="mk-card">
          <h3>Geography</h3>
          <p class="lead">Treatment cities keep the channel running. Control cities have it switched off for the whole test. Everything else is left out.</p>
          @if (suggestion(); as s) {
            @if (!s.feasible) {
              <div class="notice">{{ s.reason }}</div>
            } @else {
              <div class="notice good">
                Suggested balanced split ready. With {{ s.duration_days }} days it could detect a lift of about
                <b>{{ s.min_detectable_lift_pct === null ? '–' : s.min_detectable_lift_pct + '%' }}</b> (control fit R² {{ s.fit_r2 }}).
                {{ s.guidance }}
                <button type="button" class="btn small" style="margin-left:8px" (click)="applySuggestion()">Use suggestion</button>
              </div>
            }
          } @else {
            <div class="muted">Analysing your order history…</div>
          }
          <div class="table-scroll" style="max-height:300px;overflow:auto">
            <table class="data">
              <thead><tr><th>City</th><th>Orders (90d)</th><th>Role</th></tr></thead>
              <tbody>
                @for (c of cityList(); track c.city) {
                  <tr>
                    <td>{{ c.city }}</td><td>{{ num(c.orders) }}</td>
                    <td>
                      <select [ngModel]="roles()[c.city] || 'exclude'" (ngModelChange)="setRole(c.city, $event)">
                        <option value="exclude">Exclude</option><option value="treatment">Treatment</option><option value="control">Control</option>
                      </select>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      @if (formError()) {<div class="notice error mt">{{ formError() }}</div>}
      <div class="row mt"><span class="spacer"></span><button type="button" class="btn primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Create experiment' }}</button></div>
    }

    @if (view() === 'detail' && selected(); as e) {
      <div class="row">
        <button type="button" class="btn small" (click)="view.set('list'); load()">← Back</button>
        <h3 style="margin:0">{{ e.name }}</h3><span class="spacer"></span>
        <button type="button" class="btn small danger" (click)="remove(e)">Delete</button>
      </div>

      <div class="mk-card mt">
        <div class="meta">
          <div><span class="muted">Status</span><b><span class="pill" [class.ok]="e.status === 'completed'" [class.warn]="e.status === 'running'" [class.info]="e.status === 'scheduled'">{{ e.status }}</span></b></div>
          <div><span class="muted">Start date</span><b>{{ e.start_date }}</b></div>
          <div><span class="muted">End date</span><b>{{ e.end_date }}</b></div>
          <div><span class="muted">Platform</span><b>{{ label(e.platform) }}</b></div>
          <div><span class="muted">Primary outcome</span><b>{{ e.metric === 'orders' ? 'Orders' : 'Revenue' }}</b></div>
        </div>
      </div>

      @if (analysis(); as a) {
        @if (!a.ready) {
          <div class="notice mt">{{ a.issues.join(' ') }}</div>
        } @else {
          @for (i of a.issues; track i) {<div class="notice mt">{{ i }}</div>}

          @if (a.summary; as s) {
            <div class="grid cols-4 mt">
              <div class="mk-card kpi"><div class="label">Incremental {{ a.metric_label?.toLowerCase() }}</div><div class="value">{{ num(s.incremental_total, 0) }}</div><div class="hint">95% CI {{ num(s.ci95[0]) }} to {{ num(s.ci95[1]) }}</div></div>
              <div class="mk-card kpi"><div class="label">Lift vs counterfactual</div><div class="value">{{ pct(s.relative_lift_pct) }}</div><div class="hint"><span class="pill" [class.ok]="s.significant" [class.warn]="!s.significant">{{ s.significant ? 'Significant' : 'Not significant' }}</span> {{ s.p_value < 0.001 ? 'p < 0.001' : 'p = ' + s.p_value }}</div></div>
              <div class="mk-card kpi"><div class="label">Incremental revenue</div><div class="value">{{ money(s.incremental_revenue) }}</div><div class="hint">Spend in test: {{ money(s.platform_spend) }}</div></div>
              <div class="mk-card kpi"><div class="label">Incremental ROAS</div><div class="value">{{ ratio(s.iroas) }}</div><div class="hint">Caused revenue / spend</div></div>
            </div>
          }

          <div class="grid cols-2 mt">
            <div class="mk-card"><app-chart [title]="'Treatment ' + (a.metric_label || '')" subtitle="Actual vs what would have happened without the change" [labels]="chartLabels()" [series]="mainSeries()" [band]="band()" [marker]="marker()" [format]="a.experiment.metric === 'revenue' ? 'money' : 'number'" [currency]="currency()" /></div>
            <div class="mk-card"><app-chart title="Daily difference" subtitle="Actual minus counterfactual, test days" [labels]="testLabels()" [series]="diffSeries()" type="bar" [format]="a.experiment.metric === 'revenue' ? 'money' : 'number'" [currency]="currency()" /></div>
            <div class="mk-card"><app-chart title="Cumulative difference" subtitle="Running total of the daily gap" [labels]="testLabels()" [series]="cumSeries()" [format]="a.experiment.metric === 'revenue' ? 'money' : 'number'" [currency]="currency()" /></div>
            <div class="mk-card">
              <h3>Validity checks</h3>
              <p class="lead">Warnings mean the counterfactual is less trustworthy. Read results with care.</p>
              <table class="data">
                <thead><tr><th>Check</th><th>Value</th><th>Status</th></tr></thead>
                <tbody>@for (v of a.validity; track v.metric) {<tr><td>{{ v.metric }}</td><td>{{ v.value }}</td><td><span class="pill" [class.ok]="v.status === 'OK'" [class.warn]="v.status !== 'OK'">{{ v.status }}</span></td></tr>}</tbody>
              </table>
              @for (n of a.notes; track n) {<p class="muted" style="margin:8px 0 0">• {{ n }}</p>}
            </div>
          </div>
        }
      }
      @if (loading()) {<div class="empty">Analysing…</div>}
    }
  `,
  styles: [
    `
      .exp { cursor: pointer; display: flex; flex-direction: column; gap: 4px; &:hover { border-color: rgba(99, 102, 241, 0.5); } }
      .meta { display: flex; gap: 32px; flex-wrap: wrap; div { display: flex; flex-direction: column; gap: 3px; } b { font-size: 14px; } }
    `
  ]
})
export class IncrementalityTab {
  currency = input<string>('');
  storeKey = input<string>('');

  readonly platforms = ['meta-ads', 'google-ads', 'tiktok-ads', 'snapchat-ads'];
  readonly label = channelLabel;
  readonly num = num;
  readonly pct = pct;
  readonly ratio = ratio;
  readonly money = (v: number | null | undefined) => money(v, this.currency());

  view = signal<'list' | 'design' | 'detail'>('list');
  experiments = signal<Experiment[]>([]);
  selected = signal<Experiment | null>(null);
  analysis = signal<ExperimentAnalysis | null>(null);
  suggestion = signal<ExperimentSuggestion | null>(null);
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  error = signal<string>('');
  formError = signal<string>('');

  form = signal({ name: '', hypothesis: '', platform: 'meta-ads', metric: 'orders' as 'orders' | 'revenue', start_date: plusDays(1), end_date: plusDays(21), pre_period_days: 28 });
  roles = signal<Record<string, Role>>({});

  constructor(private mk: MarketingService) {
    effect(() => {
      this.storeKey();
      this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.experiments.set(await this.mk.experiments());
    } catch (e) {
      this.error.set(this.mk.errorMessage(e, 'Could not load experiments.'));
    } finally {
      this.loading.set(false);
    }
  }

  patch(p: Partial<ReturnType<typeof this.form>>): void {
    this.form.update((f) => ({ ...f, ...p }));
  }

  async openDesigner(): Promise<void> {
    this.view.set('design');
    this.formError.set('');
    this.suggestion.set(null);
    try {
      this.suggestion.set(await this.mk.suggestExperiment(21));
    } catch (e) {
      this.suggestion.set({ feasible: false, reason: this.mk.errorMessage(e) });
    }
  }

  cityList = computed(() => this.suggestion()?.cities ?? []);

  applySuggestion(): void {
    const s = this.suggestion();
    if (!s?.feasible) return;
    const r: Record<string, Role> = {};
    for (const c of s.treatment_cities ?? []) r[c] = 'treatment';
    for (const c of s.control_cities ?? []) r[c] = 'control';
    this.roles.set(r);
  }

  setRole(city: string, role: Role): void {
    this.roles.update((r) => ({ ...r, [city]: role }));
  }

  async save(): Promise<void> {
    const f = this.form();
    const r = this.roles();
    const treatment = Object.keys(r).filter((c) => r[c] === 'treatment');
    const control = Object.keys(r).filter((c) => r[c] === 'control');
    this.formError.set('');
    this.saving.set(true);
    try {
      const exp = await this.mk.createExperiment({ ...f, treatment_cities: treatment, control_cities: control });
      await this.load();
      this.open(exp);
    } catch (e) {
      this.formError.set(this.mk.errorMessage(e, 'Could not create the experiment.'));
    } finally {
      this.saving.set(false);
    }
  }

  async open(e: Experiment): Promise<void> {
    this.selected.set(e);
    this.analysis.set(null);
    this.view.set('detail');
    this.loading.set(true);
    try {
      this.analysis.set(await this.mk.analyzeExperiment(e.id));
    } catch (err) {
      this.error.set(this.mk.errorMessage(err, 'Could not analyse the experiment.'));
    } finally {
      this.loading.set(false);
    }
  }

  async remove(e: Experiment): Promise<void> {
    if (!confirm(`Delete experiment "${e.name}"?`)) return;
    try {
      await this.mk.deleteExperiment(e.id);
      this.view.set('list');
      await this.load();
    } catch (err) {
      this.error.set(this.mk.errorMessage(err));
    }
  }

  // ── chart data ──
  private pre = computed(() => this.analysis()?.pre_series ?? []);
  private test = computed(() => this.analysis()?.series ?? []);
  chartLabels = computed(() => [...this.pre().map((p) => p.date), ...this.test().map((t) => t.date)]);
  testLabels = computed(() => this.test().map((t) => t.date));
  marker = computed(() => (this.test().length ? { index: this.pre().length, label: 'Test starts' } : null));

  mainSeries = computed<ChartSeries[]>(() => [
    { name: 'Actual (treatment)', slot: 1, values: [...this.pre().map((p) => p.actual), ...this.test().map((t) => t.actual)] },
    { name: 'Counterfactual', slot: 2, dashed: true, values: [...this.pre().map((p) => p.counterfactual), ...this.test().map((t) => t.counterfactual)] }
  ]);

  band = computed<ChartBand | null>(() => {
    if (!this.test().length) return null;
    const pad = this.pre().map(() => null);
    return { lower: [...pad, ...this.test().map((t) => t.lower)], upper: [...pad, ...this.test().map((t) => t.upper)], label: '95% interval' };
  });

  diffSeries = computed<ChartSeries[]>(() => [{ name: 'Daily difference', slot: 1, values: this.test().map((t) => t.diff) }]);

  cumSeries = computed<ChartSeries[]>(() => {
    let run = 0;
    return [{ name: 'Cumulative difference', slot: 3, values: this.test().map((t) => (run += t.diff)) }];
  });
}
