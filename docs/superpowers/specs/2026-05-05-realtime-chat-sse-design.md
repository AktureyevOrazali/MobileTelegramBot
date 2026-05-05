# Realtime Chat SSE Design

## Problem

Operators currently have to refresh the webapp chat page to see new client messages. The frontend already contains an `EventSource` subscription and chat/dialog hooks that reload data when a `new_message` event arrives, but the backend event bus never records the running FastAPI event loop. Because `event_bus.loop` stays `None`, backend publish calls skip delivery.

This is not solved by adding every client device IP to CORS. All users will connect from different devices to one backend server, so CORS should allow the webapp origin, not individual user IP addresses.

## Recommended Approach

Use the existing Server-Sent Events channel as the primary realtime path.

The backend will register the active asyncio loop during FastAPI startup and clear it during shutdown. Existing message publish calls will then deliver `new_message` events to connected webapp clients. The frontend will keep its current `EventSource` connection and debounced reload behavior for the active chat and dialog list.

## Architecture

- `backend/api.py`
  - Owns `EventBus`, `/api/stream`, CORS config, and message publish helpers.
  - Adds FastAPI startup/shutdown handlers to set and clear `event_bus.loop`.
  - Keeps SSE authorization through the current `get_current_user` dependency.

- `webapp/src/api/ApiClient.ts`
  - Keeps one `EventSource` connection per authenticated session.
  - Sends `api_token` and `session_token` as query params because browsers cannot set custom headers on `EventSource`.

- `webapp/src/hooks/useChatConversation.ts`
  - Keeps current behavior: when a `new_message` event belongs to the active chat/dialog, schedule a message reload.

- `webapp/src/hooks/useDialogsData.ts`
  - Keeps current behavior: when any `new_message` event arrives, schedule a dialog list refresh.

## CORS Policy

Production CORS must be based on the frontend origin, for example `https://app.example.kz`, not every user device IP. If frontend and API are served from the same origin, CORS becomes mostly irrelevant for browser API calls. For development and LAN testing, the existing private-network regex can stay as a convenience.

No wildcard credentials policy is required. `allow_credentials=True` can remain because the middleware reflects only allowed origins from `CORS_ORIGINS` or `CORS_ORIGIN_REGEX`.

## Error Handling

`EventSource` already reconnects automatically after transient failures. The webapp should not block normal chat use if SSE disconnects; manual fetches and send-message reloads continue to work. Backend publish remains best-effort: if no loop or no connected clients exist, message persistence still succeeds.

## Testing

- Add a backend regression test that opens FastAPI through `TestClient` and proves `event_bus.loop` is set during lifespan and cleared afterward.
- Run the focused backend test before and after implementation to prove the regression.
- Run the existing 1C/chat flow tests that cover message persistence and publish helper call sites.
- Run the webapp build to ensure existing SSE frontend code still compiles.

## Out of Scope

- Replacing SSE with WebSocket.
- Adding per-device IPs to CORS.
- Refactoring the large `backend/api.py` module beyond the small lifecycle hook needed for the bug.
