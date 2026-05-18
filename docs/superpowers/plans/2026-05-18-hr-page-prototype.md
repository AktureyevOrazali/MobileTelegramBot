# HR Page Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a frontend-only HR workspace prototype with role-aware navigation, mock HR data, and minimalist aligned UI tabs for requests, employees, calendar, templates, and archive.

**Architecture:** Add a focused `/hr` route backed by typed mock data and small tab components under `webapp/src/pages/hr/`. Centralize role labels and route permissions in one utility so the future backend phase can reuse the same role semantics. Keep the first phase frontend-only while shaping data objects close to future API records.

**Tech Stack:** React 18, React Router, TypeScript, Vite, Vitest, Testing Library, CSS modules by convention through existing global stylesheets.

---

## File Structure

- Create: `webapp/src/utils/roles.ts`
  - Owns role labels, role predicates, navigation visibility helpers, and default route decisions.
- Create: `webapp/src/utils/roles.test.ts`
  - Verifies `hr` is not treated as admin/operator and receives `/hr` as the default route.
- Modify: `webapp/src/utils/converters.ts`
  - Uses `roles.ts` to compute `isAdmin` and `canReply`.
- Modify: `webapp/src/context/ApiContext.tsx`
  - Uses `roles.ts` while restoring sessions from storage.
- Modify: `webapp/src/utils/admin-helpers.ts`
  - Adds the `hr` label for admin role selectors.
- Create: `webapp/src/pages/hr/hrTypes.ts`
  - Defines mock-facing HR domain types.
- Create: `webapp/src/pages/hr/hrMockData.ts`
  - Provides stable, realistic mock data for the prototype.
- Create: `webapp/src/pages/hr/hrMockData.test.ts`
  - Verifies fixture integrity and status/type coverage.
- Create: `webapp/src/pages/HrPage.tsx`
  - Top-level HR route with header, stat cards, tabs, and local tab state.
- Create: `webapp/src/pages/hr/HrRequestsTab.tsx`
  - Request queue and selected request detail panel.
- Create: `webapp/src/pages/hr/HrEmployeesTab.tsx`
  - Employee cards and local editable detail drawer/modal.
- Create: `webapp/src/pages/hr/HrCalendarTab.tsx`
  - Week schedule and HR events view.
- Create: `webapp/src/pages/hr/HrTemplatesTab.tsx`
  - Template list and preview/editor panel.
- Create: `webapp/src/pages/hr/HrArchiveTab.tsx`
  - Processed request archive table.
- Create: `webapp/src/pages/HrPage.test.tsx`
  - Verifies header stats, tabs, and basic interactions.
- Modify: `webapp/src/App.tsx`
  - Adds lazy `HrPage`, HR navigation item, role-aware route guards, HR shell class, and default route logic.
- Modify: `webapp/src/main.tsx`
  - Imports `./styles/hr.css`.
- Create: `webapp/src/styles/hr.css`
  - Styles the HR workspace with compact cards, equal-height rows, soft corners, responsive tab layouts, and dark theme compatibility.
- Create: `webapp/src/styles/hr-layout.test.ts`
  - Guards the CSS rules that prevent row-height drift and oversized hero styling.

---

### Task 1: Centralize Role Logic

**Files:**
- Create: `webapp/src/utils/roles.ts`
- Create: `webapp/src/utils/roles.test.ts`
- Modify: `webapp/src/utils/converters.ts`
- Modify: `webapp/src/context/ApiContext.tsx`
- Modify: `webapp/src/utils/admin-helpers.ts`

- [ ] **Step 1: Write the failing role utility tests**

Create `webapp/src/utils/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getDefaultRouteForRole,
  getRoleLabel,
  isAdminLikeRole,
  isHrRole,
  roleCanReply,
} from './roles';

describe('role helpers', () => {
  it('labels the HR role in Russian', () => {
    expect(getRoleLabel('hr')).toBe('Кадровик');
  });

  it('keeps HR outside admin-like and reply-capable roles', () => {
    expect(isHrRole('hr')).toBe(true);
    expect(isAdminLikeRole('hr')).toBe(false);
    expect(roleCanReply('hr')).toBe(false);
  });

  it('routes HR users to the HR workspace by default', () => {
    expect(getDefaultRouteForRole('hr')).toBe('/hr');
    expect(getDefaultRouteForRole('admin')).toBe('/dialogs');
    expect(getDefaultRouteForRole('operator')).toBe('/dialogs');
  });
});
```

- [ ] **Step 2: Run the role test to verify it fails**

Run:

```bash
cd webapp
npm run test -- src/utils/roles.test.ts
```

Expected: FAIL because `webapp/src/utils/roles.ts` does not exist.

- [ ] **Step 3: Add the role utility**

Create `webapp/src/utils/roles.ts`:

```ts
export type AppRole = 'admin' | 'moderator' | 'operator' | 'hr' | string;

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  operator: 'Оператор',
  hr: 'Кадровик',
};

export function normalizeRole(role: unknown): string {
  return typeof role === 'string' && role.trim() ? role.trim() : 'operator';
}

export function getRoleLabel(role: unknown): string {
  const normalized = normalizeRole(role);
  return ROLE_LABELS[normalized] ?? normalized;
}

export function isAdminLikeRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'moderator';
}

export function isHrRole(role: unknown): boolean {
  return normalizeRole(role) === 'hr';
}

export function roleCanReply(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'moderator' || normalized === 'operator';
}

export function canAccessHr(role: unknown): boolean {
  return isAdminLikeRole(role) || isHrRole(role);
}

export function getDefaultRouteForRole(role: unknown): string {
  return isHrRole(role) ? '/hr' : '/dialogs';
}
```

- [ ] **Step 4: Reuse role helpers in converters**

In `webapp/src/utils/converters.ts`, add:

```ts
import { isAdminLikeRole, normalizeRole, roleCanReply } from './roles';
```

Replace the first lines inside `mapUserProfile`:

```ts
const role = raw.role || 'operator';
const isAdmin = role === 'admin' || role === 'moderator';
const canReply = role === 'admin' || role === 'moderator' || role === 'operator';
```

