# HR NCALayer Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require NCALayer EDS signing before employee HR request submission and before HR approval/rejection.

**Architecture:** The browser signs canonical JSON through local NCALayer over `wss://127.0.0.1:13579/`. The React app stores the returned CMS signature in request/decision API payloads, and FastAPI validates presence and persists signature evidence in `hr_requests`.

**Tech Stack:** React 18, TypeScript, Vite/Vitest, FastAPI, Pydantic, PostgreSQL/SQLite-compatible database helper layer.

---

## File Structure

- Create `webapp/src/services/ncalayer.ts`: NCALayer WebSocket client, canonical JSON encoder, and signing helpers.
- Create `webapp/src/services/ncalayer.test.ts`: unit tests for canonical payload and mocked WebSocket signing.
- Modify `webapp/src/types.ts`: add reusable `HrSignature` types and signature fields on HR requests.
- Modify `webapp/src/api/ApiClient.ts`: send/receive signature fields.
- Modify `webapp/src/pages/EmployeeRequestsPage.tsx`: employee signing state, button, stale signature clearing, submit gating.
- Modify `webapp/src/pages/EmployeeRequestsPage.test.tsx`: employee signing UI and API payload tests.
- Modify `webapp/src/pages/hr/HrRequestsTab.tsx`: HR decision signing state and approval/rejection gating.
- Modify `webapp/src/pages/hr/HrRequestsTab.test.tsx`: decision signing UI tests.
- Modify `webapp/src/pages/HrPage.tsx`: pass signature payload through `handleDecision`.
- Modify `webapp/src/pages/HrPage.test.tsx`: update expected signed/unsigned decision calls.
- Modify `backend/api.py`: Pydantic models, validation, response fields, endpoint passthrough.
- Modify `backend/database.py`: columns, row mapping, create/update persistence.
- Modify `tests/test_hr_requests_api.py`: API validation and passthrough tests.
- Modify `tests/test_hr_database.py`: database storage and row mapping tests.

---

### Task 1: Shared Signature Types And API Payload Mapping

**Files:**
- Modify: `webapp/src/types.ts`
- Modify: `webapp/src/api/ApiClient.ts`

- [ ] **Step 1: Add frontend signature types**

Add these interfaces near the HR request types in `webapp/src/types.ts`:

```ts
export interface HrSignatureRaw {
  signature: string;
  signed_payload: string;
  signed_at: string;
  certificate_subject?: string | null;
  certificate_serial?: string | null;
  certificate_pem?: string | null;
}

export interface HrSignature {
  signature: string;
  signedPayload: string;
  signedAt: string;
  certificateSubject: string | null;
  certificateSerial: string | null;
  certificatePem: string | null;
}
```

Extend `HrRequestRaw`:

```ts
employee_signature?: HrSignatureRaw | null;
hr_signature?: HrSignatureRaw | null;
```

Extend `HrRequest`:

```ts
employeeSignature: HrSignature | null;
hrSignature: HrSignature | null;
```

- [ ] **Step 2: Run typecheck to verify current failures**

Run:

```powershell
cd webapp
npm run build
```

Expected: TypeScript fails until `ApiClient.mapHrRequest` is updated to provide the new required `employeeSignature` and `hrSignature` fields.

- [ ] **Step 3: Map raw signature fields**

In `webapp/src/api/ApiClient.ts`, add a private mapper near `mapHrRequest`:

```ts
  private mapHrSignature(raw?: HrSignatureRaw | null): HrSignature | null {
    if (!raw) return null;
    return {
      signature: raw.signature,
      signedPayload: raw.signed_payload,
      signedAt: raw.signed_at,
      certificateSubject: raw.certificate_subject ?? null,
      certificateSerial: raw.certificate_serial ?? null,
      certificatePem: raw.certificate_pem ?? null,
    };
  }
```

Update `mapHrRequest`:

```ts
      employeeSignature: this.mapHrSignature(raw.employee_signature),
      hrSignature: this.mapHrSignature(raw.hr_signature),
```

Update the imports from `../types` to include `HrSignature` and `HrSignatureRaw`.

- [ ] **Step 4: Extend API method payloads**

Change `createHrRequest` signature:

