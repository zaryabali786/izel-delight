import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { StoreService } from './store.service';

export interface ConnectionAccount {
  id: string;
  name: string;
  currency?: string;
  active?: boolean;
  selected: boolean;
}

export interface ConnectionView {
  status: string;
  connected_via: string | null;
  identity: string | null;
  accounts: ConnectionAccount[];
  expires_at: string | null;
  last_synced_at: string | null;
  account_error: string | null;
  verification: 'live' | 'unverified' | null;
  accounts_readonly?: boolean;
}

export type ConnectorAuth = 'oauth' | 'token' | 'key' | 'pixel' | 'import' | 'link' | 'planned';

export interface CredentialField {
  id: string;
  label: string;
  secret: boolean;
  required: boolean;
  type: string;
  placeholder: string;
  help: string;
}

export interface CredentialSchema {
  verify: 'live' | 'none';
  guide: string[];
  fields: CredentialField[];
}

export interface ConnectorCard {
  id: string;
  name: string;
  category: string;
  description: string;
  support: 'native' | 'import' | 'planned';
  auth: ConnectorAuth;
  configured: boolean;
  needs_reauth: boolean;
  integration?: string;
  platform?: string;
  sync_supported?: boolean;
  /** OAuth only: false when this server has no developer-app credentials for the platform yet. */
  oauth_ready: boolean | null;
  missing_env: string[];
  docs: string | null;
  /** What a connection can do, in plain language (shown before sign-in). */
  access: string[];
  /** True when the signed-in user is the SaaS operator (sees setup help); customers never get server details. */
  operator: boolean;
  embedded?: boolean;
  embedded_ready?: boolean | null;
  redirect_uri: string | null;
  note?: string;
  /** Actionable help when the connection cannot work yet (e.g. no Instagram account linked to the Page). */
  hint?: string | null;
  link_to?: string;
  credentials: CredentialSchema | null;
  connection: ConnectionView | null;
}

export interface OAuthResult {
  type: 'oauth-result';
  ok: boolean;
  provider: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ConnectionsService {
  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private stores: StoreService
  ) {}

  private headers(): HttpHeaders {
    const token = this.auth.getAccessToken();
    return new HttpHeaders({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  }

  private url(path: string): string {
    const id = this.stores.activeStore()?.id;
    if (!id) throw new Error('No active store selected.');
    return `${environment.apiUrl}/connections/${id}${path}`;
  }

  errorCode(err: any): string {
    return err?.error?.code || '';
  }

  errorMessage(err: any, fallback = 'Something went wrong.'): string {
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }

  async list(): Promise<ConnectorCard[]> {
    const res: any = await firstValueFrom(this.http.get(this.url(''), { headers: this.headers() }));
    return res.data as ConnectorCard[];
  }

  async setAccounts(provider: string, selected: string[]): Promise<ConnectionAccount[]> {
    const res: any = await firstValueFrom(this.http.put(this.url(`/${provider}/accounts`), { selected }, { headers: this.headers() }));
    return res.data.accounts;
  }

  async saveCredentials(provider: string, fields: Record<string, string>): Promise<{ verified: boolean }> {
    const res: any = await firstValueFrom(this.http.post(this.url(`/${provider}/credentials`), { fields }, { headers: this.headers() }));
    return res.data;
  }

  async disconnect(provider: string): Promise<void> {
    await firstValueFrom(this.http.post(this.url(`/${provider}/disconnect`), {}, { headers: this.headers() }));
  }

  async sync(provider: string, days: number): Promise<{ accounts: number; rows: number; inserted: number; updated: number }> {
    const res: any = await firstValueFrom(this.http.post(this.url(`/${provider}/sync`), { days }, { headers: this.headers() }));
    return res.data;
  }

  /**
   * WhatsApp Embedded Signup: Meta's own popup lets the merchant pick or create their WhatsApp Business
   * number. Nothing is typed or pasted. Meta reports the chosen number to this page via postMessage.
   */
  async connectWhatsApp(): Promise<{ phone: string | null; name: string | null }> {
    const cfgRes: any = await firstValueFrom(this.http.get(this.url('/whatsapp-business/embedded-config'), { headers: this.headers() }));
    const cfg = cfgRes.data as { ready: boolean; appId?: string; configId?: string; version?: string };
    if (!cfg.ready) throw new Error('WhatsApp sign-in is not available yet.');
    const FB = await this.loadFacebookSdk(cfg.appId as string, cfg.version as string);

    let session: { phone_number_id?: string; waba_id?: string } | null = null;
    let cancelled = false;
    const onMessage = (ev: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (d.event === 'FINISH') session = d.data;
        else if (d.event === 'CANCEL') cancelled = true;
      } catch {
        /* not a JSON message from Meta */
      }
    };
    window.addEventListener('message', onMessage);

    try {
      const code: string | null = await new Promise((resolve) => {
        FB.login((resp: any) => resolve(resp?.authResponse?.code ?? null), {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {}, featureType: '', sessionInfoVersion: '3' }
        });
      });
      if (!code || cancelled) throw new Error('WhatsApp sign-in was cancelled.');
      // Meta posts the chosen number a moment before or after the login callback.
      for (let i = 0; i < 20 && !session; i++) await new Promise((r) => setTimeout(r, 250));
      const chosen = session as { phone_number_id?: string; waba_id?: string } | null;
      if (!chosen?.phone_number_id || !chosen?.waba_id) throw new Error('WhatsApp did not report which number was chosen. Please try again.');
      const res: any = await firstValueFrom(
        this.http.post(this.url('/whatsapp-business/embedded'), { code, phone_number_id: chosen.phone_number_id, waba_id: chosen.waba_id }, { headers: this.headers() })
      );
      return res.data;
    } finally {
      window.removeEventListener('message', onMessage);
    }
  }

