import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  logoWhatsapp,
  logoFacebook,
  chatbubbleEllipsesOutline,
  mailOutline,
  sparklesOutline,
  addOutline,
  trashOutline,
  createOutline,
  checkmarkOutline,
  closeOutline,
  informationCircleOutline,
  flashOutline,
  eyeOutline,
  handLeftOutline,
  timeOutline,
  playOutline,
  warningOutline
} from 'ionicons/icons';
import { AiMode, AiSettings, AiSettingsService, AiTestResult, Faq } from '../../core/services/ai-settings.service';
import { ConnectionsService } from '../../core/services/connections.service';
import { StoreService } from '../../core/services/store.service';

type ChannelKey = 'whatsapp' | 'comments' | 'dms' | 'email';

interface ChannelRow {
  key: ChannelKey;
  title: string;
  subtitle: string;
  icon: string;
  tint: string;
  /** Plain-language limit of automatic replies on this channel. */
  note: string;
  connectId: string;
}

const CHANNELS: ChannelRow[] = [
  { key: 'whatsapp', title: 'WhatsApp messages', subtitle: 'Customers writing to your WhatsApp Business number', icon: 'logo-whatsapp', tint: '#25D366', note: 'WhatsApp allows free-form replies only within 24 hours of the customer’s last message.', connectId: 'whatsapp-business' },
  { key: 'comments', title: 'Facebook & Instagram comments', subtitle: 'Comments on your posts, reels and ads', icon: 'chatbubble-ellipses-outline', tint: '#1877F2', note: 'Replies are public. The AI sees the post caption and the ad it was made on.', connectId: 'meta-messaging' },
  { key: 'dms', title: 'Facebook & Instagram messages', subtitle: 'Messenger and Instagram direct messages', icon: 'logo-facebook', tint: '#0084FF', note: 'Meta allows replies within 24 hours of the customer’s last message.', connectId: 'meta-messaging' },
  { key: 'email', title: 'Email replies', subtitle: 'Messages arriving at your support address', icon: 'mail-outline', tint: '#F59E0B', note: 'Sent from your support address with your signature.', connectId: 'email-inbox' }
];

const MODES: { id: AiMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Messages arrive in the inbox. The AI does nothing.' },
  { id: 'draft', label: 'Suggest', hint: 'The AI writes a reply and waits. You review, edit and send.' },
  { id: 'auto', label: 'Automatic', hint: 'The AI sends the reply itself. It stops on hand-off words or when a person replies.' }
];

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