```ts
  async createHrRequest(data: {
    templateId: number;
    values: Record<string, unknown>;
    summary?: string;
    period?: string;
    employeeSignature: HrSignature;
  }): Promise<HrRequest> {
```

Add to the POST body:

```ts
        employee_signature: {
          signature: data.employeeSignature.signature,
          signed_payload: data.employeeSignature.signedPayload,
          signed_at: data.employeeSignature.signedAt,
          certificate_subject: data.employeeSignature.certificateSubject,
          certificate_serial: data.employeeSignature.certificateSerial,
          certificate_pem: data.employeeSignature.certificatePem,
        },
```

Change `decideHrRequest` payload:

```ts
    data: {
      status: Extract<HrRequestStatus, 'approved' | 'rejected' | 'needsInfo'>;
      comment?: string;
      hrSignature?: HrSignature | null;
    },
```

Add `hr_signature` only when present:

```ts
      body: JSON.stringify({
        status: data.status,
        comment: data.comment ?? '',
        ...(data.hrSignature ? {
          hr_signature: {
            signature: data.hrSignature.signature,
            signed_payload: data.hrSignature.signedPayload,
            signed_at: data.hrSignature.signedAt,
            certificate_subject: data.hrSignature.certificateSubject,
            certificate_serial: data.hrSignature.certificateSerial,
            certificate_pem: data.hrSignature.certificatePem,
          },
        } : {}),
      }),
```

- [ ] **Step 5: Verify**

Run:

```powershell
cd webapp
npm run build
```

Expected: build may still fail because existing tests/fixtures lack new `HrRequest` fields; production mapping should typecheck once fixtures are updated in later tasks.

- [ ] **Step 6: Commit**

```powershell
git add webapp/src/types.ts webapp/src/api/ApiClient.ts
git commit -m "feat: add HR signature API types"
```

---

### Task 2: Backend Signature Schema And Storage

**Files:**
- Modify: `backend/api.py`
- Modify: `backend/database.py`
- Test: `tests/test_hr_requests_api.py`
- Test: `tests/test_hr_database.py`

- [ ] **Step 1: Write failing API tests**

In `tests/test_hr_requests_api.py`, add this helper near `_employee_user`:

```py
def _signature_payload(action="submit"):
    return {
        "signature": "MIICMS",
        "signed_payload": f'{{"action":"{action}"}}',
        "signed_at": "2026-05-26T10:00:00+00:00",
        "certificate_subject": "CN=Employee User",
        "certificate_serial": "123456",
        "certificate_pem": "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    }
```

Update `test_employee_can_submit_request_from_template` POST JSON to include:

```py
"employee_signature": _signature_payload("submit"),
```

Add assertions:

```py
self.assertEqual(captured["employee_signature"]["signature"], "MIICMS")
self.assertEqual(captured["employee_signature"]["certificate_serial"], "123456")
```

Add a new test:

```py
def test_employee_cannot_submit_unsigned_request(self):
    api.app.dependency_overrides[api.get_current_user] = _employee_user

    response = self.client.post(
        "/api/hr/requests",
        json={
            "template_id": 7,
            "values": {"start_date": "2026-06-01"},
            "summary": "Annual leave",
            "period": "2026-06-01 - 2026-06-10",
        },
    )

    self.assertEqual(response.status_code, 422)
```

Update `test_hr_can_approve_request` POST JSON:

```py
json={"status": "approved", "comment": "Approved", "hr_signature": _signature_payload("approved")},
```

Update expected call:

```py
hr_signature=_signature_payload("approved"),
```

Add:

