import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  sparklesOutline,
  sendOutline,
  warningOutline,
  informationCircleOutline,
  closeOutline,
  calendarOutline
} from 'ionicons/icons';
import { StoreService } from '../../core/services/store.service';
import { AlertItem, MarketingService } from '../../core/services/marketing.service';
import { OverviewTab } from './tabs/overview.tab';
import { AttributionTab } from './tabs/attribution.tab';
import { IncrementalityTab } from './tabs/incrementality.tab';
import { CustomersTab } from './tabs/customers.tab';
import { ActivateTab } from './tabs/activate.tab';
import { ConnectTab } from './tabs/connect.tab';

type TabId = 'overview' | 'attribution' | 'incrementality' | 'customers' | 'activate' | 'connect';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400000));

@Component({
  selector: 'app-marketing',
  templateUrl: './marketing.page.html',
  styleUrls: ['./marketing.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, OverviewTab, AttributionTab, IncrementalityTab, CustomersTab, ActivateTab, ConnectTab]
})
export class MarketingPage {
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'attribution', label: 'Attribution' },
    { id: 'incrementality', label: 'Incrementality' },
    { id: 'customers', label: 'Customers & LTV' },
    { id: 'activate', label: 'Activate' },
    { id: 'connect', label: 'Connect data' }
  ];
  readonly presets = [
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 }
  ];

  tab = signal<TabId>('overview');
  from = signal<string>(daysAgo(29));
  to = signal<string>(daysAgo(0));
  preset = signal<number | null>(30);

  storeKey = computed(() => this.stores.activeStore()?.id ?? '');
  currency = computed(() => this.stores.activeStore()?.currency_symbol || 'PKR ');

  alerts = signal<AlertItem[]>([]);
  alertsDismissed = signal<boolean>(false);

  question = signal<string>('');
  asking = signal<boolean>(false);
  answer = signal<{ text: string; sources: string[] } | null>(null);
  askError = signal<string>('');

  readonly examples = ['Which channel has the best MER this month?', 'Why did my CAC change?', 'Which products have the best margin?', 'What is my repeat purchase rate?'];

  constructor(
    private stores: StoreService,
    private mk: MarketingService,
    route: ActivatedRoute
  ) {
    const wanted = route.snapshot.queryParamMap.get('tab') as TabId | null;
    if (wanted && this.tabs.some((t) => t.id === wanted)) this.tab.set(wanted);
    addIcons({ sparklesOutline, sendOutline, warningOutline, informationCircleOutline, closeOutline, calendarOutline });
    effect(() => {
      if (this.storeKey()) this.loadAlerts();
    });
  }

  async loadAlerts(): Promise<void> {
    try {
      const r = await this.mk.alerts();
      this.alerts.set(r.alerts);
      this.alertsDismissed.set(false);
    } catch {
      this.alerts.set([]);
    }
  }

  setPreset(days: number): void {
    this.preset.set(days);
    this.from.set(daysAgo(days - 1));
    this.to.set(daysAgo(0));
  }

  setFrom(v: string): void {
    if (!v) return;
    this.preset.set(null);
    this.from.set(v > this.to() ? this.to() : v);
  }

  setTo(v: string): void {
    if (!v) return;
    this.preset.set(null);
    this.to.set(v < this.from() ? this.from() : v);
    if (this.to() > daysAgo(0)) this.to.set(daysAgo(0));
  }

  async ask(q?: string): Promise<void> {
    const question = (q ?? this.question()).trim();
    if (!question || this.asking()) return;
    this.question.set(question);
    this.asking.set(true);
    this.askError.set('');
    this.answer.set(null);
    try {
      const r = await this.mk.ask(question);
      this.answer.set({ text: r.answer, sources: [...new Set(r.sources.map((s) => s.tool.replace('get_', '').replace(/_/g, ' ')))] });
    } catch (e) {
      this.askError.set(this.mk.errorMessage(e, 'The assistant could not answer.'));
    } finally {
      this.asking.set(false);
    }
  }
}
