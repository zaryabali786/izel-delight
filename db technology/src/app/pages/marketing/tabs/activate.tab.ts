import { Component, effect, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Audience, AudiencesResult, MarketingService } from '../../../core/services/marketing.service';
import { money, num } from './format';

@Component({
  selector: 'app-activate-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrls: ['../marketing-shared.scss'],
  template: `
    @if (message()) {<div class="notice" [class.error]="messageKind() === 'error'" [class.good]="messageKind() === 'ok'">{{ message() }}</div>}

    @if (data(); as d) {
      <div class="mk-card hero">
        <div>
          <div class="muted">Estimated monthly impact</div>
          <div class="big">{{ money(totalImpact()) }}</div>
          <div class="muted">Reachable people x your average order value x an assumed recovery rate for each audience. It is an estimate, not a forecast.</div>
        </div>
      </div>

      <div class="grid cols-3 mt">
        @for (a of d.audiences; track a.id) {
          <div class="mk-card aud">
            <div class="row"><b>{{ a.name }}</b><span class="spacer"></span><span class="pill" [class.info]="a.source === 'pixel'">{{ a.source === 'pixel' ? 'Pixel' : 'Orders' }}</span></div>
            <p class="lead">{{ a.description }}</p>
            <div class="stats">
              <div><span class="muted">Reachable</span><b>{{ num(a.reachable) }}</b></div>
              <div><span class="muted">Est. impact</span><b>{{ money(a.estimated_impact) }}</b></div>
              @if (a.source === 'pixel') {<div><span class="muted">Anonymous</span><b>{{ num(a.anonymous_visitors) }}</b></div>}
            </div>
            <div class="muted" style="margin:6px 0 10px">Assumes {{ a.assumed_recovery_pct }}% recovery at {{ money(a.aov) }} AOV.</div>
            <div class="row">
              <button type="button" class="btn small" [disabled]="a.reachable === 0" (click)="download(a, 'csv')">Download CSV</button>
              <button type="button" class="btn small" [disabled]="a.reachable === 0" (click)="download(a, 'meta')" title="SHA-256 hashed email and phone, ready for a Meta Custom Audience">Meta format</button>
              <button type="button" class="btn small primary" [disabled]="a.reachable === 0 || !d.klaviyo_connected" (click)="openKlaviyo(a)" [title]="d.klaviyo_connected ? '' : 'Connect Klaviyo below first'">To Klaviyo</button>
            </div>
          </div>
        }
      </div>

      @if (klaviyoAudience(); as ka) {
        <div class="mk-card mt">
          <h3>Send “{{ ka.name }}” to Klaviyo</h3>
          <p class="lead">Profiles with an email are imported. Pick a list to add them to (optional).</p>
          <div class="row">
            <select [ngModel]="listId()" (ngModelChange)="listId.set($event)" class="sel">
              <option value="">No list (profiles only)</option>
              @for (l of lists(); track l.id) {<option [value]="l.id">{{ l.name }}</option>}
            </select>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="pushKlaviyo(ka)">{{ busy() ? 'Sending…' : 'Send ' + num(ka.reachable) + ' people' }}</button>
            <button type="button" class="btn" (click)="klaviyoAudience.set(null)">Cancel</button>
          </div>
        </div>
      }

      <div class="grid cols-2 mt">
        <div class="mk-card">
          <h3>Klaviyo</h3>
          <p class="lead">Use a private API key with profiles and lists write access. The key is encrypted at rest.</p>
          <div class="row">
            <span class="pill" [class.ok]="d.klaviyo_connected">{{ d.klaviyo_connected ? 'Connected' : 'Not connected' }}</span>
            <input type="password" class="inp" placeholder="pk_…" [ngModel]="klaviyoKey()" (ngModelChange)="klaviyoKey.set($event)" autocomplete="off" />
            <button type="button" class="btn primary" [disabled]="busy() || !klaviyoKey().trim()" (click)="saveKlaviyo()">Save key</button>
          </div>
        </div>

        <div class="mk-card">
          <h3>Meta Conversions API</h3>
          <p class="lead">Sends your real purchases to Meta from the server, with hashed email/phone, so ad optimisation sees sales the browser pixel misses. Purchases are de-duplicated by order ID.</p>
          <div class="grid" style="gap:10px">
            <label class="field">Meta Pixel ID<input type="text" [ngModel]="capiPixel()" (ngModelChange)="capiPixel.set($event)" placeholder="1234567890" /></label>
            <label class="field">Access token {{ d.capi?.has_token ? '(saved, leave blank to keep)' : '' }}<input type="password" [ngModel]="capiToken()" (ngModelChange)="capiToken.set($event)" autocomplete="off" /></label>
            <label class="field">Test event code (optional, for Events Manager testing)<input type="text" [ngModel]="capiTest()" (ngModelChange)="capiTest.set($event)" /></label>
            <div class="row">
              <button type="button" class="btn" [disabled]="busy() || !capiPixel().trim()" (click)="saveCapi()">Save</button>
              <button type="button" class="btn primary" [disabled]="busy() || !d.capi?.has_token" (click)="sendCapi()">Send last 7 days of purchases</button>
            </div>
          </div>
        </div>
      </div>
    }
    @if (loading() && !data()) {<div class="empty">Loading…</div>}
  `,
  styles: [
    `
      .hero { background: linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(16, 185, 129, 0.1)); .big { font-size: 38px; font-weight: 800; letter-spacing: -0.02em; margin: 2px 0 6px; } }
      .aud .stats { display: flex; gap: 22px; div { display: flex; flex-direction: column; } b { font-size: 20px; } }
      .inp, .sel { flex: 1; min-width: 160px; padding: 8px 11px; border-radius: 10px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: inherit; font: inherit; font-size: 13px; }
    `
  ]
})
export class ActivateTab {
  currency = input<string>('');
  storeKey = input<string>('');