```py
def test_hr_cannot_approve_without_signature(self):
    response = self.client.post(
        "/api/hr/requests/31/decision",
        json={"status": "approved", "comment": "Approved"},
    )

    self.assertEqual(response.status_code, 400)
    self.assertIn("signature", response.json()["detail"].lower())

def test_hr_can_request_info_without_signature(self):
    decided = {
        "id": 31,
        "template_id": 7,
        "template_title": "Vacation request",
        "type": "vacation",
        "employee_id": 20,
        "employee_name": "Employee User",
        "department": "Operator",
        "status": "needsInfo",
        "values": {},
        "rendered_text": "Signed text",
        "summary": "Annual leave",
        "period": "2026-06-01 - 2026-06-10",
        "submitted_at": "2026-05-19T10:10:00+00:00",
        "updated_at": "2026-05-19T10:20:00+00:00",
        "decided_at": None,
        "decided_by": 10,
        "decided_by_name": "HR User",
        "decision_comment": "Attach certificate",
        "employee_signature": None,
        "hr_signature": None,
        "events": [],
    }
    with patch.object(api.database, "decide_hr_request", return_value=decided) as decide:
        response = self.client.post(
            "/api/hr/requests/31/decision",
            json={"status": "needsInfo", "comment": "Attach certificate"},
        )

    self.assertEqual(response.status_code, 200)
    decide.assert_called_once_with(
        31,
        status="needsInfo",
        decided_by=10,
        decided_by_name="HR User",
        comment="Attach certificate",
        hr_signature=None,
    )
```

- [ ] **Step 2: Run failing API tests**

Run:

```powershell
pytest tests/test_hr_requests_api.py -q
```

Expected: failures for unknown/missing model fields and missing `hr_signature` argument.

- [ ] **Step 3: Implement Pydantic schema and endpoint validation**

In `backend/api.py`, add:

```py
class HrSignaturePayload(BaseModel):
    signature: str = Field(min_length=1)
    signed_payload: str = Field(min_length=1)
    signed_at: str = Field(min_length=1)
    certificate_subject: str | None = None
    certificate_serial: str | None = None
    certificate_pem: str | None = None
```

Update `HrRequestSubmit`:

```py
    employee_signature: HrSignaturePayload
```

Update `HrDecisionRequest`:

```py
    hr_signature: HrSignaturePayload | None = None
```

Update `HrRequestResponse`:

```py
    employee_signature: HrSignaturePayload | None = None
    hr_signature: HrSignaturePayload | None = None
```

In `create_hr_request`, pass:

```py
            employee_signature=request.employee_signature.model_dump(),
```

In `decide_hr_request`, before calling database:

```py
        if request.status in {"approved", "rejected"} and request.hr_signature is None:
            raise HTTPException(status_code=400, detail="HR signature is required for approval or rejection")
```

Pass:

```py
            hr_signature=request.hr_signature.model_dump() if request.hr_signature else None,
```

- [ ] **Step 4: Add database storage fields**

In `backend/database.py`, extend the `CREATE TABLE IF NOT EXISTS hr_requests` statement with:

```sql
            employee_signature TEXT,
            employee_signed_payload TEXT,
            employee_signed_at TEXT,
            employee_certificate_subject TEXT,
            employee_certificate_serial TEXT,
            employee_certificate_pem TEXT,
            hr_signature TEXT,
            hr_signed_payload TEXT,
            hr_signed_at TEXT,
            hr_certificate_subject TEXT,
            hr_certificate_serial TEXT,
            hr_certificate_pem TEXT
```

Add `_ensure_column` calls for the same fields after existing `hr_requests` columns.

Add a helper near `_hr_request_from_row`:

```py
def _hr_signature_from_row(row: Mapping[str, Any], prefix: str) -> dict | None:
    signature = row.get(f"{prefix}_signature")
    signed_payload = row.get(f"{prefix}_signed_payload")
    signed_at = row.get(f"{prefix}_signed_at")
    if not signature or not signed_payload or not signed_at:
        return None
    return {
        "signature": str(signature),
        "signed_payload": str(signed_payload),
        "signed_at": str(signed_at),
        "certificate_subject": row.get(f"{prefix}_certificate_subject"),
        "certificate_serial": row.get(f"{prefix}_certificate_serial"),
        "certificate_pem": row.get(f"{prefix}_certificate_pem"),
    }
```

Update `_hr_request_from_row` return dict:

```py
        "employee_signature": _hr_signature_from_row(row, "employee"),
        "hr_signature": _hr_signature_from_row(row, "hr"),
```

- [ ] **Step 5: Persist signatures in create/update queries**

Change `create_hr_request` signature:

```py
    employee_signature: Mapping[str, Any],
```

Add inserted columns and params:

```sql
                employee_signature, employee_signed_payload, employee_signed_at,
                employee_certificate_subject, employee_certificate_serial, employee_certificate_pem
```

