import { Injectable, computed, effect, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { StoreService } from './store.service';
import { RealtimeService } from './realtime.service';

export type ChannelGroup = 'all' | 'whatsapp' | 'facebook' | 'instagram' | 'dms' | 'comments' | 'email';
export type KindFilter = 'all' | 'messages' | 'comments';
export type StateFilter = 'all' | 'unread' | 'new' | 'replied';

export interface PostSummary {
  id: string;
  platform: 'facebook' | 'instagram';
  message: string;
  permalink_url: string | null;
  picture: string | null;
  created_time: string | null;
  is_ad: boolean;
  ad_name: string | null;
  unavailable: boolean;
}

export interface AiDraft {
  text: string;
  images: { url: string; caption?: string }[];
  sources?: { faq_ids: string[]; post: boolean };
  created_at: string;
}

export interface InboxMessage {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'ai' | 'system';
  sender_name?: string;
  message_text: string;
  message_type: string;
  attachments?: { type?: string; url?: string; caption?: string }[];
  status: 'sent' | 'delivered' | 'read' | 'failed';
  is_private_note?: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface InboxCustomer {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  orders_count?: number;
  total_spent?: number;
}

export interface InboxConversation {
  id: string;
  channel_id?: string;
  channel_type: string;
  channel?: { name: string; type: string; account_id: string } | null;
  customer: InboxCustomer;
  subject?: string | null;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: string;
  last_message_at: string;
  last_message_preview: string;
  unread_count: number;
  unread: boolean;
  reply_state: 'new' | 'replied' | 'awaiting';
  metadata: {
    post?: PostSummary;
    post_id?: string;
    ai_draft?: AiDraft;
    needs_human?: { reason: string; at: string };
    ai_paused?: boolean;
    is_ad?: boolean;
    ad_name?: string;
    permalink_url?: string;
  };
  messages?: InboxMessage[];
  shopifyContext?: { total_orders: number; total_spent: number; recent_orders: any[] };
}

export interface InboxCounts {
  all: number;
  unread: number;
  new: number;
  replied: number;
  by_channel: Record<'whatsapp' | 'dms' | 'comments' | 'email' | 'facebook' | 'instagram', number>;
}

export interface PostRow {
  key: string;
  channel_id: string;
  post_id: string;
  platform: 'facebook' | 'instagram';
  channel_name: string | null;
  total: number;
  unread: number;
  unreplied: number;
  last_activity: string;
  is_ad: boolean;
  post: PostSummary;
}

const EMPTY_COUNTS: InboxCounts = { all: 0, unread: 0, new: 0, replied: 0, by_channel: { whatsapp: 0, dms: 0, comments: 0, email: 0, facebook: 0, instagram: 0 } };

@Injectable({ providedIn: 'root' })
export class InboxService {
  conversations = signal<InboxConversation[]>([]);
  counts = signal<InboxCounts>(EMPTY_COUNTS);
  active = signal<InboxConversation | null>(null);
  posts = signal<PostRow[]>([]);

  group = signal<ChannelGroup>('all');
  state = signal<StateFilter>('all');
  kind = signal<KindFilter>('all');
  search = signal<string>('');
  view = signal<'conversations' | 'posts'>('conversations');
  postKey = signal<string | null>(null);

  loading = signal<boolean>(false);
  sending = signal<boolean>(false);
  suggesting = signal<boolean>(false);
  syncing = signal<boolean>(false);
  loadError = signal<string>('');

  unreadTotal = computed(() => this.counts().unread);

  /** Conversations shown in the list: when a post is selected, only its comments. */
  visible = computed(() => {
    const key = this.postKey();
    const list = this.conversations();
    if (!key) return list;
    return list.filter((c) => c.channel_type.includes('comment') && `${c.channel_id}:${c.metadata?.post_id}` === key);
  });

  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private stores: StoreService,
    private realtime: RealtimeService
  ) {
    effect(() => {
      // Reload whenever the store, filters or search change.
      const id = this.stores.activeStore()?.id;
      this.group();
      this.state();
      this.kind();
      this.search();
      if (id) this.reload();
    });

    this.realtime.events$.subscribe((evt) => this.onEvent(evt.event, evt.data));
  }

  private headers(): HttpHeaders {
    const token = this.auth.getAccessToken();
    return new HttpHeaders({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
  }

  private url(path: string): string {
    const id = this.stores.activeStore()?.id;
    if (!id) throw new Error('No active store selected.');
    return `${environment.apiUrl}/inbox/${id}${path}`;
  }

  errorMessage(err: any, fallback = 'Something went wrong.'): string {
    return err?.error?.error || err?.error?.message || err?.message || fallback;
  }

  errorCode(err: any): string {
    return err?.error?.code || '';
  }

  // ── loading ──

  async reload(): Promise<void> {
    if (!this.stores.activeStore()?.id) return;
    this.loading.set(true);
    this.loadError.set('');
    try {
      let params = new HttpParams();
      if (this.group() !== 'all') params = params.set('channel_type', this.group());
      if (this.state() !== 'all') params = params.set('state', this.state());
      if (this.kind() !== 'all') params = params.set('kind', this.kind());
      if (this.search().trim()) params = params.set('search', this.search().trim());
      const res: any = await firstValueFrom(this.http.get(this.url('/conversations'), { headers: this.headers(), params }));
      this.conversations.set(res.conversations ?? []);
      this.counts.set(res.counts ?? EMPTY_COUNTS);
    } catch (e) {
      this.loadError.set(this.errorMessage(e, 'Could not load the inbox.'));
    } finally {
      this.loading.set(false);
    }
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reload();
      if (this.view() === 'posts') this.loadPosts();
    }, 350);
  }

  async loadPosts(): Promise<void> {
    if (!this.stores.activeStore()?.id) return;
    try {
      const res: any = await firstValueFrom(this.http.get(this.url('/posts'), { headers: this.headers() }));
      this.posts.set(res.posts ?? []);
    } catch (e) {
      this.loadError.set(this.errorMessage(e, 'Could not load posts.'));
    }
  }

  async open(id: string): Promise<void> {
    try {
      const res: any = await firstValueFrom(this.http.get(this.url(`/conversations/${id}`), { headers: this.headers() }));
      const wasUnread = !!this.conversations().find((x) => x.id === id)?.unread;
      this.active.set(res.conversation);
      this.patchRow(id, { unread_count: 0, unread: false });
      if (wasUnread) this.counts.update((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
    } catch (e) {
      this.loadError.set(this.errorMessage(e, 'Could not open the conversation.'));
    }
  }

  close(): void {
    this.active.set(null);
  }

  private patchRow(id: string, patch: Partial<InboxConversation>): void {
    this.conversations.update((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const a = this.active();
    if (a && a.id === id) this.active.set({ ...a, ...patch });
  }

  // ── realtime ──

  private onEvent(event: string, data: any): void {
    const convId: string | undefined = data?.conversationId;
    if (event === 'inbox:new_message' && convId) {
      const msg: InboxMessage | undefined = data.message;
      const a = this.active();
      if (a && a.id === convId && msg && !(a.messages ?? []).some((m) => m.id === msg.id)) {
        this.active.set({ ...a, messages: [...(a.messages ?? []), msg], last_message_preview: msg.message_text });
        // The agent is looking at it, so it is read.
        if (msg.sender_type === 'customer') this.markReadSilently(convId);
      }
      this.scheduleReload();
    } else if (event === 'inbox:draft' && convId) {
      const a = this.active();
      if (a && a.id === convId) this.active.set({ ...a, metadata: { ...a.metadata, ai_draft: data.draft ?? undefined } });
      this.scheduleReload();
    } else if (event === 'inbox:handoff' && convId) {
      this.scheduleReload();
      if (this.active()?.id === convId) this.open(convId);
    } else if (event === 'inbox:message_status' && convId) {
      const a = this.active();
      if (a && a.id === convId) {
        this.active.set({ ...a, messages: (a.messages ?? []).map((m) => (m.id === data.messageId ? { ...m, status: data.status } : m)) });
      }
    }
  }

  private async markReadSilently(id: string): Promise<void> {
    try {
      await firstValueFrom(this.http.get(this.url(`/conversations/${id}`), { headers: this.headers() }));
    } catch {
      /* best effort */
    }
  }

  // ── actions ──

  /** Sends on the real channel (or saves an internal note). Rejects with the provider's real error. */
  async send(text: string, isNote = false): Promise<void> {
    const conv = this.active();
    if (!conv || !text.trim()) return;
    this.sending.set(true);
    try {
      await firstValueFrom(this.http.post(this.url(`/conversations/${conv.id}/messages`), { text: text.trim(), is_private_note: isNote }, { headers: this.headers() }));
      await this.open(conv.id);
      this.scheduleReload();
    } finally {
      this.sending.set(false);
    }
  }

  async suggest(): Promise<{ handoff: boolean; text: string }> {
    const conv = this.active();
    if (!conv) return { handoff: false, text: '' };
    this.suggesting.set(true);
    try {
      const res: any = await firstValueFrom(this.http.post(this.url(`/conversations/${conv.id}/ai-reply`), {}, { headers: this.headers() }));
      if (!res.handoff) this.active.set({ ...conv, metadata: { ...conv.metadata, ai_draft: { text: res.draftText, images: res.images ?? [], sources: res.sources, created_at: new Date().toISOString() } } });
      return { handoff: !!res.handoff, text: res.draftText ?? '' };
    } finally {
      this.suggesting.set(false);
    }
  }

  async dismissDraft(): Promise<void> {
    const conv = this.active();
    if (!conv) return;
    await firstValueFrom(this.http.delete(this.url(`/conversations/${conv.id}/draft`), { headers: this.headers() }));
    const { ai_draft, ...rest } = conv.metadata;
    this.active.set({ ...conv, metadata: rest });
  }

  async setPaused(paused: boolean): Promise<void> {
    const conv = this.active();
    if (!conv) return;
    const res: any = await firstValueFrom(this.http.put(this.url(`/conversations/${conv.id}/ai-pause`), { paused }, { headers: this.headers() }));
    this.active.set({ ...conv, metadata: res.conversation?.metadata ?? conv.metadata });
  }

  async setStatus(status: InboxConversation['status']): Promise<void> {
    const conv = this.active();
    if (!conv) return;
    await firstValueFrom(this.http.put(this.url(`/conversations/${conv.id}/status`), { status }, { headers: this.headers() }));
    this.patchRow(conv.id, { status });
  }

  async commentAction(action: 'like' | 'delete' | 'private_dm', messageText?: string): Promise<void> {
    const conv = this.active();
    if (!conv) return;
    await firstValueFrom(this.http.post(this.url(`/conversations/${conv.id}/comment-action`), { action, messageText }, { headers: this.headers() }));
    if (action === 'delete') this.close();
    else await this.open(conv.id);
    this.scheduleReload();
  }

  /** Pull recent posts and their comments from Facebook / Instagram (official Graph API). */
  async syncSocial(): Promise<{ channel: string; channel_type?: string; posts?: number; comments_imported?: number; conversations?: number; messages_imported?: number; error?: string }[]> {
    this.syncing.set(true);
    try {
      const res: any = await firstValueFrom(this.http.post(this.url('/sync'), {}, { headers: this.headers() }));
      await Promise.all([this.reload(), this.loadPosts()]);
      return res.results ?? [];
    } finally {
      this.syncing.set(false);
    }
  }
}
