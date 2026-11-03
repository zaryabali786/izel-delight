import { Component, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  logoWhatsapp,
  logoFacebook,
  logoInstagram,
  chatbubbleEllipsesOutline,
  chatbubblesOutline,
  mailOutline,
  megaphoneOutline,
  searchOutline,
  refreshOutline,
  sparklesOutline,
  sendOutline,
  thumbsUpOutline,
  trashOutline,
  lockClosedOutline,
  pauseCircleOutline,
  playCircleOutline,
  checkmarkDoneOutline,
  checkmarkOutline,
  warningOutline,
  openOutline,
  chevronBackOutline,
  imagesOutline,
  receiptOutline,
  helpCircleOutline,
  handLeftOutline,
  closeOutline,
  settingsOutline,
  timeOutline,
  mailUnreadOutline
} from 'ionicons/icons';
import { ChannelGroup, InboxConversation, InboxMessage, InboxService, KindFilter, PostRow, StateFilter } from '../../core/services/inbox.service';
import { AiSettingsService, Faq } from '../../core/services/ai-settings.service';
import { StoreService } from '../../core/services/store.service';

interface ChannelLook {
  label: string;
  icon: string;
  color: string;
}

const LOOK: Record<string, ChannelLook> = {
  whatsapp: { label: 'WhatsApp', icon: 'logo-whatsapp', color: '#25D366' },
  facebook_messenger: { label: 'Messenger', icon: 'logo-facebook', color: '#0084FF' },
  facebook_comment: { label: 'Facebook comment', icon: 'chatbubble-ellipses-outline', color: '#1877F2' },
  facebook_ad_comment: { label: 'Facebook ad comment', icon: 'megaphone-outline', color: '#1877F2' },
  instagram_dm: { label: 'Instagram DM', icon: 'logo-instagram', color: '#E1306C' },
  instagram_comment: { label: 'Instagram comment', icon: 'chatbubble-ellipses-outline', color: '#E1306C' },
  instagram_ad_comment: { label: 'Instagram ad comment', icon: 'megaphone-outline', color: '#E1306C' },
  email: { label: 'Email', icon: 'mail-outline', color: '#F59E0B' }
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-inbox',
  templateUrl: './inbox.page.html',
  styleUrls: ['./inbox.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonIcon]
})
export class InboxPage {
  readonly groups: { id: ChannelGroup; label: string; icon: string }[] = [
    { id: 'all', label: 'All chats', icon: 'chatbubbles-outline' },
    { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
    { id: 'facebook', label: 'Facebook', icon: 'logo-facebook' },
    { id: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
    { id: 'email', label: 'Email', icon: 'mail-outline' }
  ];
  readonly kinds: { id: KindFilter; label: string }[] = [
    { id: 'all', label: 'Everything' },
    { id: 'messages', label: 'Messages' },
    { id: 'comments', label: 'Comments' }
  ];
  readonly states: { id: StateFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'new', label: 'New' },
    { id: 'replied', label: 'Replied' }
  ];

  reply = signal<string>('');
  asNote = signal<boolean>(false);
  sendError = signal<{ text: string; code: string } | null>(null);
  notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  mobilePane = signal<'list' | 'thread'>('list');
  faqs = signal<Faq[]>([]);
  faqMenu = signal<boolean>(false);
  searchText = signal<string>('');
  private shownFor = '';
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  unreadBadge = computed(() => this.inbox.counts().unread);

  /** The post whose comments are being shown, for the small header above the list. */
  selectedPost = computed(() => this.inbox.posts().find((p) => p.key === this.inbox.postKey()) ?? null);

  /** WhatsApp (and Messenger/Instagram) only allow free-form replies within 24 hours of the customer's last message. */
  windowClosed = computed(() => {
    const c = this.inbox.active();
    if (!c || !(c.channel_type === 'whatsapp')) return false;
    const last = [...(c.messages ?? [])].reverse().find((m) => m.sender_type === 'customer');
    return !last || Date.now() - new Date(last.created_at).getTime() > WINDOW_MS;
  });

  constructor(
    public inbox: InboxService,
    private aiApi: AiSettingsService,
    private stores: StoreService
  ) {
    addIcons({
      logoWhatsapp,
      logoFacebook,
      logoInstagram,
      chatbubbleEllipsesOutline,
      chatbubblesOutline,
      mailOutline,
      megaphoneOutline,
      searchOutline,
      refreshOutline,
      sparklesOutline,
      sendOutline,
      thumbsUpOutline,
      trashOutline,
      lockClosedOutline,
      pauseCircleOutline,
      playCircleOutline,
      checkmarkDoneOutline,
      checkmarkOutline,
      warningOutline,
      openOutline,
      chevronBackOutline,
      imagesOutline,
      receiptOutline,
      helpCircleOutline,
      handLeftOutline,
      closeOutline,
      settingsOutline,
      timeOutline,
      mailUnreadOutline
    });

    // Opening a conversation prefills the box with the AI's draft (if any); a draft arriving later fills an empty box.
    effect(() => {
      const c = this.inbox.active();
      if (!c) {
        this.shownFor = '';
        this.reply.set('');
        return;
      }
      const draft = c.metadata?.ai_draft?.text ?? '';
      if (c.id !== this.shownFor) {
        this.shownFor = c.id;
        this.reply.set(draft);
        this.asNote.set(false);
        this.sendError.set(null);
      } else if (draft && !this.reply().trim()) {
        this.reply.set(draft);
      }
    });

    effect(() => {
      if (this.stores.activeStore()?.id) this.aiApi.get().then((s) => this.faqs.set(s.faqs)).catch(() => this.faqs.set([]));
    });
  }

  // ── presentation ──

  look(type: string): ChannelLook {
    return LOOK[type] || { label: type, icon: 'chatbubble-ellipses-outline', color: '#6366f1' };
  }

  isComment(c: InboxConversation | null): boolean {
    return !!c && c.channel_type.includes('comment');
  }

  initial(c: InboxConversation): string {
    return (c.customer?.name || 'C').trim().charAt(0).toUpperCase();
  }

  timeAgo(iso?: string): string {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  stateLabel(c: InboxConversation): string {
    return c.reply_state === 'new' ? 'New' : c.reply_state === 'replied' ? 'Replied' : 'Waiting';
  }

  groupCount(id: ChannelGroup): number {
    const c = this.inbox.counts();
    return id === 'all' ? c.all : c.by_channel[id];
  }

  stateCount(id: StateFilter): number {
    const c = this.inbox.counts();
    return c[id];
  }

  statusTick(m: InboxMessage): string {
    return m.status === 'read' ? 'read' : m.status === 'delivered' ? 'delivered' : m.status === 'failed' ? 'failed' : 'sent';
  }

  composerPlaceholder(c: InboxConversation): string {
    if (this.asNote()) return 'Write a private note. Only your team can see it…';
    if (this.isComment(c)) return 'Reply publicly to this comment…';
    if (c.channel_type === 'email') return 'Write your email reply…';
    return 'Write a reply…';
  }

  sendLabel(c: InboxConversation): string {
    if (this.asNote()) return 'Add note';
    if (this.isComment(c)) return 'Reply publicly';
    if (c.channel_type === 'email') return 'Send email';
    return 'Send';
  }

  listTitle(): string {
    if (this.inbox.view() === 'posts') return 'Posts & comments';
    const g = this.inbox.group();
    return g === 'all' ? 'All conversations' : g === 'whatsapp' ? 'WhatsApp' : g === 'facebook' ? 'Facebook' : g === 'instagram' ? 'Instagram' : g === 'dms' ? 'Messages' : g === 'comments' ? 'Comments' : 'Email';
  }

  // ── navigation / filters ──

  pickGroup(id: ChannelGroup): void {
    this.inbox.postKey.set(null);
    this.inbox.view.set('conversations');
    this.inbox.kind.set('all');
    this.inbox.group.set(id);
  }

  pickKind(id: KindFilter): void {
    this.inbox.kind.set(id);
  }

  pickState(id: StateFilter): void {
    this.inbox.state.set(id);
  }

  onSearch(v: string): void {
    this.searchText.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.inbox.search.set(v), 300);
  }

  showPosts(): void {
    this.inbox.view.set('posts');
    this.inbox.group.set('comments');
    this.inbox.postKey.set(null);
    this.inbox.loadPosts();
  }

  showInbox(): void {
    this.inbox.view.set('conversations');
    this.inbox.postKey.set(null);
  }

  openPost(p: PostRow): void {
    this.inbox.postKey.set(p.key);
  }

  select(c: InboxConversation): void {
    this.inbox.open(c.id);
    this.mobilePane.set('thread');
  }

  back(): void {
    this.mobilePane.set('list');
  }

  async sync(): Promise<void> {
    this.notice.set(null);
    try {
      const r = await this.inbox.syncSocial();
      const imported = r.reduce((n, x) => n + (x.comments_imported ?? 0) + (x.messages_imported ?? 0), 0);
      const failed = r.filter((x) => x.error);
      this.notice.set(
        failed.length && !imported
          ? { kind: 'error', text: failed.map((f) => `${f.channel}: ${f.error}`).join(' ') }
          : { kind: 'ok', text: `Synced ${r.reduce((n, x) => n + (x.posts ?? 0), 0)} posts. Imported ${imported} new comments and messages.${failed.length ? ` ${failed.length} account(s) had errors: ${failed.map((f) => f.error).join(' ')}` : ''}` }
      );
    } catch (e) {
      this.notice.set({ kind: 'error', text: this.inbox.errorMessage(e, 'Sync failed.') });
    }
  }

  // ── composer ──

  async send(): Promise<void> {
    const text = this.reply().trim();
    if (!text) return;
    this.sendError.set(null);
    try {
      await this.inbox.send(text, this.asNote());
      this.reply.set('');
      this.asNote.set(false);
    } catch (e) {
      // The provider's real reason (e.g. the 24-hour WhatsApp window) is shown; nothing was recorded as sent.
      this.sendError.set({ text: this.inbox.errorMessage(e, 'The message could not be sent.'), code: this.inbox.errorCode(e) });
    }
  }

  async suggest(): Promise<void> {
    this.sendError.set(null);
    try {
      const r = await this.inbox.suggest();
      if (r.handoff) this.notice.set({ kind: 'error', text: 'The AI could not answer this from your business information. Add the answer to your FAQs or reply yourself.' });
      else this.reply.set(r.text);
    } catch (e) {
      this.notice.set({ kind: 'error', text: this.inbox.errorMessage(e, 'The AI could not write a reply.') });
    }
  }

  async dismissDraft(): Promise<void> {
    await this.inbox.dismissDraft();
    this.reply.set('');
  }

  insertFaq(f: Faq): void {
    this.reply.update((t) => (t ? `${t}\n${f.answer}` : f.answer));
    this.faqMenu.set(false);
  }

  async privateDm(): Promise<void> {
    const text = this.reply().trim();
    if (!text) return;
    try {
      await this.inbox.commentAction('private_dm', text);
      this.reply.set('');
    } catch (e) {
      this.sendError.set({ text: this.inbox.errorMessage(e, 'The private message could not be sent.'), code: '' });
    }
  }

  async commentAction(a: 'like' | 'delete'): Promise<void> {
    if (a === 'delete' && !confirm('Delete this comment from the post? This cannot be undone.')) return;
    try {
      await this.inbox.commentAction(a);
    } catch (e) {
      this.notice.set({ kind: 'error', text: this.inbox.errorMessage(e) });
    }
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  trackByKey(_: number, item: { key: string }): string {
    return item.key;
  }
}
