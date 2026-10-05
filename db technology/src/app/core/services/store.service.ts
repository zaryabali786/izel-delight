import { Injectable, signal, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import {
  Store,
  CreateStoreDto,
  StoreIntegration,
  StoreProduct,
  StoreMetrics
} from '../models/store.models';

interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

const ACTIVE_STORE_KEY = 'nexus_active_store_id';

@Injectable({
  providedIn: 'root'
})
export class StoreService {
  private readonly apiUrl = environment.apiUrl;

  // ── Signals ───────────────────────────────────────────────────────────────
  stores = signal<Store[]>([]);
  activeStore = signal<Store | null>(null);
  isLoading = signal<boolean>(false);

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {
    // Whenever current user changes and is logged in, auto-load stores
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadStores();
      } else {
        this.stores.set([]);
        this.activeStore.set(null);
      }
    });
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.authService.getAccessToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  /**
   * Load all stores owned by authenticated user
   */
  async loadStores(): Promise<Store[]> {
    if (!this.authService.isAuthenticated()) return [];
    this.isLoading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<Store[]>>(`${this.apiUrl}/stores`, {
          headers: this.getAuthHeaders()
        })
      );

      if (res.success && Array.isArray(res.data)) {
        this.stores.set(res.data);

        // Determine active store
        const savedId = localStorage.getItem(ACTIVE_STORE_KEY);
        let selected = res.data.find((s) => s.id === savedId);
        if (!selected && res.data.length > 0) {
          selected = res.data[0];
        }

        if (selected) {
          this.setActiveStore(selected);
        }
        return res.data;
      }
      return [];
    } catch (err) {
      console.error('[StoreService] loadStores error:', err);
      return [];
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Set active store and persist in localStorage
   */
  setActiveStore(store: Store): void {
    this.activeStore.set(store);
    localStorage.setItem(ACTIVE_STORE_KEY, store.id);
  }

  /**
   * Switch active store by ID
   */
  switchStore(storeId: string): void {
    const found = this.stores().find((s) => s.id === storeId);
    if (found) {
      this.setActiveStore(found);
    }
  }

  /**
   * Create a new store (multi-tenant isolation)
   */
  async createStore(dto: CreateStoreDto): Promise<{ success: boolean; message: string; store?: Store }> {
    try {
      this.isLoading.set(true);
      const res = await firstValueFrom(
        this.http.post<ApiResponse<Store>>(`${this.apiUrl}/stores`, dto, {
          headers: this.getAuthHeaders()
        })
      );

      if (res.success && res.data) {
        const updatedList = [...this.stores(), res.data];
        this.stores.set(updatedList);
        this.setActiveStore(res.data);
        return { success: true, message: res.message || 'Store created!', store: res.data };
      }

      return { success: false, message: res.message || 'Failed to create store.' };
    } catch (err: any) {
      const msg = err?.error?.message || 'Error creating store.';
      return { success: false, message: msg };
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Update active store
   */
  async updateStore(storeId: string, data: Partial<Store>): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<Store>>(`${this.apiUrl}/stores/${storeId}`, data, {
          headers: this.getAuthHeaders()
        })
      );

      if (res.success && res.data) {
        const updatedStores = this.stores().map((s) => (s.id === storeId ? res.data! : s));
        this.stores.set(updatedStores);
        if (this.activeStore()?.id === storeId) {
          this.activeStore.set(res.data);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Delete store
   */
  async deleteStore(storeId: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse>(`${this.apiUrl}/stores/${storeId}`, {
          headers: this.getAuthHeaders()
        })
      );

      if (res.success) {
        const remaining = this.stores().filter((s) => s.id !== storeId);
        this.stores.set(remaining);
        if (this.activeStore()?.id === storeId) {
          this.activeStore.set(remaining[0] || null);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Per-Store Data Methods ─────────────────────────────────────────────────

  async getStoreProducts(storeId: string): Promise<StoreProduct[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<StoreProduct[]>>(`${this.apiUrl}/stores/${storeId}/catalog`, {
          headers: this.getAuthHeaders()
        })
      );
      return res.success && Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  async addStoreProduct(storeId: string, product: Partial<StoreProduct>): Promise<StoreProduct | null> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<StoreProduct>>(`${this.apiUrl}/stores/${storeId}/catalog`, product, {
          headers: this.getAuthHeaders()
        })
      );
      return res.success && res.data ? res.data : null;
    } catch {
      return null;
    }
  }

  async deleteStoreProduct(storeId: string, productId: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse>(`${this.apiUrl}/stores/${storeId}/catalog/${productId}`, {
          headers: this.getAuthHeaders()
        })
      );
      return !!res.success;
    } catch {
      return false;
    }
  }

  async getStoreIntegrations(storeId: string): Promise<StoreIntegration[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<StoreIntegration[]>>(`${this.apiUrl}/stores/${storeId}/integrations`, {
          headers: this.getAuthHeaders()
        })
      );
      return res.success && Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  async saveStoreIntegration(storeId: string, provider: string, config: any): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/stores/${storeId}/integrations`, {
          provider,
          config,
          status: 'connected'
        }, {
          headers: this.getAuthHeaders()
        })
      );
      return !!res.success;
    } catch {
      return false;
    }
  }

  async getStoreMetrics(storeId: string): Promise<StoreMetrics | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<StoreMetrics>>(`${this.apiUrl}/stores/${storeId}/metrics`, {
          headers: this.getAuthHeaders()
        })
      );
      return res.success && res.data ? res.data : null;
    } catch {
      return null;
    }
  }
}
