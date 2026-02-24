export { WhispClient } from './client.js';
export { WhispRealtime } from './realtime.js';

// Types
export type {
  WhispConfig,
  AuthState,
  RegisterUserRequest,
  SignInRequest,
  SignInResponse,
  UserInfo,
  ChatDetails,
  ChatsListResponse,
  ChatUserInfo,
  ChatUsersResponse,
  Reaction,
  MessageContent,
  Message,
  MessagesResponse,
  TicketResponse,
  ErrorMessage,
  AuthErrorResponse,
  // WebSocket events
  SendMsgEvent,
  EditMsgEvent,
  DeleteMsgEvent,
  ReplyEvent,
  TypingEvent,
  ReactEvent,
  DeleteReactEvent,
  ReadMsgEvent,
  UserJoinEvent,
  UserLeaveEvent,
  NewChatEvent,
  DeleteChatEvent,
  WhispEvent,
  RealtimeEventMap,
  ChangeUsernameRequest,
  CreateChatRequest,
  AddUserRequest,
  ChangeChatNameRequest,
  RemoveUserRequest,
} from './types.js';

export { WhispError } from './types.js';