with:

```ts
const role = normalizeRole(raw.role);
const isAdmin = isAdminLikeRole(role);
const canReply = roleCanReply(role);
```

- [ ] **Step 5: Reuse role helpers in session restore**

In `webapp/src/context/ApiContext.tsx`, add:

```ts
import { isAdminLikeRole, normalizeRole, roleCanReply } from '../utils/roles';
```

Replace:

```ts
const role: string = parsed.user.role ?? 'operator';
```

with:

```ts
const role = normalizeRole(parsed.user.role);
```

Replace:

```ts
isAdmin: role === 'admin' || role === 'moderator',
canReply: role === 'admin' || role === 'moderator' || role === 'operator',
```

with:

```ts
isAdmin: isAdminLikeRole(role),
canReply: roleCanReply(role),
```

- [ ] **Step 6: Add HR label to admin helpers**

In `webapp/src/utils/admin-helpers.ts`, update `roleLabels`:

```ts
export const roleLabels: Record<string, string> = {
    admin: 'Администратор',
    moderator: 'Модератор',
    operator: 'Оператор',
    hr: 'Кадровик',
};
```

- [ ] **Step 7: Run role tests**

Run:

```bash
cd webapp
npm run test -- src/utils/roles.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit role utility changes**

Run:

```bash
git add webapp/src/utils/roles.ts webapp/src/utils/roles.test.ts webapp/src/utils/converters.ts webapp/src/context/ApiContext.tsx webapp/src/utils/admin-helpers.ts
git commit -m "feat: add HR role helpers"
```

---

### Task 2: Add HR Mock Data Model

**Files:**
- Create: `webapp/src/pages/hr/hrTypes.ts`
- Create: `webapp/src/pages/hr/hrMockData.ts`
- Create: `webapp/src/pages/hr/hrMockData.test.ts`

- [ ] **Step 1: Write fixture integrity tests**

Create `webapp/src/pages/hr/hrMockData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  hrArchiveItems,
  hrCalendarEvents,
  hrEmployees,
  hrRequests,
  hrTemplates,
} from './hrMockData';

