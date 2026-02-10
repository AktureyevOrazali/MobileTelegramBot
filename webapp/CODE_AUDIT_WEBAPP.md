# Webapp Code Audit v2 — MobileBot Companion

**Date:** 2026-02-10  
**Scope:** All files under `webapp/src/`  
**Previous audit:** 2026-02-09 (`CODE_AUDIT_WEBAPP.md` v1, 20 issues)

---

## 1. Что было исправлено с прошлого аудита

В таблице ниже каждый пункт из первого аудита, его текущий статус и что конкретно сделано.

| # | Проблема (аудит v1) | Статус | Что сделано |
|--:|----------------------|--------|-------------|
| 1 | **Zero test coverage** | ⏳ Не исправлено | Тестов по-прежнему нет — ни Vitest, ни Testing Library не настроены |
| 2 | **AdminPage 1450 LOC** | ✅ Исправлено | Уменьшен до **606 строк**. Извлечены: `AdminUserCard` (570 LOC) → `components/`, `useAdminData` (319 LOC) → `hooks/`, хелперы → `utils/admin-helpers.ts` (55 LOC) |
| 3 | **DashboardPage 1065 LOC** | ✅ Исправлено | Уменьшен до **513 строк**. Вся логика данных перенесена в `useDashboardData` (581 LOC) → `hooks/`, константы и хелперы → `utils/dashboard-helpers.ts` (110 LOC) |
| 4 | **API token in client bundle** | ⏳ Не исправлено | `VITE_API_TOKEN` по-прежнему вшивается в бандл (`ApiClient.ts`, line 46) |
| 5 | **4345-line monolithic CSS** | ✅ Исправлено | Разделён на **8 файлов**: `variables.css`, `components.css`, `dialogs.css`, `dashboard.css`, `profile.css`, `chat-modal.css`, `admin.css`, `auth.css`. Импортируются в `main.tsx` |
| 6 | **No routing (unused dep)** | ✅ Исправлено | Полноценная маршрутизация через `react-router-dom` с `BrowserRouter`, `Routes`, `NavLink` и `Navigate`. URL меняются, кнопки назад/вперёд работают |
| 7 | **No I/O abstraction (ApiClient)** | ⏳ Не исправлено | `ApiClient` остаётся конкретным классом без интерфейса `IApiClient` |
| 8 | **Dual session state ownership** | ⏳ Не исправлено | `ApiClient` хранит `session` и `currentUserProfile` внутри себя, и они отдельно управляются через `ApiContext` |
| 9 | **Multiple overlapping polling** | ⏳ Не исправлено | DialogsPage по-прежнему имеет несколько параллельных polling-циклов |
| 10 | **2.9 MB GeoJSON in main bundle** | ✅ Частично | Код-сплиттинг через `React.lazy` уменьшает нагрузку: DashboardPage и AdminPage загружаются лениво. Однако сам `kz.json` не упрощён |
| 11 | **Inconsistent error handling** | ✅ Исправлено | `extractErrorMessage` теперь используется **повсеместно** (10 файлов): `AuthPage`, `ProfilePage`, `AdminPage`, `DialogsPage`, `ChatDetailModal`, `AdminUserCard`, `useAdminData`, `useDashboardData`. Паттерны B и C полностью удалены |
| 12 | **Duplicated type mapping logic** | ⏳ Частично | Дублирование в `ApiContext.tsx` (session deserialization) и `converters.ts` осталось |
| 13 | **Password validation inconsistency** | ✅ Исправлено | Создан `utils/validation.ts` с единой функцией `validatePassword()` (мин. 4 символа). AuthPage и ProfilePage оба используют её |
| 14 | **Excessive `any` casts** | ⏳ Частично | Количество `as any` сократилось, но 15 использований остаётся: `converters.ts` (4), `ApiContext.tsx` (9), `ApiClient.ts` (2) |
| 15 | **No focus trapping in modals** | ⏳ Не исправлено | `Modal.tsx` не реализует перехват фокуса |
| 16 | **Inline styles in JSX** | ⏳ Частично | Большинство inline-стилей убрано, но `App.tsx` (line 155: `marginTop: 12`), `PageLoader` (padding, textAlign) используют остаточные |
| 17 | **Missing ARIA attributes** | ⏳ Частично | `aria-label` добавлен на кнопку переключения темы. Но `role="tablist"` / `role="tab"` на навигации нет |
| 18 | **No lint/format config** | ⏳ Не исправлено | В `package.json` нет скриптов `lint`, `test`, `format` |
| 19 | **Duplicate CSS `:root`** | ✅ Исправлено | Только один блок `:root` в `variables.css` (line 3–54). Второй дублирующий блок удалён |
| 20 | **8 parallel API calls on admin load** | ⏳ Не исправлено | `useAdminData` всё ещё загружает все данные массивом через `Promise.all` при каждом поиске |

### Итого по прошлому аудиту

| Категория | Кол-во |
|-----------|--------|
| ✅ Полностью исправлено | **8** из 20 |
| ⏳ Частично исправлено | **4** из 20 |
| ❌ Не исправлено | **8** из 20 |

