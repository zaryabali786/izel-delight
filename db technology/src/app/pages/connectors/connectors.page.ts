import { Component, HostListener, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  mailOutline,
  radioButtonOnOutline,
  cubeOutline,
  searchOutline,
  checkmarkCircleOutline,
  checkmarkOutline,
  warningOutline,
  refreshOutline,
  closeOutline,
  addOutline,
  eyeOutline,
  eyeOffOutline,
  lockClosedOutline,
  shieldCheckmarkOutline,
  copyOutline,
  openOutline,
  informationCircleOutline
} from 'ionicons/icons';
import { ConnectionAccount, ConnectionsService, ConnectorCard, CredentialSchema } from '../../core/services/connections.service';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StoreService } from '../../core/services/store.service';
import { PortalDirective } from '../../shared/directives/portal.directive';

interface Brand {
  /** File in assets/brands (official mark, or the brand's own site logo). */
  file?: string;
  /** Own-feature fallback icon (pixel, email) where there is no third-party brand. */
  icon?: string;
  /** Brand colour used for the dialog accent and the primary button. */
  color: string;
  /** Button text colour on top of `color`. */
  ink?: string;
  /** "Continue with {label}" */
  label?: string;
  /** Tile background when the logo is not meant for white (DHL red on yellow). */
  tileBg?: string;
}

const BRANDS: Record<string, Brand> = {
  shopify: { file: 'shopify.png', color: '#5E8E3E', label: 'Shopify' },
  'meta-ads': { file: 'meta-ads.svg', color: '#0467DF', label: 'Facebook' },
  'meta-capi': { file: 'meta-capi.svg', color: '#0467DF', label: 'Meta' },
  'meta-messaging': { file: 'meta-messaging.svg', color: '#0084FF', label: 'Facebook' },
  'instagram-inbox': { file: 'instagram-inbox.svg', color: '#E4405F', label: 'Facebook' },
  'google-ads': { file: 'google-ads.svg', color: '#4285F4', label: 'Google' },
  ga4: { file: 'ga4.svg', color: '#E37400', label: 'Google' },
  gsc: { file: 'gsc.svg', color: '#458CF5', label: 'Google' },
  'tiktok-ads': { file: 'tiktok-ads.svg', color: '#111827', label: 'TikTok' },
  'snapchat-ads': { file: 'snapchat-ads.png', color: '#FFFC00', ink: '#111827', label: 'Snapchat' },
  'pinterest-ads': { file: 'pinterest-ads.svg', color: '#E60023', label: 'Pinterest' },
  'bing-ads': { file: 'bing-ads.svg', color: '#0F78D4', label: 'Microsoft' },
  'twitter-ads': { file: 'twitter-ads.svg', color: '#111827', label: 'X' },
  klaviyo: { file: 'klaviyo.png', color: '#111827', label: 'Klaviyo' },
  'whatsapp-business': { file: 'whatsapp-business.svg', color: '#1FAF54', label: 'WhatsApp' },
  'amazon-seller': { file: 'amazon-seller.svg', color: '#FF9900', ink: '#111827' },
  'store-pixel': { icon: 'radio-button-on-outline', color: '#6366f1' },
  'email-inbox': { icon: 'mail-outline', color: '#f59e0b' },
  // Couriers: logos taken from each company's own site where one could be fetched cleanly
  'postex-courier': { file: 'postex-courier.png', color: '#111827' },
  'trax-logistics': { file: 'trax-logistics.png', color: '#2E7D32' },
  'leopards-courier': { file: 'leopards-courier.png', color: '#E0A800', ink: '#111827' },
  'tcs-courier': { file: 'tcs-courier.png', color: '#E31B23' },
  'call-courier': { file: 'call-courier.png', color: '#17A34A' },
  'mnp-courier': { file: 'mnp-courier.png', color: '#E65100' },
  'bluex-courier': { file: 'bluex-courier.png', color: '#0B4EC4' },
  'daewoo-courier': { file: 'daewoo-courier.png', color: '#1D4E9E' },
  'tranzo-courier': { file: 'tranzo-courier.svg', color: '#111827' },
  'speedaf-courier': { file: 'speedaf-courier.png', color: '#F26B00' },
  'pakpost-courier': { file: 'pakpost-courier.png', color: '#C62828' },
  'dhl-courier': { file: 'dhl-courier.svg', color: '#D40511', tileBg: '#FFCC00' },
  'fedex-courier': { file: 'fedex-courier.svg', color: '#4D148C' }
};

