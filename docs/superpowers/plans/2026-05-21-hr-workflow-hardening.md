# HR Workflow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HR requests safer to process by preserving decision history, sending meaningful HR comments, and preventing invalid employee submissions.

**Architecture:** Extend the existing HR request model rather than introducing a separate workflow engine. The backend stores append-only HR request events and returns them with each request. The frontend displays the timeline, lets HR enter a comment when deciding/requesting data, and validates employee date ranges before submit.

**Tech Stack:** Python FastAPI, PostgreSQL helpers in `backend/database.py`, React 18, TypeScript, Vite, Vitest, Testing Library, pytest/unittest.

---

## File Structure

- Modify `backend/database.py`
  - Add `hr_request_events` table and migration columns.
  - Add event normalization, row mapping, append helper, and request event loading.
  - Append `created`, `approved`, `rejected`, and `needsInfo` events.
- Modify `backend/api.py`
  - Add HR event response model.
  - Include `events` in `HrRequestResponse`.
- Modify `tests/test_hr_database.py`
  - Verify creating and deciding HR requests appends audit events.
- Modify `tests/test_hr_requests_api.py`
  - Verify API responses include events.
- Modify `webapp/src/types.ts`
  - Add `HrRequestEventRaw` and `HrRequestEvent`.
  - Add `events` to `HrRequestRaw` and `HrRequest`.
- Modify `webapp/src/api/ApiClient.ts`
  - Map HR request events.
- Modify `webapp/src/pages/hr/HrRequestsTab.tsx`
  - Add comment field for decision actions.
  - Show timeline/events in request details.
- Modify `webapp/src/pages/HrPage.tsx`
  - Pass HR comment from tab to `decideHrRequest`.
- Modify `webapp/src/pages/HrPage.test.tsx`
  - Verify HR sends a comment and displays request history.
- Modify `webapp/src/pages/EmployeeRequestsPage.tsx`
  - Show an inline error when end date is earlier than start date.
- Modify `webapp/src/pages/EmployeeRequestsPage.test.tsx`
  - Verify invalid date ranges block submit.

---

### Task 1: Backend Audit Events

**Files:**
- Modify: `backend/database.py`
- Test: `tests/test_hr_database.py`

- [ ] **Step 1: Write failing database tests**

Add tests that assert `create_hr_request` appends a `created` event and `decide_hr_request` appends a decision event with comment.

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_hr_database.py
```

Expected: fail because `events` are not loaded and no event insert happens.

- [ ] **Step 3: Implement event persistence**

Add `hr_request_events` table, mapper, loader, and append calls in `create_hr_request` and `decide_hr_request`.

- [ ] **Step 4: Run database tests to verify green**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_hr_database.py
```

Expected: pass.

---

### Task 2: API And Type Mapping

**Files:**
- Modify: `backend/api.py`
- Modify: `tests/test_hr_requests_api.py`
- Modify: `webapp/src/types.ts`
- Modify: `webapp/src/api/ApiClient.ts`

- [ ] **Step 1: Write failing API and frontend mapping tests**

Extend existing HR request fixtures with `events` and assert the response/mapped object preserves event data.

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_hr_requests_api.py
npm run test -- src/pages/HrPage.test.tsx
```

Expected: fail until models/types understand `events`.

- [ ] **Step 3: Implement response and mapping**

Add `HrRequestEventResponse`, add `events` to `HrRequestResponse`, add TS event types, and map events in `ApiClient.mapHrRequest`.

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_hr_requests_api.py
npm run test -- src/pages/HrPage.test.tsx
```

Expected: pass.

---

### Task 3: HR UI Comments And Timeline

**Files:**
- Modify: `webapp/src/pages/hr/HrRequestsTab.tsx`
- Modify: `webapp/src/pages/HrPage.tsx`
- Modify: `webapp/src/pages/HrPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert HR can type a comment, click `Запросить данные`, and `decideHrRequest` receives `{ status: 'needsInfo', comment: '...' }`. Assert existing request events are visible in the detail panel.

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
npm run test -- src/pages/HrPage.test.tsx
```

Expected: fail because no comment control or timeline rendering exists.

- [ ] **Step 3: Implement HR comment and timeline UI**

Add a textarea/input in the detail card, pass the comment with actions, clear it after successful action, and render request events in chronological order.

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
npm run test -- src/pages/HrPage.test.tsx
```

Expected: pass.

---

### Task 4: Employee Date Validation

**Files:**
- Modify: `webapp/src/pages/EmployeeRequestsPage.tsx`
- Modify: `webapp/src/pages/EmployeeRequestsPage.test.tsx`

- [ ] **Step 1: Write failing validation test**

Assert choosing an end date earlier than the start date shows an error and does not call `createHrRequest`.

- [ ] **Step 2: Run tests to verify red**

Run:

```powershell
npm run test -- src/pages/EmployeeRequestsPage.test.tsx
```

Expected: fail because there is no explicit validation message.

- [ ] **Step 3: Implement date validation**

Compute `isDateRangeInvalid`, show a short inline message, and disable submit while invalid.

- [ ] **Step 4: Run tests to verify green**

Run:

```powershell
npm run test -- src/pages/EmployeeRequestsPage.test.tsx
```

Expected: pass.

---

### Task 5: Final Verification

Run:

```powershell
npm run test -- src/utils/roles.test.ts src/App.hr-routing.test.tsx src/pages/HrPage.test.tsx src/pages/EmployeeRequestsPage.test.tsx src/pages/hr/hrMockData.test.ts src/styles/hr-layout.test.ts
npm run build
.\.venv\Scripts\python.exe -m pytest tests\test_hr_database.py tests\test_hr_requests_api.py
```

Expected:
- All focused frontend tests pass.
- Production build passes.
- Backend HR tests pass.

---

## Self-Review

- Spec coverage: the plan covers audit trail, HR comment capture, timeline display, API mapping, and employee-side validation.
- Placeholder scan: no open placeholders or deferred implementation steps remain.
- Type consistency: `events` flows from database row to API response, TS raw type, mapped app type, and UI display.
