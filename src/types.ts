// ─── Client Configuration ────────────────────────────────────────────────────

export interface WhispConfig {
  /** Base URL of the Whisp API, e.g. "https://myapp.api.whispchat.com" */
  baseUrl: string;

  /**
   * API key for registerUser/signIn endpoints.
   * Only provide this if calling those endpoints directly (e.g. from a Node.js backend).
   * In browser apps, these calls should go through your own backend.
   */
  apiKey?: string;

  /**
   * Custom WebSocket implementation for Node.js environments.
   * In browsers, the native WebSocket is used automatically.
   * In Node.js, pass `require('ws')` or `import('ws').then(m => m.default)`.
   *
   * @example
   * import WebSocket from 'ws';
   * const whisp = new WhispClient({ baseUrl: '...', webSocketImpl: WebSocket });
   */
  webSocketImpl?: unknown;
}

export interface AuthState {
  jwt: string;
  refreshToken: string;
  userId: string;
}

// ─── REST API: Request Types ─────────────────────────────────────────────────

export interface RegisterUserRequest {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  surName?: string;
}

export interface SignInRequest {
  username: string;
  password: string;
}

export interface ChangeUsernameRequest {
  newUsername: string;
}

export interface CreateChatRequest {
  chatName: string;
  userNames: string[];
}

export interface AddUserRequest {
  chatId: string;
  newUsername: string;
}

export interface ChangeChatNameRequest {
  chatId: string;
  newChatName: string;
}

export interface RemoveUserRequest {
  chatId: string;
  removeUser: string;
}

// ─── REST API: Response Types ────────────────────────────────────────────────

export interface SignInResponse {
  id: string;
  username: string;
  email: string;
  refreshToken: string;
  roles: ('USER' | 'ADMIN')[];
}

export interface UserInfo {
  id: string;
  username: string;
  email: string;
  role: ('USER' | 'ADMIN')[];
}

export interface TicketResponse {
  ticket: string;
}

export interface ChatDetails {
  chatId: string;
  chatName: string;
  lastMessageTimestamp: string | null;
  lastMessage: string | null;
  createdAt: string;
  creator: string;
  groupChat: boolean;
}

export interface ChatsListResponse {
  chats: ChatDetails[];
}

export interface ChatUserInfo {
  userId: string;
  username: string;
  joinedChatAt: string;
  lastSeenMessage: string | null;
}

export interface ChatUsersResponse {
  users: ChatUserInfo[];
}

export interface Reaction {
  reactionId: string;
  chatId: string;
  messageId: string;
  senderId: string;
  reaction: string;
  createdAt: string;
}

export interface MessageContent {
  chatId: string;
  timeStamp: string;
  messageId: string;
  senderId: string;
  content: string;
  edited: boolean;
  editedAt: string | null;
}

export interface Message extends MessageContent {
  replyTo: MessageContent | null;
  reactions: Reaction[];
}

export interface MessagesResponse {
  messages: Message[];
}

export interface ErrorMessage {
  message: string;
}

export interface AuthErrorResponse {
  type?: string;
  title?: string;
  status?: string;
  detail?: string;
  instance?: string;
  code?: string;
}

// ─── WebSocket: Receive Event Types ──────────────────────────────────────────

interface BaseEvent {
  chatId: string;
  recipientId: string;
  senderId: string;
}

export interface SendMsgEvent extends BaseEvent {
  type: 'SEND_MSG';
  timeStamp: string;
  message: string;
  messageId: string;
}

export interface EditMsgEvent extends BaseEvent {
  type: 'EDIT_MSG';
  message: string;
  messageId: string;
  editedAt: string;
}

export interface DeleteMsgEvent extends BaseEvent {
  type: 'DELETE_MSG';
  messageId: string;
  timeStamp: string;
}

export interface ReplyEvent extends BaseEvent {
  type: 'REPLY';
  messageId: string;
  message: string;
  replyTo: MessageContent;
  timeStamp: string;
}

export interface TypingEvent extends BaseEvent {
  type: 'TYPING';
}

export interface ReactEvent extends BaseEvent {
  type: 'REACT';
  messageId: string;
  message: string;
  parentMessageId: string;
  timeStamp: string;
}

export interface DeleteReactEvent extends BaseEvent {
  type: 'DELETE_REACT';
  messageId: string;
}

export interface ReadMsgEvent extends BaseEvent {
  type: 'READ_MSG';
  messageId: string;
}

export interface UserJoinEvent extends BaseEvent {
  type: 'USER_JOIN';
  message: string;
  username: string;
}

export interface UserLeaveEvent extends BaseEvent {
  type: 'USER_LEAVE';
  message: string;
  timeStamp: string;
}

export interface NewChatEvent extends BaseEvent {
  type: 'NEW_CHAT';
  timeStamp: string;
  message: string;
}

export interface DeleteChatEvent extends BaseEvent {
  type: 'DELETE_CHAT';
}

export type WhispEvent =
  | SendMsgEvent
  | EditMsgEvent
  | DeleteMsgEvent
  | ReplyEvent
  | TypingEvent
  | ReactEvent
  | DeleteReactEvent
  | ReadMsgEvent
  | UserJoinEvent
  | UserLeaveEvent
  | NewChatEvent
  | DeleteChatEvent;

// ─── WebSocket: Event Map for .on() ─────────────────────────────────────────

export interface RealtimeEventMap {
  message: SendMsgEvent;
  messageEdited: EditMsgEvent;
  messageDeleted: DeleteMsgEvent;
  reply: ReplyEvent;
  typing: TypingEvent;
  reaction: ReactEvent;
  reactionDeleted: DeleteReactEvent;
  messageRead: ReadMsgEvent;
  userJoined: UserJoinEvent;
  userLeft: UserLeaveEvent;
  chatCreated: NewChatEvent;
  chatDeleted: DeleteChatEvent;
  connected: void;
  disconnected: { reason: string; willReconnect: boolean };
  reconnecting: { attempt: number };
  error: { error: unknown };
}

// ─── SDK Error ───────────────────────────────────────────────────────────────

export class WhispError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'WhispError';
    this.status = status;
    this.body = body;
  }
}