```py
                str(employee_signature.get("signature") or ""),
                str(employee_signature.get("signed_payload") or ""),
                str(employee_signature.get("signed_at") or ""),
                employee_signature.get("certificate_subject"),
                employee_signature.get("certificate_serial"),
                employee_signature.get("certificate_pem"),
```

Change `decide_hr_request` signature:

```py
    hr_signature: Mapping[str, Any] | None = None,
```

For approved/rejected, set HR signature fields in the `UPDATE`; for `needsInfo`, keep them unchanged. Use this branch:

```py
        if status in {"approved", "rejected"}:
            if not hr_signature:
                raise ValueError("HR signature is required")
            row = execute(
                """
                UPDATE hr_requests
                SET status = %s, decided_at = %s, decided_by = %s, decided_by_name = %s,
                    decision_comment = %s, updated_at = %s,
                    hr_signature = %s, hr_signed_payload = %s, hr_signed_at = %s,
                    hr_certificate_subject = %s, hr_certificate_serial = %s, hr_certificate_pem = %s
                WHERE id = %s
                RETURNING id
                """,
                (...),
            ).fetchone()
        else:
            row = execute(existing_needs_info_update, (...)).fetchone()
```

Keep the existing event append block after the branch.

- [ ] **Step 6: Update SELECT projections**

In `list_hr_requests` and `get_hr_request`, add all signature columns to the `SELECT r...` list:

```sql
r.employee_signature, r.employee_signed_payload, r.employee_signed_at,
r.employee_certificate_subject, r.employee_certificate_serial, r.employee_certificate_pem,
r.hr_signature, r.hr_signed_payload, r.hr_signed_at,
r.hr_certificate_subject, r.hr_certificate_serial, r.hr_certificate_pem
```

- [ ] **Step 7: Update database tests**

In fake rows in `tests/test_hr_database.py`, add signature keys with `None` where not testing signature mapping.

Add to `test_create_hr_request_appends_created_event` call:

```py
employee_signature={
    "signature": "MIICMS",
    "signed_payload": '{"action":"submit"}',
    "signed_at": "2026-05-26T10:00:00+00:00",
    "certificate_subject": "CN=Employee User",
    "certificate_serial": "123456",
    "certificate_pem": None,
},
```

Assert captured insert params contain `"MIICMS"` and `"123456"`.

Add to `test_decide_hr_request_appends_decision_event` call for approved/rejected branch in a new test:

```py
hr_signature={
    "signature": "HRMIICMS",
    "signed_payload": '{"action":"approved"}',
    "signed_at": "2026-05-26T10:05:00+00:00",
    "certificate_subject": "CN=HR User",
    "certificate_serial": "654321",
    "certificate_pem": None,
},
```

- [ ] **Step 8: Verify backend tests**

Run:

```powershell
pytest tests/test_hr_requests_api.py tests/test_hr_database.py -q
```

Expected: all selected backend tests pass.

- [ ] **Step 9: Commit**

```powershell
git add backend/api.py backend/database.py tests/test_hr_requests_api.py tests/test_hr_database.py
git commit -m "feat: persist HR EDS signatures"
```

---

### Task 3: NCALayer WebSocket Service

**Files:**
- Create: `webapp/src/services/ncalayer.ts`
- Create: `webapp/src/services/ncalayer.test.ts`

- [ ] **Step 1: Write service tests**

Create `webapp/src/services/ncalayer.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCanonicalPayload, encodePayloadForSigning, signWithNcalayer } from './ncalayer';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {}
}

describe('ncalayer service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockWebSocket.instances = [];
  });

  it('builds stable canonical JSON with sorted keys', () => {
    expect(buildCanonicalPayload({ b: 2, a: 1, nested: { d: 4, c: 3 } })).toBe('{"a":1,"b":2,"nested":{"c":3,"d":4}}');
  });

  it('encodes payload as base64 unicode safely', () => {
    expect(encodePayloadForSigning('{"text":"Қазақша"}')).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('sends a basics CMS sign request and returns a normalized signature', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    const promise = signWithNcalayer({ action: 'submit', requestId: 31 });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      module: 'kz.gov.pki.knca.basics',
      method: 'sign',
    });

    socket.onmessage?.({
      data: JSON.stringify({
        status: true,
        body: {
          result: ['MIICMS'],
          certificate: {
            subject: 'CN=Employee User',
            serialNumber: '123456',
            pem: 'CERT',
          },
        },
      }),
    });

    await expect(promise).resolves.toMatchObject({
      signature: 'MIICMS',
      certificateSubject: 'CN=Employee User',
      certificateSerial: '123456',
      certificatePem: 'CERT',
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
cd webapp
npm test -- src/services/ncalayer.test.ts
```

