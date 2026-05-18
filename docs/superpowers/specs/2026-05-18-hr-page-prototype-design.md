# HR Page Prototype Design

## Purpose

Build a first UI prototype for a new HR role and HR workspace in the web app. The prototype should let us validate layout, workflows, and visual density before connecting database tables and backend APIs.

The new role is `hr` / `Кадровик`. A кадровик should see only HR-related screens: employees, employee requests, schedule/calendar, templates, and request archive. The role should not expose admin dashboard, surveys, operator dialogs, or system administration tools.

## Scope

The first phase is a frontend prototype on mock data. It should be visually complete and navigable, but persistence, database schema, and backend processing are intentionally deferred.

Included:

- Add a `Кадры` section to the app navigation for the HR role.
- Create one HR page with tabs: `Заявления`, `Сотрудники`, `Календарь`, `Шаблоны`, `Архив`.
- Show realistic mock data for requests, employee cards, schedule events, templates, and archive rows.
- Add minimal role-aware routing so `hr` users land in the HR workspace and see only HR navigation.
- Keep UI structure ready for future API integration.

Deferred:

- Database tables for HR requests, employees, templates, approvals, and schedule events.
- Backend CRUD endpoints.
- File upload, document generation, electronic signatures, and notification delivery.
- Full employee-side request creation flow. The prototype may include a visual entry point, but employee request submission will be planned as a later step.

## Visual Direction

The HR page must match the existing web app style instead of introducing a separate product look.

Rules:

- Minimalist interface with compact, work-focused layout.
- Cards use the same visual language as the current site: soft corners, subtle borders, light surfaces, restrained shadow.
- No large hero, marketing copy, decorative illustrations, or explanatory text blocks.
- Components in one row must align by top and bottom edges.
- Stat cards in the header must share one height.
- Employee cards in the same grid row must share one height.
- Request rows and calendar blocks should be dense but readable.
- Use soft status badges instead of loud colors.
- Prefer short labels, icons where useful, and clear visual state over long text.

## Page Structure

The HR page is a single route, proposed as `/hr`, with internal tabs.

Header:

- Title: `Кадры`.
- Compact subtitle can be omitted or kept to one short status line if needed.
- Stat cards:
  - `Новые заявления`
  - `Отпуска на неделе`
  - `Карточки требуют данных`
  - `Документы на подпись`
- Header actions:
  - `Добавить сотрудника`
  - `Создать шаблон`
  - `Фильтр`

Tabs:

- `Заявления`
- `Сотрудники`
- `Календарь`
- `Шаблоны`
- `Архив`

The active tab controls the main content area without changing the overall header structure.

## Requests Tab

Purpose: кадровик processes employee requests and service letters.

Visible request types:

- Отпуск
- Аванс
- Больничный
- Командировка
- Справка
- Служебное письмо

Request statuses:

- `Новое`
- `На рассмотрении`
- `Нужны данные`
- `Одобрено`
- `Отклонено`
- `В архиве`

Layout:

- Left/main: request list or table with employee photo, name, department, request type, period/date, status, and updated time.
- Right/detail panel: selected request details, approval chain, internal comment, and quick actions.

Primary actions:

- `Одобрить`
- `Отклонить`
- `Запросить данные`
- `Сформировать документ`

The prototype should make actions visible but may keep them as local UI state or non-persistent interactions.

## Employees Tab

Purpose: кадровик views and edits employee cards.

Employee card content:

- Photo/avatar.
- Full name.
- Position.
- Department.
- Location.
- Phone/email.
- HR status badges such as `В отпуске`, `На смене`, `Документы неполные`, `Испытательный срок`.

Detail view:

- Opens as a side panel or modal.
- Tabs inside employee detail:
  - `Информация`
  - `Документы`
  - `Посещаемость`
  - `Заявления`
  - `История`

Editable prototype fields:

- Photo placeholder.
- Name.
- Phone.
- Email.
- Position.
- Department.
- Location.
- Hire date.
- Schedule type.
- Document completeness flags.

The first prototype can edit these fields locally without persistence.

## Calendar Tab

Purpose: кадровик sees events and employee schedule.

Views:

- Week view as the default.
- Month view can be represented as a toggle if time allows.

Calendar content:

- Vacations.
- Sick leaves.
- Business trips.
- Schedule shifts.
- Birthdays.
- Contract or probation period end dates.

Filters:

- Department.
- Position.
- Location.
- Event type.

Visual behavior:

- Blocks should follow the schedule-table style from the reference screenshots.
- Events use soft background colors and concise labels.
- Overlap warnings can appear as small badges, not large alerts.

## Templates Tab

Purpose: кадровик creates and manages letter/request templates.

Template types:

- Заявление на отпуск.
- Заявление на аванс.
- Командировка.
- Служебная записка.
- Справка с места работы.

Layout:

- Left: template list with type, title, and last updated date.
- Right: preview/editor panel.

Template variables:

- `{employee_name}`
- `{position}`
- `{department}`
- `{date_from}`
- `{date_to}`
- `{amount}`
- `{reason}`

Prototype actions:

- `Создать шаблон`
- `Дублировать`
- `Использовать`
- `Сохранить`

## Archive Tab

Purpose: кадровик reviews processed requests and decisions.

Content:

- Processed requests with final status, employee, type, decision date, and responsible HR user.
- Search by employee name.
- Filters by type, status, department, and date range.

The archive should use a compact table/list, not large cards.

## Role And Navigation

Frontend role logic:

- Add a recognized `hr` role label: `Кадровик`.
- `hr` users should see `Кадры` and `Профиль`.
- `hr` users should not see `Диалоги`, `Дашборд`, `Сотрудники` admin page, or `Опросы`.
- Admin users may also see `Кадры` if useful for testing and oversight.
- Non-HR, non-admin users should not access `/hr`; they should be redirected to their normal default route.

Backend role enforcement is deferred, but the frontend should be structured so backend authorization can be added cleanly later.

## Data Model Shape For Mock Data

The UI should use typed mock objects close to the future API shape:

- `HrEmployee`
- `HrRequest`
- `HrCalendarEvent`
- `HrTemplate`
- `HrArchiveItem`

Each mock object should use stable IDs and fields that map naturally to future database records.

## Future Backend Phase

After the prototype is approved, add backend support in stages:

1. Add database tables and migrations for HR employees, request templates, employee requests, request comments, approvals, and calendar events.
2. Add API endpoints for list/detail/create/update actions.
3. Connect the HR page to API data.
4. Add employee-side web flow for creating requests.
5. Add document generation from templates.
6. Add notifications and audit history.

## Testing And Verification

Prototype verification:

- Build passes with TypeScript.
- HR route renders for an `hr` role.
- Admin can access HR route if enabled.
- Operator/non-HR users are redirected away.
- Tabs switch content without layout jumps.
- Header stat cards align in height.
- Employee cards align in grid rows.
- Text does not overflow cards or buttons on desktop and mobile widths.

Visual QA should include desktop and narrow viewport checks once implementation starts.