  readonly num = num;
  readonly money = (v: number | null | undefined) => money(v, this.currency());

  data = signal<AudiencesResult | null>(null);
  loading = signal<boolean>(false);
  busy = signal<boolean>(false);
  message = signal<string>('');
  messageKind = signal<'ok' | 'error' | ''>('');

  klaviyoKey = signal<string>('');
  klaviyoAudience = signal<Audience | null>(null);
  lists = signal<{ id: string; name: string }[]>([]);
  listId = signal<string>('');

  capiPixel = signal<string>('');
  capiToken = signal<string>('');
  capiTest = signal<string>('');

  constructor(private mk: MarketingService) {
    effect(() => {
      this.storeKey();
      this.load();
    });
  }

  totalImpact(): number {
    return (this.data()?.audiences ?? []).reduce((s, a) => s + (a.estimated_impact ?? 0), 0);
  }

  private say(text: string, kind: 'ok' | 'error' = 'ok'): void {
    this.message.set(text);
    this.messageKind.set(kind);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const d = await this.mk.audiences();
      this.data.set(d);
      if (d.capi) {
        this.capiPixel.set(d.capi.pixel_id);
        this.capiTest.set(d.capi.test_event_code);
      }
    } catch (e) {
      this.say(this.mk.errorMessage(e, 'Could not load audiences.'), 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async download(a: Audience, format: 'csv' | 'meta'): Promise<void> {
    try {
      await this.mk.downloadAudience(a.id, format);
    } catch (e) {
      this.say(this.mk.errorMessage(e, 'Download failed.'), 'error');
    }
  }

  async saveKlaviyo(): Promise<void> {
    this.busy.set(true);
    try {
      await this.mk.saveKlaviyo(this.klaviyoKey().trim());
      this.klaviyoKey.set('');
      this.say('Klaviyo key saved.');
      await this.load();
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  async openKlaviyo(a: Audience): Promise<void> {
    this.klaviyoAudience.set(a);
    this.listId.set('');
    try {
      this.lists.set(await this.mk.klaviyoLists());
    } catch (e) {
      this.lists.set([]);
      this.say(this.mk.errorMessage(e), 'error');
    }
  }

  async pushKlaviyo(a: Audience): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.mk.pushKlaviyo(a.id, this.listId());
      this.say(`Sent ${r.sent} profiles to Klaviyo${r.skipped_without_email ? ` (${r.skipped_without_email} skipped: no email)` : ''}.`);
      this.klaviyoAudience.set(null);
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  async saveCapi(): Promise<void> {
    this.busy.set(true);
    try {
      await this.mk.saveCapi({ pixel_id: this.capiPixel().trim(), access_token: this.capiToken().trim() || undefined, test_event_code: this.capiTest().trim() });
      this.capiToken.set('');
      this.say('Conversions API settings saved.');
      await this.load();
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }

  async sendCapi(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.mk.sendCapi();
      this.say(r.sent ? `Sent ${r.sent} purchases to Meta${r.test_mode ? ' in test mode' : ''}.` : r.message || 'Nothing new to send.');
    } catch (e) {
      this.say(this.mk.errorMessage(e), 'error');
    } finally {
      this.busy.set(false);
    }
  }
}