Expected: FAIL because `ncalayer.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `webapp/src/services/ncalayer.ts`:

```ts
import type { HrSignature } from '../types';

const NCALAYER_URL = 'wss://127.0.0.1:13579/';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function buildCanonicalPayload(value: unknown): string {
  const normalize = (input: unknown): JsonValue => {
    if (input === null || ['string', 'number', 'boolean'].includes(typeof input)) return input as JsonValue;
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      return Object.keys(input as Record<string, unknown>).sort().reduce<Record<string, JsonValue>>((acc, key) => {
        const next = (input as Record<string, unknown>)[key];
        if (typeof next !== 'undefined') acc[key] = normalize(next);
        return acc;
      }, {});
    }
    return String(input);
  };
  return JSON.stringify(normalize(value));
}

export function encodePayloadForSigning(payload: string): string {
  return btoa(unescape(encodeURIComponent(payload)));
}

function normalizeNcalayerResponse(raw: any, signedPayload: string): HrSignature {
  const body = raw?.body ?? raw?.responseObject ?? raw;
  const result = Array.isArray(body?.result) ? body.result[0] : body?.result ?? body;
  if (!result || typeof result !== 'string') {
    throw new Error(raw?.message || 'NCALayer не вернул подпись.');
  }
  return {
    signature: result,
    signedPayload,
    signedAt: new Date().toISOString(),
    certificateSubject: body?.certificate?.subject ?? body?.subjectCn ?? null,
    certificateSerial: body?.certificate?.serialNumber ?? body?.serialNumber ?? null,
    certificatePem: body?.certificate?.pem ?? body?.pem ?? null,
  };
}

export function signWithNcalayer(payload: unknown): Promise<HrSignature> {
  const signedPayload = buildCanonicalPayload(payload);
  const base64Payload = encodePayloadForSigning(signedPayload);

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(NCALAYER_URL);
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      reject(new Error(message));
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({
        module: 'kz.gov.pki.knca.basics',
        method: 'sign',
        args: {
          allowedStorages: ['PKCS12'],
          format: 'cms',
          data: base64Payload,
          signingParams: {
            decode: true,
            encapsulate: true,
            digested: false,
            tsaProfile: null,
          },
          signerParams: {
            extKeyUsageOids: [],
            chain: [],
          },
          locale: 'ru',
        },
      }));
    };

    socket.onerror = () => fail('NCALayer недоступен. Запустите NCALayer и повторите подпись.');
    socket.onclose = () => {
      if (!settled) fail('Соединение с NCALayer закрыто до завершения подписи.');
    };
    socket.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (raw?.status === false || raw?.code === '500') {
          fail(raw?.message || 'Подписание через NCALayer отменено или завершилось ошибкой.');
          return;
        }
        const signature = normalizeNcalayerResponse(raw, signedPayload);
        settled = true;
        socket.close();
        resolve(signature);
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Не удалось обработать ответ NCALayer.');
      }
    };
  });
}
```

- [ ] **Step 4: Verify service tests**

Run:

```powershell
cd webapp
npm test -- src/services/ncalayer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add webapp/src/services/ncalayer.ts webapp/src/services/ncalayer.test.ts
git commit -m "feat: add NCALayer signing client"
```

---

### Task 4: Employee Signing Flow

**Files:**
- Modify: `webapp/src/pages/EmployeeRequestsPage.tsx`
- Modify: `webapp/src/pages/EmployeeRequestsPage.test.tsx`

- [ ] **Step 1: Mock NCALayer in tests and add failing coverage**

At the top of `webapp/src/pages/EmployeeRequestsPage.test.tsx`:

```ts
import { signWithNcalayer } from '../services/ncalayer';

vi.mock('../services/ncalayer', () => ({
  signWithNcalayer: vi.fn(),
}));