  private fbReady?: Promise<any>;

  private loadFacebookSdk(appId: string, version: string): Promise<any> {
    const w = window as any;
    if (this.fbReady) return this.fbReady;
    this.fbReady = new Promise((resolve, reject) => {
      const init = () => {
        w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
        resolve(w.FB);
      };
      if (w.FB) return init();
      w.fbAsyncInit = init;
      const s = document.createElement('script');
      s.src = 'https://connect.facebook.net/en_US/sdk.js';
      s.async = true;
      s.onerror = () => {
        this.fbReady = undefined;
        reject(new Error('Could not load the Facebook sign-in script. Check your connection or ad blocker.'));
      };
      document.body.appendChild(s);
    });
    return this.fbReady;
  }

  /**
   * One-click OAuth in a popup. The popup is opened synchronously (inside the click) so browsers do not
   * block it, then pointed at the provider once the server hands back the consent URL.
   * Resolves with the result the popup reported, or null if it was closed without reporting.
   */
  async connectOAuth(provider: string, shop?: string): Promise<OAuthResult | null> {
    const w = 640;
    const h = 780;
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    const popup = window.open('about:blank', `oauth_${provider}`, `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) throw new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.');
    popup.document.write('<p style="font-family:system-ui;padding:24px">Opening sign-in…</p>');

    try {
      const res: any = await firstValueFrom(this.http.post(this.url(`/${provider}/start`), { shop }, { headers: this.headers() }));
      popup.location.href = res.data.authUrl;
    } catch (err) {
      popup.close();
      throw err;
    }

    return new Promise<OAuthResult | null>((resolve) => {
      let result: OAuthResult | null = null;
      // Facebook and Instagram share one Meta sign-in, so the popup reports it as "meta-messaging" for both cards.
      const reported = provider === 'instagram-inbox' ? 'meta-messaging' : provider;
      const onMessage = (ev: MessageEvent) => {
        const d = ev.data as OAuthResult;
        if (d && d.type === 'oauth-result' && (d.provider === provider || d.provider === reported)) result = d;
      };
      window.addEventListener('message', onMessage);
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          window.removeEventListener('message', onMessage);
          resolve(result);
        }
      }, 400);
    });
  }
}