---

## 2. Подробные улучшения, сделанные после аудита v1

### 2.1 Маршрутизация (react-router-dom)

**Было:** `useState<TabKey>` для переключения вкладок, URL не менялся.  
**Стало:**
```tsx
// main.tsx — BrowserRouter обёртка
<BrowserRouter>
  <ApiProvider>
    <App />
  </ApiProvider>
</BrowserRouter>

// App.tsx — полноценные маршруты
<Routes>
  <Route path="/" element={<Navigate to="/dialogs" replace />} />
  <Route path="/dialogs" element={<DialogsPage />} />
  <Route path="/dashboard" element={isAdmin ? <DashboardPage /> : <Navigate to="/dialogs" />} />
  <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/dialogs" />} />
  <Route path="/profile" element={<ProfilePage />} />
</Routes>
```
- URL меняется при переключении вкладок
- Кнопки назад/вперёд браузера работают
- Защита маршрутов admin/dashboard для неадминов

### 2.2 Code Splitting (React.lazy)

**Было:** Все страницы импортировались сразу.  
**Стало:**
```tsx
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
```
- 3 из 5 страниц загружаются лениво
- Обёрнуты в `<Suspense fallback={<PageLoader />}>`
- Уменьшение начального бандла

### 2.3 Декомпозиция страниц

#### AdminPage: 1450 → 606 строк (−58%)

| Извлечённый модуль | Строк | Описание |
|--------------------|------:|----------|
| `components/AdminUserCard.tsx` | 570 | Компонент карточки пользователя |
| `hooks/useAdminData.ts` | 319 | Вся логика данных, API-вызовы, мутации |
| `utils/admin-helpers.ts` | 55 | `formatDateTimeLocalInput`, `parseDateTimeLocalInput`, `pluralizeDialogs`, `cloneAssignment`, `roleLabels` |

#### DashboardPage: 1065 → 513 строк (−52%)

| Извлечённый модуль | Строк | Описание |
|--------------------|------:|----------|
| `hooks/useDashboardData.ts` | 581 | Полная логика фильтров, API-вызовов, метрик |
| `utils/dashboard-helpers.ts` | 110 | Константы (`EMPTY_SUMMARY`, пороги), хелперы (`formatMinutes`, `getInitials`, `parseQuestion`, `speedLabel`, и др.) |

#### Дополнительные извлечения

| Модуль | Строк | Назначение |
|--------|------:|------------|
| `hooks/useDebouncedEffect.ts` | 24 | Переиспользуемый хук дебаунса |
| `utils/validation.ts` | 38 | Общие валидаторы: `validatePassword`, `validateName`, `validatePasswordMatch` |

### 2.4 CSS модуляризация

**Было:** 1 файл `styles.css` — 4345 строк  
**Стало:** 8 файлов:

| Файл | Размер | Назначение |
|------|-------:|------------|
| `variables.css` | 155 строк | Токены, `:root`, `[data-theme='dark']`, ресет |
| `components.css` | ~190 строк | Шапка, навигация, кнопки, пиллы |
| `dialogs.css` | ~330 строк | Карточки диалогов, фильтры, поиск |
| `dashboard.css` | ~470 строк | Статкарты, графики, таблицы, вопросы |
| `profile.css` | ~475 строк | Страница профиля, формы, аватар |
| `chat-modal.css` | ~600 строк | Модал чата, сообщения, композер |
| `admin.css` | ~1000 строк | Карточки пользователей, модалки, BIN-назначения |
| `auth.css` | ~155 строк | Страница авторизации |

- Дублирующий `:root` блок удалён
- Единая система CSS-переменных в `variables.css`

### 2.5 Единый error handling

**Было:** 3 паттерна обработки ошибок (`extractErrorMessage`, ручной `instanceof` и inline-кастинг).  
**Стало:** `extractErrorMessage` используется во всех компонентах (10 файлов), Паттерны B и C полностью удалены.

### 2.6 Единая валидация паролей

**Было:** Минимальная длина пароля: 5 в AuthPage, 6 в ProfilePage, 6 в AdminPage.  
**Стало:** Единая функция `validatePassword()` из `utils/validation.ts` (мин. 4 символа) используется повсеместно.

---

## 3. Оставшиеся проблемы (новый аудит)

### 🔴 Критические

#### 3.1 Zero Test Coverage
Тестов по-прежнему нет. Ни Vitest, ни testing-framework не установлены. Чистые функции (`dashboard-helpers.ts`, `admin-helpers.ts`, `validation.ts`, `converters.ts`, `date.ts`, `errors.ts`) — идеальные кандидаты для первичного покрытия.

#### 3.2 API Token в клиентском бандле
`VITE_API_TOKEN` всё ещё вшивается в JavaScript-бандл при сборке (строка 46, `ApiClient.ts`). Любой может извлечь его через DevTools.