const signature = {
  signature: 'MIICMS',
  signedPayload: '{"action":"submit"}',
  signedAt: '2026-05-26T10:00:00.000Z',
  certificateSubject: 'CN=Employee User',
  certificateSerial: '123456',
  certificatePem: null,
};
```

Before existing submit tests that click submit, add:

```ts
vi.mocked(signWithNcalayer).mockResolvedValue(signature);
```

Then click the new signing button before submit:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Подписать ЭЦП' }));
await screen.findByText('ЭЦП подписано');
```

Add a new test:

```ts
it('requires an EDS signature before submitting an employee request', async () => {
  const apiClient = {
    fetchHrTemplates: vi.fn().mockResolvedValue([template]),
    fetchHrRequests: vi.fn().mockResolvedValue([]),
    createHrRequest: vi.fn(),
  };

  const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

  await screen.findByText('Vacation request');
  const dateInputs = container.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: '2026-06-01' } });
  fireEvent.change(dateInputs[1], { target: { value: '2026-06-10' } });
  fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Annual leave' } });

  expect(screen.getByRole('button', { name: 'Отправить заявление' })).toBeDisabled();
  expect(apiClient.createHrRequest).not.toHaveBeenCalled();
});
```

Add another test:

```ts
it('clears employee EDS signature when request inputs change', async () => {
  vi.mocked(signWithNcalayer).mockResolvedValue(signature);
  const apiClient = {
    fetchHrTemplates: vi.fn().mockResolvedValue([template]),
    fetchHrRequests: vi.fn().mockResolvedValue([]),
    createHrRequest: vi.fn(),
  };

  const { container } = render(<EmployeeRequestsPage apiClient={apiClient as any} session={session} />);

  await screen.findByText('Vacation request');
  const dateInputs = container.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: '2026-06-01' } });
  fireEvent.change(dateInputs[1], { target: { value: '2026-06-10' } });
  fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Annual leave' } });
  fireEvent.click(screen.getByRole('button', { name: 'Подписать ЭЦП' }));

  await screen.findByText('ЭЦП подписано');
  fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'Changed reason' } });

  expect(screen.queryByText('ЭЦП подписано')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Отправить заявление' })).toBeDisabled();
});
```

- [ ] **Step 2: Run failing employee tests**

Run:

```powershell
cd webapp
npm test -- src/pages/EmployeeRequestsPage.test.tsx
```

Expected: FAIL because signing UI is not implemented.

- [ ] **Step 3: Implement employee signing state**

In `EmployeeRequestsPage.tsx`, import:

```ts
import type { HrSignature } from '../types';
import { signWithNcalayer } from '../services/ncalayer';
```

Add state:

```ts
  const [employeeSignature, setEmployeeSignature] = useState<HrSignature | null>(null);
  const [isSigning, setIsSigning] = useState(false);
```

Add an effect after `previewText` is computed:

```ts
  useEffect(() => {
    setEmployeeSignature(null);
  }, [selectedTemplate?.id, startDate, endDate, reason, previewText]);
```

Add:

```ts
  const handleSign = async () => {
    if (!selectedTemplate || !period || !reason.trim() || isDateRangeInvalid) return;
    setIsSigning(true);
    setError('');
    try {
      const signature = await signWithNcalayer({
        action: 'submit',
        templateId: selectedTemplate.id,
        employeeId: session.user.id,
        employeeName: session.user.name,
        values,
        period,
        summary: reason.trim(),
        statement: previewText,
      });
      setEmployeeSignature(signature);
    } catch (err) {
      setEmployeeSignature(null);
      setError(err instanceof Error ? err.message : 'Не удалось подписать заявление через NCALayer.');
    } finally {
      setIsSigning(false);
    }
  };
```

Update `handleSubmit` guard:

```ts
    if (!selectedTemplate || !period || !reason.trim() || isDateRangeInvalid || !employeeSignature) return;
```

Add to `createHrRequest`:

```ts
        employeeSignature,
```

Add signing UI near existing form actions:

```tsx
<button className="button secondary" type="button" disabled={isSigning || !selectedTemplate || !period || !reason.trim() || isDateRangeInvalid} onClick={handleSign}>
  {isSigning ? 'Подписание...' : 'Подписать ЭЦП'}
</button>
{employeeSignature && <span className="hr-badge">ЭЦП подписано</span>}
```

