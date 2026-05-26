# HR NCALayer EDS Signing Design

Date: 2026-05-26

## Goal

Add EDS signing to the HR request workflow through local NCALayer:

- An employee must sign an HR request before submitting it.
- HR staff must sign before approving or rejecting a request.
- The backend must store the signature data with the request and reject unsigned final actions.

## Current Project Context

The web client is a Vite React app in `webapp`.

Relevant frontend files:

- `webapp/src/pages/EmployeeRequestsPage.tsx` creates employee HR requests.
- `webapp/src/pages/hr/HrRequestsTab.tsx` renders HR review controls.
- `webapp/src/pages/HrPage.tsx` calls the HR decision API.
- `webapp/src/api/ApiClient.ts` maps HR API payloads.
- `webapp/src/types.ts` defines HR request types.

The backend is FastAPI in `backend`.

Relevant backend files:

- `backend/api.py` exposes `/hr/requests` and `/hr/requests/{id}/decision`.
- `backend/database.py` creates and updates `hr_requests` and `hr_request_events`.

The SDK folder contains NCALayer examples in `SDK 2.0/Java/NCALayer`. The included sample uses a WebSocket connection to `wss://127.0.0.1:13579/`. The local SDK sample uses the older `kz.gov.pki.knca.commonUtils`; implementation should use a thin wrapper that can call the current `kz.gov.pki.knca.basics` API and fall back only if needed during testing.

## Chosen Approach

Sign canonical JSON payloads in the browser via NCALayer, then send the resulting CMS signature and signed payload to the backend.

This keeps the signed content stable and auditable:

- For employee submission, the signed payload contains the template id, rendered statement, values, period, summary, employee id/name, and action `submit`.
- For HR approval/rejection, the signed payload contains request id, target status, HR comment, HR user id/name, the request snapshot being decided, and action `approve` or `reject`.

PDF and Word downloads remain generated documents. They can later display signature metadata, but the legal/audit source of truth is the stored signed payload plus CMS signature.

## Frontend Design

Create a small NCALayer client module under `webapp/src/services` or an equivalent local pattern:

- Opens WebSocket to `wss://127.0.0.1:13579/`.
- Sends a sign request with storage `PKCS12`, key type `SIGNATURE`, format `cms`, and base64 encoded canonical JSON.
- Returns a normalized result with `signature`, `signedPayload`, optional certificate metadata, and timestamp.
- Converts connection failures into a clear UI error: NCALayer is not running or unavailable.

Employee flow:

- The request form keeps a local `employeeSignature` state.
- `Подписать ЭЦП` signs the current request preview payload.
- The submit button stays disabled until the signature exists.
- If the employee changes template, dates, reason, or generated preview text after signing, the existing signature is cleared and the employee must sign again.
- `createHrRequest` sends `employee_signature` together with the request data.

HR flow:

- The decision panel keeps local `decisionSignature` state for the currently selected request and comment/status.
- `Одобрить` and `Отклонить` are disabled until HR signs the matching decision payload.
- `Запросить данные` remains available without EDS because it is not a final approval/rejection.
- If HR changes selected request, status, or comment after signing, the signature is cleared.
- `decideHrRequest` sends `hr_signature` for `approved` and `rejected`.

## Backend Design

Extend request/decision schemas:

- `HrSignaturePayload`: `signature`, `signed_payload`, `signed_at`, optional `certificate_subject`, `certificate_serial`, `certificate_pem`.
- `HrRequestSubmit.employee_signature` is required.
- `HrDecisionRequest.hr_signature` is required only for `approved` and `rejected`.

Extend `hr_requests` storage with nullable columns:

- `employee_signature`
- `employee_signed_payload`
- `employee_signed_at`
- `employee_certificate_subject`
- `employee_certificate_serial`
- `employee_certificate_pem`
- `hr_signature`
- `hr_signed_payload`
- `hr_signed_at`
- `hr_certificate_subject`
- `hr_certificate_serial`
- `hr_certificate_pem`

The backend validates presence and basic shape:

- Reject employee request creation when `employee_signature` is missing.
- Reject approval/rejection when `hr_signature` is missing.
- Store signature data without logging the raw CMS to application logs.
- Include signature summary fields in `HrRequestResponse` so the UI can show whether employee/HR signatures exist.

Cryptographic verification can be added in a later hardening step with KalkanCrypt or an official server-side verifier. This first implementation enforces the workflow and stores enough evidence for audit and later verification.

## Data Flow

Employee submit:

1. Employee fills request fields.
2. Frontend builds canonical JSON from the exact request data.
3. Employee clicks `Подписать ЭЦП`.
4. NCALayer returns CMS signature.
5. Frontend enables submit.
6. Backend creates `hr_requests` row with employee signature fields.

HR approve/reject:

1. HR selects request and enters optional comment.
2. HR clicks a sign control for approve or reject.
3. Frontend builds canonical JSON from decision plus request snapshot.
4. NCALayer returns CMS signature.
5. Frontend enables the matching final decision button.
6. Backend updates status and stores HR signature fields.

## Error Handling

Frontend:

- Show a clear error if NCALayer is not running.
- Show NCALayer error messages when signing is cancelled or fails.
- Disable submit/decision during signing and API submission.
- Clear stale signatures when signed inputs change.

Backend:

- Return `400` for missing signature payloads.
- Return `422` for malformed signature objects.
- Keep existing `404` behavior for missing templates or requests.

## Testing

Frontend unit tests:

- Employee submit is disabled until signing succeeds.
- Changing signed request inputs clears the signature.
- HR approve/reject are disabled until matching decision signature exists.
- `needsInfo` remains available without signature.
- API client sends signature payloads.

Backend tests:

- Creating an HR request without `employee_signature` fails.
- Creating with `employee_signature` stores signature fields.
- Approving/rejecting without `hr_signature` fails.
- `needsInfo` works without `hr_signature`.
- HR signature fields appear in returned request data.

## Out Of Scope

- Server-side cryptographic CMS verification.
- Time-stamping through TSA beyond what NCALayer returns.
- Signing generated PDF/Word files directly.
- Changing the broader HR document layout.
