import { AuthState, WhispError } from './types.js';

export type AuthStateGetter = () => AuthState | null;
export type AuthStateSetter = (state: AuthState) => void;
export type OnAuthLost = () => void;

export interface HttpClientConfig {
  baseUrl: string;
  apiKey?: string;
  getAuth: AuthStateGetter;
  setAuth: AuthStateSetter;
  onAuthLost: OnAuthLost;
}

export class HttpClient {
  private baseUrl: string;
  private apiKey?: string;
  private getAuth: AuthStateGetter;
  private setAuth: AuthStateSetter;
  private onAuthLost: OnAuthLost;

  // Token refresh lock: only one refresh request at a time
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.getAuth = config.getAuth;
    this.setAuth = config.setAuth;
    this.onAuthLost = config.onAuthLost;
  }

  /**
   * Make an API-key-authenticated request (registerUser, signIn).
   */
  async requestWithApiKey<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { extractJwtFromHeader?: boolean }
  ): Promise<{ body: T; jwt?: string }> {
    if (!this.apiKey) {
      throw new WhispError(
        'API key is required for this endpoint. Provide it in WhispClient config, ' +
        'or call this endpoint from your backend instead.',
        0
      );
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new WhispError(
        errorBody?.message || `Request failed: ${res.status}`,
        res.status,
        errorBody
      );
    }

    const responseBody = await res.json().catch(() => null);
    const result: { body: T; jwt?: string } = { body: responseBody as T };

    if (options?.extractJwtFromHeader) {
      const authHeader = res.headers.get('Authorization');
      if (authHeader) {
        result.jwt = authHeader;
      }
    }

    return result;
  }

  /**
   * Make a JWT-authenticated request with automatic refresh on 401.
   */
  async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      extractJwtFromHeader?: boolean;
    }
  ): Promise<{ body: T; jwt?: string }> {
    // Build URL with query params
    let url = `${this.baseUrl}${path}`;
    if (options?.query) {
      const params = new URLSearchParams();
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined) params.set(key, String(val));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    // First attempt
    const result = await this.doAuthenticatedRequest<T>(url, method, options);
    if (result) return result;

    // Got 401 — try refresh
    const refreshed = await this.refreshToken();
    if (!refreshed) {
      this.onAuthLost();
      throw new WhispError('Session expired. Please sign in again.', 401);
    }

    // Retry after refresh
    const retry = await this.doAuthenticatedRequest<T>(url, method, options);
    if (!retry) {
      this.onAuthLost();
      throw new WhispError('Request failed after token refresh.', 401);
    }

    return retry;
  }

  /**
   * Returns the response on success, or null on 401.
   */
  private async doAuthenticatedRequest<T>(
    url: string,
    method: string,
    options?: {
      body?: unknown;
      extractJwtFromHeader?: boolean;
    }
  ): Promise<{ body: T; jwt?: string } | null> {
    const auth = this.getAuth();
    if (!auth) {
      throw new WhispError('Not authenticated. Call signIn() or setAuth() first.', 401);
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.jwt}`,
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 401) {
      return null;
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new WhispError(
        errorBody?.message || `Request failed: ${res.status}`,
        res.status,
        errorBody
      );
    }

    const responseBody = await res.json().catch(() => null);
    const result: { body: T; jwt?: string } = { body: responseBody as T };

    if (options?.extractJwtFromHeader) {
      const authHeader = res.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        result.jwt = authHeader.slice(7);
      }
    }

    return result;
  }

  /**
   * Refresh the JWT. Uses a lock to prevent concurrent refresh requests.
   * Returns true if refresh succeeded.
   */
  private async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<boolean> {
    const auth = this.getAuth();
    if (!auth) return false;

    try {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.refreshToken}`,
        },
        body: JSON.stringify({ expiredJwt: auth.jwt }),
      });

      if (!res.ok) return false;

      const authHeader = res.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return false;

      const newJwt = authHeader.slice(7);
      this.setAuth({ ...auth, jwt: newJwt });
      return true;
    } catch {
      return false;
    }
  }
}
