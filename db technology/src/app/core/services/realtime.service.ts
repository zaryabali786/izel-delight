import { Injectable, effect, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { StoreService } from './store.service';

export interface RealtimeEvent<T = any> {
  event: string;
  storeId: string;
  data: T;
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class RealtimeService {
  private socket: Socket | null = null;
  isConnected = signal<boolean>(false);
  lastEvent = signal<RealtimeEvent | null>(null);

  /** Every event as a stream: unlike `lastEvent`, two events in the same tick are both delivered. */
  private bus = new Subject<RealtimeEvent>();
  readonly events$: Observable<RealtimeEvent> = this.bus.asObservable();

  constructor(
    private authService: AuthService,
    private storeService: StoreService
  ) {
    // Reactively connect/join rooms when store or auth state changes
    effect(() => {
      const token = this.authService.getAccessToken();
      const activeStore = this.storeService.activeStore();

      if (token && activeStore?.id) {
        this.connect(token, activeStore.id);
      } else {
        this.disconnect();
      }
    });
  }

  /**
   * Connect to backend Socket.io server with Supabase auth token
   */
  private connect(token: string, storeId: string): void {
    if (this.socket && this.socket.connected) {
      // If already connected, join the updated store room
      this.socket.emit('store:join', { storeId });
      return;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = io(environment.wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000
    });

    this.socket.on('connect', () => {
      console.log(`⚡ [RealtimeService] Connected to Realtime Gateway (Socket ID: ${this.socket?.id})`);
      this.isConnected.set(true);
      this.socket?.emit('store:join', { storeId });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('⚡ [RealtimeService] Disconnected:', reason);
      this.isConnected.set(false);
    });

    this.socket.on('connect_error', (err) => {
      console.warn('⚡ [RealtimeService] Realtime connection notice:', err.message);
      this.isConnected.set(false);
    });

    // ── Shopify Event Listeners ───────────────────────────────────────────────
    this.registerEventListener('shopify:connected');
    this.registerEventListener('shopify:disconnected');
    this.registerEventListener('shopify:sync_started');
    this.registerEventListener('shopify:sync_completed');
    this.registerEventListener('shopify:sync_failed');
    this.registerEventListener('shopify:product_updated');
    this.registerEventListener('shopify:product_deleted');
    this.registerEventListener('shopify:order_updated');

    // ── Multichannel Integrations Listeners ───────────────────────────────────
    this.registerEventListener('integration:status_changed');

    // ── Unified inbox: new messages, AI drafts, hand-offs, delivery receipts ───
    this.registerEventListener('inbox:new_message');
    this.registerEventListener('inbox:draft');
    this.registerEventListener('inbox:handoff');
    this.registerEventListener('inbox:message_status');
    this.registerEventListener('channels:updated');
  }

  private registerEventListener(eventName: string): void {
    if (!this.socket) return;

    this.socket.on(eventName, (payload) => {
      console.log(`📡 [Realtime Event: ${eventName}]`, payload);
      const evt: RealtimeEvent = {
        event: eventName,
        storeId: payload?.storeId || '',
        data: payload,
        timestamp: new Date().toISOString()
      };
      this.lastEvent.set(evt);
      this.bus.next(evt);
    });
  }

  /**
   * Disconnect socket cleanly
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected.set(false);
    }
  }

  /**
   * Listen to specific event with callback
   */
  on(eventName: string, callback: (data: any) => void): void {
    if (this.socket) {
      this.socket.on(eventName, callback);
    }
  }
}
