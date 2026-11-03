import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { StoreService } from './store.service';

export interface Metrics {
  date: string;
  spend: number;
  revenue: number;
  orders: number;
  new_customers: number;
  new_customer_revenue: number;
  cogs: number;
  profit: number;
  aov: number | null;
  cac: number | null;
  mer: number | null;
  nc_roas: number | null;
  poas: number | null;
  ctr: number | null;
  cpc: number | null;
  impressions: number;
  clicks: number;
}

export interface BlendedResult {
  range: { from: string; to: string; days: number; previous_from: string; previous_to: string };
  granularity: 'day' | 'week' | 'month';
  totals: Metrics;
  deltas: Record<string, { previous: number | null; change_pct: number | null }>;
  series: Metrics[];
  data_quality: { has_ad_spend: boolean; has_orders: boolean; cogs_coverage: number | null; notes: string[] };
}

export interface PlatformRow {
  platform: string;
  label: string;
  campaign_id?: string;
  campaign_name?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  spend_share_pct: number | null;
  platform_roas: number | null;
  cpc: number | null;
  ctr: number | null;
  cpm: number | null;
  cost_per_conversion: number | null;
}

export interface ChannelsResult {
  range: { from: string; to: string };
  total_spend: number;
  platforms: PlatformRow[];
  campaigns: PlatformRow[];
}

export interface AttributionChannel {
  channel: string;
  orders: number;
  revenue: number;
  spend: number;
  roas: number | null;
  cac: number | null;
  platform_reported_revenue: number | null;
  platform_reported_roas: number | null;
  share_pct: number | null;
}

export interface AttributionResult {
  model: string;
  models: string[];
  range: { from: string; to: string };
  lookback_days: number;
  tracked_purchases: number;
  tracked_revenue: number;
  store_orders: number;
  pixel_match_rate_pct: number | null;
  avg_touches_before_purchase: number | null;
  avg_days_to_purchase: number | null;
  channels: AttributionChannel[];
  campaigns: { channel: string; campaign: string; orders: number; revenue: number }[];
  top_paths: { path: string; purchases: number }[];
}

export interface FunnelRow {
  name: string;
  sessions: number;
  product_view: number;
  add_to_cart: number;
  checkout_started: number;
  purchase: number;
  conversion_rate_pct: number | null;
  add_to_cart_rate_pct: number | null;
}

export interface FunnelResult {
  range: { from: string; to: string };
  total: FunnelRow;
  channels: FunnelRow[];
}

export interface PixelInfo {
  key: string;
  script_url: string;
  snippet: string;
  status: { total_events: number; last_event_at: string | null; last_24h: Record<string, number>; receiving: boolean };
}

export interface CohortRow {
  cohort: string;
  customers: number;
  ltv_by_month: (number | null)[];
  retention_by_month: (number | null)[];
}

export interface CohortsResult {
  months: number;
  cohorts: CohortRow[];
  summary: { identified_customers: number; repeat_rate_pct: number | null; avg_orders_per_customer: number | null; avg_revenue_per_customer: number | null };
}

export interface RfmResult {
  customers: number;
  segments: { segment: string; customers: number; revenue: number; orders: number; avg_order_value: number | null }[];
}

export interface ProductRow {
  product_id: string | null;
  title: string;
  image_url: string | null;
  units: number;
  revenue: number;
  cogs: number | null;
  profit: number | null;
  margin_pct: number | null;
  revenue_share_pct: number | null;
  days_of_stock: number | null;
}

export interface AlertItem {
  metric: string;
  label: string;
  severity: 'critical' | 'warning' | 'info';
  direction: 'up' | 'down';
  recent_avg: number | null;
  baseline_avg: number | null;
  change_pct: number | null;
  message: string;
}

export interface Experiment {
  id: string;
  name: string;
  platform: string;
  metric: 'orders' | 'revenue';
  hypothesis: string;
  start_date: string;
  end_date: string;
  pre_period_days: number;
  treatment_cities: string[];
  control_cities: string[];
  status: 'scheduled' | 'running' | 'completed';
  created_at: string;
}

export interface ExperimentAnalysis {
  experiment: Experiment;
  ready: boolean;
  issues: string[];
  metric_label?: string;
  windows?: { pre: { from: string; to: string }; test: { from: string; to: string } };
  pre_series?: { date: string; actual: number; counterfactual: number }[];
  series?: { date: string; actual: number; counterfactual: number; lower: number; upper: number; diff: number; control: number }[];
  summary?: {
    actual_total: number;
    counterfactual_total: number;
    incremental_total: number;
    relative_lift_pct: number | null;
    ci95: [number, number];
    z_score: number;
    p_value: number;
    significant: boolean;
    incremental_revenue: number | null;
    platform_spend: number;
    iroas: number | null;
  };
  validity?: { metric: string; value: string | number; status: 'OK' | 'Warning' }[];
  notes?: string[];
}

export interface ExperimentSuggestion {
  feasible: boolean;
  reason?: string;
  cities?: { city: string; orders: number }[];
  treatment_cities?: string[];
  control_cities?: string[];
  treatment_daily_orders?: number;
  control_daily_orders?: number;
  fit_r2?: number;
  duration_days?: number;
  min_detectable_lift_pct?: number | null;
  guidance?: string;
}

