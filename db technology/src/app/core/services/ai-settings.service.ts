import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { StoreService } from './store.service';

export type AiMode = 'off' | 'draft' | 'auto';

export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export interface AiSettings {
  channels: {
    whatsapp: { mode: AiMode };
    comments: { mode: AiMode; private_reply: boolean };
    dms: { mode: AiMode };
    email: { mode: AiMode };
  };
  instructions: string;
  business: { about: string; hours: string; delivery: string; returns: string; payments: string; contact: string };
  faqs: Faq[];
  preferences: {
    tone: 'friendly' | 'professional' | 'casual' | 'formal';
    language: 'auto' | 'english' | 'urdu' | 'roman-urdu';
    length: 'short' | 'medium' | 'detailed';
    signature: string;
    send_product_images: boolean;
  };
  rules: {
    handoff_keywords: string;
    business_hours_only: boolean;
    business_hours: { start: string; end: string; tz: string };
    max_auto_replies_per_conversation: number;
    pause_when_agent_replies: boolean;
  };
}

export interface AiTestResult {
  reply: string | null;
  handoff: boolean;
  handoff_reason: string | null;
  used_faqs: string[];
  matched_products: string[];
}

@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private stores: StoreService
  ) {}

  private headers(): HttpHeaders {
    const token = this.auth.getAccessToken();
    return new HttpHeaders({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  }

  private url(path = ''): string {
    const id = this.stores.activeStore()?.id;
    if (!id) throw new Error('No active store selected.');
    return `${environment.apiUrl}/ai-settings/${id}${path}`;
  }

  errorMessage(err: any, fallback = 'Something went wrong.'): string {
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }

  async get(): Promise<AiSettings> {
    const res: any = await firstValueFrom(this.http.get(this.url(), { headers: this.headers() }));
    return res.settings as AiSettings;
  }

  async save(settings: AiSettings): Promise<AiSettings> {
    const res: any = await firstValueFrom(this.http.put(this.url(), settings, { headers: this.headers() }));
    return res.settings as AiSettings;
  }

  async test(message: string, channel: 'whatsapp' | 'comments' | 'dms' | 'email'): Promise<AiTestResult> {
    const res: any = await firstValueFrom(this.http.post(this.url('/test'), { message, channel }, { headers: this.headers() }));
    return res as AiTestResult;
  }
}