describe('HR mock data', () => {
  it('contains enough data to render every HR tab', () => {
    expect(hrRequests.length).toBeGreaterThanOrEqual(6);
    expect(hrEmployees.length).toBeGreaterThanOrEqual(6);
    expect(hrCalendarEvents.length).toBeGreaterThanOrEqual(8);
    expect(hrTemplates.length).toBeGreaterThanOrEqual(5);
    expect(hrArchiveItems.length).toBeGreaterThanOrEqual(5);
  });

  it('uses stable unique IDs in every collection', () => {
    const collections = [hrRequests, hrEmployees, hrCalendarEvents, hrTemplates, hrArchiveItems];
    for (const collection of collections) {
      const ids = collection.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('covers the primary request types and statuses', () => {
    expect(new Set(hrRequests.map((request) => request.type))).toEqual(
      new Set(['vacation', 'advance', 'sickLeave', 'businessTrip', 'certificate', 'serviceLetter']),
    );
    expect(new Set(hrRequests.map((request) => request.status))).toContain('new');
    expect(new Set(hrRequests.map((request) => request.status))).toContain('needsInfo');
  });
});
```

- [ ] **Step 2: Run the mock data test to verify it fails**

Run:

```bash
cd webapp
npm run test -- src/pages/hr/hrMockData.test.ts
```

Expected: FAIL because `hrMockData.ts` does not exist.

- [ ] **Step 3: Define HR domain types**

Create `webapp/src/pages/hr/hrTypes.ts`:

```ts
export type HrRequestType =
  | 'vacation'
  | 'advance'
  | 'sickLeave'
  | 'businessTrip'
  | 'certificate'
  | 'serviceLetter';

export type HrRequestStatus =
  | 'new'
  | 'review'
  | 'needsInfo'
  | 'approved'
  | 'rejected'
  | 'archived';

export type HrCalendarEventType =
  | 'vacation'
  | 'sickLeave'
  | 'shift'
  | 'birthday'
  | 'probation'
  | 'businessTrip';

export interface HrEmployee {
  id: string;
  fullName: string;
  position: string;
  department: string;
  location: string;
  phone: string;
  email: string;
  photoUrl: string;
  hireDate: string;
  schedule: string;
  statuses: string[];
  documentCompleteness: number;
}

export interface HrRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePhotoUrl: string;
  department: string;
  type: HrRequestType;
  status: HrRequestStatus;
  period: string;
  submittedAt: string;
  updatedAt: string;
  summary: string;
  approvalChain: string[];
}

export interface HrCalendarEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  type: HrCalendarEventType;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface HrTemplate {
  id: string;
  title: string;
  type: HrRequestType;
  updatedAt: string;
  variables: string[];
  preview: string;
}

export interface HrArchiveItem {
  id: string;
  employeeName: string;
  type: HrRequestType;
  finalStatus: Extract<HrRequestStatus, 'approved' | 'rejected' | 'archived'>;
  decisionDate: string;
  responsible: string;
}
```

- [ ] **Step 4: Add realistic mock data**

Create `webapp/src/pages/hr/hrMockData.ts` using these exports and values:

```ts
import {
  HrArchiveItem,
  HrCalendarEvent,
  HrEmployee,
  HrRequest,
  HrRequestStatus,
  HrRequestType,
  HrTemplate,
} from './hrTypes';

export const requestTypeLabels: Record<HrRequestType, string> = {
  vacation: 'Отпуск',
  advance: 'Аванс',
  sickLeave: 'Больничный',
  businessTrip: 'Командировка',
  certificate: 'Справка',
  serviceLetter: 'Служебное письмо',
};

export const requestStatusLabels: Record<HrRequestStatus, string> = {
  new: 'Новое',
  review: 'На рассмотрении',
  needsInfo: 'Нужны данные',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  archived: 'В архиве',
};

export const hrEmployees: HrEmployee[] = [
  {
    id: 'emp-arman',
    fullName: 'Арман Темирланов',
    position: 'Менеджер',
    department: 'Администрация',
    location: 'Основной офис',
    phone: '+7 555 412 4405',
    email: 'arman@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=12',
    hireDate: '2019-09-20',
    schedule: '09:00-18:00',
    statuses: ['На смене'],
    documentCompleteness: 92,
  },
  {
    id: 'emp-anel',
    fullName: 'Анель Кали',
    position: 'Менеджер',
    department: 'Продажи',
    location: 'Филиал A',
    phone: '+7 701 222 1100',
    email: 'anel@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=47',
    hireDate: '2021-02-11',
    schedule: '10:00-19:00',
    statuses: ['Документы неполные'],
    documentCompleteness: 68,
  },
  {
    id: 'emp-bota',
    fullName: 'Бота Айтжанова',
    position: 'Координатор',
    department: 'Операции',
    location: 'Основной офис',
    phone: '+7 707 515 6012',
    email: 'bota@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=32',
    hireDate: '2020-06-03',
    schedule: '07:30-16:30',
    statuses: ['Испытательный срок'],
    documentCompleteness: 80,
  },
  {
    id: 'emp-denis',
    fullName: 'Денис Григорьев',
    position: 'Директор',
    department: 'Управление',
    location: 'Основной офис',
    phone: '+7 777 820 1133',
    email: 'denis@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=59',
    hireDate: '2018-03-14',
    schedule: '10:00-20:00',
    statuses: ['На смене'],
    documentCompleteness: 100,
  },
  {
    id: 'emp-manas',
    fullName: 'Манас Кенжебай',
    position: 'Инженер',
    department: 'Технический отдел',
    location: 'Склад',
    phone: '+7 700 332 9090',
    email: 'manas@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=68',
    hireDate: '2022-08-08',
    schedule: '08:00-20:00',
    statuses: ['Больничный'],
    documentCompleteness: 74,
  },
  {
    id: 'emp-kamilla',
    fullName: 'Камилла Есжан',
    position: 'Администратор',
    department: 'Администрация',
    location: 'Филиал B',
    phone: '+7 705 910 3344',
    email: 'kamilla@company.kz',
    photoUrl: 'https://i.pravatar.cc/160?img=5',
    hireDate: '2023-01-16',
    schedule: '09:00-18:00',
    statuses: ['В отпуске'],
    documentCompleteness: 88,
  },
];

export const hrRequests: HrRequest[] = [
  {
    id: 'req-001',
    employeeId: 'emp-arman',
    employeeName: 'Арман Темирланов',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=12',
    department: 'Администрация',
    type: 'vacation',
    status: 'new',
    period: '24.05-31.05',
    submittedAt: '18.05.2026 09:10',
    updatedAt: '18.05.2026 09:20',
    summary: 'Ежегодный оплачиваемый отпуск на 6 рабочих дней.',
    approvalChain: ['Кадровик', 'Руководитель'],
  },
  {
    id: 'req-002',
    employeeId: 'emp-anel',
    employeeName: 'Анель Кали',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=47',
    department: 'Продажи',
    type: 'advance',
    status: 'review',
    period: 'Май 2026',
    submittedAt: '17.05.2026 16:42',
    updatedAt: '18.05.2026 08:35',
    summary: 'Аванс в размере 80 000 KZT.',
    approvalChain: ['Кадровик', 'Бухгалтерия'],
  },
  {
    id: 'req-003',
    employeeId: 'emp-bota',
    employeeName: 'Бота Айтжанова',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=32',
    department: 'Операции',
    type: 'sickLeave',
    status: 'needsInfo',
    period: '16.05-20.05',
    submittedAt: '16.05.2026 11:14',
    updatedAt: '17.05.2026 12:05',
    summary: 'Не приложен номер больничного листа.',
    approvalChain: ['Кадровик'],
  },
  {
    id: 'req-004',
    employeeId: 'emp-denis',
    employeeName: 'Денис Григорьев',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=59',
    department: 'Управление',
    type: 'businessTrip',
    status: 'approved',
    period: '27.05-29.05',
    submittedAt: '15.05.2026 14:01',
    updatedAt: '16.05.2026 10:10',
    summary: 'Командировка в Алматы для встречи с партнёрами.',
    approvalChain: ['Кадровик', 'Директор'],
  },
  {
    id: 'req-005',
    employeeId: 'emp-manas',
    employeeName: 'Манас Кенжебай',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=68',
    department: 'Технический отдел',
    type: 'certificate',
    status: 'new',
    period: '18.05.2026',
    submittedAt: '18.05.2026 10:02',
    updatedAt: '18.05.2026 10:02',
    summary: 'Справка с места работы для банка.',
    approvalChain: ['Кадровик'],
  },
  {
    id: 'req-006',
    employeeId: 'emp-kamilla',
    employeeName: 'Камилла Есжан',
    employeePhotoUrl: 'https://i.pravatar.cc/160?img=5',
    department: 'Администрация',
    type: 'serviceLetter',
    status: 'review',
    period: '18.05.2026',
    submittedAt: '18.05.2026 08:44',
    updatedAt: '18.05.2026 09:01',
    summary: 'Служебная записка на изменение графика.',
    approvalChain: ['Кадровик', 'Руководитель'],
  },
];

export const hrCalendarEvents: HrCalendarEvent[] = [
  { id: 'evt-001', employeeId: 'emp-arman', employeeName: 'Арман Т.', type: 'shift', label: '09:00-18:00', date: '2026-05-18', startTime: '09:00', endTime: '18:00' },
  { id: 'evt-002', employeeId: 'emp-anel', employeeName: 'Анель К.', type: 'shift', label: '10:00-19:00', date: '2026-05-18', startTime: '10:00', endTime: '19:00' },
  { id: 'evt-003', employeeId: 'emp-bota', employeeName: 'Бота А.', type: 'shift', label: '07:30-16:30', date: '2026-05-19', startTime: '07:30', endTime: '16:30' },
  { id: 'evt-004', employeeId: 'emp-denis', employeeName: 'Денис Г.', type: 'businessTrip', label: 'Командировка', date: '2026-05-20', startTime: '09:00', endTime: '18:00' },
  { id: 'evt-005', employeeId: 'emp-manas', employeeName: 'Манас К.', type: 'sickLeave', label: 'Больничный', date: '2026-05-21', startTime: '00:00', endTime: '23:59' },
  { id: 'evt-006', employeeId: 'emp-kamilla', employeeName: 'Камилла Е.', type: 'vacation', label: 'Отпуск', date: '2026-05-22', startTime: '00:00', endTime: '23:59' },
  { id: 'evt-007', employeeId: 'emp-anel', employeeName: 'Анель К.', type: 'birthday', label: 'День рождения', date: '2026-05-23', startTime: '10:00', endTime: '10:30' },
  { id: 'evt-008', employeeId: 'emp-bota', employeeName: 'Бота А.', type: 'probation', label: 'Конец срока', date: '2026-05-24', startTime: '09:00', endTime: '09:30' },
];

export const hrTemplates: HrTemplate[] = [
  { id: 'tpl-001', title: 'Заявление на отпуск', type: 'vacation', updatedAt: '16.05.2026', variables: ['employee_name', 'date_from', 'date_to'], preview: 'Прошу предоставить отпуск сотруднику {employee_name} с {date_from} по {date_to}.' },
  { id: 'tpl-002', title: 'Заявление на аванс', type: 'advance', updatedAt: '15.05.2026', variables: ['employee_name', 'amount'], preview: 'Прошу выдать аванс сотруднику {employee_name} в размере {amount}.' },
  { id: 'tpl-003', title: 'Командировка', type: 'businessTrip', updatedAt: '12.05.2026', variables: ['employee_name', 'date_from', 'date_to', 'reason'], preview: 'Направить {employee_name} в командировку с {date_from} по {date_to}. Основание: {reason}.' },
  { id: 'tpl-004', title: 'Справка с места работы', type: 'certificate', updatedAt: '10.05.2026', variables: ['employee_name', 'position', 'department'], preview: '{employee_name} работает в должности {position}, отдел {department}.' },
  { id: 'tpl-005', title: 'Служебная записка', type: 'serviceLetter', updatedAt: '09.05.2026', variables: ['employee_name', 'reason'], preview: 'Служебная записка от {employee_name}. Причина: {reason}.' },
];

export const hrArchiveItems: HrArchiveItem[] = [
  { id: 'arc-001', employeeName: 'Арман Темирланов', type: 'vacation', finalStatus: 'approved', decisionDate: '10.05.2026', responsible: 'HR Отдел' },
  { id: 'arc-002', employeeName: 'Анель Кали', type: 'advance', finalStatus: 'approved', decisionDate: '08.05.2026', responsible: 'HR Отдел' },
  { id: 'arc-003', employeeName: 'Бота Айтжанова', type: 'serviceLetter', finalStatus: 'rejected', decisionDate: '07.05.2026', responsible: 'HR Отдел' },
  { id: 'arc-004', employeeName: 'Денис Григорьев', type: 'businessTrip', finalStatus: 'archived', decisionDate: '03.05.2026', responsible: 'HR Отдел' },
  { id: 'arc-005', employeeName: 'Манас Кенжебай', type: 'certificate', finalStatus: 'approved', decisionDate: '01.05.2026', responsible: 'HR Отдел' },
];
```

- [ ] **Step 5: Run mock data tests**

Run:

```bash
cd webapp
npm run test -- src/pages/hr/hrMockData.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit mock data model**

Run:

```bash
git add webapp/src/pages/hr/hrTypes.ts webapp/src/pages/hr/hrMockData.ts webapp/src/pages/hr/hrMockData.test.ts
git commit -m "feat: add HR mock data model"
```

---

### Task 3: Add HR Route And Navigation

**Files:**
- Modify: `webapp/src/App.tsx`
- Create: `webapp/src/pages/HrPage.tsx`
- Create: `webapp/src/pages/HrPage.test.tsx`

- [ ] **Step 1: Write route behavior tests**

Create `webapp/src/pages/HrPage.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HrPage from './HrPage';

describe('HrPage', () => {
  it('renders compact header stats and HR tabs', () => {
    render(<HrPage />);

    expect(screen.getByRole('heading', { name: 'Кадры' })).toBeInTheDocument();
    expect(screen.getByText('Новые заявления')).toBeInTheDocument();
    expect(screen.getByText('Отпуска на неделе')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Заявления' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Календарь' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Шаблоны' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Архив' })).toBeInTheDocument();
  });

  it('switches tabs without leaving the HR page shell', () => {
    render(<HrPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

    expect(screen.getByRole('tab', { name: 'Сотрудники' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hr-page-shell')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run:

```bash
cd webapp
npm run test -- src/pages/HrPage.test.tsx
```

Expected: FAIL because `HrPage.tsx` does not exist.

- [ ] **Step 3: Create the first HR page shell**

Create `webapp/src/pages/HrPage.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { hrEmployees, hrRequests } from './hr/hrMockData';

type HrTab = 'requests' | 'employees' | 'calendar' | 'templates' | 'archive';

const tabs: { id: HrTab; label: string }[] = [
  { id: 'requests', label: 'Заявления' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'templates', label: 'Шаблоны' },
  { id: 'archive', label: 'Архив' },
];

const HrPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HrTab>('requests');

  const stats = useMemo(
    () => [
      { label: 'Новые заявления', value: hrRequests.filter((request) => request.status === 'new').length },
      { label: 'Отпуска на неделе', value: 2 },
      { label: 'Карточки требуют данных', value: hrEmployees.filter((employee) => employee.documentCompleteness < 90).length },
      { label: 'Документы на подпись', value: 7 },
    ],
    [],
  );

  return (
    <div className="hr-page" data-testid="hr-page-shell">
      <header className="hr-header">
        <div className="hr-header__top">
          <h2 className="hr-header__title">Кадры</h2>
          <div className="hr-header__actions" aria-label="Действия кадровика">
            <button className="button secondary" type="button">Добавить сотрудника</button>
            <button className="button" type="button">Создать шаблон</button>
          </div>
        </div>
        <div className="hr-stat-grid">
          {stats.map((stat) => (
            <div className="hr-stat-card" key={stat.label}>
              <span className="hr-stat-card__value">{stat.value}</span>
              <span className="hr-stat-card__label">{stat.label}</span>
            </div>
          ))}
        </div>
        <div className="hr-tabs" role="tablist" aria-label="Разделы кадровика">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`hr-tab ${activeTab === tab.id ? 'hr-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <section className="hr-panel">
        {activeTab === 'requests' && <div>Заявления сотрудников</div>}
        {activeTab === 'employees' && <div>Карточки сотрудников</div>}
        {activeTab === 'calendar' && <div>Календарь сотрудников</div>}
        {activeTab === 'templates' && <div>Шаблоны документов</div>}
        {activeTab === 'archive' && <div>Архив заявлений</div>}
      </section>
    </div>
  );
};

export default HrPage;
```

- [ ] **Step 4: Add HR route and sidebar access**

In `webapp/src/App.tsx`, add imports:

```tsx
import { canAccessHr, getDefaultRouteForRole, getRoleLabel, isHrRole } from './utils/roles';
```

Add lazy page:

```tsx
const HrPage = React.lazy(() => import('./pages/HrPage'));
```

Replace the role label expression with:

```tsx
const currentRoleLabel = getRoleLabel(currentUser?.role);
```

Add role helpers near `isAdmin`:

```tsx
const isHr = isHrRole(currentUser?.role);
const canOpenHr = canAccessHr(currentUser?.role);
```

Add a `Кадры` navigation tab when `canOpenHr` is true:

```tsx
if (canOpenHr) {
  tabs.push({
    path: '/hr',
    label: 'Кадры',
    icon: (
      <svg className="app-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  });
}
```

Add route state:

```tsx
const isHrRoute = location.pathname.startsWith('/hr');
```

Add `app-shell--hr` to the root class string:

```tsx
${isHrRoute ? 'app-shell--hr' : ''}
```

Replace the root route:

```tsx
<Route path="/" element={<Navigate to={getDefaultRouteForRole(currentUser.role)} replace />} />
```

Add the HR route:

```tsx
<Route
  path="/hr"
  element={canOpenHr ? <HrPage /> : <Navigate to={getDefaultRouteForRole(currentUser.role)} replace />}
/>
```

Adjust the wildcard route:

```tsx
<Route path="*" element={<Navigate to={getDefaultRouteForRole(currentUser.role)} replace />} />
```

If TypeScript reports `isHr` as unused, do not keep the variable. The access check can rely on `canOpenHr`.

- [ ] **Step 5: Run HR page test**

Run:

```bash
cd webapp
npm run test -- src/pages/HrPage.test.tsx src/utils/roles.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit route shell**

Run:

```bash
git add webapp/src/App.tsx webapp/src/pages/HrPage.tsx webapp/src/pages/HrPage.test.tsx
git commit -m "feat: add HR workspace route"
```

---

### Task 4: Implement HR Tab Components

**Files:**
- Modify: `webapp/src/pages/HrPage.tsx`
- Create: `webapp/src/pages/hr/HrRequestsTab.tsx`
- Create: `webapp/src/pages/hr/HrEmployeesTab.tsx`
- Create: `webapp/src/pages/hr/HrCalendarTab.tsx`
- Create: `webapp/src/pages/hr/HrTemplatesTab.tsx`
- Create: `webapp/src/pages/hr/HrArchiveTab.tsx`
- Modify: `webapp/src/pages/HrPage.test.tsx`

- [ ] **Step 1: Extend HR page tests for tab content**

Append these tests to `webapp/src/pages/HrPage.test.tsx`:

```tsx
it('shows request details and quick actions on the requests tab', () => {
  render(<HrPage />);

  expect(screen.getByText('Ежегодный оплачиваемый отпуск на 6 рабочих дней.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Одобрить' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Запросить данные' })).toBeInTheDocument();
});

it('shows equal-grid employee cards on the employees tab', () => {
  render(<HrPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Сотрудники' }));

  expect(screen.getByText('Арман Темирланов')).toBeInTheDocument();
  expect(screen.getByText('Документы неполные')).toBeInTheDocument();
  expect(screen.getAllByTestId('hr-employee-card').length).toBeGreaterThanOrEqual(6);
});

it('shows calendar, templates, and archive content', () => {
  render(<HrPage />);

  fireEvent.click(screen.getByRole('tab', { name: 'Календарь' }));
  expect(screen.getByText('Пн 18')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Шаблоны' }));
  expect(screen.getByText('Заявление на отпуск')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Архив' }));
  expect(screen.getByText('decision-date')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the extended test to verify it fails**

Run:

```bash
cd webapp
npm run test -- src/pages/HrPage.test.tsx
```

Expected: FAIL because tab components are not implemented.

- [ ] **Step 3: Implement requests tab**

Create `webapp/src/pages/hr/HrRequestsTab.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { hrRequests, requestStatusLabels, requestTypeLabels } from './hrMockData';

const HrRequestsTab: React.FC = () => {
  const [selectedId, setSelectedId] = useState(hrRequests[0]?.id ?? '');
  const selected = useMemo(
    () => hrRequests.find((request) => request.id === selectedId) ?? hrRequests[0],
    [selectedId],
  );

  return (
    <div className="hr-requests-grid">
      <div className="hr-request-list" aria-label="Заявления сотрудников">
        {hrRequests.map((request) => (
          <button
            type="button"
            key={request.id}
            className={`hr-request-row ${request.id === selected?.id ? 'hr-request-row--active' : ''}`}
            onClick={() => setSelectedId(request.id)}
          >
            <img className="hr-avatar" src={request.employeePhotoUrl} alt="" />
            <span className="hr-request-row__person">
              <strong>{request.employeeName}</strong>
              <span>{request.department}</span>
            </span>
            <span className="hr-badge">{requestTypeLabels[request.type]}</span>
            <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
            <span className="hr-request-row__date">{request.updatedAt}</span>
          </button>
        ))}
      </div>

      {selected && (
        <aside className="hr-detail-card">
          <div className="hr-detail-card__head">
            <div>
              <p className="hr-kicker">{requestTypeLabels[selected.type]}</p>
              <h3>{selected.employeeName}</h3>
            </div>
            <span className={`hr-status hr-status--${selected.status}`}>{requestStatusLabels[selected.status]}</span>
          </div>
          <p className="hr-detail-card__summary">{selected.summary}</p>
          <dl className="hr-meta-list">
            <div><dt>Период</dt><dd>{selected.period}</dd></div>
            <div><dt>Подано</dt><dd>{selected.submittedAt}</dd></div>
            <div><dt>Маршрут</dt><dd>{selected.approvalChain.join(' → ')}</dd></div>
          </dl>
          <div className="hr-detail-card__actions">
            <button className="button" type="button">Одобрить</button>
            <button className="button secondary" type="button">Отклонить</button>
            <button className="button secondary" type="button">Запросить данные</button>
          </div>
        </aside>
      )}
    </div>
  );
};

export default HrRequestsTab;
```

- [ ] **Step 4: Implement employees tab**

Create `webapp/src/pages/hr/HrEmployeesTab.tsx`:

```tsx
import React, { useState } from 'react';
import { hrEmployees } from './hrMockData';
import { HrEmployee } from './hrTypes';

const HrEmployeesTab: React.FC = () => {
  const [selected, setSelected] = useState<HrEmployee | null>(null);

  return (
    <div className="hr-employees-layout">
      <div className="hr-employee-grid">
        {hrEmployees.map((employee) => (
          <button
            type="button"
            key={employee.id}
            className="hr-employee-card"
            data-testid="hr-employee-card"
            onClick={() => setSelected(employee)}
          >
            <div className="hr-employee-card__top">
              <img className="hr-employee-card__photo" src={employee.photoUrl} alt="" />
              <span className="hr-employee-card__completion">{employee.documentCompleteness}%</span>
            </div>
            <strong>{employee.fullName}</strong>
            <span>{employee.position}</span>
            <span>{employee.department}</span>
            <div className="hr-chip-row">
              {employee.statuses.map((status) => <span className="hr-badge" key={status}>{status}</span>)}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <aside className="hr-side-panel" aria-label="Карточка сотрудника">
          <button className="hr-side-panel__close" type="button" onClick={() => setSelected(null)}>×</button>
          <img className="hr-side-panel__photo" src={selected.photoUrl} alt="" />
          <h3>{selected.fullName}</h3>
          <div className="hr-form-grid">
            <label><span>Должность</span><input value={selected.position} readOnly /></label>
            <label><span>Отдел</span><input value={selected.department} readOnly /></label>
            <label><span>Локация</span><input value={selected.location} readOnly /></label>
            <label><span>Телефон</span><input value={selected.phone} readOnly /></label>
            <label><span>Email</span><input value={selected.email} readOnly /></label>
            <label><span>График</span><input value={selected.schedule} readOnly /></label>
          </div>
        </aside>
      )}
    </div>
  );
};

export default HrEmployeesTab;
```

- [ ] **Step 5: Implement calendar tab**

Create `webapp/src/pages/hr/HrCalendarTab.tsx`:

```tsx
import React from 'react';
import { hrCalendarEvents } from './hrMockData';

const days = [
  { key: '2026-05-18', label: 'Пн 18' },
  { key: '2026-05-19', label: 'Вт 19' },
  { key: '2026-05-20', label: 'Ср 20' },
  { key: '2026-05-21', label: 'Чт 21' },
  { key: '2026-05-22', label: 'Пт 22' },
  { key: '2026-05-23', label: 'Сб 23' },
  { key: '2026-05-24', label: 'Вс 24' },
];

const HrCalendarTab: React.FC = () => (
  <div className="hr-calendar">
    {days.map((day) => (
      <section className="hr-calendar-day" key={day.key}>
        <h3>{day.label}</h3>
        {hrCalendarEvents
          .filter((event) => event.date === day.key)
          .map((event) => (
            <div className={`hr-calendar-event hr-calendar-event--${event.type}`} key={event.id}>
              <strong>{event.employeeName}</strong>
              <span>{event.label}</span>
              <small>{event.startTime}-{event.endTime}</small>
            </div>
          ))}
      </section>
    ))}
  </div>
);

export default HrCalendarTab;
```

- [ ] **Step 6: Implement templates tab**

Create `webapp/src/pages/hr/HrTemplatesTab.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { hrTemplates, requestTypeLabels } from './hrMockData';

const HrTemplatesTab: React.FC = () => {
  const [selectedId, setSelectedId] = useState(hrTemplates[0]?.id ?? '');
  const selected = useMemo(
    () => hrTemplates.find((template) => template.id === selectedId) ?? hrTemplates[0],
    [selectedId],
  );

  return (
    <div className="hr-template-layout">
      <div className="hr-template-list">
        {hrTemplates.map((template) => (
          <button
            type="button"
            className={`hr-template-item ${template.id === selected?.id ? 'hr-template-item--active' : ''}`}
            key={template.id}
            onClick={() => setSelectedId(template.id)}
          >
            <strong>{template.title}</strong>
            <span>{requestTypeLabels[template.type]}</span>
            <small>{template.updatedAt}</small>
          </button>
        ))}
      </div>
      {selected && (
        <aside className="hr-detail-card">
          <p className="hr-kicker">{requestTypeLabels[selected.type]}</p>
          <h3>{selected.title}</h3>
          <p className="hr-template-preview">{selected.preview}</p>
          <div className="hr-chip-row">
            {selected.variables.map((variable) => <span className="hr-badge" key={variable}>{`{${variable}}`}</span>)}
          </div>
          <div className="hr-detail-card__actions">
            <button className="button" type="button">Использовать</button>
            <button className="button secondary" type="button">Дублировать</button>
          </div>
        </aside>
      )}
    </div>
  );
};

export default HrTemplatesTab;
```

- [ ] **Step 7: Implement archive tab**

Create `webapp/src/pages/hr/HrArchiveTab.tsx`:

```tsx
import React from 'react';
import { hrArchiveItems, requestStatusLabels, requestTypeLabels } from './hrMockData';

const HrArchiveTab: React.FC = () => (
  <div className="hr-archive-table-wrap">
    <table className="hr-archive-table">
      <thead>
        <tr>
          <th>Сотрудник</th>
          <th>Тип</th>
          <th>Статус</th>
          <th><span>Дата</span><span className="sr-only">decision-date</span></th>
          <th>Ответственный</th>
        </tr>
      </thead>
      <tbody>
        {hrArchiveItems.map((item) => (
          <tr key={item.id}>
            <td>{item.employeeName}</td>
            <td>{requestTypeLabels[item.type]}</td>
            <td><span className={`hr-status hr-status--${item.finalStatus}`}>{requestStatusLabels[item.finalStatus]}</span></td>
            <td>{item.decisionDate}</td>
            <td>{item.responsible}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default HrArchiveTab;
```

- [ ] **Step 8: Wire tab components into HrPage**

In `webapp/src/pages/HrPage.tsx`, import the tab components:

```tsx
import HrArchiveTab from './hr/HrArchiveTab';
import HrCalendarTab from './hr/HrCalendarTab';
import HrEmployeesTab from './hr/HrEmployeesTab';
import HrRequestsTab from './hr/HrRequestsTab';
import HrTemplatesTab from './hr/HrTemplatesTab';
```

Replace the placeholder content inside `<section className="hr-panel">` with:

```tsx
{activeTab === 'requests' && <HrRequestsTab />}
{activeTab === 'employees' && <HrEmployeesTab />}
{activeTab === 'calendar' && <HrCalendarTab />}
{activeTab === 'templates' && <HrTemplatesTab />}
{activeTab === 'archive' && <HrArchiveTab />}
```

- [ ] **Step 9: Run HR page tests**

Run:

```bash
cd webapp
npm run test -- src/pages/HrPage.test.tsx
```

Expected: PASS. If the archive test cannot find `decision-date` because `.sr-only` is hidden from query text, change the assertion to `expect(screen.getByRole('columnheader', { name: /Дата/ })).toBeInTheDocument();`.

- [ ] **Step 10: Commit tab components**

Run:

```bash
git add webapp/src/pages/HrPage.tsx webapp/src/pages/HrPage.test.tsx webapp/src/pages/hr/HrRequestsTab.tsx webapp/src/pages/hr/HrEmployeesTab.tsx webapp/src/pages/hr/HrCalendarTab.tsx webapp/src/pages/hr/HrTemplatesTab.tsx webapp/src/pages/hr/HrArchiveTab.tsx
git commit -m "feat: add HR workspace tabs"
```

---

### Task 5: Add Minimalist HR Styling

**Files:**
- Create: `webapp/src/styles/hr.css`
- Create: `webapp/src/styles/hr-layout.test.ts`
- Modify: `webapp/src/main.tsx`

- [ ] **Step 1: Write CSS guard tests**

Create `webapp/src/styles/hr-layout.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDir, 'hr.css'), 'utf8').replace(/\r\n/g, '\n');

describe('HR layout CSS', () => {
  it('uses compact aligned cards instead of a large hero', () => {
    expect(css).toContain('.hr-header {\n  display: grid;');
    expect(css).toContain('border-radius: var(--radius-md);');
    expect(css).toContain('.hr-stat-grid {\n  display: grid;');
    expect(css).toContain('align-items: stretch;');
  });

  it('locks employee cards to equal row height', () => {
    expect(css).toContain('.hr-employee-grid {\n  display: grid;');
    expect(css).toContain('grid-auto-rows: minmax(210px, 1fr);');
    expect(css).toContain('.hr-employee-card {\n  min-height: 210px;');
  });

  it('keeps request and template layouts aligned', () => {
    expect(css).toContain('.hr-requests-grid {\n  display: grid;');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('.hr-template-layout {\n  display: grid;');
  });
});
```

- [ ] **Step 2: Run CSS test to verify it fails**

Run:

```bash
cd webapp
npm run test -- src/styles/hr-layout.test.ts
```

Expected: FAIL because `hr.css` does not exist.

- [ ] **Step 3: Add HR stylesheet**

Create `webapp/src/styles/hr.css`:

```css
.hr-page {
  display: grid;
  gap: 16px;
  min-height: calc(100vh - 28px);
}

.hr-header {
  display: grid;
  gap: 14px;
  padding: 18px;
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
}

.hr-header__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hr-header__title {
  margin: 0;
  color: var(--text-heading);
  font-size: 1.35rem;
  font-weight: 800;
}

.hr-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hr-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
}

.hr-stat-card {
  min-height: 72px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft-color);
  border: 1px solid var(--border-color);
}

.hr-stat-card__value {
  color: var(--text-heading);
  font-weight: 800;
  font-size: 1.35rem;
  line-height: 1;
}

.hr-stat-card__label {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.hr-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}

.hr-tab {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.hr-tab--active {
  color: var(--text-on-brand);
  background: var(--nav-active-bg);
  border-color: transparent;
  box-shadow: var(--nav-active-shadow);
}

.hr-panel {
  min-height: 0;
}

.hr-requests-grid,
.hr-template-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
  align-items: stretch;
  gap: 14px;
}

.hr-request-list,
.hr-template-list,
.hr-detail-card,
.hr-archive-table-wrap {
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--card-shadow);
}

.hr-request-list,
.hr-template-list {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.hr-request-row,
.hr-template-item {
  width: 100%;
  min-height: 64px;
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.hr-request-row {
  grid-template-columns: 40px minmax(150px, 1fr) auto auto minmax(110px, auto);
}

.hr-request-row--active,
.hr-template-item--active {
  background: var(--brand-soft);
  border-color: var(--secondary-border);
}

.hr-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.hr-request-row__person {
  display: grid;
  gap: 2px;
}

.hr-request-row__person span,
.hr-request-row__date,
.hr-template-item span,
.hr-template-item small {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.hr-badge,
.hr-status {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  width: fit-content;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 800;
  white-space: nowrap;
}

.hr-badge {
  background: var(--badge-bg);
  color: var(--badge-text);
}

.hr-status {
  background: rgba(58, 124, 165, 0.12);
  color: var(--brand-color);
}

.hr-status--approved {
  background: rgba(16, 185, 129, 0.14);
  color: #0f8a61;
}

.hr-status--rejected,
.hr-status--needsInfo {
  background: rgba(239, 68, 68, 0.12);
  color: #b84a4a;
}

.hr-detail-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.hr-detail-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.hr-detail-card h3,
.hr-side-panel h3,
.hr-calendar-day h3 {
  margin: 0;
  color: var(--text-heading);
}

.hr-kicker {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
}

.hr-detail-card__summary,
.hr-template-preview {
  margin: 0;
  color: var(--text-color);
  line-height: 1.5;
}

.hr-meta-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.hr-meta-list div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.hr-meta-list dt {
  color: var(--text-muted);
  font-weight: 700;
}

.hr-meta-list dd {
  margin: 0;
  color: var(--text-heading);
  font-weight: 700;
}

.hr-detail-card__actions,
.hr-chip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hr-employees-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

.hr-employee-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  grid-auto-rows: minmax(210px, 1fr);
  align-items: stretch;
  gap: 14px;
}

.hr-employee-card {
  min-height: 210px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--surface-color);
  color: inherit;
  font: inherit;
  text-align: left;
  box-shadow: var(--card-shadow);
  cursor: pointer;
}

.hr-employee-card__top {
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.hr-employee-card__photo,
.hr-side-panel__photo {
  width: 58px;
  height: 58px;
  border-radius: 18px;
  object-fit: cover;
}

.hr-employee-card__completion {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.hr-side-panel {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 100;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-color);
  box-shadow: var(--popover-shadow);
}

.hr-side-panel__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  background: var(--surface-soft-color);
  color: inherit;
  cursor: pointer;
}

.hr-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.hr-form-grid label {
  display: grid;
  gap: 5px;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 800;
}

.hr-form-grid input {
  min-width: 0;
  height: 38px;
  border-radius: 12px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text-color);
  padding: 0 10px;
}

.hr-calendar {
  display: grid;
  grid-template-columns: repeat(7, minmax(150px, 1fr));
  gap: 10px;
  overflow-x: auto;
}

.hr-calendar-day {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--surface-color);
  box-shadow: var(--card-shadow);
}

.hr-calendar-event {
  display: grid;
  gap: 2px;
  min-height: 58px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  border: 1px solid var(--secondary-border);
}

.hr-calendar-event span,
.hr-calendar-event small {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.hr-archive-table-wrap {
  overflow: auto;
}

.hr-archive-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 720px;
}

.hr-archive-table th,
.hr-archive-table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--table-border);
  text-align: left;
  white-space: nowrap;
}

.hr-archive-table th {
  color: var(--text-muted);
  font-size: 0.78rem;
  text-transform: uppercase;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1100px) {
  .hr-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hr-requests-grid,
  .hr-template-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .hr-header__top {
    align-items: flex-start;
    flex-direction: column;
  }

  .hr-stat-grid {
    grid-template-columns: 1fr;
  }

  .hr-request-row {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .hr-request-row__date,
  .hr-request-row .hr-badge,
  .hr-request-row .hr-status {
    grid-column: 2;
  }

  .hr-form-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Import HR stylesheet**

In `webapp/src/main.tsx`, add:

```ts
import './styles/hr.css';
```

Place it after `import './styles/admin.css';` so HR styles load with the other page styles.

- [ ] **Step 5: Run CSS tests**

Run:

```bash
cd webapp
npm run test -- src/styles/hr-layout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit HR styling**

Run:

```bash
git add webapp/src/styles/hr.css webapp/src/styles/hr-layout.test.ts webapp/src/main.tsx
git commit -m "style: add HR workspace layout"
```

---

### Task 6: Final Verification

**Files:**
- Verify all files changed by Tasks 1-5.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd webapp
npm run test -- src/utils/roles.test.ts src/pages/hr/hrMockData.test.ts src/pages/HrPage.test.tsx src/styles/hr-layout.test.ts
```

Expected: PASS for all listed test files.

- [ ] **Step 2: Run the production build**

Run:

```bash
cd webapp
npm run build
```

Expected: PASS with TypeScript and Vite build completed.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files from this feature are modified or the working tree is clean aside from pre-existing unrelated changes such as `antigravity-setup`.

- [ ] **Step 4: Commit any remaining intentional adjustments**

If Step 3 shows intentional HR feature files not yet committed, stage only those files:

```bash
git add webapp/src/utils/roles.ts webapp/src/utils/roles.test.ts webapp/src/utils/converters.ts webapp/src/context/ApiContext.tsx webapp/src/utils/admin-helpers.ts webapp/src/pages/HrPage.tsx webapp/src/pages/HrPage.test.tsx webapp/src/pages/hr webapp/src/styles/hr.css webapp/src/styles/hr-layout.test.ts webapp/src/main.tsx
git commit -m "feat: complete HR page prototype"
```

Expected: commit succeeds or Git reports there is nothing to commit because all planned task commits were already created.

---

## Self-Review

Spec coverage:

- HR role and restricted navigation are covered by Task 1 and Task 3.
- Single `/hr` page with tabs is covered by Task 3 and Task 4.
- Mock data shape and future API readiness are covered by Task 2.
- Requests, employees, calendar, templates, and archive are covered by Task 4.
- Minimalist styling, soft corners, equal-height alignment, and no large hero are covered by Task 5.
- Verification for tests, build, and layout guardrails is covered by Task 6.

Placeholder scan:

- No unresolved placeholder steps or vague test instructions remain.

Type consistency:

- `HrRequestType`, `HrRequestStatus`, `HrEmployee`, `HrRequest`, `HrCalendarEvent`, `HrTemplate`, and `HrArchiveItem` are defined before use.
- `requestTypeLabels` and `requestStatusLabels` use the same status/type unions consumed by tab components.
- Role helpers are defined before being imported by converters, context, and app routing.
