import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role?: string;
  company?: string;
  createdAt?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

// ─── Storage Keys ────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SESSION: 'nexus_session',
  USER:    'nexus_user',
  THEME:   'nexus_dark_theme',
} as const;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private readonly apiUrl = environment.apiUrl;

  // ── Signals ───────────────────────────────────────────────────────────────
  currentUser  = signal<User | null>(null);
  isDarkMode   = signal<boolean>(false);
  isLoading    = signal<boolean>(false);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.initSession();
    this.initTheme();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  private initSession(): void {
    try {
      const savedUser    = localStorage.getItem(STORAGE_KEYS.USER);
      const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION);

      if (savedUser && savedSession) {
        const session: AuthSession = JSON.parse(savedSession);

        // Check if token has expired
        if (session.expires_at && Date.now() / 1000 > session.expires_at) {
          // Attempt silent refresh
          this.silentRefresh(session.refresh_token).catch(() => this.clearSession());
        } else {
          this.currentUser.set(JSON.parse(savedUser));
        }
      }
    } catch {
      this.clearSession();
    }
  }

  private initTheme(): void {
    const isDark = localStorage.getItem(STORAGE_KEYS.THEME) === 'true';
    this.setDarkMode(isDark);
  }

  // ── Theme ─────────────────────────────────────────────────────────────────

  public setDarkMode(enabled: boolean): void {
    this.isDarkMode.set(enabled);
    document.body.classList.toggle('dark', enabled);
    localStorage.setItem(STORAGE_KEYS.THEME, String(enabled));
  }

  public toggleTheme(): void {
    this.setDarkMode(!this.isDarkMode());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getAuthHeaders(): HttpHeaders {
    const session = this.getSession();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {})
    });
  }

  private getSession(): AuthSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveSession(session: AuthSession, user: User): void {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    localStorage.setItem(STORAGE_KEYS.USER,    JSON.stringify(user));
    this.currentUser.set(user);
  }

  private clearSession(): void {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    localStorage.removeItem(STORAGE_KEYS.USER);
    this.currentUser.set(null);
  }

  private mapApiUserToUser(apiUser: any): User {
    return {
      id:         apiUser.id,
      name:       apiUser.full_name || apiUser.email?.split('@')[0] || 'User',
      email:      apiUser.email,
      avatarUrl:  apiUser.user_metadata?.avatar_url ||
                  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(apiUser.email)}`,
      role:       apiUser.user_metadata?.role        || 'Member',
      company:    apiUser.user_metadata?.company     || 'DB Technology',
      createdAt:  apiUser.created_at,
    };
  }

  // ── Auth Methods ──────────────────────────────────────────────────────────

  /**
   * Login with email & password
   */
  public async login(
    email: string,
    password: string
  ): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/login`, { email, password })
      );

      if (res.success && res.data) {
        const user = this.mapApiUserToUser(res.data.user);
        this.saveSession(res.data.session, user);
        return { success: true, message: res.message, user };
      }

      return { success: false, message: res.message || 'Login failed.' };

    } catch (err: any) {
      const msg = err?.error?.message || 'Unable to connect to server. Please try again.';
      return { success: false, message: msg };
    }
  }

  /**
   * Register new user
   */
  public async signup(
    fullName: string,
    email: string,
    password: string,
    storeName?: string
  ): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/signup`, {
          email,
          password,
          full_name: fullName,
          store_name: storeName,
          company: storeName || fullName
        })
      );

      if (res.success && res.data) {
        const user = this.mapApiUserToUser(res.data.user);

        // If session is returned (email confirmation disabled), save it
        if (res.data.session) {
          this.saveSession(res.data.session, user);
        }

        return { success: true, message: res.message, user };
      }

      return { success: false, message: res.message || 'Signup failed.' };

    } catch (err: any) {
      const msg = err?.error?.message || 'Unable to connect to server. Please try again.';
      return { success: false, message: msg };
    }
  }

  /**
   * Verify email address using token or 6-digit OTP
   */
  public async verifyEmail(
    token?: string,
    otp?: string,
    email?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/verify-email`, {
          token,
          otp,
          email,
        })
      );
      return { success: res.success, message: res.message };
    } catch (err: any) {
      const msg = err?.error?.message || 'Verification failed. Please try again.';
      return { success: false, message: msg };
    }
  }

  /**
   * Resend verification email
   */
  public async resendVerification(
    email: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/resend-verification`, { email })
      );
      return { success: res.success, message: res.message };
    } catch (err: any) {
      const msg = err?.error?.message || 'Failed to resend email.';
      return { success: false, message: msg };
    }
  }

  /**
   * Logout — invalidates session on backend + clears local storage
   */
  public async logout(): Promise<void> {
    try {
      const session = this.getSession();
      if (session) {
        await firstValueFrom(
          this.http.post<ApiResponse>(
            `${this.apiUrl}/auth/logout`,
            {},
            { headers: this.getAuthHeaders() }
          )
        );
      }
    } catch {
      // Even if backend call fails, clear local session
    } finally {
      this.clearSession();
      this.router.navigate(['/login']);
    }
  }

  /**
   * Get authenticated user profile from backend
   */
  public async getProfile(): Promise<User | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse>(`${this.apiUrl}/auth/me`, {
          headers: this.getAuthHeaders()
        })
      );

      if (res.success && res.data) {
        const user = this.mapApiUserToUser(res.data);
        this.currentUser.set(user);
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
        return user;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Silent token refresh using refresh_token
   */
  public async silentRefresh(refreshToken?: string): Promise<boolean> {
    try {
      const token = refreshToken || this.getSession()?.refresh_token;
      if (!token) return false;

      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/refresh`, {
          refresh_token: token
        })
      );

      if (res.success && res.data?.session) {
        const existingUser = this.currentUser();
        if (existingUser) {
          this.saveSession(res.data.session, existingUser);
        }
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Send forgot password email
   */
  public async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${this.apiUrl}/auth/forgot-password`, { email })
      );
      return { success: res.success, message: res.message };
    } catch (err: any) {
      const msg = err?.error?.message || 'Failed to send reset email. Please try again.';
      return { success: false, message: msg };
    }
  }

  /**
   * Update password (requires auth)
   */
  public async updatePassword(newPassword: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse>(
          `${this.apiUrl}/auth/update-password`,
          { new_password: newPassword },
          { headers: this.getAuthHeaders() }
        )
      );
      return { success: res.success, message: res.message };
    } catch (err: any) {
      const msg = err?.error?.message || 'Failed to update password.';
      return { success: false, message: msg };
    }
  }

  /**
   * Get the stored access token
   */
  public getAccessToken(): string | null {
    return this.getSession()?.access_token || null;
  }

  /**
   * Check if user is currently authenticated
   */
  public isAuthenticated(): boolean {
    const session = this.getSession();
    if (!session || !this.currentUser()) return false;

    // Also check token expiry
    if (session.expires_at && Date.now() / 1000 > session.expires_at) {
      return false;
    }

    return true;
  }
}