@Component({
  selector: 'app-ai-settings',
  templateUrl: './ai-settings.page.html',
  styleUrls: ['./ai-settings.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon]
})
export class AiSettingsPage {
  readonly sections = [
    { id: 'automation', label: 'Automation' },
    { id: 'instructions', label: 'Instructions' },
    { id: 'business', label: 'Business info' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'style', label: 'Reply style' },
    { id: 'rules', label: 'Rules' },
    { id: 'test', label: 'Test' }
  ];
  readonly channels = CHANNELS;
  readonly modes = MODES;
  readonly tones = ['friendly', 'professional', 'casual', 'formal'] as const;
  readonly languages: { id: AiSettings['preferences']['language']; label: string }[] = [
    { id: 'auto', label: 'Match the customer' },
    { id: 'english', label: 'English' },
    { id: 'urdu', label: 'Urdu' },
    { id: 'roman-urdu', label: 'Roman Urdu' }
  ];
  readonly lengths = ['short', 'medium', 'detailed'] as const;
  readonly timezones = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'UTC'];

  saved = signal<AiSettings | null>(null);
  draft = signal<AiSettings | null>(null);
  loading = signal<boolean>(false);
  saving = signal<boolean>(false);
  error = signal<string>('');
  toast = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  connected = signal<Record<string, boolean>>({});

  // FAQ editor
  faqSearch = signal<string>('');
  editingId = signal<string | null>(null);
  newQ = signal<string>('');
  newA = signal<string>('');
  bulk = signal<string>('');
  showBulk = signal<boolean>(false);

  // test box
  testMessage = signal<string>('');
  testChannel = signal<ChannelKey>('whatsapp');
  testing = signal<boolean>(false);
  testResult = signal<AiTestResult | null>(null);
  testError = signal<string>('');

  dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && JSON.stringify(s) !== JSON.stringify(d);
  });

  filteredFaqs = computed(() => {
    const q = this.faqSearch().trim().toLowerCase();
    const list = this.draft()?.faqs ?? [];
    return q ? list.filter((f) => `${f.question} ${f.answer}`.toLowerCase().includes(q)) : list;
  });

  activeChannels = computed(() => {
    const d = this.draft();
    return d ? CHANNELS.filter((c) => d.channels[c.key].mode !== 'off').length : 0;
  });

  constructor(
    private api: AiSettingsService,
    private conn: ConnectionsService,
    private stores: StoreService
  ) {
    addIcons({
      logoWhatsapp,
      logoFacebook,
      chatbubbleEllipsesOutline,
      mailOutline,
      sparklesOutline,
      addOutline,
      trashOutline,
      createOutline,
      checkmarkOutline,
      closeOutline,
      informationCircleOutline,
      flashOutline,
      eyeOutline,
      handLeftOutline,
      timeOutline,
      playOutline,
      warningOutline
    });
    effect(() => {
      if (this.stores.activeStore()?.id) this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [s, cards] = await Promise.all([this.api.get(), this.conn.list().catch(() => [])]);
      this.saved.set(s);
      this.draft.set(clone(s));
      this.connected.set(Object.fromEntries(cards.map((c) => [c.id, c.configured])));
    } catch (e) {
      this.error.set(this.api.errorMessage(e, 'Could not load AI settings.'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── mode helpers ──

  mode(key: ChannelKey): AiMode {
    return this.draft()?.channels[key].mode ?? 'off';
  }

  setMode(key: ChannelKey, mode: AiMode): void {
    this.draft.update((d) => {
      if (!d) return d;
      const n = clone(d);
      n.channels[key].mode = mode;
      return n;
    });
  }

  modeHint(key: ChannelKey): string {
    return MODES.find((m) => m.id === this.mode(key))?.hint ?? '';
  }

  setPrivateReply(v: boolean): void {
    this.mutate((n) => (n.channels.comments.private_reply = v));
  }

  isConnected(c: ChannelRow): boolean {
    return !!this.connected()[c.connectId];
  }

  /** Generic immutable edit of the working copy. */
  mutate(fn: (n: AiSettings) => void): void {
    this.draft.update((d) => {
      if (!d) return d;
      const n = clone(d);
      fn(n);
      return n;
    });
  }

  // ── FAQs ──

  addFaq(): void {
    const q = this.newQ().trim();
    const a = this.newA().trim();
    if (!q || !a) return;
    this.mutate((n) => n.faqs.unshift({ id: crypto.randomUUID(), question: q, answer: a }));
    this.newQ.set('');
    this.newA.set('');
  }

  updateFaq(id: string, field: 'question' | 'answer', value: string): void {
    this.mutate((n) => {
      const f = n.faqs.find((x) => x.id === id);
      if (f) f[field] = value;
    });
  }

  removeFaq(id: string): void {
    this.mutate((n) => (n.faqs = n.faqs.filter((f) => f.id !== id)));
    if (this.editingId() === id) this.editingId.set(null);
  }

  /** Paste many at once: one per line as  Question | Answer  (or Question ? Answer on the next line). */
  importBulk(): void {
    const lines = this.bulk().split('\n').map((l) => l.trim()).filter(Boolean);
    const fresh: Faq[] = [];
    for (const line of lines) {
      const [q, ...rest] = line.split('|');
      const a = rest.join('|').trim();
      if (q.trim() && a) fresh.push({ id: crypto.randomUUID(), question: q.trim(), answer: a });
    }
    if (!fresh.length) {
      this.toast.set({ kind: 'error', text: 'No FAQs found. Use one per line: Question | Answer' });
      return;
    }
    this.mutate((n) => n.faqs.unshift(...fresh));
    this.bulk.set('');
    this.showBulk.set(false);
    this.toast.set({ kind: 'ok', text: `${fresh.length} FAQs added. Press Save to keep them.` });
  }

  // ── save / discard ──

  async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.saving.set(true);
    this.toast.set(null);
    try {
      const fresh = await this.api.save(d);
      this.saved.set(fresh);
      this.draft.set(clone(fresh));
      this.toast.set({ kind: 'ok', text: 'AI settings saved. They apply to every channel straight away.' });
    } catch (e) {
      this.toast.set({ kind: 'error', text: this.api.errorMessage(e, 'Could not save.') });
    } finally {
      this.saving.set(false);
    }
  }

  discard(): void {
    const s = this.saved();
    if (s) this.draft.set(clone(s));
    this.toast.set(null);
  }

  // ── test box ──

  async runTest(): Promise<void> {
    const msg = this.testMessage().trim();
    if (!msg) return;
    this.testing.set(true);
    this.testError.set('');
    this.testResult.set(null);
    try {
      // The test uses SAVED settings (what customers would get), so remind when there are unsaved edits.
      this.testResult.set(await this.api.test(msg, this.testChannel()));
    } catch (e) {
      this.testError.set(this.api.errorMessage(e, 'The test failed.'));
    } finally {
      this.testing.set(false);
    }
  }

  scrollTo(id: string): void {
    document.getElementById(`ai-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  trackById(_: number, f: { id: string }): string {
    return f.id;
  }
}
