# whisp-sdk

JavaScript/TypeScript SDK for the [Whisp Chat](https://whispchat.com) API. Provides a simple wrapper around the Whisp REST API and real-time WebSocket messaging.

## Installation

```bash
npm install whisp-sdk
```

**Node.js only** — if using the real-time WebSocket features in Node.js, also install `ws`:

```bash
npm install ws
```

In browsers, the native `WebSocket` is used automatically.

## Quick Start

### Browser App (Recommended Flow)

Since the `signIn` and `registerUser` endpoints require an API key that should not be exposed in browser code, the recommended approach is:

1. Your backend calls the Whisp `signIn` endpoint with the API key
2. Your backend returns the JWT, refresh token, and user ID to the browser
3. The browser SDK uses `setAuth()` to initialize

```typescript
import { WhispClient } from 'whisp-sdk';

const whisp = new WhispClient({
  baseUrl: 'https://yourapp.api.whispchat.com',
});

// After your backend authenticates the user and returns tokens:
whisp.setAuth({
  jwt: 'eyJhbG...',
  refreshToken: 'dGhpcyBpcyBh...',
  userId: '550e8400-e29b-41d4-a716-446655440000',
});

// Now use the SDK
const chats = await whisp.getChats();
```

### Node.js Backend

```typescript
import { WhispClient } from 'whisp-sdk';
import WebSocket from 'ws';

const whisp = new WhispClient({
  baseUrl: 'https://yourapp.api.whispchat.com',
  apiKey: 'your-api-key',        // Safe to use on the server
  webSocketImpl: WebSocket,       // Required for Node.js WebSocket support
});

// Register a user
await whisp.registerUser({
  username: 'johndoe',
  email: 'john@example.com',
  password: 'SecureP@ss123',
});

// Sign in (stores tokens internally)
const user = await whisp.signIn({
  username: 'johndoe',
  password: 'SecureP@ss123',
});

console.log(`Signed in as ${user.username} (${user.id})`);
```

## API Reference

### Constructor

```typescript
new WhispClient({
  baseUrl: string;          // e.g. "https://yourapp.api.whispchat.com"
  apiKey?: string;          // Only needed for registerUser/signIn (backend use)
  webSocketImpl?: unknown;  // WebSocket class for Node.js (e.g. `ws`)
})
```

### Authentication

```typescript
// Set auth tokens (after your backend authenticates)
whisp.setAuth({ jwt, refreshToken, userId });

// Get current auth state
const auth = whisp.getAuth(); // { jwt, refreshToken, userId } | null

// Check if authenticated
whisp.isAuthenticated; // boolean

// Sign in (requires API key — use from backend)
const user = await whisp.signIn({ username, password });

// Register user (requires API key — use from backend)
await whisp.registerUser({ username, email, password, firstName?, surName? });

// Refresh JWT manually (happens automatically on 401)
const success = await whisp.refresh();

// Logout (invalidates refresh token)
await whisp.logout();

// Logout all sessions
await whisp.logoutAll();
```

### User

```typescript
const user = await whisp.getUser();
// { id, username, email, role }

await whisp.changeUsername('new_username');

await whisp.deleteUser();
```

### Chats

```typescript
// Create a chat (include your own username in the list)
const chat = await whisp.createChat('Project Discussion', ['johndoe', 'janedoe']);
// { chatId, chatName, createdAt, creator, groupChat, ... }

// List chats (paginated)
const { chats } = await whisp.getChats(0, 20);

// Get users in a chat
const { users } = await whisp.getChatUsers(chatId);

// Add/remove users
await whisp.addUserToChat(chatId, 'newuser');
await whisp.removeUserFromChat(chatId, userId);

// Update chat
await whisp.changeChatName(chatId, 'New Name');
await whisp.deleteChat(chatId);
```

### Messages

```typescript
// Get messages (cursor-based pagination)
const { messages } = await whisp.getMessages(chatId);

// Load older messages
const { messages: older } = await whisp.getMessages(chatId, 50, lastMessageId);
```

### Real-Time Messaging

```typescript
// Connect to WebSocket (gets ticket automatically)
await whisp.realtime.connect();

// Listen for events
whisp.realtime.on('message', (event) => {
  console.log(`${event.senderId}: ${event.message}`);
});

whisp.realtime.on('typing', (event) => {
  console.log(`User ${event.senderId} is typing in ${event.chatId}`);
});

whisp.realtime.on('messageEdited', (event) => {
  console.log(`Message ${event.messageId} edited to: ${event.message}`);
});

whisp.realtime.on('reaction', (event) => {
  console.log(`${event.senderId} reacted with ${event.message} to ${event.parentMessageId}`);
});

// Connection lifecycle events
whisp.realtime.on('connected', () => console.log('Connected!'));
whisp.realtime.on('disconnected', ({ reason, willReconnect }) => {
  console.log(`Disconnected: ${reason}. Will reconnect: ${willReconnect}`);
});
whisp.realtime.on('reconnecting', ({ attempt }) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

// Send actions
whisp.realtime.sendMessage(chatId, 'Hello!');
whisp.realtime.editMessage(chatId, messageId, 'Hello! (edited)');
whisp.realtime.deleteMessage(chatId, messageId);
whisp.realtime.replyToMessage(chatId, messageId, 'I agree!');
whisp.realtime.sendTyping(chatId);
whisp.realtime.addReaction(chatId, messageId, '👍');
whisp.realtime.removeReaction(reactionId);
whisp.realtime.markAsRead(chatId, messageId);

// Check connection status
whisp.realtime.connected; // boolean

// Disconnect
whisp.realtime.disconnect();
```

### Event Types

All events received via `whisp.realtime.on()`:

| Event Name | Type | Description |
|---|---|---|
| `message` | `SendMsgEvent` | New message received |
| `messageEdited` | `EditMsgEvent` | Message was edited |
| `messageDeleted` | `DeleteMsgEvent` | Message was deleted |
| `reply` | `ReplyEvent` | Reply to a message (includes `replyTo` with original) |
| `typing` | `TypingEvent` | User is typing |
| `reaction` | `ReactEvent` | Reaction added (includes `parentMessageId`) |
| `reactionDeleted` | `DeleteReactEvent` | Reaction removed |
| `messageRead` | `ReadMsgEvent` | Message was read |
| `userJoined` | `UserJoinEvent` | User added to chat |
| `userLeft` | `UserLeaveEvent` | User left chat |
| `chatCreated` | `NewChatEvent` | New chat created |
| `chatDeleted` | `DeleteChatEvent` | Chat deleted |
| `connected` | `void` | WebSocket connected |
| `disconnected` | `{ reason, willReconnect }` | WebSocket disconnected |
| `reconnecting` | `{ attempt }` | Reconnection attempt |
| `error` | `{ error }` | Error occurred |

### Unsubscribing from Events

`on()` returns an unsubscribe function:

```typescript
const unsubscribe = whisp.realtime.on('message', handler);

// Later, to stop listening:
unsubscribe();

// Or remove all listeners:
whisp.realtime.removeAllListeners();
whisp.realtime.removeAllListeners('message'); // specific event only
```

### Error Handling

The SDK throws `WhispError` for HTTP errors:

```typescript
import { WhispError } from 'whisp-sdk';

try {
  await whisp.createChat('Test', ['nonexistent_user']);
} catch (err) {
  if (err instanceof WhispError) {
    console.log(err.status);  // HTTP status code
    console.log(err.message); // Error message
    console.log(err.body);    // Raw error response body
  }
}
```

### Automatic Token Refresh

The SDK automatically refreshes the JWT when any request returns a `401`. This is handled transparently — you don't need to do anything. If the refresh token itself is expired, the SDK clears the auth state and throws a `WhispError` with status `401`.

### Automatic Reconnection

If the WebSocket connection drops, the SDK automatically:

1. Refreshes the JWT if needed
2. Gets a new WebSocket ticket
3. Reconnects with exponential backoff (1s → 2s → 4s → ... → 30s max)

Listen to `disconnected`, `reconnecting`, and `connected` events to update your UI.

## TypeScript Support

The SDK is written in TypeScript and ships with full type declarations. All event payloads, request/response types, and method signatures are fully typed.

```typescript
import { WhispClient, SendMsgEvent, ChatDetails } from 'whisp-sdk';

whisp.realtime.on('message', (event: SendMsgEvent) => {
  // event is fully typed
  console.log(event.messageId, event.message, event.senderId);
});
```
