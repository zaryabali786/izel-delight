import { Component, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MarketingService, PixelInfo } from '../../../core/services/marketing.service';

const PLATFORM_IDS = ['meta-ads', 'google-ads', 'tiktok-ads', 'snapchat-ads', 'pinterest-ads', 'bing-ads', 'twitter-ads', 'other'];
const CSV_TEMPLATE = 'date,platform,campaign,spend,impressions,clicks,conversions,revenue\n2026-05-01,google-ads,Brand search,12000,40000,900,25,98000\n';

/** Minimal CSV reader: handles quoted fields and escaped quotes; enough for ad-platform exports. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

@Component({
  selector: 'app-connect-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (message()) {<div class="notice" [class.error]="kind() === 'error'" [class.good]="kind() === 'ok'">{{ message() }}</div>}

    <div class="grid cols-2">
      <!-- Pixel -->
      <div class="mk-card" id="pixel">
        <div class="row"><h3 style="margin:0">Storefront pixel</h3><span class="spacer"></span>
          @if (pixel(); as p) {<span class="pill" [class.ok]="p.status.receiving" [class.warn]="!p.status.receiving">{{ p.status.receiving ? 'Receiving events' : 'Waiting for events' }}</span>}
        </div>
        <p class="lead">A first-party script that records sessions, product views, add to cart, checkout and purchases, with UTM and ad click IDs. It powers attribution, funnels and the abandoned-cart audiences.</p>
        @if (pixel(); as p) {
          <p class="muted" style="margin:0 0 6px">Add this inside <span class="mono">&lt;head&gt;</span> of your Shopify theme (<span class="mono">theme.liquid</span>):</p>
          <code class="block">{{ p.snippet }}</code>
          <div class="row" style="margin-top:8px">
            <button type="button" class="btn small" (click)="copy(p.snippet)">Copy snippet</button>
            <button type="button" class="btn small danger" (click)="rotate()">Rotate key</button>
            <span class="muted">{{ p.status.total_events }} events stored{{ p.status.last_event_at ? ', last ' + (p.status.last_event_at | date: 'medium') : '' }}</span>
          </div>
          <p class="muted" style="margin:10px 0 0">Purchases are captured from Shopify's order status page. Stores on the newer checkout can't run theme scripts there, so purchase tracking may need a Shopify Custom Pixel calling <span class="mono">dbpixel.track('purchase', …)</span>.</p>
        } @else {<div class="empty">Loading…</div>}
      </div>

      <!-- Ad spend -->
      <div class="mk-card" id="adspend">
        <h3>Ad spend</h3>
        <p class="lead">CAC, MER and POAS need spend. Sync Meta automatically, or import any platform from a CSV.</p>

        <div class="block">
          <b>Meta Ads (automatic)</b>
          <div class="row" style="margin-top:6px">
            <select class="sel" [ngModel]="syncDays()" (ngModelChange)="syncDays.set(+$event)"><option [value]="7">Last 7 days</option><option [value]="30">Last 30 days</option><option [value]="90">Last 90 days</option></select>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="syncMeta()">{{ busy() ? 'Working…' : 'Sync from Meta' }}</button>
          </div>
          <p class="muted" style="margin:6px 0 0">Uses the ad account ID and token saved in Integrations.</p>
        </div>

        <div class="block">
          <b>Import CSV (any platform)</b>
          <div class="row" style="margin-top:6px">
            <select class="sel" [ngModel]="importPlatform()" (ngModelChange)="importPlatform.set($event)">
              @for (p of platformIds; track p) {<option [value]="p">{{ p }}</option>}
            </select>
            <input type="file" accept=".csv,text/csv" (change)="onFile($event)" #f />
            <button type="button" class="btn small" (click)="downloadTemplate()">Template</button>
          </div>
          @if (parsed().length) {
            <p class="muted" style="margin:6px 0">{{ parsed().length }} rows ready (platform column overrides the selector).</p>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="importRows()">Import {{ parsed().length }} rows</button>
          }
        </div>

        <div class="block">
          <b>Add one day manually</b>
          <div class="grid cols-2" style="gap:8px;margin-top:6px">
            <label class="field">Date<input type="date" [ngModel]="manual().date" (ngModelChange)="patchManual({ date: $event })" /></label>
            <label class="field">Platform<select [ngModel]="manual().platform" (ngModelChange)="patchManual({ platform: $event })">@for (p of platformIds; track p) {<option [value]="p">{{ p }}</option>}</select></label>
            <label class="field">Spend<input type="number" min="0" [ngModel]="manual().spend" (ngModelChange)="patchManual({ spend: $event })" /></label>
            <label class="field">Campaign (optional)<input type="text" [ngModel]="manual().campaign" (ngModelChange)="patchManual({ campaign: $event })" /></label>
          </div>
          <button type="button" class="btn small" style="margin-top:8px" [disabled]="busy() || !manual().date || !manual().spend" (click)="addManual()">Add</button>
        </div>

        <button type="button" class="btn small danger" [disabled]="busy()" (click)="clearImported()">Remove all imported spend</button>
      </div>
    </div>

    <div class="mk-card mt">
      <h3>Other connections</h3>
      <p class="lead" style="margin:0 0 10px">Sign in to Meta, Google, TikTok, Snapchat or Pinterest, link Shopify, WhatsApp and your couriers from the Connectors page.</p>
      <button type="button" class="btn primary" (click)="openConnectors()">Open Connectors</button>
    </div>
  `,
  styles: [
    `
      .block { padding: 12px 0; border-top: 1px solid var(--app-card-border); }
      .sel { padding: 7px 10px; border-radius: 10px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: inherit; font: inherit; font-size: 13px; }
    `
  ]
})
export class ConnectTab {
  currency = input<string>('');
  storeKey = input<string>('');

  readonly platformIds = PLATFORM_IDS;

  pixel = signal<PixelInfo | null>(null);
  busy = signal<boolean>(false);
  message = signal<string>('');
  kind = signal<'ok' | 'error' | ''>('');

  syncDays = signal<number>(30);
  importPlatform = signal<string>('google-ads');
  parsed = signal<Record<string, unknown>[]>([]);
  manual = signal({ date: new Date().toISOString().slice(0, 10), platform: 'meta-ads', spend: 0 as number | string, campaign: '' });


  constructor(
    private mk: MarketingService,
    private router: Router
  ) {
    effect(() => {
      this.storeKey();
      this.load();
    });
  }

  private say(text: string, kind: 'ok' | 'error' = 'ok'): void {
    this.message.set(text);
    this.kind.set(kind);
  }

  async load(): Promise<void> {
    try {
      this.pixel.set(await this.mk.pixel());
    } catch (e) {
      this.say(this.mk.errorMessage(e, 'Could not load connectors.'), 'error');
    }
  }

  openConnectors(): void {
    this.router.navigate(['/dashboard/integrations']);
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.say('Copied to clipboard.');
    } catch {
      this.say('Could not copy; select the text and copy it manually.', 'error');
    }
  }

  async rotate(): Promise<void> {
    if (!confirm('Rotate the pixel key? The snippet on your storefront stops working until you paste the new one.')) return;
    try {
      await this.mk.rotatePixel();
      await this.load();
      this.say('New pixel key generated. Update the snippet on your store.');
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    }
  }

  async syncMeta(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.mk.syncMeta(this.syncDays());
      this.say(`Synced ${r.rows} campaign-days from Meta (${r.since} to ${r.until}): ${r.inserted} new, ${r.updated} updated.`);
      await this.load();
    } catch (e) {
      this.say(this.mk.errorMessage(e, 'Meta sync failed.'), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  onFile(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return this.say('That file is larger than 5 MB.', 'error');
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ''));
      const mapped = rows
        .filter((r) => r['date'] && r['spend'] !== undefined)
        .map((r) => ({
          date: r['date'],
          platform: (r['platform'] || this.importPlatform()).toLowerCase(),
          campaign_name: r['campaign'] || r['campaign_name'] || '',
          spend: r['spend'],
          impressions: r['impressions'],
          clicks: r['clicks'],
          conversions: r['conversions'],
          revenue: r['revenue']
        }));
      this.parsed.set(mapped);
      if (mapped.length === 0) this.say('No usable rows. The CSV needs at least "date" and "spend" columns.', 'error');
      else this.message.set('');
    };
    reader.readAsText(file);
  }

  async importRows(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.mk.importAdSpend(this.parsed(), 'csv');
      this.say(`Imported: ${r.inserted} new rows, ${r.updated} updated.`);
      this.parsed.set([]);
      await this.load();
    } catch (e) {
      this.say(this.mk.errorMessage(e, 'Import failed.'), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  patchManual(p: Partial<ReturnType<typeof this.manual>>): void {
    this.manual.update((m) => ({ ...m, ...p }));
  }

  async addManual(): Promise<void> {
    const m = this.manual();
    this.busy.set(true);
    try {
      await this.mk.importAdSpend([{ date: m.date, platform: m.platform, campaign_name: m.campaign, spend: Number(m.spend) }], 'manual');
      this.say('Spend saved.');
      this.patchManual({ spend: 0 });
      await this.load();
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  async clearImported(): Promise<void> {
    if (!confirm('Remove ALL imported ad spend (CSV, manual and Meta sync) for this store?')) return;
    this.busy.set(true);
    try {
      const r = await this.mk.clearAdSpend();
      this.say(`Removed ${r.removed} spend rows.`);
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  downloadTemplate(): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    a.download = 'ad-spend-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