/** Stable colour from the name, for brands without a logo file (monogram tile). */
function hueColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 40%)`;
}

type Mode = 'connect' | 'manage' | 'token' | 'setup';
type Flash = { kind: 'ok' | 'error' | 'info'; text: string };

@Component({
  selector: 'app-connectors',
  templateUrl: './connectors.page.html',
  styleUrls: ['./connectors.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, PortalDirective]
})
export class ConnectorsPage {
  cards = signal<ConnectorCard[]>([]);
  loading = signal<boolean>(false);
  error = signal<string>('');

  search = signal<string>('');
  category = signal<string>('All');
  configuredOnly = signal<Record<string, boolean>>({});

  // ── dialog state ──
  dlg = signal<{ id: string; mode: Mode } | null>(null);
  flash = signal<Flash | null>(null);
  waiting = signal<boolean>(false); // the provider's sign-in window is open
  busy = signal<boolean>(false);
  justConnected = signal<boolean>(false);
  needShop = signal<boolean>(false);
  shopDomain = signal<string>('');
  accountFilter = signal<string>('');
  selected = signal<Set<string>>(new Set());
  syncDays = signal<number>(30);
  copied = signal<string>('');

  tokenSchema = signal<CredentialSchema | null>(null);
  tokenValues = signal<Record<string, string>>({});
  revealed = signal<Record<string, boolean>>({});
  manualToken = signal<boolean>(false);

  constructor(
    private conn: ConnectionsService,
    private analytics: AnalyticsService,
    public stores: StoreService,
    private router: Router
  ) {
    addIcons({
      mailOutline,
      radioButtonOnOutline,
      cubeOutline,
      searchOutline,
      checkmarkCircleOutline,
      checkmarkOutline,
      warningOutline,
      refreshOutline,
      closeOutline,
      addOutline,
      eyeOutline,
      eyeOffOutline,
      lockClosedOutline,
      shieldCheckmarkOutline,
      copyOutline,
      openOutline,
      informationCircleOutline
    });
    effect(() => {
      if (this.stores.activeStore()?.id) this.load();
    });
    // Page behind the dialog must not scroll.
    effect(() => {
      document.body.classList.toggle('cn-dialog-open', !!this.dlg());
    });
  }

  // ── presentation helpers ──

  brand(c: ConnectorCard): Brand {
    return BRANDS[c.id] || { color: hueColor(c.name) };
  }

  logoSrc(c: ConnectorCard): string | null {
    const f = this.brand(c).file;
    return f ? `assets/brands/${f}` : null;
  }

  initials(c: ConnectorCard): string {
    return c.name
      .split(/[\s/&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  tileBg(c: ConnectorCard): string {
    const b = this.brand(c);
    if (b.tileBg) return b.tileBg;
    if (b.file) return '#ffffff';
    return b.icon ? b.color : hueColor(c.name);
  }

  categories = computed(() => ['All', ...new Set(this.cards().map((c) => c.category))]);

  sections = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.category();
    const items = this.cards().filter((c) => (cat === 'All' || c.category === cat) && (!q || `${c.name} ${c.description}`.toLowerCase().includes(q)));
    return [...new Set(items.map((c) => c.category))].map((name) => {
      const only = !!this.configuredOnly()[name];
      return { name, items: items.filter((c) => c.category === name && (!only || c.configured)), only, total: items.filter((c) => c.category === name).length };
    });
  });

  activeCard = computed(() => {
    const d = this.dlg();
    return d ? (this.cards().find((c) => c.id === d.id) ?? null) : null;
  });

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.cards.set(await this.conn.list());
    } catch (e) {
      this.error.set(this.conn.errorMessage(e, 'Could not load connectors.'));
    } finally {
      this.loading.set(false);
    }
  }

  toggleOnly(section: string): void {
    this.configuredOnly.update((m) => ({ ...m, [section]: !m[section] }));
  }

  accountCount(c: ConnectorCard): number {
    return c.connection?.accounts.filter((a) => a.selected).length ?? 0;
  }

  statusText(c: ConnectorCard): string {
    if (c.needs_reauth) return 'Reconnect needed';
    if (c.configured && c.connection?.verification === 'unverified') return 'Saved, not live-verified';
    if (c.configured) return 'Connected';
    if (c.auth === 'planned') return 'Coming soon';
    if (c.auth === 'oauth' && c.oauth_ready === false) return c.operator ? 'Setup needed' : 'Not available yet';
    return 'Not connected';
  }

  statusTone(c: ConnectorCard): 'ok' | 'warn' | 'idle' {
    if (c.needs_reauth || (!c.configured && c.auth === 'oauth' && c.oauth_ready === false && c.operator)) return 'warn';
    return c.configured ? 'ok' : 'idle';
  }

  primaryLabel(c: ConnectorCard): string {
    switch (c.auth) {
      case 'planned':
        return 'Coming soon';
      case 'pixel':
        return 'Get snippet';
      case 'key':
        return 'Set up';
      case 'import':
        return 'Import CSV';
      case 'link':
        return c.configured ? 'Manage' : 'Set up';
      case 'token':
        return c.configured ? 'Configure' : 'Connect';
      default:
        if (c.needs_reauth) return c.oauth_ready === false && !c.operator ? 'Not available yet' : 'Reconnect';
        if (c.configured) return 'Configure';
        if (c.oauth_ready === false) return c.operator ? 'How to enable' : 'Not available yet';
        return 'Connect';
    }
  }

  /** Customers cannot press Connect for a platform the operator has not enabled. */
  unavailable(c: ConnectorCard): boolean {
    return c.auth === 'planned' || (c.auth === 'oauth' && c.oauth_ready === false && !c.operator && !c.configured);
  }

  // ── opening the dialog ──

  onPrimary(c: ConnectorCard): void {
    if (c.auth === 'planned') return;
    if (c.auth === 'pixel' || c.auth === 'import') {
      this.router.navigate(['/dashboard/marketing'], { queryParams: { tab: 'connect' } });
      return;
    }
    if (c.auth === 'key') {
      this.router.navigate(['/dashboard/marketing'], { queryParams: { tab: 'activate' } });
      return;
    }
    if (c.auth === 'link') {
      this.router.navigate([c.link_to || '/dashboard/channels']);
      return;
    }
    this.resetDialogState();
    if (c.auth === 'token') {
      this.tokenSchema.set(c.credentials);
      this.dlg.set({ id: c.id, mode: 'token' });
      return;
    }
    // An existing connection can always be managed or disconnected, even if sign-in is not enabled on this server.
    if (c.configured && !c.needs_reauth) {
      this.selected.set(new Set((c.connection?.accounts ?? []).filter((a) => a.selected).map((a) => a.id)));
      this.dlg.set({ id: c.id, mode: 'manage' });
      return;
    }
    if (c.oauth_ready === false) {
      if (c.operator) this.dlg.set({ id: c.id, mode: 'setup' });
      return;
    }
    this.dlg.set({ id: c.id, mode: 'connect' });
  }

  private resetDialogState(): void {
    this.flash.set(null);
    this.waiting.set(false);
    this.busy.set(false);
    this.justConnected.set(false);
    this.needShop.set(false);
    this.accountFilter.set('');
    this.tokenValues.set({});
    this.revealed.set({});
    this.manualToken.set(false);
    this.copied.set('');
  }

  closeDialog(): void {
    if (this.waiting() || this.busy()) return;
    this.dlg.set(null);
  }

  onBackdrop(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList.contains('overlay')) this.closeDialog();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.dlg()) this.closeDialog();
  }

  // ── OAuth ──

  async startOAuth(c: ConnectorCard): Promise<void> {
    this.flash.set(null);
    this.waiting.set(true);
    try {
      const shop = c.id === 'shopify' && this.needShop() ? this.shopDomain().trim() : undefined;
      const r = await this.conn.connectOAuth(c.id, shop);
      await this.load();
      const fresh = this.cards().find((x) => x.id === c.id);
      if (r && !r.ok) {
        this.flash.set({ kind: 'error', text: r.message || `${c.name} could not be connected.` });
      } else if (fresh?.configured) {
        this.justConnected.set(true);
        this.selected.set(new Set((fresh.connection?.accounts ?? []).filter((a) => a.selected).map((a) => a.id)));
        this.flash.set({ kind: 'ok', text: r?.message || `${c.name} is connected.` });
        this.dlg.set({ id: c.id, mode: 'manage' });
      } else if (!r) {
        this.flash.set({ kind: 'error', text: 'The sign-in window was closed before it finished. You can try again.' });
      }
    } catch (e) {
      if (this.conn.errorCode(e) === 'shop_required') {
        this.needShop.set(true); // only when the store's myshopify address is unknown; asked once
        this.flash.set({ kind: 'info', text: 'Enter your Shopify store address once and we will remember it.' });
      } else {
        this.flash.set({ kind: 'error', text: this.conn.errorMessage(e, `Could not start ${c.name} sign-in.`) });
      }
    } finally {
      this.waiting.set(false);
    }
  }

  async startWhatsApp(c: ConnectorCard): Promise<void> {
    this.flash.set(null);
    this.waiting.set(true);
    try {
      const r = await this.conn.connectWhatsApp();
      await this.load();
      this.justConnected.set(true);
      this.flash.set({ kind: 'ok', text: `WhatsApp connected${r.phone ? `: ${r.phone}` : ''}. The AI agent now answers customers on this number.` });
      this.dlg.set({ id: c.id, mode: 'token' });
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e, 'Could not connect WhatsApp.') });
    } finally {
      this.waiting.set(false);
    }
  }

  // ── accounts ──

  visibleAccounts(c: ConnectorCard): ConnectionAccount[] {
    const q = this.accountFilter().trim().toLowerCase();
    const all = c.connection?.accounts ?? [];
    return q ? all.filter((a) => `${a.name} ${a.id}`.toLowerCase().includes(q)) : all;
  }

  toggleAccount(id: string): void {
    this.selected.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  allSelected(c: ConnectorCard): boolean {
    const accts = c.connection?.accounts ?? [];
    return accts.length > 0 && accts.every((a) => this.selected().has(a.id));
  }

  toggleAll(c: ConnectorCard): void {
    const accts = c.connection?.accounts ?? [];
    this.selected.set(this.allSelected(c) ? new Set() : new Set(accts.map((a) => a.id)));
  }

  async saveAccounts(c: ConnectorCard): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await this.conn.setAccounts(c.id, [...this.selected()]);
      await this.load();
      this.flash.set({ kind: 'ok', text: 'Accounts saved.' });
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  async syncNow(c: ConnectorCard): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      const r = await this.conn.sync(c.id, this.syncDays());
      await this.load();
      this.flash.set({ kind: 'ok', text: `Synced ${r.rows} campaign-days from ${r.accounts} account(s): ${r.inserted} new, ${r.updated} updated.` });
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e, 'Sync failed.') });
    } finally {
      this.busy.set(false);
    }
  }

  async syncShopify(): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await this.analytics.syncShopifyCatalog();
      this.flash.set({ kind: 'ok', text: 'Catalog sync started. Products and orders will update shortly.' });
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e, 'Could not start the sync.') });
    } finally {
      this.busy.set(false);
    }
  }

  async disconnect(c: ConnectorCard): Promise<void> {
    if (!confirm(`Disconnect ${c.name}? Stored credentials are removed. Data you already imported stays.`)) return;
    this.busy.set(true);
    try {
      await this.conn.disconnect(c.id);
      await this.load();
      this.dlg.set(null);
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e) });
    } finally {
      this.busy.set(false);
    }
  }

  manageChannels(): void {
    this.dlg.set(null);
    this.router.navigate(['/dashboard/ai-settings']);
  }

  // ── API-key connectors (couriers, WhatsApp token): they have no OAuth ──

  setField(id: string, value: string): void {
    this.tokenValues.update((v) => ({ ...v, [id]: value }));
  }

  toggleReveal(id: string): void {
    this.revealed.update((r) => ({ ...r, [id]: !r[id] }));
  }

  canSaveToken = computed(() => {
    const schema = this.tokenSchema();
    const values = this.tokenValues();
    return !!schema && schema.fields.every((f) => !f.required || (values[f.id] ?? '').trim() !== '');
  });

  async saveToken(c: ConnectorCard): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      const r = await this.conn.saveCredentials(c.id, this.tokenValues());
      await this.load();
      this.tokenValues.set({});
      this.justConnected.set(true);
      this.flash.set({
        kind: 'ok',
        text: r.verified ? `${c.name} connected and verified.` : `Credentials saved (encrypted). They could not be verified live: there is no public test endpoint for ${c.name} yet.`
      });
    } catch (e) {
      this.flash.set({ kind: 'error', text: this.conn.errorMessage(e, `Could not connect ${c.name}.`) });
    } finally {
      this.busy.set(false);
    }
  }

  // ── operator setup help ──

  async copy(key: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(key);
      setTimeout(() => this.copied.set(''), 1600);
    } catch {
      this.flash.set({ kind: 'error', text: 'Could not copy. Select the text and copy it manually.' });
    }
  }

  fmtDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  }

  accountLabel(a: ConnectionAccount): string {
    return `${a.name}${a.currency ? ` · ${a.currency}` : ''}`;
  }

  /** Providers whose sign-in is followed by choosing accounts get the 3-step ribbon. */
  hasAccounts(c: ConnectorCard): boolean {
    return c.category === 'Advertising' || c.id === 'ga4' || c.id === 'gsc';
  }

  step(c: ConnectorCard): number {
    if (this.dlg()?.mode === 'connect') return 0;
    return this.justConnected() ? 1 : -1;
  }
}
