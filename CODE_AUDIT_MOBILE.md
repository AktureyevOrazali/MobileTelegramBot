# Mobile App — Code Audit Report

**Date:** 2026-02-10  
**Scope:** `mobile/lib/` — 26 files, ~8 500 LOC (Flutter / Dart)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)  
2. [Architecture & Structure](#2-architecture--structure)  
3. [Critical Bugs & Errors](#3-critical-bugs--errors)  
4. [High-Priority Issues](#4-high-priority-issues)  
5. [Medium-Priority Issues](#5-medium-priority-issues)  
6. [Low-Priority / Style Issues](#6-low-priority--style-issues)  
7. [Design Improvement Recommendations](#7-design-improvement-recommendations)  
8. [Summary Table](#8-summary-table)

---

## 1. Executive Summary

The mobile app is a functional Flutter client for a Telegram bot management system. It provides authentication, chat management, dashboard analytics, admin user management, and operator profiles. The codebase works, but has serious structural problems that will hinder scaling and testing. Key concerns:

| Area | Rating |
|---|---|
| **Functionality** | ✅ Working |
| **Testability** | ❌ Untestable (zero abstractions, all I/O hardwired) |
| **Maintainability** | ⚠️ Poor — god-files, `part`/`part of` coupling |
| **Session Persistence** | ❌ Broken — sessions lost on app restart |
| **State Management** | ⚠️ Fragile — manual `setState` everywhere |
| **Error Handling** | ✅ Decent for API layer, gaps in UI |
| **Theming** | ✅ Good — well-structured `ThemeExtension` |

---

## 2. Architecture & Structure

### Current Structure

```
lib/
├── main.dart                       ← single compilation unit (all `part` files merge here)
├── api/api_client.dart             ← 705-line monolith
├── app/mobile_bot_app.dart         ← 342 lines
├── app/ui_logger.dart              ← helper/theme utilities
├── models/models.dart              ← 836-line monolith
├── screens/
│   ├── auth_screen.dart            ← 330 lines
│   ├── chat_list_screen.dart       ← 1505 lines ⚠️
│   ├── chat_detail_screen.dart     ← 765 lines
│   ├── dashboard_view.dart         ← 953 lines
│   ├── admin_user_management_view.dart ← 2806 lines ⚠️⚠️
│   └── operator_profile_view.dart  ← 32 lines (stub)
├── bottom_bar/                     ← 3rd-party widget, vendored
├── theme/                          ← proper imports
├── storage/                        ← `part of` main
├── widgets/notifications.dart      ← `part of` main
└── network_exceptions*.dart        ← conditional exports (good pattern)
```

### Key Structural Problem: `part` / `part of`

> **All screens, storage, widgets, and models use `part of '../main.dart'`.**

This merges ~8 000 lines into a single compilation unit. Consequences:
- **No encapsulation** — every private symbol is visible to every other file
- **Impossible to test** any screen or model in isolation
- **Slow incremental builds** — changing any `part` file recompiles everything
- **IDE performance** degrades as the combined unit grows

**Recommended fix:** Convert `part` files to proper `import`/`export`. This is the single highest-impact refactor.

---

## 3. Critical Bugs & Errors

### 🔴 C-01: `SessionStorage` is in-memory only — sessions lost on restart

**File:** [session_storage.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/storage/session_storage.dart)

```dart
class SessionStorage {
  static AuthSession? _cachedSession;  // ← static field, never persisted to disk

  Future<void> save(AuthSession session) async {
    _cachedSession = session;  // Only in RAM
  }
}
```

The app calls `save()` after login, but the session only lives in a static variable. **Every app restart forces re-login.** The `SharedPreferences` import exists in the project but is not used for session data.

**Fix:** Serialize `AuthSession` to JSON and store via `SharedPreferences` or `flutter_secure_storage`.

---

### 🔴 C-02: Duplicate / conflicting theme systems

**Two independent theme managers exist:**

| File | Mechanism | Used By |
|---|---|---|
| [theme_manager.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/theme/theme_manager.dart) | `ChangeNotifier` with `isDarkMode` bool | Not actively integrated |
| [theme_preferences.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/storage/theme_preferences.dart) | Standalone class with `ThemeMode` enum | `MobileBotModule` |

`ThemeManager` stores `'isDarkMode'` (bool) in SharedPreferences.  
`ThemePreferences` stores `'theme_mode'` (String: `'dark'`/`'light'`) in SharedPreferences.  

These use **different keys and types**, so toggling theme via one system doesn't update the other. `ThemeManager` is also a `ChangeNotifier` but is never provided to any widget tree — it's dead code.

**Fix:** Remove `ThemeManager` entirely; keep `ThemePreferences` as the sole theme storage.

---

### 🔴 C-03: Deprecated `onPopInvoked` API

**File:** [chat_list_screen.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/screens/chat_list_screen.dart#L1411)

```dart
PopScope(
  canPop: false,
  onPopInvoked: (didPop) async { ... }  // ← deprecated in Flutter 3.22+
)
```

`onPopInvoked` was deprecated in favor of `onPopInvokedWithResult`. This will produce warnings and may break on future Flutter updates.

**Fix:** Migrate to `onPopInvokedWithResult`.

---

### 🔴 C-04: `admin_user_management_view.dart` — 2806 lines, single widget

This file is **2 806 lines** containing the entire admin panel in one `StatefulWidget`. This is by far the largest file and contains:
- User list rendering
- Role management dialogs
- BIN assignment sheets (date pickers, radio buttons)
- Section management sheets
- Pending registration approval flows
- Search with debounce
- Unassigned BIN assignment
- Password reset dialogs

This is unmaintainable at this size and impossible to test.

---

## 4. High-Priority Issues

### 🟠 H-01: `ApiClient` has zero abstractions — untestable

**File:** [api_client.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/api/api_client.dart)

`ApiClient` is a 705-line concrete class with no interface. Every screen instantiates or receives the concrete class. This means:
- **No unit testing** — you cannot mock API calls
- **No offline mode** or fake data support
- **Violates DIP** — high-level screens depend on low-level HTTP implementation

**Fix:** Extract an `ApiClientInterface` (abstract class) and inject it into screens.

---

### 🟠 H-02: `chat_list_screen.dart` — 1505 lines, handles too many concerns

This single widget manages:
- Chat list fetching & polling (`Timer.periodic` every 5s)
- Filtering by section, BIN, favorites, status
- Sorting
- Navigation to 4 different tabs (Dialogs, Dashboard, Admin, Profile)
- Bottom navigation bar
- Theme switching
- AppBar construction
- Favorite toggling, AI toggling, dialog status toggling
- Chat deletion with confirmation
- Filter bottom sheets

**Fix:** Extract into separate widgets: `ChatFilterBar`, `ChatCard`, `ChatListBody`. Move tab/navigation logic to a dedicated `HomeScreen`.

---

### 🟠 H-03: Polling timers lack lifecycle guard

**Files:** [chat_list_screen.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/screens/chat_list_screen.dart), [chat_detail_screen.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/screens/chat_detail_screen.dart)

```dart
// chat_list_screen.dart
_updatesTimer = Timer.periodic(
  const Duration(seconds: 5),
  (_) => _pollUpdates(),
);
```

The timers fire even when the app is in the background. On mobile, this:
- Drains battery unnecessarily
- Wastes network data
- May trigger API rate limits

**Fix:** Use `WidgetsBindingObserver` to pause/resume polling when the app goes to background/foreground.

---

### 🟠 H-04: `_ensureAppColorsTheme` pattern is fragile

**File:** [chat_list_screen.dart](file:///c:/Users/Admin/MobileTelegramBot_clean/mobile/lib/screens/chat_list_screen.dart)

The codebase manually rebuilds `ThemeData` inside widgets to ensure `AppColors` extension is present:

```dart
ThemeData _ensureAppColorsTheme(ThemeData base) {
  if (base.extension<AppColors>() != null) return base;
  // ... rebuild entire ThemeData with extensions
}
```

This function is duplicated across multiple screens and creates a **new** `ThemeData` on every `build()` call, which is expensive.

**Fix:** Apply `AppColors` once at the `MaterialApp` level in `mobile_bot_app.dart`, then trust it to propagate down. Remove all `_ensureAppColorsTheme()` calls.

---

### 🟠 H-05: `_logButtonPress` wrapper swallows async errors

**Files:** Multiple screens

```dart
VoidCallback? _logButtonPress(String eventName, VoidCallback? callback) {
  if (callback == null) return null;
  return () {
    debugPrint('[Button] $eventName');
    callback();  // ← if callback is async, errors are fire-and-forget
  };
}
```

When `callback` is an `async` function (many are), any thrown exception becomes an unhandled `Future` error. The pattern `() => _toggleFavorite(chat)` returns a `Future<void>` that nobody awaits.

**Fix:** Add an async variant:
```dart
VoidCallback _logButtonPressAsync(String name, Future<void> Function() cb) {
  return () {
    debugPrint('[Button] $name');
    cb().catchError((e) => debugPrint('[Button] $name failed: $e'));
  };
}
```

---

## 5. Medium-Priority Issues

### 🟡 M-01: `models.dart` — 836-line monolith with business logic mixed in

All 15+ model classes live in one file, and several contain business logic that should be separate:

```dart
// In DashboardSummary
static DashboardSummary empty() { ... }  // Factory logic is fine

// In ChatSummary — formatting in domain model
String get updatedAtLabel => DateFormat('HH:mm').format(updatedAt.toLocal());
```

Also, `ChatSummary.updatedAtLabel` calls `DateFormat` every time it's accessed (no caching).

**Fix:** Split models into individual files. Move formatting helpers to a UI utilities layer.

---

### 🟡 M-02: `withOpacity()` anti-pattern

Used extensively throughout the codebase:

```dart
theme.colorScheme.surfaceVariant.withOpacity(0.35)
theme.colorScheme.outlineVariant.withOpacity(0.55)
```

`Color.withOpacity()` was deprecated in Flutter 3.27 in favor of `Color.withValues(alpha: ...)`. Even before deprecation, creating new `Color` objects on every `build()` is wasteful.

**Fix:** Replace with `Color.withValues(alpha: ...)` or define opacity colors as constants.

---

### 🟡 M-03: No state management solution — raw `setState` everywhere

The app relies entirely on `setState()` in `StatefulWidget` for all state management:
- Auth state → `_MobileBotModuleState`
- Chat list → `_ChatListScreenState`
- Dashboard → `_DashboardViewState`
- Admin panel → `_AdminUserManagementViewState`

State is passed via constructor parameters and callbacks (`onLogout`, `onProfileUpdated`, etc.), creating deep callback drilling.

**Fix:** Consider adopting Provider (already in `pubspec.yaml` but unused) or Riverpod for state management.

---

### 🟡 M-04: No `const` constructor optimizations in lists

Many widget trees rebuild identical subtrees on every `setState`:

```dart
const SizedBox(width: 8),   // ✅ Good — const
SizedBox(width: 8),         // ❌ Bad — allocates new widget each build
Icon(Icons.search),         // ❌ Missing const
```

**Fix:** Add `const` to all eligible constructors. Enable `prefer_const_constructors` lint.

---

### 🟡 M-05: `bottom_bar` — vendored 3rd-party code with issues

The `bottom_bar/` directory appears to be a vendored (copy-pasted) package. Issues:
- `build_icom.dart` — filename typo (should be `build_icon.dart`)
- `shadow.dart` uses a mutable global `isShadow` variable — not thread-safe
- `BottomBar` abstract class has `_BottomBarState` with underscore — effectively unusable by subclasses
- No attribution or license

**Fix:** Either use the original package via `pubspec.yaml` or rename/clean up the vendored code.

---

### 🟡 M-06: `operator_profile_view.dart` — 32 lines, mostly a stub

This file only declares the `OperatorProfileView` widget and a helper class `_QuestionSectionEntry`. The actual state and build method must be defined elsewhere (likely in a `part` file), making it hard to find the implementation.

---

### 🟡 M-07: Error messages hardcoded in Russian only

All error strings, labels, and validation messages are Russian-only:

```dart
throw const ApiException(
  'Превышено время ожидания ответа от сервера. Попробуйте снова.',
);
```

**Fix:** For i18n readiness, extract strings to a localization file (the `intl` package is already a dependency).

---

## 6. Low-Priority / Style Issues

### 🔵 L-01: `UiLogger` uses `debugPrint` — invisible in production

Logging with `debugPrint` is stripped in release builds. If production diagnostics are needed, consider `package:logging` or a crash reporting service (Sentry, Firebase Crashlytics).

---

### 🔵 L-02: Date formatting repeated inline

`DateFormat('dd.MM.yyyy HH:mm')` and `DateFormat('HH:mm')` are created inline in many places. Each call allocates a new `DateFormat` instance.

**Fix:** Define shared `DateFormat` constants in a utility file.

---

### 🔵 L-03: `analysis_options.yaml` — minimal lint config

```yaml
include: package:flutter_lints/flutter.yaml
```

This uses the basic set. Consider upgrading to `flutter_lints` v5+ or `very_good_analysis` for stricter rules (`prefer_const_constructors`, `avoid_dynamic_calls`, `unawaited_futures`, etc.).

---

### 🔵 L-04: No loading/error states for initial `DashboardView` load if error occurs

When `_loadSummary(initial: true)` fails, `_loading` becomes `false` and `_summary` is `null`, but the `build()` method proceeds to render with `DashboardSummary.empty()` instead of showing an error state. The error text is only shown inline inside the header card, which may not be obvious.

---

### 🔵 L-05: Orphaned `image_picker` / `image_cropper` dependencies

`pubspec.yaml` includes `image_picker` and `image_cropper`, but no file in `lib/` uses them. These add unnecessary native dependencies and increase APK/IPA size.

**Fix:** Remove unused dependencies.

---

## 7. Design Improvement Recommendations

### 7.1 — Convert `part`/`part of` to proper imports

**Impact: 🔥 Highest**

```
BEFORE: main.dart → part → all screens, models, widgets (single compilation unit)
AFTER:  main.dart → import → each screen, model, widget (independent units)
```

Steps:
1. Replace `part of '../main.dart'` with proper imports in each file
2. Add `export` declarations for shared types
3. Make helper functions like `_logButtonPress`, `showTopMessage` properly public or move to a utility file
4. Verify no private symbol leaks across files

---

### 7.2 — Extract `ApiClient` interface

```dart
// api/api_client_interface.dart
abstract class IApiClient {
  Future<AuthSession> login(String login, String password);
  Future<List<ChatSummary>> fetchChats({...});
  Future<DashboardSummary> fetchDashboardSummary({int? operatorId});
  // ... all current public methods
}

// api/api_client.dart
class ApiClient implements IApiClient { ... }

// api/mock_api_client.dart (for tests)
class MockApiClient implements IApiClient { ... }
```

---

### 7.3 — Break up god-widgets

| Current File | Proposed Extraction |
|---|---|
| `chat_list_screen.dart` (1505 lines) | `HomeScreen` (tabs/nav), `ChatListBody`, `ChatCard`, `ChatFilterSheet` |
| `admin_user_management_view.dart` (2806 lines) | `AdminUserList`, `UserCard`, `BinAssignmentSheet`, `SectionManagementSheet`, `PendingRegistrationsCard`, `UnassignedBinsCard` |
| `dashboard_view.dart` (953 lines) | `DashboardHeader`, `SectionBreakdownCard`, `QuestionsCard`, `AgentStatsCard`, `ActivityCard` |

---

### 7.4 — Add app lifecycle awareness

```dart
class _ChatListScreenState extends State<ChatListScreen>
    with WidgetsBindingObserver {

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _updatesTimer?.cancel();
    } else if (state == AppLifecycleState.resumed) {
      _startPolling();
    }
  }
}
```

---

### 7.5 — Persist sessions properly

```dart
class SessionStorage {
  static const _key = 'auth_session';

  Future<void> save(AuthSession session) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(session.toJson()));
  }

  Future<AuthSession?> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    return AuthSession.fromJson(jsonDecode(raw));
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
```

---

## 8. Summary Table

| ID | Severity | File(s) | Issue |
|---|---|---|---|
| C-01 | 🔴 Critical | `session_storage.dart` | Sessions in-memory only — lost on restart |
| C-02 | 🔴 Critical | `theme_manager.dart` / `theme_preferences.dart` | Dual conflicting theme systems |
| C-03 | 🔴 Critical | `chat_list_screen.dart` | Deprecated `onPopInvoked` API |
| C-04 | 🔴 Critical | `admin_user_management_view.dart` | 2806-line god-file |
| H-01 | 🟠 High | `api_client.dart` | No interface, untestable |
| H-02 | 🟠 High | `chat_list_screen.dart` | 1505-line god-file, mixed concerns |
| H-03 | 🟠 High | Multiple screens | Polling never pauses in background |
| H-04 | 🟠 High | Multiple screens | `_ensureAppColorsTheme` duplication |
| H-05 | 🟠 High | Multiple screens | `_logButtonPress` swallows async errors |
| M-01 | 🟡 Medium | `models.dart` | 836-line monolith, mixed concerns |
| M-02 | 🟡 Medium | Multiple | Deprecated `withOpacity()` |
| M-03 | 🟡 Medium | All screens | No state management, raw `setState` |
| M-04 | 🟡 Medium | All screens | Missing `const` constructors |
| M-05 | 🟡 Medium | `bottom_bar/` | Vendored code with typos/globals |
| M-06 | 🟡 Medium | `operator_profile_view.dart` | Stub file, implementation unclear |
| M-07 | 🟡 Medium | Multiple | All strings hardcoded in Russian |
| L-01 | 🔵 Low | `ui_logger.dart` | `debugPrint` — invisible in release |
| L-02 | 🔵 Low | Multiple screens | `DateFormat` created inline repeatedly |
| L-03 | 🔵 Low | `analysis_options.yaml` | Minimal lint configuration |
| L-04 | 🔵 Low | `dashboard_view.dart` | Error state falls through to empty data |
| L-05 | 🔵 Low | `pubspec.yaml` | Unused `image_picker`/`image_cropper` deps |

---

> **Recommended priority order:**  
> 1. Fix session persistence (C-01) — users lose auth on every restart  
> 2. Remove dead `ThemeManager` (C-02) — eliminates confusion  
> 3. Convert `part`/`part of` to imports (structural) — enables all other refactoring  
> 4. Extract `ApiClient` interface (H-01) — enables testing  
> 5. Break up god-files (C-04, H-02) — enables maintainability  
> 6. Add lifecycle observer for polling (H-03) — battery/data savings