Disable submit when unsigned:

```tsx
disabled={isSubmitting || !employeeSignature || !selectedTemplate || !period || !reason.trim() || isDateRangeInvalid}
```

- [ ] **Step 4: Verify employee tests**

Run:

```powershell
cd webapp
npm test -- src/pages/EmployeeRequestsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add webapp/src/pages/EmployeeRequestsPage.tsx webapp/src/pages/EmployeeRequestsPage.test.tsx
git commit -m "feat: require EDS for employee HR submissions"
```

---

### Task 5: HR Decision Signing Flow

**Files:**
- Modify: `webapp/src/pages/hr/HrRequestsTab.tsx`
- Modify: `webapp/src/pages/hr/HrRequestsTab.test.tsx`
- Modify: `webapp/src/pages/HrPage.tsx`
- Modify: `webapp/src/pages/HrPage.test.tsx`

- [ ] **Step 1: Update component contract**

In `HrRequestsTab.tsx`, import:

```ts
import type { HrRequest, HrRequestStatus, HrSignature } from '../../types';
import { signWithNcalayer } from '../../services/ncalayer';
```

Change `onDecide` prop:

```ts
onDecide?: (
  requestId: number,
  status: Extract<HrRequestStatus, 'approved' | 'rejected' | 'needsInfo'>,
  comment: string,
  hrSignature?: HrSignature | null,
) => Promise<void> | void;
```

- [ ] **Step 2: Add failing HR tests**

In `webapp/src/pages/hr/HrRequestsTab.test.tsx`, add `fireEvent`, `waitFor`, `vi`, and mock `signWithNcalayer`:

```ts
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { signWithNcalayer } from '../../services/ncalayer';

vi.mock('../../services/ncalayer', () => ({
  signWithNcalayer: vi.fn(),
}));

const hrSignature = {
  signature: 'HRMIICMS',
  signedPayload: '{"action":"approved"}',
  signedAt: '2026-05-26T10:05:00.000Z',
  certificateSubject: 'CN=HR User',
  certificateSerial: '654321',
  certificatePem: null,
};
```

Add:

```ts
it('disables approve and reject until HR signs a final decision', () => {
  render(<HrRequestsTab requests={[request]} onDecide={vi.fn()} />);

  expect(screen.getByTestId('hr-approve-request')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Отклонить' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Запросить данные' })).not.toBeDisabled();
});

it('passes HR signature when approving a request', async () => {
  vi.mocked(signWithNcalayer).mockResolvedValue(hrSignature);
  const onDecide = vi.fn().mockResolvedValue(undefined);
  render(<HrRequestsTab requests={[request]} onDecide={onDecide} />);

  fireEvent.click(screen.getByRole('button', { name: 'Подписать одобрение ЭЦП' }));
  await screen.findByText('Решение подписано ЭЦП');
  fireEvent.click(screen.getByTestId('hr-approve-request'));

  await waitFor(() => {
    expect(onDecide).toHaveBeenCalledWith(1, 'approved', '', hrSignature);
  });
});
```

- [ ] **Step 3: Run failing HR tab tests**

Run:

```powershell
cd webapp
npm test -- src/pages/hr/HrRequestsTab.test.tsx
```

Expected: FAIL because HR signing UI is missing.

- [ ] **Step 4: Implement HR signing state**

Add state:

```ts
  const [decisionSignature, setDecisionSignature] = useState<{ status: 'approved' | 'rejected'; signature: HrSignature } | null>(null);
  const [isSigningDecision, setIsSigningDecision] = useState<'approved' | 'rejected' | null>(null);
```

Clear stale signatures:

```ts
  useEffect(() => {
    setDecisionSignature(null);
  }, [selectedRequest?.id, decisionComment]);
```

Add:

```ts
  const handleSignDecision = async (status: 'approved' | 'rejected') => {
    if (!selectedRequest || isSigningDecision) return;
    setIsSigningDecision(status);
    try {
      const signature = await signWithNcalayer({
        action: status,
        requestId: selectedRequest.id,
        employeeId: selectedRequest.employeeId,
        employeeName: selectedRequest.employeeName,
        requestStatus: selectedRequest.status,
        statement: requestStatement(selectedRequest),
        comment: decisionComment.trim(),
      });
      setDecisionSignature({ status, signature });
    } finally {
      setIsSigningDecision(null);
    }
  };
```