export interface Audience {
  id: string;
  name: string;
  description: string;
  source: 'pixel' | 'orders';
  reachable: number;
  anonymous_visitors: number;
  assumed_recovery_pct: number;
  estimated_impact: number | null;
  aov: number | null;
}

export interface AudiencesResult {
  audiences: Audience[];
  klaviyo_connected: boolean;
  capi: { pixel_id: string; test_event_code: string; has_token: boolean; saved_at: string } | null;
}

export interface Connector {
  id: string;
  name: string;
  category: string;
  description: string;
  support: 'native' | 'import' | 'planned';
  configured: boolean;
  integration?: string;
  platform?: string;
  sync?: string;
  pixel?: boolean;
  klaviyo?: boolean;
  capi?: boolean;
}

export interface AskResult {
  answer: string;
  sources: { tool: string; args: Record<string, unknown> }[];
}

@Injectable({ providedIn: 'root' })
export class MarketingService {
  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private stores: StoreService
  ) {}

  get storeId(): string | null {
    return this.stores.activeStore()?.id ?? null;
  }

  private headers(): HttpHeaders {
    const token = this.auth.getAccessToken();
    return new HttpHeaders({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  }

  private url(path: string): string {
    const id = this.storeId;
    if (!id) throw new Error('No active store selected.');
    return `${environment.apiUrl}/marketing/${id}/${path}`;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p = p.set(k, String(v));
    const res: any = await firstValueFrom(this.http.get(this.url(path), { headers: this.headers(), params: p }));
    return res.data as T;
  }

  private async send<T>(method: 'post' | 'put' | 'delete', path: string, body: unknown = {}, params: Record<string, string> = {}): Promise<T> {
    const opts = { headers: this.headers(), params: new HttpParams({ fromObject: params }) };
    const res: any = await firstValueFrom(
      method === 'delete' ? this.http.delete(this.url(path), opts) : this.http[method](this.url(path), body, opts)
    );
    return res.data as T;
  }

  /** Pull a readable message out of an HttpErrorResponse. */
  errorMessage(err: any, fallback = 'Something went wrong.'): string {
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }

  blended(q: { from?: string; to?: string; granularity?: string; platform?: string }) { return this.get<BlendedResult>('blended', q); }
  channels(q: { from?: string; to?: string }) { return this.get<ChannelsResult>('channels', q); }
  cohorts() { return this.get<CohortsResult>('cohorts'); }
  rfm() { return this.get<RfmResult>('rfm'); }
  products(q: { from?: string; to?: string }) { return this.get<{ products: ProductRow[] }>('products', q); }
  alerts() { return this.get<{ alerts: AlertItem[]; checked_days: number }>('alerts'); }

  importAdSpend(rows: Record<string, unknown>[], source: 'csv' | 'manual') { return this.send<{ inserted: number; updated: number }>('post', 'ad-spend', { rows, source }); }
  clearAdSpend(source?: string) { return this.send<{ removed: number }>('delete', 'ad-spend', {}, source ? { source } : {}); }
  syncMeta(days: number) { return this.send<{ since: string; until: string; rows: number; inserted: number; updated: number }>('post', 'ad-spend/sync-meta', { days }); }

  pixel() { return this.get<PixelInfo>('pixel'); }
  rotatePixel() { return this.send<{ key: string }>('post', 'pixel/rotate'); }
  attribution(q: { model?: string; from?: string; to?: string }) { return this.get<AttributionResult>('attribution', q); }
  funnel(q: { from?: string; to?: string }) { return this.get<FunnelResult>('funnel', q); }

  experiments() { return this.get<Experiment[]>('experiments'); }
  analyzeExperiment(id: string) { return this.get<ExperimentAnalysis>(`experiments/${id}`); }
  suggestExperiment(durationDays: number) { return this.get<ExperimentSuggestion>('experiments/suggest', { duration_days: durationDays }); }
  createExperiment(body: Partial<Experiment>) { return this.send<Experiment>('post', 'experiments', body); }
  deleteExperiment(id: string) { return this.send<{ deleted: boolean }>('delete', `experiments/${id}`); }

  audiences() { return this.get<AudiencesResult>('audiences'); }
  saveKlaviyo(apiKey: string) { return this.send<{ connected: boolean }>('put', 'klaviyo', { api_key: apiKey }); }
  klaviyoLists() { return this.get<{ id: string; name: string }[]>('klaviyo/lists'); }
  pushKlaviyo(audienceId: string, listId: string) { return this.send<{ sent: number; skipped_without_email: number }>('post', `audiences/${audienceId}/klaviyo`, { list_id: listId }); }
  saveCapi(body: { pixel_id: string; access_token?: string; test_event_code?: string }) { return this.send<unknown>('put', 'capi', body); }
  sendCapi() { return this.send<{ sent: number; message?: string; events_received?: number | null; test_mode?: boolean }>('post', 'capi/send', { days: 7 }); }

  /** Download an audience as CSV through an authenticated request (a plain link would lose the bearer token). */
  async downloadAudience(id: string, format: 'csv' | 'meta'): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(this.url(`audiences/${id}/export`), { headers: this.headers(), params: new HttpParams().set('format', format), responseType: 'blob' })
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${id}${format === 'meta' ? '-meta-hashed' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  connectors() { return this.get<Connector[]>('connectors'); }
  ask(question: string) { return this.send<AskResult>('post', 'ask', { question }); }
}