#### 3.3 DialogsPage.tsx — 661 строк
Хотя AdminPage и DashboardPage были декомпозированы, `DialogsPage` остаётся монолитным (661 строк, 1 компонент). Содержит polling, фильтрацию, избранное, AI-toggle, удаление — всё в одной функции.

### 🟡 Средние

#### 3.4 No I/O Abstraction
`ApiClient` — конкретный класс без интерфейса. Невозможно замокать для тестов без пинатурации.

#### 3.5 Dual Session State
Сессия хранится и в `ApiClient.session` и управляется через `ApiContext`. Двойное владение состоянием.

#### 3.6 `as any` — 15 использований
- `converters.ts`: 4 каста для нормализации `assignedAt`/`expiresAt`
- `ApiContext.tsx`: 9 кастов в `loadSessionFromStorage` (дублирует логику `converters.ts`)
- `ApiClient.ts`: 2 каста в `extractErrorMessage`

#### 3.7 Overlapping Polling
DialogsPage использует несколько параллельных `setInterval`: обновления (5с), полный рефреш (15с), сообщения в модалке (1.5с). Нет `visibilitychange` для остановки при скрытии вкладки.

#### 3.8 AdminUserCard — 570 строк
Карточка пользователя стала самым большим компонентом в проекте. Содержит логику назначения BIN, смены ролей, сброса пароля, управления секциями — стоит декомпозировать дальше.

#### 3.9 useDashboardData — 581 строк
Один из самых больших хуков — содержит всю логику Dashboard. Следует декомпозировать на более мелкие хуки по разделам: фильтры, данные, метрики.

### 🟢 Низкий приоритет

#### 3.10 No Lint/Format/Test scripts
`package.json` не содержит скриптов `lint`, `test`, `format`. ESLint и Prettier не настроены.

#### 3.11 Focus Trapping in Modals
`Modal.tsx` (28 строк) не реализует перехват фокуса. Tab может выйти за пределы модального окна.

#### 3.12 Inline Styles
Остаточные inline-стили в `App.tsx` (`marginTop: 12`) и `PageLoader` (`padding: 48, textAlign: 'center'`).

#### 3.13 Navigation ARIA
Навигационные вкладки (`NavLink`) не имеют `role="tablist"` / `role="tab"` / `aria-selected`.

#### 3.14 AdminPage — 8 Parallel API Calls
`useAdminData` загружает roли, секции, BINы, пользователей и т.д. через `Promise.all` при каждом поисковом запросе. Статичные данные (роли, секции) должны загружаться один раз.

---

## 4. Сравнительная таблица файлов

| Файл | v1 (строк) | v2 (строк) | Δ |
|------|----------:|----------:|----------:|
| `AdminPage.tsx` | 1450 | 606 | **−58%** |
| `DashboardPage.tsx` | 1065 | 513 | **−52%** |
| `DialogsPage.tsx` | 654 | 661 | +1% (без изменений) |
| `ApiClient.ts` | 567 | 567 | 0% |
| `types.ts` | 341 | 341 | 0% |
| `styles.css` | 4345 | — (удалён) | **−100%** |
| `App.tsx` | ~200 (таб-навигация) | 172 (маршруты) | Переписан |

**Новые файлы:**

| Файл | Строк |
|------|------:|
| `components/AdminUserCard.tsx` | 570 |
| `hooks/useAdminData.ts` | 319 |
| `hooks/useDashboardData.ts` | 581 |
| `hooks/useDebouncedEffect.ts` | 24 |
| `utils/admin-helpers.ts` | 55 |
| `utils/dashboard-helpers.ts` | 110 |
| `utils/validation.ts` | 38 |
| `styles/variables.css` | 155 |
| `styles/components.css` | ~190 |
| `styles/dialogs.css` | ~330 |
| `styles/dashboard.css` | ~470 |
| `styles/profile.css` | ~475 |
| `styles/chat-modal.css` | ~600 |
| `styles/admin.css` | ~1000 |
| `styles/auth.css` | ~155 |

---

## 5. Приоритеты следующих шагов

| # | Задача | Приоритет | Усилие |
|--:|--------|-----------|--------|
| 1 | Убрать `VITE_API_TOKEN` из клиентского бандла | **P0** | Низкое |
| 2 | Добавить Vitest + тесты для pure-функций | **P0** | Среднее |
| 3 | Декомпозировать `DialogsPage.tsx` (661 строк) | **P1** | Среднее |
| 4 | Создать интерфейс `IApiClient` | **P1** | Среднее |
| 5 | Декомпозировать `AdminUserCard.tsx` (570 строк) | **P1** | Среднее |
| 6 | Убрать дублирование `as any` (объединить `ApiContext` + `converters`) | **P2** | Низкое |
| 7 | Добавить ESLint + Prettier | **P2** | Низкое |
| 8 | Реализовать focus trapping в Modal | **P3** | Низкое |
| 9 | Добавить ARIA-атрибуты на навигацию | **P3** | Низкое |
| 10 | Оптимизировать polling (visibility API, единый интервал) | **P2** | Среднее |