Update `handleDecision`:

```ts
    const finalDecision = status === 'approved' || status === 'rejected';
    const matchingSignature = finalDecision && decisionSignature?.status === status ? decisionSignature.signature : null;
    if (finalDecision && !matchingSignature) return;
    await onDecide(selectedRequest.id, status, decisionComment.trim(), matchingSignature);
```

Add buttons before final actions:

```tsx
<button className="button secondary" type="button" disabled={isDeciding || Boolean(isSigningDecision)} onClick={() => handleSignDecision('approved')}>
  {isSigningDecision === 'approved' ? 'Подписание...' : 'Подписать одобрение ЭЦП'}
</button>
<button className="button secondary" type="button" disabled={isDeciding || Boolean(isSigningDecision)} onClick={() => handleSignDecision('rejected')}>
  {isSigningDecision === 'rejected' ? 'Подписание...' : 'Подписать отклонение ЭЦП'}
</button>
{decisionSignature && <span className="hr-badge">Решение подписано ЭЦП</span>}
```

Disable final buttons:

```tsx
disabled={isDeciding || decisionSignature?.status !== 'approved'}
disabled={isDeciding || decisionSignature?.status !== 'rejected'}
```

- [ ] **Step 5: Update HrPage passthrough**

In `HrPage.tsx`, import `HrSignature` and change `handleDecision`:

```ts
  const handleDecision = async (
    requestId: number,
    status: 'approved' | 'rejected' | 'needsInfo',
    comment = '',
    hrSignature?: HrSignature | null,
  ) => {
    if (!apiClient) return;
    const updated = await apiClient.decideHrRequest(requestId, { status, comment, hrSignature });
    setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
  };
```

Update `HrPage.test.tsx` expectations for approve/reject tests to sign first or assert disabled behavior. For `needsInfo`, expected call becomes:

```ts
expect(apiClient.decideHrRequest).toHaveBeenCalledWith(31, { status: 'needsInfo', comment: 'Attach certificate', hrSignature: undefined });
```

- [ ] **Step 6: Verify HR tests**

Run:

```powershell
cd webapp
npm test -- src/pages/hr/HrRequestsTab.test.tsx src/pages/HrPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add webapp/src/pages/hr/HrRequestsTab.tsx webapp/src/pages/hr/HrRequestsTab.test.tsx webapp/src/pages/HrPage.tsx webapp/src/pages/HrPage.test.tsx
git commit -m "feat: require EDS for HR final decisions"
```

---

### Task 6: End-To-End Verification And Polish

**Files:**
- Modify as needed: `webapp/src/styles/hr.css`
- Modify as needed: tests touched by earlier tasks

- [ ] **Step 1: Run backend verification**

Run:

```powershell
pytest tests/test_hr_requests_api.py tests/test_hr_database.py -q
```

Expected: all selected backend tests pass.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
cd webapp
npm test -- src/services/ncalayer.test.ts src/pages/EmployeeRequestsPage.test.tsx src/pages/hr/HrRequestsTab.test.tsx src/pages/HrPage.test.tsx
```

Expected: all selected frontend tests pass.

- [ ] **Step 3: Run full frontend build**

Run:

```powershell
cd webapp
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Check working tree**

Run:

```powershell
git status --short
```

Expected: only intentional source/test changes remain, plus any pre-existing unrelated workspace changes.

- [ ] **Step 5: Commit final polish if needed**

If CSS or test fixture cleanup was needed:

```powershell
git add webapp/src/styles/hr.css webapp/src/**/*.test.tsx webapp/src/**/*.test.ts
git commit -m "test: verify HR EDS signing workflow"
```

---

## Self-Review

- Spec coverage: employee signing, HR final decision signing, backend storage, API validation, UI stale-signature clearing, and testing are covered.
- Scope check: server-side cryptographic CMS verification and PDF/Word signing remain out of scope, matching the approved spec.
- Type consistency: frontend uses `HrSignature` and API JSON uses `employee_signature` / `hr_signature`; backend uses the same snake_case field names.
- Placeholder scan: this plan contains concrete files, commands, and code snippets for each implementation task.
