# Realtime Chat SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new chat messages appear in the webapp automatically without refreshing the page.

**Architecture:** Use the existing SSE infrastructure. Register the FastAPI asyncio loop during application startup so existing `new_message` publish calls can reach connected `EventSource` clients, and clear it on shutdown.

**Tech Stack:** FastAPI, asyncio, FastAPI TestClient, React `EventSource`, Vitest/TypeScript build.

---

### Task 1: Backend SSE Lifespan Regression

**Files:**
- Create: `tests/test_sse_event_bus.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_sse_event_bus.py`:

```python
import unittest

from fastapi.testclient import TestClient

from backend import api


class SseEventBusTests(unittest.TestCase):
    def setUp(self):
        api.event_bus.loop = None
        api.event_bus.connections.clear()

    def tearDown(self):
        api.event_bus.loop = None
        api.event_bus.connections.clear()

    def test_fastapi_lifespan_registers_event_bus_loop(self):
        self.assertIsNone(api.event_bus.loop)

        with TestClient(api.app):
            self.assertIsNotNone(api.event_bus.loop)

        self.assertIsNone(api.event_bus.loop)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sse_event_bus.py -q`

Expected: FAIL because `api.event_bus.loop` remains `None` inside the `TestClient` lifespan.

- [ ] **Step 3: Implement FastAPI lifecycle hooks**

Modify `backend/api.py` immediately after `event_bus = EventBus()`:

```python
@app.on_event("startup")
async def _register_event_bus_loop() -> None:
    event_bus.loop = asyncio.get_running_loop()
    logger.info("SSE event bus loop registered")


@app.on_event("shutdown")
async def _clear_event_bus_loop() -> None:
    event_bus.loop = None
    event_bus.connections.clear()
    logger.info("SSE event bus loop cleared")
```

If `logger` is still declared after `event_bus`, move `logger = logging.getLogger(__name__)` above these handlers so the handlers can reference it.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_sse_event_bus.py -q`

Expected: PASS.

- [ ] **Step 5: Run focused chat tests**

Run: `python -m pytest tests/test_sse_event_bus.py tests/test_onec_chat_flow.py -q`

Expected: PASS or report exact existing unrelated failures.

### Task 2: Frontend Compile Verification

**Files:**
- Verify: `webapp/src/api/ApiClient.ts`
- Verify: `webapp/src/hooks/useChatConversation.ts`
- Verify: `webapp/src/hooks/useDialogsData.ts`

- [ ] **Step 1: Inspect existing SSE client code**

Confirm `ApiClient.connectToStream` opens `EventSource` with `api_token` and `session_token`, and that both hooks subscribe to `new_message` updates.

- [ ] **Step 2: Run webapp build**

Run: `npm run build` in `webapp`.

Expected: TypeScript and Vite build complete successfully.

### Task 3: Final Verification

**Files:**
- Verify: `backend/api.py`
- Verify: `tests/test_sse_event_bus.py`

- [ ] **Step 1: Review diff**

Run: `git diff -- backend/api.py tests/test_sse_event_bus.py docs/superpowers/specs/2026-05-05-realtime-chat-sse-design.md docs/superpowers/plans/2026-05-05-realtime-chat-sse.md`

Expected: Only the SSE lifecycle hook, regression test, and docs/plan changes are present.

- [ ] **Step 2: Re-run backend verification**

Run: `python -m pytest tests/test_sse_event_bus.py tests/test_onec_chat_flow.py -q`

Expected: PASS or report exact existing unrelated failures.

- [ ] **Step 3: Re-run frontend build**

Run: `npm run build` in `webapp`.

Expected: Build exits with code 0.
