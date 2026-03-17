import { HttpClient } from './http.js';
import { WhispRealtime } from './realtime.js';
import {
  WhispConfig,
  AuthState,
  RegisterUserRequest,
  SignInRequest,
  SignInResponse,
  UserInfo,
  ChatDetails,
  ChatsListResponse,
  ChatUsersResponse,
  MessagesResponse,
  TicketResponse,
  WhispError,
} from './types.js';

export class WhispClient {
  private auth: AuthState | null = null;
  private http: HttpClient;

  /** Real-time messaging via WebSocket/STOMP. */
  public readonly realtime: WhispRealtime;

  constructor(private config: WhispConfig) {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');

    this.http = new HttpClient({
      baseUrl,
      apiKey: config.apiKey,
      getAuth: () => this.auth,
      setAuth: (state) => { this.auth = state; },
      onAuthLost: () => { this.auth = null; },
    });

    this.realtime = new WhispRealtime({
      baseUrl,
      getAuth: () => this.auth,
      getTicket: () => this.getTicket(),
      refreshAuth: () => this.refresh(),
      webSocketImpl: config.webSocketImpl,
    });
  }

  // ─── Authentication ──────────────────────────────────────────────────────

  /**
   * Set auth tokens directly (e.g. after your backend calls signIn).
   * This is the recommended approach for browser apps.
   */
  setAuth(state: AuthState): void {
    this.auth = { ...state };
  }

  /** Returns the current auth state, or null if not authenticated. */
  getAuth(): AuthState | null {
    return this.auth ? { ...this.auth } : null;
  }

  /** Returns whether the client is currently authenticated. */
  get isAuthenticated(): boolean {
    return this.auth !== null;
  }

  /**
   * Register a new user.
   *
   * **Important:** This endpoint requires an API key. In browser apps, call this
   * from your backend instead and pass the tokens to the SDK via `setAuth()`.
   */
  async registerUser(data: RegisterUserRequest): Promise<void> {
    await this.http.requestWithApiKey('POST', '/api/user/registerUser', data);
  }

  /**
   * Sign in a user. Stores the JWT, refresh token, and user ID internally.
   *
   * **Important:** This endpoint requires an API key. In browser apps, call this
   * from your backend instead and pass the tokens to the SDK via `setAuth()`.
   *
   * @returns The sign-in response containing user info.
   */
  async signIn(data: SignInRequest): Promise<SignInResponse> {
    const { body, jwt } = await this.http.requestWithApiKey<SignInResponse>(
      'POST',
      '/api/user/signin',
      data,
      { extractJwtFromHeader: true }
    );

    if (!jwt) {
      throw new WhispError('Sign-in succeeded but no JWT was returned in the response header.', 0);
    }

    this.auth = {
      jwt,
      refreshToken: body.refreshToken,
      userId: body.id,
    };

    return body;
  }

  /**
   * Refresh the JWT token. Called automatically on 401 responses,
   * but can also be called manually.
   *
   * @returns true if the refresh succeeded, false otherwise.
   */
  async refresh(): Promise<boolean> {
    if (!this.auth) return false;

    try {
      const res = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.auth.refreshToken}`,
        },
        body: JSON.stringify({ expiredJwt: this.auth.jwt }),
      });

      if (!res.ok) return false;

      const authHeader = res.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return false;

      this.auth = { ...this.auth, jwt: authHeader.slice(7) };
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Logout: invalidates the current refresh token.
   */
  async logout(): Promise<void> {
    if (!this.auth) return;
    const refreshToken = this.auth.refreshToken;

    try {
      await this.http.request('POST', '/api/auth/logout', {
        body: { refreshToken },
      });
    } finally {
      this.realtime.disconnect();
      this.auth = null;
    }
  }

  /**
   * Logout from all sessions: invalidates all refresh tokens.
   */
  async logoutAll(): Promise<void> {
    try {
      await this.http.request('POST', '/api/auth/logoutAll');
    } finally {
      this.realtime.disconnect();
      this.auth = null;
    }
  }

  // ─── User ────────────────────────────────────────────────────────────────

  /** Get the current authenticated user's information. */
  async getUser(): Promise<UserInfo> {
    const { body } = await this.http.request<UserInfo>('GET', '/api/user/getUser');
    return body;
  }

  /**
   * Change the authenticated user's username.
   * The JWT is automatically updated with the new token.
   */
  async changeUsername(newUsername: string): Promise<void> {
    const { jwt } = await this.http.request<null>('POST', '/api/user/changeUsername', {
      body: { newUsername },
      extractJwtFromHeader: true,
    });

    if (jwt && this.auth) {
      this.auth = { ...this.auth, jwt };
    }
  }

  /** Delete the authenticated user and all their data. */
  async deleteUser(): Promise<void> {
    await this.http.request('DELETE', '/api/user/deleteUser');
    this.realtime.disconnect();
    this.auth = null;
  }

  // ─── Chats ───────────────────────────────────────────────────────────────

  /** Create a new chat with the given users. */
  async createChat(chatName: string, userNames: string[]): Promise<ChatDetails> {
    const { body } = await this.http.request<ChatDetails>('POST', '/api/chat/createChat', {
      body: { chatName, userNames },
    });
    return body;
  }

  /** List all chats for the current user with pagination. */
  async getChats(page?: number, size?: number): Promise<ChatsListResponse> {
    const { body } = await this.http.request<ChatsListResponse>('GET', '/api/chat/getChats', {
      query: { page, size },
    });
    return body;
  }

  /** Get all users in a chat. */
  async getChatUsers(chatId: string): Promise<ChatUsersResponse> {
    const { body } = await this.http.request<ChatUsersResponse>(
      'GET',
      `/api/chat/getUsers/${chatId}`
    );
    return body;
  }

  /** Add a user to a chat. */
  async addUserToChat(chatId: string, newUsername: string): Promise<void> {
    await this.http.request('POST', '/api/chat/addUser', {
      body: { chatId, newUsername },
    });
  }

  /** Remove a user from a chat (or leave the chat). */
  async removeUserFromChat(chatId: string, removeUser: string): Promise<void> {
    await this.http.request('POST', '/api/chat/removeUser', {
      body: { chatId, removeUser },
    });
  }

  /** Change a chat's name. */
  async changeChatName(chatId: string, newChatName: string): Promise<void> {
    await this.http.request('POST', '/api/chat/changeName', {
      body: { chatId, newChatName },
    });
  }

  /** Delete a chat. Only the creator can do this. */
  async deleteChat(chatId: string): Promise<void> {
    await this.http.request('DELETE', '/api/chat/deleteChat', {
      query: { chatId },
    });
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  /**
   * Get messages for a chat with cursor-based pagination.
   * Automatically triggers a read receipt on the last message.
   *
   * @param chatId - The chat to fetch messages from.
   * @param size - Number of messages to fetch (default: 50).
   * @param lastMessage - Message ID cursor for pagination (fetch older messages).
   */
  async getMessages(chatId: string, size?: number, lastMessage?: string): Promise<MessagesResponse> {
    const { body } = await this.http.request<MessagesResponse>(
      'GET',
      `/api/messages/getMessages/${chatId}`,
      { query: { size, lastMessage } }
    );
    return body;
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async getTicket(): Promise<string> {
    const { body } = await this.http.request<TicketResponse>('GET', '/api/auth/getTicket');
    return body.ticket;
  }
}
