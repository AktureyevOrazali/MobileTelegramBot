import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'network_exceptions.dart';

class _BadgeColors {
  final Color background;
  final Color border;
  final Color foreground;

  const _BadgeColors({required this.background, required this.border, required this.foreground});
}

_BadgeColors _statusBadgeColors(ThemeData theme, {required bool isClosed}) {
  final isDark = theme.brightness == Brightness.dark;

  if (isClosed) {
    return _BadgeColors(
      background: isDark ? const Color(0xFF3A2226) : Colors.red.shade50,
      border: isDark ? const Color(0xFF6A2D35) : Colors.red.shade200,
      foreground: isDark ? const Color(0xFFFFB3C0) : Colors.red.shade700,
    );
  }

  return _BadgeColors(
    background: isDark ? const Color(0xFF1F3326) : Colors.green.shade50,
    border: isDark ? const Color(0xFF2F5D3A) : Colors.green.shade200,
    foreground: isDark ? const Color(0xFF9CE6B3) : Colors.green.shade700,
  );
}

_BadgeColors _aiBadgeColors(ThemeData theme, {required bool enabled}) {
  final isDark = theme.brightness == Brightness.dark;

  if (enabled) {
    return _BadgeColors(
      background: isDark ? const Color(0xFF1F2B46) : Colors.indigo.shade50,
      border: isDark ? const Color(0xFF304B7A) : Colors.indigo.shade200,
      foreground: isDark ? const Color(0xFFB8CCFF) : Colors.indigo.shade700,
    );
  }

  return _BadgeColors(
    background: isDark ? const Color(0xFF2A2C33) : Colors.grey.shade200,
    border: isDark ? const Color(0xFF3C4048) : Colors.grey.shade300,
    foreground: isDark ? const Color(0xFFB0B4BE) : Colors.grey.shade700,
  );
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  runApp(const MobileBotApp());
}

class MobileBotApp extends StatefulWidget {
  const MobileBotApp({super.key});

  @override
  State<MobileBotApp> createState() => _MobileBotAppState();
}

class _MobileBotAppState extends State<MobileBotApp> {
  late final ApiClient apiClient;
  final SessionStorage _sessionStorage = const SessionStorage();
  final ThemePreferences _themePreferences = const ThemePreferences();
  AuthSession? _session;
  bool _initializing = true;
  ThemeMode _themeMode = ThemeMode.system;

  String _requireConfig(String key) {
    final envValue = dotenv.env[key];
    if (envValue != null && envValue.trim().isNotEmpty) {
      return envValue.trim();
    }
    final compileTimeValue = String.fromEnvironment(key, defaultValue: '');
    if (compileTimeValue.isNotEmpty) {
      return compileTimeValue;
    }
    throw StateError('Отсутствует обязательная настройка "$key" в .env');
  }

  @override
  void initState() {
    super.initState();
    final apiBaseUrl = _requireConfig('API_BASE_URL');
    final apiToken = _requireConfig('API_TOKEN');
    apiClient = ApiClient(apiBaseUrl, apiToken);
    _restoreSession();
    _restoreThemeMode();
  }

  Future<void> _restoreSession() async {
    final restored = await _sessionStorage.restore();
    if (!mounted) {
      return;
    }
    if (restored != null) {
      apiClient.setSession(restored);
      setState(() {
        _session = restored;
        _initializing = false;
      });
    } else {
      setState(() {
        _initializing = false;
      });
    }
  }

  Future<void> _restoreThemeMode() async {
    final mode = await _themePreferences.load();
    if (!mounted) {
      return;
    }
    setState(() {
      _themeMode = mode;
    });
  }

  void _handleThemeModeChanged(ThemeMode mode) {
    setState(() {
      _themeMode = mode;
    });
    unawaited(_themePreferences.save(mode));
  }

  void _handleAuthenticated(AuthSession session) {
    apiClient.setSession(session);
    setState(() {
      _session = session;
    });
    unawaited(_sessionStorage.save(session));
  }

  void _handleLogout() {
    apiClient.clearSession();
    setState(() {
      _session = null;
    });
    unawaited(_sessionStorage.clear());
  }

  void _handleProfileUpdated(UserProfile profile) {
    apiClient.updateCurrentUser(profile);
    setState(() {
      if (_session != null) {
        _session = _session!.copyWith(user: profile);
      }
    });
    _persistCurrentSession();
  }

  void _handleSessionRefreshed(AuthSession session) {
    apiClient.setSession(session);
    setState(() {
      _session = session;
    });
    unawaited(_sessionStorage.save(session));
  }

  void _persistCurrentSession() {
    final session = _session;
    if (session != null) {
      unawaited(_sessionStorage.save(session));
    }
  }

  ThemeData _buildTheme(ColorScheme colorScheme) {
    final outlineBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.4)),
    );
    return ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
      scaffoldBackgroundColor: colorScheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        centerTitle: false,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.surfaceVariant.withOpacity(0.35),
        border: outlineBorder,
        enabledBorder: outlineBorder,
        focusedBorder: outlineBorder.copyWith(
          borderSide: BorderSide(color: colorScheme.primary, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colorScheme.inverseSurface,
        contentTextStyle: TextStyle(color: colorScheme.onInverseSurface),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: colorScheme.surface,
        indicatorColor: colorScheme.primaryContainer.withOpacity(0.6),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        labelTextStyle: MaterialStateProperty.all(
          TextStyle(color: colorScheme.onSurface, fontWeight: FontWeight.w600),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const seedColor = Color(0xFF3E5AA8);
    final lightTheme = _buildTheme(ColorScheme.fromSeed(
      seedColor: seedColor,
      brightness: Brightness.light,
    ));
    final darkTheme = _buildTheme(ColorScheme.fromSeed(
      seedColor: seedColor,
      brightness: Brightness.dark,
    ));

    final home = _session == null
        ? AuthScreen(
            apiClient: apiClient,
            onAuthenticated: _handleAuthenticated,
            themeMode: _themeMode,
            onThemeModeChanged: _handleThemeModeChanged,
          )
        : ChatListScreen(
            apiClient: apiClient,
            session: _session!,
            onLogout: _handleLogout,
            onProfileUpdated: _handleProfileUpdated,
            onSessionRefreshed: _handleSessionRefreshed,
            themeMode: _themeMode,
            onThemeModeChanged: _handleThemeModeChanged,
          );

    if (_initializing) {
      return MaterialApp(
        title: 'MobileBot Companion',
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: _themeMode,
        home: const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    return MaterialApp(
      title: 'MobileBot Companion',
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: _themeMode,
      home: home,
    );
  }
}

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

void showTopMessage(
  BuildContext context,
  String message, {
  bool isError = false,
  IconData? icon,
}) {
  final messenger = ScaffoldMessenger.of(context);
  final theme = Theme.of(context);
  messenger.clearSnackBars();
  messenger.clearMaterialBanners();
  final bannerColor = isError
      ? theme.colorScheme.errorContainer
      : theme.colorScheme.primaryContainer;
  final bannerTextColor = isError
      ? theme.colorScheme.onErrorContainer
      : theme.colorScheme.onPrimaryContainer;
  final banner = MaterialBanner(
    backgroundColor: bannerColor,
    content: Text(
      message,
      style: TextStyle(color: bannerTextColor),
    ),
    leading: Icon(
      icon ?? (isError ? Icons.error_outline : Icons.info_outline),
      color: bannerTextColor,
    ),
    actions: [
      TextButton(
        style: TextButton.styleFrom(foregroundColor: bannerTextColor),
        onPressed: () => messenger.hideCurrentMaterialBanner(),
        child: const Text('Закрыть'),
      ),
    ],
  );
  messenger.showMaterialBanner(banner);
  Future<void>.delayed(const Duration(seconds: 4)).then((_) {
    if (messenger.mounted) {
      messenger.hideCurrentMaterialBanner();
    }
  });
}

class ApiClient {
  ApiClient(String baseUrl, String apiToken)
      : baseUrl = baseUrl.trim(),
        apiToken = apiToken.trim() {
    if (this.baseUrl.isEmpty) {
      throw ArgumentError('API base URL обязателен');
    }
    if (this.apiToken.isEmpty) {
      throw ArgumentError('API токен обязателен');
    }
  }

  final String baseUrl;
  final String apiToken;
  String? _sessionToken;
  UserProfile? _currentUser;
  final Set<int> _favoriteDialogIds = <int>{};

  Uri _buildUri(String path, [Map<String, dynamic>? queryParameters]) {
    final normalizedBase = baseUrl.endsWith('/') ? baseUrl : '$baseUrl/';
    final normalizedPath = path.startsWith('/') ? path.substring(1) : path;
    final resolved = Uri.parse(normalizedBase).resolve(normalizedPath);
    if (queryParameters == null || queryParameters.isEmpty) {
      return resolved;
    }
    final stringParams = queryParameters.map(
      (key, value) => MapEntry(key, value.toString()),
    );
    return resolved.replace(
      queryParameters: {
        ...resolved.queryParameters,
        ...stringParams,
      },
    );
  }

  void setSession(AuthSession session) {
    _sessionToken = session.token;
    updateCurrentUser(session.user);
    _favoriteDialogIds
      ..clear()
      ..addAll(session.user.favoriteDialogIds);
  }

  void clearSession() {
    _sessionToken = null;
    _currentUser = null;
    _favoriteDialogIds.clear();
  }

  UserProfile? get currentUser => _currentUser;

  AuthSession? get currentSession =>
      _sessionToken != null && _currentUser != null
          ? AuthSession(token: _sessionToken!, user: _currentUser!)
          : null;

  void updateCurrentUser(UserProfile profile) {
    _currentUser = profile;
    _favoriteDialogIds
      ..clear()
      ..addAll(profile.favoriteDialogIds);
  }

  Set<int> get favoriteDialogIds => _favoriteDialogIds;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json; charset=utf-8',
        if (apiToken.isNotEmpty) 'X-Api-Token': apiToken,
        if (_sessionToken != null) 'X-Session-Token': _sessionToken!,
      };

  Future<AuthSession> register(String name, String email, String password) async {
    final uri = _buildUri('auth/register');
    final response = await _sendRequest(
      () => http.post(
        uri,
        headers: _headers,
        body: jsonEncode({'name': name, 'email': email, 'password': password}),
      ),
      'Не удалось завершить регистрацию.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final session = AuthSession.fromJson(decoded);
    setSession(session);
    return session;
  }

  Future<AuthSession> login(String identifier, String password) async {
    final uri = _buildUri('auth/login');
    final response = await _sendRequest(
      () => http.post(
        uri,
        headers: _headers,
        body: jsonEncode({'identifier': identifier, 'password': password}),
      ),
      'Не удалось выполнить вход. Проверьте логин и пароль.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final session = AuthSession.fromJson(decoded);
    setSession(session);
    return session;
  }

  Future<List<Section>> fetchSections() async {
    final uri = _buildUri('sections');
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить список разделов.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => Section.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<String>> fetchBins({String? query}) async {
    final queryParams = (query != null && query.trim().isNotEmpty)
        ? <String, dynamic>{'query': query.trim()}
        : null;
    final uri = _buildUri('bins', queryParams);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить список БИНов.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded.map((item) => item.toString()).toList();
  }

  Future<List<UnassignedBin>> fetchUnassignedBins() async {
    List<UnassignedBin> parseResponse(http.Response response) {
      final decoded = jsonDecode(response.body) as List<dynamic>;
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(UnassignedBin.fromJson)
          .toList();
    }

    final primaryUri = _buildUri('bins/unassigned');
    try {
      final response = await _sendRequest(
        () => http.get(primaryUri, headers: _headers),
        'Не удалось загрузить список неразделенных БИНов.',
      );
      return parseResponse(response);
    } on ApiException catch (error) {
      final legacyUri = _buildUri('bins/pending');
      try {
        final fallback = await _sendRequest(
          () => http.get(legacyUri, headers: _headers),
          'Не удалось загрузить список неразделенных БИНов.',
        );
        return parseResponse(fallback);
      } catch (_) {
        throw error;
      }
    }
  }

  Future<UserProfile> fetchProfile() async {
    final uri = _buildUri('profile');
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить профиль пользователя.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final profile = UserProfile.fromJson(decoded);
    updateCurrentUser(profile);
    return profile;
  }

  Future<UserProfile> updateProfile({
    required String name,
    String jobTitle = '',
    String phone = '',
    String bio = '',
  }) async {
    final uri = _buildUri('profile');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({
          'name': name,
          'job_title': jobTitle,
          'phone': phone,
          'bio': bio,
        }),
      ),
      'Не удалось обновить профиль.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final profile = UserProfile.fromJson(decoded);
    updateCurrentUser(profile);
    return profile;
  }

  Future<AuthSession> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final uri = _buildUri('profile/password');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({
          'current_password': currentPassword,
          'new_password': newPassword,
        }),
      ),
      'Не удалось обновить пароль.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final session = AuthSession.fromJson(decoded);
    setSession(session);
    return session;
  }

  Future<List<ChatSummary>> fetchChats({bool favoritesOnly = false, String? binQuery}) async {
    final query = <String, dynamic>{};
    if (favoritesOnly) {
      query['favorite_only'] = true;
    }
    if (binQuery != null && binQuery.isNotEmpty) {
      query['bin_query'] = binQuery;
    }
    final uri = _buildUri('chats', query.isNotEmpty ? query : null);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить список диалогов.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => ChatSummary.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<ChatSummary?> fetchChatByDialogId(int dialogId) async {
    final chats = await fetchChats();
    for (final chat in chats) {
      if (chat.dialogId == dialogId) {
        return chat;
      }
    }
    return null;
  }

  Future<List<Message>> fetchMessages(int chatId, {int? dialogId}) async {
    final params = <String, dynamic>{'limit': 100};
    if (dialogId != null && dialogId > 0) {
      params['dialog_id'] = dialogId;
    }
    final uri = _buildUri('chats/$chatId/messages', params);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить сообщения.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => Message.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> sendMessage(int chatId, String text, {int? dialogId}) async {
    final uri = _buildUri('messages/send');
    final payload = <String, dynamic>{'chat_id': chatId, 'text': text};
    if (dialogId != null && dialogId > 0) {
      payload['dialog_id'] = dialogId;
    }
    final body = jsonEncode(payload);
    await _sendRequest(
      () => http.post(uri, headers: _headers, body: body),
      'Не удалось отправить сообщение.',
    );
  }

  Future<void> setFavoriteDialog(int dialogId, bool favorite) async {
    final uri = _buildUri('dialogs/$dialogId/favorite');
    await _sendRequest(
      () => favorite
          ? http.post(uri, headers: _headers)
          : http.delete(uri, headers: _headers),
      'Не удалось обновить избранное.',
    );
    if (_currentUser != null) {
      final updatedFavorites = Set<int>.from(_currentUser!.favoriteDialogIds);
      if (favorite) {
        updatedFavorites.add(dialogId);
      } else {
        updatedFavorites.remove(dialogId);
      }
      _currentUser = _currentUser!.copyWith(favoriteDialogIds: updatedFavorites);
      _favoriteDialogIds
        ..clear()
        ..addAll(updatedFavorites);
    }
  }

  Future<void> enableDialogAI(int dialogId) async {
    final uri = _buildUri('dialogs/$dialogId/ai/enable');
    await _sendRequest(
      () => http.post(uri, headers: _headers),
      'Не удалось включить AI.',
    );
  }

  Future<void> disableDialogAI(int dialogId) async {
    final uri = _buildUri('dialogs/$dialogId/ai/disable');
    await _sendRequest(
      () => http.post(uri, headers: _headers),
      'Не удалось отключить AI.',
    );
  }

  Future<DialogStatusUpdate> closeDialog(int dialogId) async {
    final uri = _buildUri('dialogs/$dialogId/close');
    final response = await _sendRequest(
      () => http.post(uri, headers: _headers),
      'Не удалось закрыть диалог.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return DialogStatusUpdate.fromJson(decoded);
  }

  Future<DialogStatusUpdate> openDialog(int dialogId) async {
    final uri = _buildUri('dialogs/$dialogId/open');
    final response = await _sendRequest(
      () => http.post(uri, headers: _headers),
      'Не удалось открыть диалог.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return DialogStatusUpdate.fromJson(decoded);
  }

  Future<void> deleteChat(int chatId) async {
    final uri = _buildUri('chats/$chatId');
    await _sendRequest(
      () => http.delete(uri, headers: _headers),
      'Не удалось удалить диалог.',
    );
    if (_currentUser != null) {
       final updatedFavorites = Set<int>.from(_favoriteDialogIds);
      _favoriteDialogIds
        ..clear()
        ..addAll(updatedFavorites);
      _currentUser = _currentUser!.copyWith(favoriteDialogIds: updatedFavorites);
    }
  }

  Future<List<UserProfile>> fetchUsers({String? query}) async {
    final queryParams = (query != null && query.trim().isNotEmpty)
        ? <String, dynamic>{'query': query.trim()}
        : null;
    final uri = _buildUri('users', queryParams);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить список пользователей.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => UserProfile.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<RoleInfo>> fetchRoles() async {
    final uri = _buildUri('roles');
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить список ролей.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => RoleInfo.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<UserProfile> updateUserRole(int userId, String role) async {
    final uri = _buildUri('users/$userId/role');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({'role': role}),
      ),
      'Не удалось обновить роль пользователя.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    final profile = UserProfile.fromJson(decoded);
    if (_currentUser != null && _currentUser!.id == profile.id) {
      updateCurrentUser(profile);
    }
    return profile;
  }

  Future<UserProfile> updateUserSections(int userId, List<String> sections) async {
    final uri = _buildUri('users/$userId/sections');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({'sections': sections}),
      ),
      'Не удалось обновить назначенные разделы.',
    );
    return UserProfile.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<UserProfile> updateUserBins(int userId, List<UserBinAssignment> assignments) async {
    final uri = _buildUri('users/$userId/bins');
    final payload = assignments.map((assignment) => assignment.toUpdatePayload()).toList();
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({'bins': payload}),
      ),
      'Не удалось обновить назначенные БИНы.',
    );
    return UserProfile.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<UserProfile> adminSetUserPassword(int userId, String newPassword) async {
    final uri = _buildUri('users/$userId/password');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({'new_password': newPassword}),
      ),
      'Не удалось обновить пароль пользователя.',
    );
    return UserProfile.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<void> deleteUser(int userId) async {
    final uri = _buildUri('users/$userId');
    await _sendRequest(
      () => http.delete(uri, headers: _headers),
      'Не удалось удалить пользователя.',
    );
  }

  Future<List<MessageNotification>> fetchUpdates(DateTime? since) async {
    final query = since != null
        ? <String, dynamic>{
            'since': since
                .toUtc()
                .toIso8601String()
                .replaceFirst('Z', '+00:00'),
          }
        : null;
    final uri = _buildUri('updates', query);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось получить обновления.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    final notifications = <MessageNotification>[];
    for (final item in decoded) {
      if (item is! Map<String, dynamic>) {
        continue;
      }
      final notification = MessageNotification.tryParse(item);
      if (notification != null) {
        notifications.add(notification);
      } else {
        final truncated = item.toString();
        final printable =
            truncated.length > 200 ? '${truncated.substring(0, 200)}…' : truncated;
        debugPrint('Пропущено некорректное обновление: $printable');
      }
    }
    return notifications;
  }

  Future<DashboardSummary> fetchDashboardSummary({int? operatorId}) async {
    final query = operatorId != null ? <String, dynamic>{'operator_id': operatorId} : null;
    final uri = _buildUri('analytics/dashboard', query);
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить дэшборд.',
    );
    final decoded = jsonDecode(response.body) as Map<String, dynamic>;
    return DashboardSummary.fromJson(decoded);
  }

  Future<http.Response> _sendRequest(
    Future<http.Response> Function() request,
    String fallbackMessage,
  ) async {
    try {
      final response = await request();
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return response;
      }
      final message = _extractErrorMessage(response) ?? fallbackMessage;
      throw ApiException(message);
    } on TimeoutException {
      throw const ApiException(
        'Превышено время ожидания ответа от сервера. Попробуйте снова.',
      );
    } on http.ClientException catch (error) {
      final message = error.message.isNotEmpty
          ? 'Сетевая ошибка: ${error.message}'
          : fallbackMessage;
      throw ApiException(message);
      } catch (error) {
      if (error is ApiException) {
        rethrow;
      }
      if (isNetworkException(error)) {
        throw const ApiException(
          'Не удалось подключиться к серверу. Проверьте интернет-соединение и адрес API.',
        );
      }
      throw ApiException(fallbackMessage);
    }
  }

  String? _extractErrorMessage(http.Response response) {
    final body = response.body.trim();
    if (body.isEmpty) {
      return null;
    }
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        final detail = decoded['detail'] ?? decoded['message'] ?? decoded['error'];
        final message = _normalizeDetail(detail);
        if (message != null && message.isNotEmpty) {
          return message;
        }
      } else if (decoded is List) {
        final messages = decoded
            .map((item) => _normalizeDetail(item))
            .whereType<String>()
            .toList();
        if (messages.isNotEmpty) {
          return messages.join('\n');
        }
      }
    } catch (_) {
      if (body.isNotEmpty && !body.startsWith('<')) {
        return body;
      }
    }
    if (body.isNotEmpty && !body.startsWith('<')) {
      return body;
    }
    return null;
  }

  String? _normalizeDetail(dynamic detail) {
    if (detail == null) {
      return null;
    }
    if (detail is String) {
      switch (detail) {
        case 'Invalid API token':
          return 'Неверный API токен. Проверьте настройку бэкенда.';
        case 'Invalid credentials':
          return 'Неверный логин или пароль.';
        case 'User already exists':
          return 'Пользователь с таким e-mail уже зарегистрирован.';
        case 'Administrator role required':
          return 'Недостаточно прав: требуется роль администратора.';
        case 'Session token required':
          return 'Не удалось определить сессию. Выполните вход заново.';
        case 'Invalid session token':
          return 'Сессия истекла. Выполните вход ещё раз.';
      }
      return detail;
    }
    if (detail is List) {
      final messages = detail
          .map((item) => _normalizeDetail(item))
          .whereType<String>()
          .toList();
      if (messages.isNotEmpty) {
        return messages.join('\n');
      }
      return null;
    }
    if (detail is Map<String, dynamic>) {
      final type = detail['type'] as String?;
      final message = detail['message'] ?? detail['msg'];
      final ctx = detail['ctx'];
      final loc = detail['loc'];
      final field = _friendlyFieldName(
        loc is List && loc.isNotEmpty ? loc.last.toString() : '',
      );
      if (type == 'value_error.any_str.min_length') {
        final limit = ctx is Map<String, dynamic> ? ctx['limit_value'] : null;
        if (limit != null) {
          return '$field должно содержать не менее $limit символов.';
        }
      }
      if (type == 'value_error.any_str.max_length') {
        final limit = ctx is Map<String, dynamic> ? ctx['limit_value'] : null;
        if (limit != null) {
          return '$field должно содержать не более $limit символов.';
        }
      }
      if (type == 'value_error.missing') {
        return 'Заполните поле $field.';
      }
      if (type == 'value_error.email') {
        return 'Введите корректный e-mail.';
      }
      if (type == 'type_error.integer') {
        return '$field должно быть числом.';
      }
      if (type == 'type_error.string') {
        return '$field должно быть строкой.';
      }
      if (message is String && message.isNotEmpty) {
        return message;
      }
    }
    return detail.toString();
  }

  String _friendlyFieldName(String raw) {
    switch (raw) {
      case 'name':
        return '«Имя»';
      case 'email':
        return '«E-mail»';
      case 'password':
        return '«Пароль»';
      case 'identifier':
        return '«Логин или e-mail»';
      case 'job_title':
        return '«Должность»';
      case 'phone':
        return '«Телефон»';
      case 'bio':
        return '«Описание»';
      case 'chat_id':
        return '«Чат»';
      case 'text':
        return '«Сообщение»';
      case 'role':
        return '«Роль»';
      case 'sections':
        return '«Разделы»';
      case 'bins':
        return '«БИНы»';
      default:
        if (raw.isEmpty) {
          return 'поле';
        }
        return '«${raw.replaceAll('_', ' ')}»';
    }
  }
}

class SessionStorage {
  const SessionStorage();

  static AuthSession? _cachedSession;

  Future<void> save(AuthSession session) async {
    _cachedSession = session;
  }

  Future<AuthSession?> restore() async {
    return _cachedSession;
  }

  Future<void> clear() async {
    _cachedSession = null;
  }
}

class ThemePreferences {
  const ThemePreferences();

  static const _storageKey = 'theme_mode';

  Future<ThemeMode> load() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_storageKey);
    if (stored == 'dark') {
      return ThemeMode.dark;
    }
    if (stored == 'light') {
      return ThemeMode.light;
    }
    return ThemeMode.system;
  }

  Future<void> save(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    switch (mode) {
      case ThemeMode.dark:
        await prefs.setString(_storageKey, 'dark');
        break;
      case ThemeMode.light:
        await prefs.setString(_storageKey, 'light');
        break;
      case ThemeMode.system:
        await prefs.remove(_storageKey);
        break;
    }
  }
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    required this.apiClient,
    required this.onAuthenticated,
    required this.themeMode,
    required this.onThemeModeChanged,
    super.key,
  });

  final ApiClient apiClient;
  final void Function(AuthSession session) onAuthenticated;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isLogin = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      AuthSession session;
      if (_isLogin) {
        session = await widget.apiClient.login(_emailController.text.trim(), _passwordController.text);
      } else {
        session = await widget.apiClient.register(
          _nameController.text.trim(),
          _emailController.text.trim(),
          _passwordController.text,
        );
      }
      widget.onAuthenticated(session);
    } catch (error) {
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final platformBrightness = MediaQuery.of(context).platformBrightness;
    final isDarkModeActive = widget.themeMode == ThemeMode.dark ||
        (widget.themeMode == ThemeMode.system && platformBrightness == Brightness.dark);
    final themeToggleIcon = isDarkModeActive ? Icons.light_mode : Icons.dark_mode;
    final themeToggleTooltip = isDarkModeActive ? 'Светлый режим' : 'Тёмный режим';
    final nextThemeMode = isDarkModeActive ? ThemeMode.light : ThemeMode.dark;
    final title = _isLogin ? 'Добро пожаловать' : 'Создание аккаунта';
    final description = _isLogin
        ? 'Введите логин или e-mail и пароль, чтобы продолжить работу.'
        : 'Заполните форму, чтобы подключиться. Пароль должен содержать минимум 5 символов.';

    return Scaffold(
      floatingActionButton: FloatingActionButton.small(
        heroTag: 'auth-theme-toggle',
        onPressed: () => widget.onThemeModeChanged(nextThemeMode),
        tooltip: themeToggleTooltip,
        child: Icon(themeToggleIcon),
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              theme.colorScheme.primaryContainer.withOpacity(0.4),
              theme.colorScheme.surface,
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final availableHeight = constraints.maxHeight.isFinite ? constraints.maxHeight : 0.0;
              final effectiveMinHeight = availableHeight > 48 ? availableHeight - 48 : 0.0;
              return SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: effectiveMinHeight),
                  child: Align(
                    alignment: Alignment.center,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Form(
                            key: _formKey,
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  title,
                                  style: theme.textTheme.headlineMedium?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: theme.colorScheme.onSurface,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  description,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(height: 24),
                                if (!_isLogin)
                                  TextFormField(
                                    controller: _nameController,
                                    decoration: const InputDecoration(labelText: 'Имя и фамилия'),
                                    textCapitalization: TextCapitalization.words,
                                    textInputAction: TextInputAction.next,
                                    validator: (value) {
                                      final trimmed = value?.trim() ?? '';
                                      if (trimmed.runes.length < 2) {
                                        return 'Имя должно содержать минимум 2 символа.';
                                      }
                                      return null;
                                    },
                                  ),
                                if (!_isLogin) const SizedBox(height: 16),
                                TextFormField(
                                  controller: _emailController,
                                  decoration: InputDecoration(
                                    labelText: _isLogin ? 'Логин или e-mail' : 'Рабочий e-mail',
                                  ),
                                  keyboardType:
                                      _isLogin ? TextInputType.text : TextInputType.emailAddress,
                                  textInputAction: TextInputAction.next,
                                  validator: (value) {
                                    final trimmed = value?.trim() ?? '';
                                    if (_isLogin) {
                                      if (trimmed.isEmpty) {
                                        return 'Введите логин или e-mail.';
                                      }
                                      return null;
                                    }
                                    if (trimmed.isEmpty || !trimmed.contains('@')) {
                                      return 'Укажите корректный e-mail.';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                TextFormField(
                                  controller: _passwordController,
                                  decoration: const InputDecoration(labelText: 'Пароль'),
                                  obscureText: true,
                                  textInputAction: TextInputAction.done,
                                  onFieldSubmitted: (_) => _loading ? null : _submit(),
                                  validator: (value) {
                                    if (value == null || value.trim().length < 5) {
                                      return 'Пароль должен содержать минимум 5 символов.';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                AnimatedSwitcher(
                                  duration: const Duration(milliseconds: 250),
                                  child: _error == null
                                      ? const SizedBox.shrink()
                                      : Container(
                                          key: ValueKey<String?>(_error),
                                          padding: const EdgeInsets.all(12),
                                          decoration: BoxDecoration(
                                            color: theme.colorScheme.errorContainer,
                                            borderRadius: BorderRadius.circular(12),
                                          ),
                                          child: Text(
                                            _error!,
                                            style: TextStyle(
                                              color: theme.colorScheme.onErrorContainer,
                                            ),
                                          ),
                                        ),
                                ),
                                const SizedBox(height: 24),
                                FilledButton.icon(
                                  onPressed: _loading ? null : _submit,
                                  icon: _loading
                                      ? SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor: AlwaysStoppedAnimation<Color>(
                                              theme.colorScheme.onPrimary,
                                            ),
                                          ),
                                        )
                                      : Icon(_isLogin ? Icons.login : Icons.person_add_alt_1),
                                  label: Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 2),
                                    child:
                                        Text(_isLogin ? 'Войти' : 'Зарегистрироваться'),
                                  ),
                                  style: FilledButton.styleFrom(
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                  ),
                                ),
                                const SizedBox(height: 12),
                                TextButton(
                                  onPressed: _loading
                                      ? null
                                      : () {
                                          setState(() {
                                            _isLogin = !_isLogin;
                                            _error = null;
                                          });
                                        },
                                  child: Text(
                                    _isLogin
                                        ? 'Создать новый аккаунт'
                                        : 'У меня уже есть аккаунт',
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({
    required this.apiClient,
    required this.session,
    required this.onLogout,
    required this.onProfileUpdated,
    required this.onSessionRefreshed,
    required this.themeMode,
    required this.onThemeModeChanged,
    super.key,
  });

  final ApiClient apiClient;
  final AuthSession session;
  final VoidCallback onLogout;
  final ValueChanged<UserProfile> onProfileUpdated;
  final ValueChanged<AuthSession> onSessionRefreshed;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

enum ChatSortOrder { newest, oldest }

enum DialogStatusFilter { all, open, closed }

class _ChatFiltersResult {
  _ChatFiltersResult({
    required this.section,
    required this.bin,
    required this.favoritesOnly,
    required this.sortOrder,
    required this.statusFilter,
  });

  final String? section;
  final String? bin;
  final bool favoritesOnly;
  final ChatSortOrder sortOrder;
  final DialogStatusFilter statusFilter;
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<ChatSummary> _allChats = [];
  List<Section> _sections = [];
  List<String> _availableBins = [];
  String? _selectedSection;
  String? _selectedBin;
  bool _loading = true;
  String? _error;
  int _tabIndex = 0;
  bool _showFavoritesOnly = false;
  ChatSortOrder _sortOrder = ChatSortOrder.newest;
  DialogStatusFilter _statusFilter = DialogStatusFilter.all;
  int? _aiTogglingDialogId;
  int? _statusUpdatingDialogId;
  Timer? _updatesTimer;
  DateTime? _lastUpdateCursor;
  final GlobalKey<_OperatorProfileViewState> _profileKey = GlobalKey<_OperatorProfileViewState>();
  final GlobalKey<_AdminUserManagementViewState> _adminKey = GlobalKey<_AdminUserManagementViewState>();
  final GlobalKey<_DashboardViewState> _dashboardKey = GlobalKey<_DashboardViewState>();

  @override
  void initState() {
    super.initState();
    _loadData();
    _loadAvailableBins();
    _updatesTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pollUpdates());
  }

  @override
  void dispose() {
    _updatesTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() {
        _error = null;
      });
    }
    try {
      final sections = await widget.apiClient.fetchSections();
      final chats = await widget.apiClient.fetchChats(
        favoritesOnly: _showFavoritesOnly,
        binQuery: _selectedBin,
      );
      final currentUser = widget.apiClient.currentUser ?? widget.session.user;
      final visibleSections = currentUser.isAdmin
          ? sections
          : sections.where((section) => currentUser.sections.contains(section.id)).toList();
      setState(() {
        _sections = visibleSections;
        _allChats = chats;
        _loading = false;
        if (_selectedSection != null &&
            !_sections.any((section) => section.id == _selectedSection)) {
          _selectedSection = null;
        }
      });
      _lastUpdateCursor ??= DateTime.now().toUtc();
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadAvailableBins() async {
    try {
      final bins = await widget.apiClient.fetchBins();
      if (!mounted) return;
      setState(() {
        _availableBins = bins;
      });
    } catch (error) {
      debugPrint('Не удалось загрузить БИНы: $error');
    }
  }

  void _showUpdateBanner(String message) {
    showTopMessage(
      context,
      message,
      icon: Icons.notifications_active_outlined,
    );
  }

  Future<void> _pollUpdates() async {
    try {
      if (_lastUpdateCursor == null) {
        _lastUpdateCursor = DateTime.now().toUtc();
        return;
      }
      final updates = await widget.apiClient.fetchUpdates(_lastUpdateCursor);
      if (updates.isEmpty) {
        return;
      }
      _lastUpdateCursor = updates.last.createdAt.toUtc();
      if (!mounted) {
        return;
      }
      await _loadData(showLoading: false);
      if (!mounted) {
        return;
      }
      final message = updates.length == 1
          ? 'Новое сообщение: ${updates.first.chatTitle}'
          : 'Новых сообщений: ${updates.length}';
      _showUpdateBanner(message);
    } catch (error) {
      debugPrint('Не удалось получить обновления: $error');
    }
  }

  Future<void> _toggleFavorite(ChatSummary chat) async {
    final newValue = !chat.isFavorite;
    setState(() {
      _allChats = _allChats
          .map((item) => item.dialogId == chat.dialogId
              ? item.copyWith(isFavorite: newValue)
              : item)
          .toList();
    });
    try {
      await widget.apiClient.setFavoriteDialog(chat.dialogId, newValue);
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        newValue
            ? 'Диалог добавлен в избранное'
            : 'Диалог удалён из избранного',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _allChats = _allChats
            .map((item) => item.dialogId == chat.dialogId
                ? item.copyWith(isFavorite: !newValue)
                : item)
            .toList();
      });
      showTopMessage(
        context,
        'Не удалось обновить избранное: $error',
        isError: true,
      );
    }
  }

  void _applyDialogStatusUpdate(DialogStatusUpdate update) {
    setState(() {
      _allChats = _allChats
          .map(
            (item) => item.dialogId == update.dialogId
                ? item.copyWith(
                    dialogClosedAt: update.dialogClosedAt,
                    aiEnabled: update.aiEnabled,
                  )
                : item,
          )
          .toList();
    });
  }

  void _updateChatAiStatus(int dialogId, bool aiEnabled) {
    setState(() {
      _allChats = _allChats
          .map(
            (item) =>
                item.dialogId == dialogId ? item.copyWith(aiEnabled: aiEnabled) : item,
          )
          .toList();
    });
  }

  Future<void> _refreshChatFromServer(int dialogId) async {
    try {
      final refreshed = await widget.apiClient.fetchChatByDialogId(dialogId);
      if (!mounted || refreshed == null) {
        return;
      }
      setState(() {
        _allChats = _allChats
            .map((item) => item.dialogId == refreshed.dialogId ? refreshed : item)
            .toList();
      });
    } catch (_) {
      // тихо игнорируем: отображаем локальное состояние, а ошибки покажут ручные действия
    }
  }

  Future<void> _toggleAi(ChatSummary chat) async {
    setState(() {
      _aiTogglingDialogId = chat.dialogId;
    });
    try {
      if (chat.aiEnabled) {
        await widget.apiClient.disableDialogAI(chat.dialogId);
        _updateChatAiStatus(chat.dialogId, false);
        showTopMessage(
          context,
          'AI помощник отключён. Клиенту отправлено уведомление.',
        );
      } else {
        await widget.apiClient.enableDialogAI(chat.dialogId);
        _updateChatAiStatus(chat.dialogId, true);
        showTopMessage(
          context,
          'AI помощник включён для этого диалога.',
        );
      }
      await _refreshChatFromServer(chat.dialogId);
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить режим AI: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _aiTogglingDialogId = null;
        });
      }
    }
  }

  Future<void> _toggleDialogStatus(ChatSummary chat) async {
    setState(() {
      _statusUpdatingDialogId = chat.dialogId;
    });
    try {
      final wasClosed = chat.isClosed;
      final result = wasClosed
          ? await widget.apiClient.openDialog(chat.dialogId)
          : await widget.apiClient.closeDialog(chat.dialogId);
      _applyDialogStatusUpdate(result);
      if (!mounted) {
        return;
      }
      await _refreshChatFromServer(chat.dialogId);
      showTopMessage(
        context,
        wasClosed
            ? 'Диалог открыт снова и готов к сообщениям.'
            : 'Диалог закрыт. Клиент уведомлён и AI снова включён.',
      );
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить статус диалога: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _statusUpdatingDialogId = null;
        });
      }
    }
  }

  Future<void> _confirmDeleteChat(ChatSummary chat) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить диалог?'),
          content: Text('Переписка с "${chat.title}" будет удалена без возможности восстановления.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      return;
    }
    try {
      await widget.apiClient.deleteChat(chat.chatId);
      if (!mounted) {
        return;
      }
      setState(() {
        _allChats = _allChats.where((item) => item.chatId != chat.chatId).toList();
      });
      showTopMessage(
        context,
        'Диалог "${chat.title}" удалён.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Не удалось удалить диалог: $error',
        isError: true,
      );
    }
  }

  List<ChatSummary> get _filteredChats {
    Iterable<ChatSummary> result = _allChats;
    if (_selectedSection != null && _selectedSection!.isNotEmpty) {
      result = result.where((chat) => chat.section == _selectedSection);
    }
    if (_showFavoritesOnly) {
      result = result.where((chat) => chat.isFavorite);
    }
    if (_statusFilter == DialogStatusFilter.open) {
      result = result.where((chat) => !chat.isClosed);
    } else if (_statusFilter == DialogStatusFilter.closed) {
      result = result.where((chat) => chat.isClosed);
    }
    final sorted = result.toList()
      ..sort((a, b) {
        final diff = a.updatedAt.compareTo(b.updatedAt);
        return _sortOrder == ChatSortOrder.newest ? -diff : diff;
      });
    return sorted;
  }

  Future<void> _showFiltersSheet() async {
    final result = await showModalBottomSheet<_ChatFiltersResult>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        String? section = _selectedSection;
        String? bin = _selectedBin;
        bool favorites = _showFavoritesOnly;
        ChatSortOrder sort = _sortOrder;
        DialogStatusFilter status = _statusFilter;
        return StatefulBuilder(
          builder: (context, setModalState) {
            final bottomInset = MediaQuery.of(context).viewInsets.bottom;
            final theme = Theme.of(context);
            return Padding(
              padding: EdgeInsets.only(bottom: bottomInset),
              child: SafeArea(
                top: false,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 36,
                          height: 4,
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.outlineVariant,
                            borderRadius: BorderRadius.circular(100),
                          ),
                        ),
                      ),
                      Text(
                        'Фильтры диалогов',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String?>(
                        value: section,
                        decoration: const InputDecoration(labelText: 'Раздел'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Все разделы'),
                          ),
                          ..._sections.map(
                            (item) => DropdownMenuItem<String?>(
                              value: item.id,
                              child: Text(item.title),
                            ),
                          ),
                        ],
                        onChanged: (value) => setModalState(() => section = value),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        value: bin,
                        decoration: const InputDecoration(labelText: 'БИН'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Все БИНы'),
                          ),
                          ..._availableBins.map(
                            (item) => DropdownMenuItem<String?>(
                              value: item,
                              child: Text(item),
                            ),
                          ),
                        ],
                        onChanged: (value) => setModalState(() => bin = value),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<DialogStatusFilter>(
                        value: status,
                        decoration: const InputDecoration(labelText: 'Статус диалога'),
                        items: const [
                          DropdownMenuItem(
                            value: DialogStatusFilter.all,
                            child: Text('Все диалоги'),
                          ),
                          DropdownMenuItem(
                            value: DialogStatusFilter.open,
                            child: Text('Только открытые'),
                          ),
                          DropdownMenuItem(
                            value: DialogStatusFilter.closed,
                            child: Text('Только закрытые'),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) {
                            return;
                          }
                          setModalState(() => status = value);
                        },
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<ChatSortOrder>(
                        value: sort,
                        decoration: const InputDecoration(labelText: 'Сортировка по времени'),
                        items: const [
                          DropdownMenuItem(
                            value: ChatSortOrder.newest,
                            child: Text('Сначала новые'),
                          ),
                          DropdownMenuItem(
                            value: ChatSortOrder.oldest,
                            child: Text('Сначала старые'),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) {
                            return;
                          }
                          setModalState(() => sort = value);
                        },
                      ),
                      const SizedBox(height: 12),
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Только избранные'),
                        value: favorites,
                        onChanged: (value) => setModalState(() => favorites = value),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          TextButton(
                            onPressed: () {
                              setModalState(() {
                                section = null;
                                bin = null;
                                favorites = false;
                                sort = ChatSortOrder.newest;
                                status = DialogStatusFilter.all;
                              });
                            },
                            child: const Text('Сбросить'),
                          ),
                          const Spacer(),
                          FilledButton(
                            onPressed: () {
                              Navigator.of(sheetContext).pop(
                                _ChatFiltersResult(
                                  section: section,
                                  bin: bin,
                                  favoritesOnly: favorites,
                                  sortOrder: sort,
                                  statusFilter: status,
                                ),
                              );
                            },
                            child: const Text('Применить'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );

    if (result == null) {
      return;
    }

    final shouldReload =
        result.bin != _selectedBin || result.favoritesOnly != _showFavoritesOnly;
    setState(() {
      _selectedSection = result.section;
      _selectedBin = result.bin;
      _showFavoritesOnly = result.favoritesOnly;
      _sortOrder = result.sortOrder;
      _statusFilter = result.statusFilter;
    });
    if (shouldReload) {
      await _loadData(showLoading: true);
    }
  }

  PreferredSizeWidget _buildAppBar(int index, bool isAdmin) {
    final platformBrightness = MediaQuery.of(context).platformBrightness;
    final isDarkModeActive = widget.themeMode == ThemeMode.dark ||
        (widget.themeMode == ThemeMode.system && platformBrightness == Brightness.dark);
    final themeToggleIcon = isDarkModeActive ? Icons.light_mode : Icons.dark_mode;
    final themeToggleTooltip = isDarkModeActive ? 'Светлый режим' : 'Тёмный режим';
    final nextMode = isDarkModeActive ? ThemeMode.light : ThemeMode.dark;
    final themeButton = IconButton(
      tooltip: themeToggleTooltip,
      icon: Icon(themeToggleIcon),
      onPressed: () => widget.onThemeModeChanged(nextMode),
    );
    final logoutButton = IconButton(
      tooltip: 'Выход',
      icon: const Icon(Icons.logout),
      onPressed: widget.onLogout,
    );

    Widget buildChatAppBar() {
      return AppBar(
        title: const Text('Диалоги MobileBot'),
        actions: [
          IconButton(
            tooltip: 'Фильтры',
            icon: const Icon(Icons.filter_alt_outlined),
            onPressed: _showFiltersSheet,
          ),
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadData(),
          ),
          themeButton,
          logoutButton,
        ],
      );
    }

    Widget buildProfileAppBar() {
      return AppBar(
        title: const Text('Профиль оператора'),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () => _profileKey.currentState?.refreshProfile(),
          ),
          themeButton,
          logoutButton,
        ],
      );
    }

    if (!isAdmin) {
      return (index == 0 ? buildChatAppBar() : buildProfileAppBar()) as PreferredSizeWidget;
    }

    if (index == 0) {
      return buildChatAppBar() as PreferredSizeWidget;
    }
    if (index == 1) {
      return AppBar(
        title: const Text('Дэшборд обращений'),
        actions: [
          IconButton(
            tooltip: 'Обновить дэшборд',
            icon: const Icon(Icons.refresh),
            onPressed: () => _dashboardKey.currentState?.reloadSummary(),
          ),
          themeButton,
          logoutButton,
        ],
      );
    }
    if (index == 2) {
      return AppBar(
        title: const Text('Администрирование'),
        actions: [
          IconButton(
            tooltip: 'Обновить список',
            icon: const Icon(Icons.refresh),
            onPressed: () => _adminKey.currentState?.refreshAdminData(),
          ),
          themeButton,
          logoutButton,
        ],
      );
    }
    return buildProfileAppBar() as PreferredSizeWidget;
  }

  Widget _buildChatTab() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Ошибка: $_error'),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => _loadData(),
              child: const Text('Повторить попытку'),
            ),
          ],
        ),
      );
    }
    final theme = Theme.of(context);
    final String? sectionTitle = _selectedSection == null
        ? null
        : _sections
            .firstWhere(
              (section) => section.id == _selectedSection,
              orElse: () => Section(id: _selectedSection!, title: _selectedSection!),
            )
            .title;
    final statusLabel = () {
      switch (_statusFilter) {
        case DialogStatusFilter.open:
          return 'Только открытые';
        case DialogStatusFilter.closed:
          return 'Только закрытые';
        case DialogStatusFilter.all:
          return null;
      }
    }();
    final chips = <Widget>[];
    if (sectionTitle != null && sectionTitle.isNotEmpty) {
      chips.add(
        InputChip(
          label: Text('Раздел: $sectionTitle'),
          onDeleted: () {
            setState(() {
              _selectedSection = null;
            });
          },
        ),
      );
    }
    if (_selectedBin != null && _selectedBin!.isNotEmpty) {
      chips.add(
        InputChip(
          label: Text('БИН: ${_selectedBin!}'),
          onDeleted: () {
            setState(() {
              _selectedBin = null;
            });
            unawaited(_loadData(showLoading: false));
          },
        ),
      );
    }
    if (statusLabel != null) {
      chips.add(
        InputChip(
          label: Text(statusLabel),
          onDeleted: () {
            setState(() {
              _statusFilter = DialogStatusFilter.all;
            });
          },
        ),
      );
    }
    if (_sortOrder == ChatSortOrder.oldest) {
      chips.add(
        InputChip(
          label: const Text('Сначала старые'),
          onDeleted: () {
            setState(() {
              _sortOrder = ChatSortOrder.newest;
            });
          },
        ),
      );
    }
    if (_showFavoritesOnly) {
      chips.add(
        InputChip(
          label: const Text('Только избранные'),
          onDeleted: () {
            setState(() {
              _showFavoritesOnly = false;
            });
            unawaited(_loadData(showLoading: false));
          },
        ),
      );
    }

    final filtersCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Фильтры',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _showFiltersSheet,
                    icon: const Icon(Icons.filter_alt_outlined),
                    label: const Text('Настроить'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (chips.isEmpty)
                Text(
                  'Активные фильтры отсутствуют',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: chips,
                ),
            ],
          ),
        ),
      ),
    );

    final chats = _filteredChats;
    final currentUser = widget.apiClient.currentUser ?? widget.session.user;
    final canDeleteChats = currentUser.isAdmin || currentUser.canReply;
    final canManageDialogs = currentUser.canReply;

    final listChildren = <Widget>[
      filtersCard,
      if (chats.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 48),
          child: Column(
            children: [
              Icon(Icons.forum_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(height: 12),
              Text(
                'Нет активных диалогов',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Сообщения из MobileBot появятся здесь автоматически.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        )
      else
        ...chats.map((chat) {
          final statusLabel = chat.isClosed ? 'Закрыт' : 'Открыт';
          final statusColors = _statusBadgeColors(theme, isClosed: chat.isClosed);
          final aiColors = _aiBadgeColors(theme, enabled: chat.aiEnabled);
          final isStatusUpdating = _statusUpdatingDialogId == chat.dialogId;
          final isAiUpdating = _aiTogglingDialogId == chat.dialogId;
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () async {
                  final chatToOpen =
                      chat.unreadCount > 0 ? chat.copyWith(unreadCount: 0) : chat;
                  if (chat.unreadCount > 0) {
                    setState(() {
                      _allChats = _allChats
                          .map(
                            (item) => item.dialogId == chat.dialogId
                                ? item.copyWith(unreadCount: 0)
                                : item,
                          )
                          .toList();
                    });
                  }
                  final deleted = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => ChatDetailScreen(
                        apiClient: widget.apiClient,
                        chat: chatToOpen,
                      ),
                    ),
                  );
                  if (!mounted) {
                    return;
                  }
                  if (deleted == true) {
                    setState(() {
                      _allChats = _allChats.where((item) => item.chatId != chat.chatId).toList();
                    });
                  } else {
                    await _loadData(showLoading: false);
                  }
                },
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.center,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        chat.title,
                                        style: theme.textTheme.titleMedium
                                            ?.copyWith(fontWeight: FontWeight.w600),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    if (chat.unreadCount > 0)
                                      Container(
                                        margin: const EdgeInsets.only(left: 8),
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 10,
                                          vertical: 6,
                                        ),
                                        decoration: BoxDecoration(
                                          color: theme.colorScheme.errorContainer,
                                          borderRadius: BorderRadius.circular(999),
                                          border: Border.all(
                                            color:
                                                theme.colorScheme.error.withOpacity(0.35),
                                          ),
                                        ),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(
                                              Icons.mark_chat_unread,
                                              size: 16,
                                              color: theme.colorScheme.onErrorContainer,
                                            ),
                                            const SizedBox(width: 6),
                                            Text(
                                              '${chat.unreadCount}',
                                              style: theme.textTheme.labelMedium?.copyWith(
                                                color:
                                                    theme.colorScheme.onErrorContainer,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 6,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: statusColors.background,
                                        borderRadius: BorderRadius.circular(999),
                                        border:
                                            Border.all(color: statusColors.border, width: 1),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (isStatusUpdating)
                                            SizedBox(
                                              width: 14,
                                              height: 14,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: statusColors.foreground,
                                              ),
                                            )
                                          else
                                            Icon(
                                              chat.isClosed ? Icons.lock : Icons.lock_open,
                                              size: 14,
                                              color: statusColors.foreground,
                                            ),
                                          const SizedBox(width: 6),
                                          Text(
                                            statusLabel,
                                            style: theme.textTheme.labelSmall?.copyWith(
                                              color: statusColors.foreground,
                                              fontWeight: FontWeight.w700,
                                              letterSpacing: 0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: aiColors.background,
                                        borderRadius: BorderRadius.circular(999),
                                        border: Border.all(color: aiColors.border, width: 1),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (isAiUpdating)
                                            SizedBox(
                                              width: 14,
                                              height: 14,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: aiColors.foreground,
                                              ),
                                            )
                                          else
                                            Icon(
                                              chat.aiEnabled
                                                  ? Icons.smart_toy
                                                  : Icons.smart_toy_outlined,
                                              size: 14,
                                              color: aiColors.foreground,
                                            ),
                                          const SizedBox(width: 6),
                                          Text(
                                            chat.aiEnabled ? 'AI' : 'AI выкл',
                                            style: theme.textTheme.labelSmall?.copyWith(
                                              color: aiColors.foreground,
                                              fontWeight: FontWeight.w700,
                                              letterSpacing: 0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              IconButton(
                                icon: Icon(chat.isFavorite ? Icons.star : Icons.star_border),
                                color: chat.isFavorite
                                    ? theme.colorScheme.tertiary
                                    : theme.colorScheme.onSurfaceVariant,
                                tooltip: chat.isFavorite
                                    ? 'Убрать из избранного'
                                    : 'Добавить в избранное',
                                onPressed: () => _toggleFavorite(chat),
                              ),
                              const SizedBox(height: 6),
                              PopupMenuButton<String>(
                                enabled: canManageDialogs && !isStatusUpdating && !isAiUpdating,
                                onSelected: (value) {
                                  switch (value) {
                                    case 'toggle_status':
                                      _toggleDialogStatus(chat);
                                      break;
                                    case 'toggle_ai':
                                      _toggleAi(chat);
                                      break;
                                    case 'delete':
                                      _confirmDeleteChat(chat);
                                      break;
                                  }
                                },
                                itemBuilder: (context) {
                                  return [
                                    PopupMenuItem(
                                      value: 'toggle_status',
                                      child: Row(
                                        children: [
                                          Icon(
                                            chat.isClosed ? Icons.lock_open : Icons.lock_outline,
                                            size: 18,
                                            color: theme.colorScheme.onSurfaceVariant,
                                          ),
                                          const SizedBox(width: 8),
                                          Text(chat.isClosed ? 'Открыть диалог' : 'Закрыть диалог'),
                                        ],
                                      ),
                                    ),
                                    PopupMenuItem(
                                      value: 'toggle_ai',
                                      child: Row(
                                        children: [
                                          Icon(
                                            chat.aiEnabled
                                                ? Icons.smart_toy
                                                : Icons.smart_toy_outlined,
                                            size: 18,
                                            color: theme.colorScheme.onSurfaceVariant,
                                          ),
                                          const SizedBox(width: 8),
                                          Text(chat.aiEnabled ? 'Отключить AI' : 'Включить AI'),
                                        ],
                                      ),
                                    ),
                                    if (canDeleteChats)
                                      PopupMenuItem(
                                        value: 'delete',
                                        child: Row(
                                          children: const [
                                            Icon(Icons.delete_outline, size: 18),
                                            SizedBox(width: 8),
                                            Text('Удалить диалог'),
                                          ],
                                        ),
                                      ),
                                  ];
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          if (chat.sectionTitle != null)
                            Chip(
                              label: Text(chat.sectionTitle!),
                              avatar: const Icon(Icons.category_outlined, size: 16),
                            ),
                          if (chat.bin != null && chat.bin!.isNotEmpty)
                            Chip(
                              label: Text('БИН: ${chat.bin}'),
                              avatar: const Icon(Icons.badge_outlined, size: 16),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        chat.username != null ? '@${chat.username}' : 'Тип: ${chat.type}',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      const SizedBox(height: 24),
    ];

    return RefreshIndicator(
      onRefresh: () => _loadData(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: listChildren,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentUser = widget.apiClient.currentUser ?? widget.session.user;
    final isAdmin = currentUser.isAdmin;

    final tabs = <Widget>[_buildChatTab()];
    final destinations = <NavigationDestination>[
      const NavigationDestination(
        icon: Icon(Icons.chat_bubble_outline),
        selectedIcon: Icon(Icons.chat_bubble),
        label: 'Диалоги',
      ),
    ];
    final callbacks = <VoidCallback?>[
      () => _loadData(),
    ];

    if (isAdmin) {
      tabs.add(
        DashboardView(
          key: _dashboardKey,
          apiClient: widget.apiClient,
        ),
      );
      destinations.add(
        const NavigationDestination(
          icon: Icon(Icons.analytics_outlined),
          selectedIcon: Icon(Icons.analytics),
          label: 'Дэшборд',
        ),
      );
      callbacks.add(() => _dashboardKey.currentState?.reloadSummary());

      tabs.add(
        AdminUserManagementView(
          key: _adminKey,
          apiClient: widget.apiClient,
          currentUser: currentUser,
        ),
      );
      destinations.add(
        const NavigationDestination(
          icon: Icon(Icons.admin_panel_settings_outlined),
          selectedIcon: Icon(Icons.admin_panel_settings),
          label: 'Администрирование',
        ),
      );
      callbacks.add(() => _adminKey.currentState?.refreshAdminData());
    }

    tabs.add(
      OperatorProfileView(
        key: _profileKey,
        apiClient: widget.apiClient,
        onProfileUpdated: widget.onProfileUpdated,
        onSessionRefreshed: widget.onSessionRefreshed,
      ),
    );
    destinations.add(
      const NavigationDestination(
        icon: Icon(Icons.person_outline),
        selectedIcon: Icon(Icons.person),
        label: 'Профиль',
      ),
    );
    callbacks.add(() => _profileKey.currentState?.refreshProfile());

    final currentIndex = _tabIndex.clamp(0, tabs.length - 1);

    return Scaffold(
      appBar: _buildAppBar(currentIndex, isAdmin),
      body: IndexedStack(
        index: currentIndex,
        children: tabs,
      ),
      bottomNavigationBar: NavigationBar(
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        selectedIndex: currentIndex,
        onDestinationSelected: (index) {
          final callback = callbacks[index];
          if (currentIndex == index) {
            callback?.call();
            return;
          }
          setState(() {
            _tabIndex = index;
          });
          callback?.call();
        },
        destinations: destinations,
      ),
    );
  }
}
class ChatDetailScreen extends StatefulWidget {
  const ChatDetailScreen({required this.apiClient, required this.chat, super.key});

  final ApiClient apiClient;
  final ChatSummary chat;

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  late ChatSummary _chat;
  late Timer _timer;
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Message> _messages = [];
  bool _loading = true;
  String? _error;
  bool _isFavorite = false;
  bool _updatingFavorite = false;
  bool _deleting = false;
  bool _togglingAi = false;
  bool _updatingStatus = false;
  int? _lastMessageId;

  @override
  void initState() {
    super.initState();
    _chat = widget.chat;
    _fetchMessages();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _fetchMessages());
    _isFavorite = _chat.isFavorite;
  }

  @override
  void dispose() {
    _timer.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _fetchMessages() async {
    try {
      final messages = await widget.apiClient.fetchMessages(
        _chat.chatId,
        dialogId: _chat.dialogId,
      );
      final previousLastId = _lastMessageId;
      final newLastId = messages.isNotEmpty ? messages.last.id : null;
      setState(() {
        _messages = messages;
        _loading = false;
        _error = null;
        _lastMessageId = newLastId;
      });
      if (newLastId != null && newLastId != previousLastId) {
        _scrollToBottom();
      }
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _refreshChatFromServer() async {
    try {
      final refreshed = await widget.apiClient.fetchChatByDialogId(_chat.dialogId);
      if (!mounted || refreshed == null) {
        return;
      }
      setState(() {
        _chat = refreshed;
        _isFavorite = refreshed.isFavorite;
      });
    } catch (_) {
      // если не удалось обновить, оставляем локальное состояние
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) {
      return;
    }
    setState(() {
      _loading = true;
    });
    try {
      await widget.apiClient.sendMessage(
        _chat.chatId,
        text,
        dialogId: _chat.dialogId,
      );
      _messageController.clear();
      await _fetchMessages();
      _scrollToBottom();
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  void _scrollToBottom() {
    if (!mounted) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) {
        return;
      }
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _toggleFavorite() async {
    if (_updatingFavorite) {
      return;
    }
    setState(() {
      _updatingFavorite = true;
      _isFavorite = !_isFavorite;
    });
    try {
      await widget.apiClient.setFavoriteDialog(_chat.dialogId, _isFavorite);
      setState(() {
        _chat = _chat.copyWith(isFavorite: _isFavorite);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        _isFavorite
            ? 'Диалог добавлен в избранное'
            : 'Диалог удалён из избранного',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isFavorite = !_isFavorite;
      });
      showTopMessage(
        context,
        'Не удалось обновить избранное: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _updatingFavorite = false;
        });
      }
    }
  }

  Future<void> _toggleDialogStatus() async {
    if (_updatingStatus) {
      return;
    }
    setState(() {
      _updatingStatus = true;
    });
    try {
      final wasClosed = _chat.isClosed;
      final result = wasClosed
          ? await widget.apiClient.openDialog(_chat.dialogId)
          : await widget.apiClient.closeDialog(_chat.dialogId);
      setState(() {
        _chat = _chat.copyWith(
          dialogClosedAt: result.dialogClosedAt,
          aiEnabled: result.aiEnabled,
        );
      });
      await _refreshChatFromServer();
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        wasClosed
            ? 'Диалог открыт снова и готов к сообщениям.'
            : 'Диалог закрыт. Клиент уведомлён и AI снова включён.',
      );
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить статус диалога: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _updatingStatus = false;
        });
      }
    }
  }

  Future<void> _toggleAiAssistant() async {
    if (_togglingAi) {
      return;
    }
    setState(() {
      _togglingAi = true;
    });
    try {
      if (_chat.aiEnabled) {
        await widget.apiClient.disableDialogAI(_chat.dialogId);
      } else {
        await widget.apiClient.enableDialogAI(_chat.dialogId);
      }
      setState(() {
        _chat = _chat.copyWith(aiEnabled: !_chat.aiEnabled);
      });
      await _refreshChatFromServer();
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        _chat.aiEnabled
            ? 'AI помощник включён для этого диалога.'
            : 'AI помощник отключён. Клиенту отправлено уведомление.',
      );
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить режим AI: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _togglingAi = false;
        });
      }
    }
  }

  Future<void> _deleteChat() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить диалог?'),
          content: Text('Переписка с "${_chat.title}" будет удалена без возможности восстановления.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      return;
    }
    setState(() {
      _deleting = true;
    });
    try {
      await widget.apiClient.deleteChat(_chat.chatId);
      if (!mounted) {
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _deleting = false;
      });
      showTopMessage(
        context,
        'Не удалось удалить диалог: $error',
        isError: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final latestSectionTitle = _messages.isNotEmpty
        ? (_messages.last.sectionTitle ?? _chat.sectionTitle)
        : _chat.sectionTitle;
    final sectionTitle = latestSectionTitle ?? 'Раздел не выбран';
    final user = widget.apiClient.currentUser;
    final canSend = user?.canReply ?? false;
    final operatorSuffix = user != null
        ? ' (${user.name}${user.jobTitle.isNotEmpty ? ', ${user.jobTitle}' : ''})'
        : '';
    final canDelete = (user?.isAdmin ?? false) || (user?.canReply ?? false);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isClosed = _chat.isClosed;
    final statusLabel = isClosed ? 'Закрыт' : 'Открыт';
    final statusColors = _statusBadgeColors(theme, isClosed: isClosed);
    final aiColors = _aiBadgeColors(theme, enabled: _chat.aiEnabled);
    final startedAtLabel = _chat.dialogStartedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogStartedAt!.toLocal())
        : null;
    final closedAtLabel = _chat.dialogClosedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogClosedAt!.toLocal())
        : null;
    return Scaffold(
      appBar: AppBar(
        title: Text(_chat.title),
        actions: [
          IconButton(
            tooltip: _isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
            icon: Icon(_isFavorite ? Icons.star : Icons.star_border),
            color: _isFavorite ? colorScheme.tertiary : null,
            onPressed: (_updatingFavorite || _deleting) ? null : _toggleFavorite,
          ),
          PopupMenuButton<String>(
            enabled: !_deleting,
            onSelected: (value) {
              switch (value) {
                case 'toggle_status':
                  _toggleDialogStatus();
                  break;
                case 'toggle_ai':
                  _toggleAiAssistant();
                  break;
                case 'delete':
                  if (canDelete) {
                    _deleteChat();
                  }
                  break;
              }
            },
            itemBuilder: (context) {
              return [
                PopupMenuItem(
                  value: 'toggle_status',
                  enabled: canSend && !_updatingStatus,
                  child: Row(
                    children: [
                      Icon(
                        _chat.isClosed ? Icons.lock_open : Icons.lock_outline,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 8),
                      Text(_chat.isClosed ? 'Открыть диалог' : 'Закрыть диалог'),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'toggle_ai',
                  enabled: canSend && !_togglingAi,
                  child: Row(
                    children: [
                      Icon(
                        _chat.aiEnabled ? Icons.smart_toy : Icons.smart_toy_outlined,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      const SizedBox(width: 8),
                      Text(_chat.aiEnabled ? 'Отключить AI' : 'Включить AI'),
                    ],
                  ),
                ),
                if (canDelete)
                  const PopupMenuItem(
                    value: 'delete',
                    child: Row(
                      children: [
                        Icon(Icons.delete_outline),
                        SizedBox(width: 8),
                        Text('Удалить диалог'),
                      ],
                    ),
                  ),
              ];
            },
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(88),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: statusColors.background,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: statusColors.border, width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_updatingStatus)
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: statusColors.foreground,
                              ),
                            )
                          else
                            Icon(
                              isClosed ? Icons.lock : Icons.lock_open,
                              size: 16,
                              color: statusColors.foreground,
                            ),
                          const SizedBox(width: 8),
                          Text(
                            statusLabel,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: statusColors.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: aiColors.background,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: aiColors.border, width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_togglingAi)
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: aiColors.foreground,
                              ),
                            )
                          else
                            Icon(
                              _chat.aiEnabled ? Icons.smart_toy : Icons.smart_toy_outlined,
                              size: 16,
                              color: aiColors.foreground,
                            ),
                          const SizedBox(width: 8),
                          Text(
                            _chat.aiEnabled ? 'AI' : 'AI выключен',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: aiColors.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text('Раздел: $sectionTitle'),
                if (_chat.bin != null && _chat.bin!.isNotEmpty)
                  Text('БИН: ${_chat.bin}', style: const TextStyle(fontSize: 12)),
                if (startedAtLabel != null)
                  Text('Начат: $startedAtLabel', style: const TextStyle(fontSize: 12)),
                if (closedAtLabel != null)
                  Text('Закрыт: $closedAtLabel', style: const TextStyle(fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          if (_deleting) const LinearProgressIndicator(),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Ошибка: $_error'),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: _fetchMessages,
                              child: const Text('Обновить'),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                        itemCount: _messages.length,
                        itemBuilder: (context, index) {
                          final message = _messages[index];
                          final isOutgoing = message.direction == 'outgoing';
                          final bubbleColor = isOutgoing
                              ? colorScheme.primary
                              : colorScheme.surfaceVariant;
                          final textColor = isOutgoing
                              ? colorScheme.onPrimary
                              : colorScheme.onSurface;
                          final alignment = isOutgoing ? Alignment.centerRight : Alignment.centerLeft;
                          return Align(
                            alignment: alignment,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              constraints: const BoxConstraints(maxWidth: 340),
                              decoration: BoxDecoration(
                                color: bubbleColor,
                                borderRadius: BorderRadius.only(
                                  topLeft: const Radius.circular(16),
                                  topRight: const Radius.circular(16),
                                  bottomLeft: Radius.circular(isOutgoing ? 16 : 4),
                                  bottomRight: Radius.circular(isOutgoing ? 4 : 16),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment:
                                    isOutgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                                children: [
                                  if (message.author != null)
                                    Text(
                                      message.author!,
                                      style: theme.textTheme.labelSmall?.copyWith(
                                        color: textColor.withOpacity(0.8),
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  Text(
                                    message.text,
                                    style: theme.textTheme.bodyMedium?.copyWith(color: textColor),
                                  ),
                                  if (message.sectionTitle != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text(
                                        'Раздел: ${message.sectionTitle}',
                                        style: theme.textTheme.labelSmall?.copyWith(
                                          color: textColor.withOpacity(0.7),
                                        ),
                                      ),
                                    ),
                                  const SizedBox(height: 4),
                                  Text(
                                    message.createdAtLabel,
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: textColor.withOpacity(0.7),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: InputDecoration(
                      hintText: canSend
                          ? 'Ваш ответ...$operatorSuffix'
                          : 'Только просмотр. Свяжитесь с администратором для прав ответа.',
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                    enabled: canSend && !_deleting,
                    keyboardType: TextInputType.multiline,
                    textCapitalization: TextCapitalization.sentences,
                    minLines: 1,
                    maxLines: 5,
                    onSubmitted: canSend && !_deleting ? (_) => _sendMessage() : null,
                  ),
                ),
                const SizedBox(width: 12),
                IconButton.filled(
                  onPressed: canSend && !_deleting ? _sendMessage : null,
                  icon: const Icon(Icons.send),
                  tooltip: 'Отправить',
                ),
              ],
            ),
          ),
          if (!canSend)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'У вашей роли нет прав на отправку ответов. Обратитесь к администратору.',
                style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.error),
              ),
            ),
        ],
      ),
    );
  }
}

class OperatorProfileView extends StatefulWidget {
  const OperatorProfileView({
    required this.apiClient,
    required this.onProfileUpdated,
    required this.onSessionRefreshed,
    super.key,
  });

  final ApiClient apiClient;
  final ValueChanged<UserProfile> onProfileUpdated;
  final ValueChanged<AuthSession> onSessionRefreshed;

  @override
  State<OperatorProfileView> createState() => _OperatorProfileViewState();
}

class _QuestionSectionEntry {
  _QuestionSectionEntry({
    required this.key,
    required this.title,
    required this.section,
    required this.totalCount,
  });

  final String key;
  final String title;
  final DashboardSectionTopQuestions section;
  final int totalCount;
}

class DashboardView extends StatefulWidget {
  const DashboardView({required this.apiClient, super.key});

  final ApiClient apiClient;

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  DashboardSummary? _summary;
  bool _loading = true;
  bool _refreshing = false;
  String? _error;
  List<UserProfile> _operators = [];
  bool _operatorsLoading = false;
  String? _operatorsError;
  int? _selectedOperatorId;
  String _selectedQuestionSection = 'all';

  @override
  void initState() {
    super.initState();
    _loadSummary(initial: true);
    _loadOperators();
  }

  Future<void> reloadSummary() => _loadSummary(initial: false);

  Future<void> _loadSummary({required bool initial, int? operatorOverride}) async {
    if (initial) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() {
        _refreshing = true;
      });
    }
    try {
      final summary = await widget.apiClient.fetchDashboardSummary(
        operatorId: operatorOverride ?? _selectedOperatorId,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _summary = summary;
        _error = null;
        if (_selectedQuestionSection != 'all') {
          final validKeys = summary.questionsBySection
              .map((section) => section.section ?? (section.title.isNotEmpty ? section.title : 'no-section'))
              .toSet();
          if (!validKeys.contains(_selectedQuestionSection)) {
            _selectedQuestionSection = 'all';
          }
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        if (initial) {
          _summary = null;
        }
      });
} finally {
      if (!mounted) {
        return;
      }
      setState(() {
        if (initial) {
          _loading = false;
        } else {
          _refreshing = false;
        }
      });
    }
  }

  Future<void> _loadOperators() async {
    setState(() {
      _operatorsLoading = true;
      _operatorsError = null;
    });
    try {
      final users = await widget.apiClient.fetchUsers();
      if (!mounted) {
        return;
      }
      final filtered = users
          .where((user) => !user.isAdmin && (user.role == 'moderator' || user.role == 'viewer'))
          .where((user) {
            final normalized = ('${user.name} ${user.login}').toLowerCase();
            if (normalized.trim().isEmpty) {
              return true;
            }
            return !normalized.contains('bot') && !normalized.contains('бот');
          })
          .toList()
        ..sort((a, b) {
          final nameA = a.name.isNotEmpty ? a.name : a.login;
          final nameB = b.name.isNotEmpty ? b.name : b.login;
          return nameA.toLowerCase().compareTo(nameB.toLowerCase());
        });
      setState(() {
        _operators = filtered;
        if (_selectedOperatorId != null &&
            !_operators.any((operator) => operator.id == _selectedOperatorId)) {
          _selectedOperatorId = null;
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _operatorsError = error.toString();
      });
    } finally {
      if (!mounted) {
        return;
      }
      setState(() {
        _operatorsLoading = false;
      });
    }
  }

  Future<void> _handleRefresh() => _loadSummary(initial: false);

  void _handleOperatorChanged(int? value) {
    setState(() {
      _selectedOperatorId = value;
    });
    _loadSummary(initial: false, operatorOverride: value);
  }

  String _formatResponseTime(double? minutes) {
    if (minutes == null) {
      return '—';
    }
    final totalSeconds = (minutes * 60).round();
    final minutesPart = totalSeconds ~/ 60;
    final secondsPart = totalSeconds % 60;
    if (minutesPart > 0 && secondsPart > 0) {
      return '$minutesPart мин $secondsPart с';
    }
    if (minutesPart > 0) {
      return '$minutesPart мин';
    }
    return '$secondsPart с';
  }

  String _describeResponseTime(double? minutes) {
    if (minutes == null) {
      return 'Недостаточно данных';
    }
    if (minutes <= 2) {
      return 'Отвечает быстро';
    }
    if (minutes <= 7) {
      return 'Отвечает в среднем темпе';
    }
    return 'Отвечает медленно';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final theme = Theme.of(context);
    final numberFormatter = NumberFormat.decimalPattern('ru');
    final summary = _summary;
    final hasData = summary != null;
    final data = summary ?? DashboardSummary.empty();
    final updatedAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(data.updatedAt.toLocal());
    final avgMessagesLabel = data.averageMessagesPerDialog.toStringAsFixed(1);
    final responseTimeLabel = _formatResponseTime(data.avgResponseTimeMinutes);
    final responseTimeMood = _describeResponseTime(data.avgResponseTimeMinutes);

    final operatorItems = <DropdownMenuItem<int?>>[
      const DropdownMenuItem<int?>(
        value: null,
        child: Text('Все сотрудники'),
      ),
      ..._operators.map(
        (operator) => DropdownMenuItem<int?>(
          value: operator.id,
          child: Text(operator.name.isNotEmpty ? operator.name : operator.login),
        ),
      ),
    ];

    final sectionEntries = <_QuestionSectionEntry>[];
    final seenKeys = <String>{};
    for (final section in data.questionsBySection) {
      final key = section.section ?? (section.title.isNotEmpty ? section.title : 'no-section');
      if (seenKeys.contains(key)) {
        continue;
      }
      seenKeys.add(key);
      final totalCount = section.questions.fold<int>(0, (acc, question) => acc + question.count);
      sectionEntries.add(
        _QuestionSectionEntry(
          key: key,
          title: section.title.isNotEmpty ? section.title : 'Без раздела',
          section: section,
          totalCount: totalCount,
        ),
      );
    }
    sectionEntries.sort((a, b) => b.totalCount.compareTo(a.totalCount));

    final questionSectionItems = <DropdownMenuItem<String>>[
      const DropdownMenuItem<String>(value: 'all', child: Text('Все разделы')),
      ...sectionEntries.map(
        (entry) => DropdownMenuItem<String>(
          value: entry.key,
          child: Text(entry.title),
        ),
      ),
    ];

    final selectedSectionTitle = _selectedQuestionSection == 'all'
        ? 'Все разделы'
        : sectionEntries
                .firstWhere(
                  (entry) => entry.key == _selectedQuestionSection,
                  orElse: () => _QuestionSectionEntry(
                    key: 'all',
                    title: 'Все разделы',
                    section: DashboardSectionTopQuestions(
                      section: null,
                      title: 'Все разделы',
                      questions: const <DashboardTopQuestion>[],
                    ),
                    totalCount: 0,
                  ),
                )
                .title;

    final selectedQuestions = () {
      if (_selectedQuestionSection == 'all') {
        return data.topQuestions.take(5).toList();
      }
      final match = sectionEntries.firstWhere(
        (entry) => entry.key == _selectedQuestionSection,
        orElse: () => _QuestionSectionEntry(
          key: 'all',
          title: 'Все разделы',
          section: DashboardSectionTopQuestions(
            section: null,
            title: 'Все разделы',
            questions: const <DashboardTopQuestion>[],
          ),
          totalCount: 0,
        ),
      );
      return match.section.questions.take(5).toList();
    }();

    final agentStats = data.agentBreakdown
        .where((agent) {
          final normalized = agent.name.toLowerCase();
          if (normalized.trim().isEmpty) {
            return false;
          }
          if (normalized.contains('bot') || normalized.contains('бот')) {
            return false;
          }
          if (normalized.contains('admin') || normalized.contains('administrator') || normalized.contains('администратор')) {
            return false;
          }
          return true;
        })
        .toList()
      ..sort((a, b) => b.messages.compareTo(a.messages));

    final headerCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Дэшборд обращений',
                style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 4),
              Text(
                'Обновлено: $updatedAtLabel',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<int?>(
                value: _selectedOperatorId,
                decoration: const InputDecoration(labelText: 'Сотрудник'),
                items: operatorItems,
                onChanged: _operatorsLoading ? null : _handleOperatorChanged,
              ),
              if (_operatorsLoading) ...[
                const SizedBox(height: 12),
                const LinearProgressIndicator(),
              ],
              if (_operatorsError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _operatorsError!,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              if (!hasData && _error == null) ...[
                const SizedBox(height: 12),
                Text(
                  'Нет данных для отображения. Попробуйте выбрать другого сотрудника или обновить дэшборд.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
              if (_error != null && hasData) ...[
                const SizedBox(height: 12),
                Text(
                  'Ошибка при обновлении: $_error',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              LayoutBuilder(
                builder: (context, constraints) {
                  final maxWidth = constraints.maxWidth;
                  final tileWidth = maxWidth > 520 ? (maxWidth - 12) / 2 : maxWidth;
                  final statCards = <Widget>[
                    _DashboardStatCard(label: 'Всего обращений', value: numberFormatter.format(data.totalDialogs)),
                    _DashboardStatCard(label: 'Открытые диалоги', value: numberFormatter.format(data.openDialogs)),
                    _DashboardStatCard(label: 'Закрытые диалоги', value: numberFormatter.format(data.closedDialogs)),
                    _DashboardStatCard(label: 'Активных чатов', value: numberFormatter.format(data.totalChats)),
                    _DashboardStatCard(label: 'Входящих сообщений', value: numberFormatter.format(data.totalIncomingMessages)),
                    _DashboardStatCard(label: 'Исходящих сообщений', value: numberFormatter.format(data.totalOutgoingMessages)),
                    _DashboardStatCard(label: 'Среднее сообщений в диалоге', value: avgMessagesLabel),
                    _DashboardStatCard(label: 'Среднее время ответа', value: responseTimeLabel, hint: responseTimeMood),
                  ];
                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: statCards
                        .map(
                          (card) => SizedBox(
                            width: tileWidth,
                            child: card,
                          ),
                        )
                        .toList(),
                  );
                },
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _refreshing ? null : () => _loadSummary(initial: false),
                icon: Icon(_refreshing ? Icons.sync : Icons.refresh),
                label: Text(_refreshing ? 'Обновляем…' : 'Обновить дэшборд'),
              ),
            ],
          ),
        ),
      ),
    );

    final sectionCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Обращения по разделам',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              if (data.sectionBreakdown.isEmpty)
                Text(
                  'Данных пока нет.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                Column(
                  children: data.sectionBreakdown.map((section) {
                    final progress = (section.percentage / 100).clamp(0, 1);
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(section.title, style: theme.textTheme.bodyMedium),
                              ),
                              const SizedBox(width: 12),
                              Text(
                                '${numberFormatter.format(section.dialogs)} · ${section.percentage.toStringAsFixed(1)}%',
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(999),
                            child: LinearProgressIndicator(
                              minHeight: 6,
                              value: progress.toDouble(),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
            ],
          ),
        ),
      ),
    );

    final questionsCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      'Частые вопросы',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 200,
                    child: DropdownButtonFormField<String>(
                      value: _selectedQuestionSection,
                      decoration: const InputDecoration(labelText: 'Раздел'),
                      items: questionSectionItems,
                      onChanged: (value) {
                        if (value == null) {
                          return;
                        }
                        setState(() {
                          _selectedQuestionSection = value;
                        });
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'ТОП-5 · $selectedSectionTitle',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              if (selectedQuestions.isEmpty)
                Text(
                  'Пока нет популярных вопросов для выбранного раздела.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                Column(
                  children: List.generate(selectedQuestions.length, (index) {
                    final question = selectedQuestions[index];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${index + 1}.', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              question.question,
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            numberFormatter.format(question.count),
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ),
                    );
                  }),
                ),
            ],
          ),
        ),
      ),
    );

    final agentsCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Дэшборд сотрудников',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              if (agentStats.isEmpty)
                Text(
                  'Пока нет активности сотрудников.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else ...[
                Container(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(flex: 2, child: Text('Сотрудник', style: theme.textTheme.labelMedium)),
                      Expanded(child: Text('Диалогов', textAlign: TextAlign.right, style: theme.textTheme.labelMedium)),
                      Expanded(child: Text('Сообщений', textAlign: TextAlign.right, style: theme.textTheme.labelMedium)),
                      Expanded(child: Text('Среднее', textAlign: TextAlign.right, style: theme.textTheme.labelMedium)),
                      Expanded(flex: 2, child: Text('Последняя активность', textAlign: TextAlign.right, style: theme.textTheme.labelMedium)),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                ...agentStats.map((agent) {
                  final lastActivityLabel = agent.lastActivity != null
                      ? DateFormat('dd.MM.yyyy HH:mm').format(agent.lastActivity!.toLocal())
                      : '—';
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Expanded(flex: 2, child: Text(agent.name, style: theme.textTheme.bodyMedium)),
                        Expanded(child: Text(numberFormatter.format(agent.dialogs), textAlign: TextAlign.right)),
                        Expanded(child: Text(numberFormatter.format(agent.messages), textAlign: TextAlign.right)),
                        Expanded(child: Text(agent.avgMessagesPerDialog.toStringAsFixed(1), textAlign: TextAlign.right)),
                        Expanded(
                          flex: 2,
                          child: Text(
                            lastActivityLabel,
                            textAlign: TextAlign.right,
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                  );
                }),
              ],
            ],
          ),
        ),
      ),
    );

    final activityCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Активность по дням',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              if (data.recentActivity.isEmpty)
                Text(
                  'Данных пока нет.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                Column(
                  children: data.recentActivity.map((activity) {
                    final dateLabel = DateFormat('dd.MM').format(activity.date.toLocal());
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Expanded(child: Text(dateLabel)),
                          Expanded(
                            child: Text(
                              numberFormatter.format(activity.dialogs),
                              textAlign: TextAlign.right,
                            ),
                          ),
                          Expanded(
                            child: Text(
                              numberFormatter.format(activity.incomingMessages),
                              textAlign: TextAlign.right,
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
            ],
          ),
        ),
      ),
    );

    final listChildren = <Widget>[
      headerCard,
      sectionCard,
      questionsCard,
      agentsCard,
      activityCard,
      const SizedBox(height: 24),
    ];

    return RefreshIndicator(
      onRefresh: _handleRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: listChildren,
      ),
    );
  }
}

class _DashboardStatCard extends StatelessWidget {
  const _DashboardStatCard({required this.label, required this.value, this.hint});

  final String label;
  final String value;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(
              hint!,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}

class AdminUserManagementView extends StatefulWidget {
  const AdminUserManagementView({
    required this.apiClient,
    required this.currentUser,
    super.key,
  });

  final ApiClient apiClient;
  final UserProfile currentUser;

  @override
  State<AdminUserManagementView> createState() => _AdminUserManagementViewState();
}

class _AdminUserManagementViewState extends State<AdminUserManagementView> {
  bool _loading = true;
  String? _error;
  List<UserProfile> _users = [];
  List<RoleInfo> _roles = [];
  List<Section> _availableSections = [];
  List<String> _availableBins = [];
  List<UnassignedBin> _unassignedBins = [];
  final Set<int> _updatingUserIds = <int>{};
  final Set<int> _deletingUserIds = <int>{};
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    refreshAdminData();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> refreshAdminData({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() {
        _error = null;
      });
    }
    try {
      final query = _searchQuery.trim().isEmpty ? null : _searchQuery.trim();
      final rolesFuture = widget.apiClient.fetchRoles();
      final usersFuture = widget.apiClient.fetchUsers(query: query);
      final sectionsFuture = widget.apiClient.fetchSections();
      final binsFuture = widget.apiClient.fetchBins();
      final unassignedFuture = widget.apiClient.fetchUnassignedBins();

      final roles = await rolesFuture;
      final users = await usersFuture;
      final sections = await sectionsFuture;
      final bins = await binsFuture;
      final unassigned = await unassignedFuture;
      if (!mounted) {
        return;
      }
      setState(() {
        _roles = roles;
        _users = users;
        _availableSections = sections;
        _availableBins = bins;
        _unassignedBins = unassigned;
        _loading = false;
        _updatingUserIds.clear();
        _deletingUserIds.clear();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        _loading = false;
      });
      final message = error is ApiException ? error.message : error.toString();
      showTopMessage(
        context,
        'Не удалось загрузить данные администратора: $message',
        isError: true,
      );
    }
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted) {
        return;
      }
      setState(() {
        _searchQuery = value;
      });
      refreshAdminData(showLoading: false);
    });
  }

  String _pluralizeDialogs(int count) {
    final mod10 = count % 10;
    final mod100 = count % 100;
    if (mod10 == 1 && mod100 != 11) {
      return 'диалог';
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return 'диалога';
    }
    return 'диалогов';
  }

  Future<UserBinAssignment?> _showBinAssignmentSheet({
    required UserProfile user,
    required String bin,
    UserBinAssignment? current,
  }) async {
    DateTime? selected = current?.expiresAt?.toLocal();
    bool indefinite = selected == null;

    DateTime _defaultExpirySeed() {
      final now = DateTime.now();
      final truncatedHour = DateTime(now.year, now.month, now.day, now.hour);
      final candidate = truncatedHour.add(const Duration(hours: 1));
      if (candidate.isAfter(now)) {
        return candidate;
      }
      return now.add(const Duration(hours: 2));
    }

    void _ensureSelectionValidity() {
      if (indefinite) {
        selected = null;
        return;
      }
      final minAllowed = DateTime.now().add(const Duration(minutes: 5));
      if (selected == null || !selected!.isAfter(minAllowed)) {
        selected = _defaultExpirySeed();
      }
    }

    if (!indefinite) {
      _ensureSelectionValidity();
    }

    return showModalBottomSheet<UserBinAssignment>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            void updateSelection(bool makeIndefinite) {
              setModalState(() {
                indefinite = makeIndefinite;
                if (makeIndefinite) {
                  selected = null;
                } else {
                  _ensureSelectionValidity();
                }
              });
            }

            Future<void> handlePick() async {
              final now = DateTime.now();
              final fallback =
                  selected != null && selected!.isAfter(now) ? selected! : _defaultExpirySeed();
              final firstDate = DateTime(now.year, now.month, now.day);
              final date = await showDatePicker(
                context: sheetContext,
                initialDate: fallback.isBefore(firstDate) ? firstDate : fallback,
                firstDate: firstDate,
                lastDate: now.add(const Duration(days: 365)),
              );
              if (date == null) {
                return;
              }
              final timeOfDay = await showTimePicker(
                context: sheetContext,
                initialTime: TimeOfDay.fromDateTime(fallback),
              );
              if (timeOfDay == null) {
                return;
              }
              setModalState(() {
                selected = DateTime(
                  date.year,
                  date.month,
                  date.day,
                  timeOfDay.hour,
                  timeOfDay.minute,
                );
                indefinite = false;
                _ensureSelectionValidity();
              });
            }

            final theme = Theme.of(context);
            final expiresLabel = (!indefinite && selected != null)
                ? DateFormat('dd.MM.yyyy HH:mm').format(selected!)
                : 'Срок не выбран';

            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 16,
                bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 16,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Назначение БИНа', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text(
                    user.name,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      bin,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 16),
                  RadioListTile<bool>(
                    value: true,
                    groupValue: indefinite,
                    onChanged: (_) => updateSelection(true),
                    title: const Text('Без ограничения по времени'),
                    subtitle: const Text('БИН останется за сотрудником, пока вы не снимете назначение вручную.'),
                  ),
                  RadioListTile<bool>(
                    value: false,
                    groupValue: indefinite,
                    onChanged: (_) => updateSelection(false),
                    title: const Text('До указанной даты и времени'),
                    subtitle: const Text('После истечения срока БИН появится среди неразделенных.'),
                    secondary: IconButton(
                      icon: const Icon(Icons.event_outlined),
                      tooltip: 'Выбрать дату и время',
                      onPressed: () {
                        updateSelection(false);
                        handlePick();
                      },
                    ),
                  ),
                  if (!indefinite)
                    Padding(
                      padding: const EdgeInsets.only(left: 24, right: 16, bottom: 8),
                      child: Text(
                        expiresLabel,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: () => Navigator.of(sheetContext).pop(),
                        child: const Text('Отмена'),
                      ),
                      const SizedBox(width: 12),
                      FilledButton(
                        onPressed: () {
                          if (!indefinite && selected == null) {
                            ScaffoldMessenger.of(sheetContext).showSnackBar(
                              const SnackBar(content: Text('Укажите срок действия БИНа.')),
                            );
                            return;
                          }
                          final expiresUtc = indefinite ? null : selected!.toUtc();
                          Navigator.of(sheetContext).pop(
                            UserBinAssignment(
                              bin: bin,
                              assignedAt: current?.assignedAt ?? DateTime.now().toUtc(),
                              expiresAt: expiresUtc,
                              assignedBy: current?.assignedBy,
                            ),
                          );
                        },
                        child: Text(current == null ? 'Назначить' : 'Сохранить'),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _confirmRemoveBin(UserProfile user, UserBinAssignment assignment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить назначение БИНа?'),
          content: Text('БИН ${assignment.bin} станет неразделенным.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      return;
    }
    final updated = List<UserBinAssignment>.from(user.binAssignments)
      ..removeWhere((item) => item.bin == assignment.bin);
    await _updateUserBins(user, updated);
  }

  Future<void> _changeRole(UserProfile user, String role) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserRole(user.id, role);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Роль пользователя "${updated.name}" обновлена на ${updated.roleLabel}',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить роль: $error',
        isError: true,
      );
    }
  }

  Future<void> _updateUserSections(UserProfile user, Set<String> sections) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserSections(user.id, sections.toList());
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Разделы пользователя "${updated.name}" обновлены.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить разделы: $error',
        isError: true,
      );
    }
  }

  Future<void> _updateUserBins(UserProfile user, List<UserBinAssignment> assignments) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final sortedAssignments = List<UserBinAssignment>.from(assignments)
        ..sort((a, b) => a.bin.compareTo(b.bin));
      final updated = await widget.apiClient.updateUserBins(user.id, sortedAssignments);
      final unassigned = await widget.apiClient.fetchUnassignedBins();
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
        _unassignedBins = unassigned;
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'БИНы пользователя "${updated.name}" обновлены.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить БИНы: $error',
        isError: true,
      );
    }
  }

  Future<void> _deleteUser(UserProfile user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Удалить аккаунт ${user.name}?'),
          content: const Text('Пользователь потеряет доступ к системе. Действие нельзя отменить.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      return;
    }
    setState(() {
      _deletingUserIds.add(user.id);
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      await widget.apiClient.deleteUser(user.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users.where((existing) => existing.id != user.id).toList();
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
      });
      showTopMessage(
        context,
        'Аккаунт "${user.name}" удалён.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось удалить пользователя: $error',
        isError: true,
      );
    }
  }

  Future<void> _promptResetPassword(UserProfile user) async {
    final formKey = GlobalKey<FormState>();
    final passwordController = TextEditingController();
    final confirmController = TextEditingController();
    final newPassword = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Смена пароля: ${user.name}'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: passwordController,
                  decoration: const InputDecoration(labelText: 'Новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: confirmController,
                  decoration: const InputDecoration(labelText: 'Повторите пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value != passwordController.text) {
                      return 'Пароли не совпадают';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.of(dialogContext).pop(passwordController.text.trim());
                }
              },
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );
    passwordController.dispose();
    confirmController.dispose();
    if (newPassword == null) {
      return;
    }
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.adminSetUserPassword(user.id, newPassword);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      showTopMessage(
        context,
        'Пароль для "${updated.name}" обновлён.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось изменить пароль: $error',
        isError: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final roleItems = _roles
        .map(
          (role) => DropdownMenuItem<String>(
            value: role.id,
            child: Text(role.title),
          ),
        )
        .toList();

    final theme = Theme.of(context);
    final searchField = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: TextField(
        controller: _searchController,
        decoration: InputDecoration(
          labelText: 'Поиск по имени, логину или e-mail',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _searchQuery.isEmpty
              ? null
              : IconButton(
                  onPressed: () {
                    _searchController.clear();
                    _onSearchChanged('');
                  },
                  icon: const Icon(Icons.close),
                ),
        ),
        onChanged: _onSearchChanged,
      ),
    );

    final listChildren = <Widget>[
      searchField,
      const SizedBox(height: 12),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Неразделенные БИНы',
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                if (_unassignedBins.isEmpty)
                  Text(
                    'Все активные БИНы закреплены за сотрудниками.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final isNarrow = constraints.maxWidth < 420;
                      final targetWidth = isNarrow
                          ? constraints.maxWidth
                          : math.min(260.0, constraints.maxWidth);
                      return Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: _unassignedBins.map((entry) {
                          final description = entry.openDialogs > 0
                              ? '${entry.openDialogs} ${_pluralizeDialogs(entry.openDialogs)} без закрепленного сотрудника'
                              : 'Нет активных диалогов';
                          return ConstrainedBox(
                            constraints: BoxConstraints(
                              minWidth: targetWidth,
                              maxWidth: targetWidth,
                            ),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    entry.bin,
                                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    description,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      );
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
      const SizedBox(height: 12),
    ];

    if (_users.isEmpty) {
      listChildren.add(
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
          child: Text(
            'Пока нет зарегистрированных операторов.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
      );
    } else {
      listChildren.addAll(
        _users.map((user) {
          final isSelf = user.id == widget.currentUser.id;
          final isUpdating = _updatingUserIds.contains(user.id);
          final isDeleting = _deletingUserIds.contains(user.id);
          final canDelete = !isSelf && !user.isAdmin;
          final badgeColor = user.isAdmin
              ? theme.colorScheme.errorContainer
              : (user.canReply
                  ? theme.colorScheme.primaryContainer
                  : theme.colorScheme.surfaceVariant.withOpacity(0.6));
          final badgeTextColor = user.isAdmin
              ? theme.colorScheme.onErrorContainer
              : (user.canReply
                  ? theme.colorScheme.onPrimaryContainer
                  : theme.colorScheme.onSurfaceVariant);
          final createdAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(user.createdAt.toLocal());

          Widget buildInfoChip(IconData icon, String label) {
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceVariant.withOpacity(0.4),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            );
          }

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user.name,
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              Wrap(
                                spacing: 8,
                                runSpacing: 6,
                                children: [
                                  buildInfoChip(Icons.email_outlined, user.email),
                                  buildInfoChip(Icons.person_outline, user.login),
                                  buildInfoChip(Icons.calendar_month_outlined, createdAtLabel),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Chip(
                              label: Text(user.roleLabel),
                              backgroundColor: badgeColor,
                              labelStyle: TextStyle(color: badgeTextColor, fontWeight: FontWeight.w600),
                            ),
                            if (canDelete)
                              IconButton(
                                tooltip: 'Удалить аккаунт',
                                icon: const Icon(Icons.delete_outline),
                                color: theme.colorScheme.error,
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : () => _deleteUser(user),
                              ),
                          ],
                        ),
                      ],
                    ),
                    if (isDeleting) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: const [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          SizedBox(width: 8),
                          Text('Удаляем аккаунт…'),
                        ],
                      ),
                    ],
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: user.role,
                      decoration: const InputDecoration(labelText: 'Роль пользователя'),
                      items: roleItems,
                      onChanged: (!isSelf && !isUpdating && !isDeleting)
                          ? (value) {
                              if (value == null || value == user.role) {
                                return;
                              }
                              _changeRole(user, value);
                            }
                          : null,
                    ),
                    if (isUpdating && !isDeleting) ...[
                      const SizedBox(height: 12),
                      const LinearProgressIndicator(),
                    ],
                    const SizedBox(height: 16),
                    Text('Разделы', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 8),
                    if (user.sections.isEmpty)
                      Text(
                        'Нет назначенных разделов',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: user.sections.map((sectionId) {
                          final match = _availableSections.firstWhere(
                            (section) => section.id == sectionId,
                            orElse: () => Section(id: sectionId, title: sectionId),
                          );
                          return Chip(
                            label: Text(match.title),
                            onDeleted: (!isUpdating && !isDeleting)
                                ? () {
                                    final updatedSections =
                                        Set<String>.from(user.sections)..remove(sectionId);
                                    _updateUserSections(user, updatedSections);
                                  }
                                : null,
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 8),
                    _SectionSelectorField(
                      key: ValueKey('section-selector-${user.id}-${user.sections.length}'),
                      availableSections: _availableSections
                          .where((section) => !user.sections.contains(section.id))
                          .toList(),
                      enabled: !isUpdating && !isDeleting && _availableSections.isNotEmpty,
                      onSectionSelected: (value) {
                        if (value.isEmpty || user.sections.contains(value)) {
                          return;
                        }
                        final updatedSections = Set<String>.from(user.sections)..add(value);
                        _updateUserSections(user, updatedSections);
                      },
                    ),
                    const SizedBox(height: 16),
                    Text('БИНы', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 8),
                    if (user.binAssignments.isEmpty)
                      Text(
                        'Нет назначенных БИНов',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      Column(
                        children: user.binAssignments.map((assignment) {
                          final expiresLabel = assignment.expiresAt != null
                              ? 'Действует до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                              : 'Бессрочное назначение';
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: theme.colorScheme.outlineVariant.withOpacity(0.6),
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        assignment.bin,
                                        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        expiresLabel,
                                        style: theme.textTheme.bodySmall?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (!isUpdating && !isDeleting)
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        tooltip: 'Изменить срок',
                                        icon: const Icon(Icons.edit_calendar_outlined),
                                        onPressed: () async {
                                          final updatedAssignment = await _showBinAssignmentSheet(
                                            user: user,
                                            bin: assignment.bin,
                                            current: assignment,
                                          );
                                          if (updatedAssignment == null) {
                                            return;
                                          }
                                          final updatedAssignments = user.binAssignments
                                              .map((item) => item.bin == assignment.bin ? updatedAssignment : item)
                                              .toList();
                                          await _updateUserBins(user, updatedAssignments);
                                        },
                                      ),
                                      IconButton(
                                        tooltip: 'Убрать БИН',
                                        icon: const Icon(Icons.delete_outline),
                                        onPressed: () => _confirmRemoveBin(user, assignment),
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 8),
                    _BinSelectorField(
                      key: ValueKey('bin-selector-${user.id}-${user.binAssignments.length}'),
                      availableBins: _availableBins
                          .where((bin) => user.binAssignments.every((assignment) => assignment.bin != bin))
                          .toList(),
                      enabled: !isUpdating && !isDeleting && _availableBins.isNotEmpty,
                      onBinSelected: (value) async {
                        if (value.isEmpty ||
                            user.binAssignments.any((assignment) => assignment.bin == value)) {
                          return;
                        }
                        final assignment = await _showBinAssignmentSheet(user: user, bin: value);
                        if (assignment == null) {
                          return;
                        }
                        final updatedAssignments = List<UserBinAssignment>.from(user.binAssignments)
                          ..add(assignment);
                        await _updateUserBins(user, updatedAssignments);
                      },
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        OutlinedButton.icon(
                          icon: const Icon(Icons.lock_reset),
                          label: const Text('Сменить пароль'),
                          onPressed:
                              (isUpdating || isDeleting) ? null : () => _promptResetPassword(user),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      (isUpdating || isDeleting)
                          ? 'Сохраняем изменения…'
                          : 'Изменения сохраняются автоматически',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (isSelf)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Нельзя изменять собственную роль администратора.',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        }),
      );
    }

    final content = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 24),
      children: listChildren,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _error!,
                  style: const TextStyle(color: Colors.red),
                ),
                TextButton(
                  onPressed: () => refreshAdminData(),
                  child: const Text('Повторить загрузку'),
                ),
              ],
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => refreshAdminData(showLoading: false),
            child: content,
          ),
        ),
      ],
    );
  }
}

class _OperatorProfileViewState extends State<OperatorProfileView> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _loginController = TextEditingController();
  final TextEditingController _jobTitleController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _bioController = TextEditingController();

  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _successMessage;
  UserProfile? _profile;
  List<Section> _sections = [];

  @override
  void initState() {
    super.initState();
    refreshProfile();
  }

  Future<void> refreshProfile() async {
    setState(() {
      _loading = true;
      _error = null;
      _successMessage = null;
    });
    try {
      final profile = await widget.apiClient.fetchProfile();
      final sections = await widget.apiClient.fetchSections();
      widget.onProfileUpdated(profile);
      if (!mounted) {
        return;
      }
      _profile = profile;
      _nameController.text = profile.name;
      _emailController.text = profile.email;
      _loginController.text = profile.login;
      _jobTitleController.text = profile.jobTitle;
      _phoneController.text = profile.phone;
      _bioController.text = profile.bio;
      setState(() {
        _sections = sections;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _successMessage = null;
    });
    try {
      final updated = await widget.apiClient.updateProfile(
        name: _nameController.text.trim(),
        jobTitle: _jobTitleController.text.trim(),
        phone: _phoneController.text.trim(),
        bio: _bioController.text.trim(),
      );
      widget.onProfileUpdated(updated);
      if (!mounted) {
        return;
      }
      setState(() {
        _profile = updated;
        _saving = false;
        _successMessage = 'Профиль обновлён';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _changeOwnPassword() async {
    final formKey = GlobalKey<FormState>();
    final currentController = TextEditingController();
    final newController = TextEditingController();
    final confirmController = TextEditingController();

    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Смена пароля'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: currentController,
                  decoration: const InputDecoration(labelText: 'Текущий пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: newController,
                  decoration: const InputDecoration(labelText: 'Новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    if (value.trim() == currentController.text.trim()) {
                      return 'Новый пароль должен отличаться от текущего';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: confirmController,
                  decoration: const InputDecoration(labelText: 'Повторите новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value != newController.text) {
                      return 'Пароли не совпадают';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState!.validate()) {
                  Navigator.of(dialogContext).pop({
                    'current': currentController.text.trim(),
                    'new': newController.text.trim(),
                  });
                }
              },
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );

    currentController.dispose();
    newController.dispose();
    confirmController.dispose();

    if (result == null) {
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
      _successMessage = null;
    });

    try {
      final session = await widget.apiClient.changePassword(
        currentPassword: result['current']!,
        newPassword: result['new']!,
      );
      widget.onProfileUpdated(session.user);
      if (!mounted) {
        return;
      }
      setState(() {
        _profile = session.user;
        _saving = false;
        _successMessage = 'Пароль обновлён';
      });
      showTopMessage(context, 'Пароль обновлён.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить пароль: $error',
        isError: true,
      );
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _loginController.dispose();
    _jobTitleController.dispose();
    _phoneController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final profile = _profile;
    final isAdmin = profile?.isAdmin ?? false;


    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'Имя'),
              textCapitalization: TextCapitalization.words,
              validator: (value) {
                final trimmed = value?.trim() ?? '';
                if (trimmed.runes.length < 2) {
                  return 'Введите имя длиной не менее 2 символов';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _emailController,
              decoration: const InputDecoration(labelText: 'Email'),
              readOnly: true,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _loginController,
              decoration: const InputDecoration(labelText: 'Логин для входа'),
              readOnly: true,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _jobTitleController,
              decoration: const InputDecoration(labelText: 'Должность/роль'),
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phoneController,
              decoration: const InputDecoration(labelText: 'Телефон'),
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _bioController,
              decoration: const InputDecoration(labelText: 'О себе и компетенции'),
              maxLines: 4,
            ),
            const SizedBox(height: 16),
            if (profile != null)
              Text(
                'Аккаунт создан: ${DateFormat('dd.MM.yyyy HH:mm').format(profile.createdAt.toLocal())}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (profile != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Текущая роль: ${profile.roleLabel}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            if (profile != null) ...[
              const SizedBox(height: 12),
              if (!isAdmin) ...[
                Text(
                  'Назначенные разделы:',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                if (profile.sections.isEmpty)
                  const Text(
                    'Разделы ещё не назначены. Обратитесь к администратору.',
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: profile.sections.map((sectionId) {
                      final match = _sections.firstWhere(
                        (section) => section.id == sectionId,
                        orElse: () => Section(id: sectionId, title: sectionId),
                      );
                      return Chip(label: Text(match.title));
                    }).toList(),
                  ),
                const SizedBox(height: 8),
                Text(
                  'Назначенные БИНы:',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 8),
                if (profile.binAssignments.isEmpty)
                  const Text(
                    'БИНы ещё не назначены. Обратитесь к администратору.',
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: profile.binAssignments.map((assignment) {
                      final expiresLabel = assignment.expiresAt != null
                          ? 'до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                          : 'без срока';
                      return Chip(
                        label: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(assignment.bin),
                            Text(
                              expiresLabel,
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
                const SizedBox(height: 8),
              ],
              Text(
                'Избранных диалогов: ${profile.favoriteDialogIds.length}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            if (_error != null)
              Text(
                _error!,
                style: const TextStyle(color: Colors.red),
              ),
            if (_successMessage != null)
              Text(
                _successMessage!,
                style: const TextStyle(color: Colors.green),
              ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                ElevatedButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: const Icon(Icons.save),
                  label: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Сохранить'),
                ),
                OutlinedButton.icon(
                  onPressed: _saving ? null : _changeOwnPassword,
                  icon: const Icon(Icons.lock_outline),
                  label: const Text('Сменить пароль'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionSelectorField extends StatefulWidget {
  const _SectionSelectorField({
    required this.availableSections,
    required this.onSectionSelected,
    required this.enabled,
    super.key,
  });

  final List<Section> availableSections;
  final ValueChanged<String> onSectionSelected;
  final bool enabled;

  @override
  State<_SectionSelectorField> createState() => _SectionSelectorFieldState();
}

class _SectionSelectorFieldState extends State<_SectionSelectorField> {
  TextEditingController? _fieldController;
  FocusNode? _focusNode;

  Iterable<Section> _buildOptions(TextEditingValue value) {
    if (!widget.enabled) {
      return const Iterable<Section>.empty();
    }
    final query = value.text.trim();
    if (query.isEmpty) {
      return widget.availableSections;
    }
    final lowerQuery = query.toLowerCase();
    return widget.availableSections.where(
      (section) =>
          section.title.toLowerCase().contains(lowerQuery) ||
          section.id.toLowerCase().contains(lowerQuery),
    );
  }

  @override
  void didUpdateWidget(covariant _SectionSelectorField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled && oldWidget.enabled) {
      _fieldController?.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Autocomplete<Section>(
      optionsBuilder: _buildOptions,
      displayStringForOption: (option) => option.title,
      onSelected: (value) {
        _fieldController?.clear();
        if (!widget.enabled) {
          return;
        }
        widget.onSectionSelected(value.id);
        _focusNode?.unfocus();
      },
      fieldViewBuilder: (context, textEditingController, focusNode, onFieldSubmitted) {
        _fieldController = textEditingController;
        _focusNode = focusNode;
        return TextField(
          controller: textEditingController,
          focusNode: focusNode,
          enabled: widget.enabled,
          decoration: const InputDecoration(
            labelText: 'Выберите раздел',
            hintText: 'Поиск…',
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) {
            if (!widget.enabled) {
              return;
            }
            final trimmed = value.trim();
            if (trimmed.isEmpty) {
              return;
            }
            final normalized = trimmed.toLowerCase();
            Section? match;
            for (final section in widget.availableSections) {
              final titleMatch = section.title.toLowerCase() == normalized;
              final idMatch = section.id.toLowerCase() == normalized;
              if (titleMatch || idMatch) {
                match = section;
                break;
              }
            }
            if (match != null) {
              widget.onSectionSelected(match.id);
              _fieldController?.clear();
              focusNode.unfocus();
            }
          },
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, minWidth: 240),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                itemCount: optionList.length,
                itemBuilder: (context, index) {
                  final option = optionList[index];
                  return ListTile(
                    title: Text(option.title),
                    subtitle: Text(option.id),
                    onTap: () => onSelected(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

class _BinSelectorField extends StatefulWidget {
  const _BinSelectorField({
    required this.availableBins,
    required this.onBinSelected,
    required this.enabled,
    super.key,
  });

  final List<String> availableBins;
  final Future<void> Function(String) onBinSelected;
  final bool enabled;

  @override
  State<_BinSelectorField> createState() => _BinSelectorFieldState();
}

class _BinSelectorFieldState extends State<_BinSelectorField> {
  TextEditingController? _fieldController;
  FocusNode? _focusNode;

  Iterable<String> _buildOptions(TextEditingValue value) {
    if (!widget.enabled) {
      return const Iterable<String>.empty();
    }
    final query = value.text.trim();
    if (query.isEmpty) {
      return widget.availableBins;
    }
    final lowerQuery = query.toLowerCase();
    return widget.availableBins.where(
      (bin) => bin.toLowerCase().contains(lowerQuery),
    );
  }

  @override
  void didUpdateWidget(covariant _BinSelectorField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled && oldWidget.enabled) {
      _fieldController?.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Autocomplete<String>(
      optionsBuilder: _buildOptions,
      displayStringForOption: (option) => option,
      onSelected: (value) {
        _fieldController?.clear();
        if (!widget.enabled) {
          return;
        }
        unawaited(widget.onBinSelected(value));
        _focusNode?.unfocus();
      },
      fieldViewBuilder: (context, textEditingController, focusNode, onFieldSubmitted) {
        _fieldController = textEditingController;
        _focusNode = focusNode;
        return TextField(
          controller: textEditingController,
          focusNode: focusNode,
          enabled: widget.enabled,
          decoration: const InputDecoration(
            labelText: 'Выберите БИН',
            hintText: 'Поиск…',
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) {
            if (!widget.enabled) {
              return;
            }
            final trimmed = value.trim();
            if (trimmed.isEmpty) {
              return;
            }
            if (widget.availableBins.contains(trimmed)) {
              unawaited(widget.onBinSelected(trimmed));
              _fieldController?.clear();
              focusNode.unfocus();
            }
          },
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, minWidth: 240),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                itemCount: optionList.length,
                itemBuilder: (context, index) {
                  final option = optionList[index];
                  return ListTile(
                    title: Text(option),
                    onTap: () => onSelected(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

int? _parseIntValue(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value);
  }
  return int.tryParse(value.toString());
}

double? _parseDoubleValue(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is double) {
    return value;
  }
  if (value is int) {
    return value.toDouble();
  }
  if (value is num) {
    return value.toDouble();
  }
  if (value is String) {
    final normalized = value.replaceAll(',', '.').trim();
    if (normalized.isEmpty) {
      return null;
    }
    return double.tryParse(normalized);
  }
  return double.tryParse(value.toString());
}

DateTime? _parseDateTime(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is DateTime) {
    return value.toLocal();
  }
  if (value is String) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

class DashboardSummary {
  DashboardSummary({
    required this.totalDialogs,
    required this.openDialogs,
    required this.closedDialogs,
    required this.totalChats,
    required this.totalMessages,
    required this.totalIncomingMessages,
    required this.totalOutgoingMessages,
    required this.averageMessagesPerDialog,
    required this.avgDialogDurationMinutes,
    required this.avgResponseTimeMinutes,
    required this.sectionBreakdown,
    required this.topQuestions,
    required this.questionsBySection,
    required this.agentBreakdown,
    required this.recentActivity,
    required this.updatedAt,
  });

  final int totalDialogs;
  final int openDialogs;
  final int closedDialogs;
  final int totalChats;
  final int totalMessages;
  final int totalIncomingMessages;
  final int totalOutgoingMessages;
  final double averageMessagesPerDialog;
  final double? avgDialogDurationMinutes;
  final double? avgResponseTimeMinutes;
  final List<DashboardSectionStat> sectionBreakdown;
  final List<DashboardTopQuestion> topQuestions;
  final List<DashboardSectionTopQuestions> questionsBySection;
  final List<DashboardAgentStat> agentBreakdown;
  final List<DashboardActivityPoint> recentActivity;
  final DateTime updatedAt;

  factory DashboardSummary.empty() {
    final now = DateTime.now();
    return DashboardSummary(
      totalDialogs: 0,
      openDialogs: 0,
      closedDialogs: 0,
      totalChats: 0,
      totalMessages: 0,
      totalIncomingMessages: 0,
      totalOutgoingMessages: 0,
      averageMessagesPerDialog: 0,
      avgDialogDurationMinutes: null,
      avgResponseTimeMinutes: null,
      sectionBreakdown: const [],
      topQuestions: const [],
      questionsBySection: const [],
      agentBreakdown: const [],
      recentActivity: const [],
      updatedAt: now,
    );
  }

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    int parseInt(dynamic value) => _parseIntValue(value) ?? 0;
    double parseDouble(dynamic value) => _parseDoubleValue(value) ?? 0.0;
    double? parseDoubleNullable(dynamic value) => _parseDoubleValue(value);

    double? parseResponseMinutes(dynamic minutesRaw, dynamic secondsRaw) {
      final minutes = parseDoubleNullable(minutesRaw);
      if (minutes != null && minutes.isFinite) {
        return minutes;
      }
      final seconds = parseDoubleNullable(secondsRaw);
      if (seconds != null && seconds.isFinite) {
        return seconds / 60;
      }
      if (minutesRaw is String) {
        final pattern = RegExp(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[\.,]\d+)?)S)?$', caseSensitive: false);
        final match = pattern.firstMatch(minutesRaw.trim().toUpperCase());
        if (match != null) {
          final hours = int.tryParse(match.group(1) ?? '') ?? 0;
          final mins = int.tryParse(match.group(2) ?? '') ?? 0;
          final secs = double.tryParse((match.group(3) ?? '').replaceAll(',', '.')) ?? 0.0;
          return hours * 60 + mins + secs / 60;
        }
      }
      return null;
    }

    final sectionBreakdown = (json['section_breakdown'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardSectionStat.fromJson)
        .toList();
    final topQuestions = (json['top_questions'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardTopQuestion.fromJson)
        .toList();
    final questionsBySection = (json['questions_by_section'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardSectionTopQuestions.fromJson)
        .toList();
    final agentBreakdown = (json['agent_breakdown'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardAgentStat.fromJson)
        .toList();
    final recentActivity = (json['recent_activity'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardActivityPoint.fromJson)
        .toList();

    final avgDialogDuration = parseDoubleNullable(json['avg_dialog_duration_minutes']);
    final avgResponseMinutes = parseResponseMinutes(
      json['avg_response_time_minutes'],
      json['avg_response_time_seconds'],
    );

    final updatedAt = _parseDateTime(json['updated_at']) ?? DateTime.now();

    return DashboardSummary(
      totalDialogs: parseInt(json['total_dialogs']),
      openDialogs: parseInt(json['open_dialogs']),
      closedDialogs: parseInt(json['closed_dialogs']),
      totalChats: parseInt(json['total_chats']),
      totalMessages: parseInt(json['total_messages']),
      totalIncomingMessages: parseInt(json['total_incoming_messages']),
      totalOutgoingMessages: parseInt(json['total_outgoing_messages']),
      averageMessagesPerDialog: parseDouble(json['average_messages_per_dialog']),
      avgDialogDurationMinutes: avgDialogDuration?.isFinite == true ? avgDialogDuration : null,
      avgResponseTimeMinutes: avgResponseMinutes?.isFinite == true ? avgResponseMinutes : null,
      sectionBreakdown: sectionBreakdown,
      topQuestions: topQuestions,
      questionsBySection: questionsBySection,
      agentBreakdown: agentBreakdown,
      recentActivity: recentActivity,
      updatedAt: updatedAt,
    );
  }
}

class DashboardSectionStat {
  DashboardSectionStat({
    required this.section,
    required this.title,
    required this.dialogs,
    required this.percentage,
  });

  final String? section;
  final String title;
  final int dialogs;
  final double percentage;

  factory DashboardSectionStat.fromJson(Map<String, dynamic> json) {
    return DashboardSectionStat(
      section: json['section'] as String?,
      title: (json['title'] as String?)?.trim() ?? '',
      dialogs: _parseIntValue(json['dialogs']) ?? 0,
      percentage: _parseDoubleValue(json['percentage']) ?? 0,
    );
  }
}

class DashboardTopQuestion {
  DashboardTopQuestion({required this.question, required this.count});

  final String question;
  final int count;

  factory DashboardTopQuestion.fromJson(Map<String, dynamic> json) {
    return DashboardTopQuestion(
      question: (json['question'] as String?)?.trim() ?? '',
      count: _parseIntValue(json['count']) ?? 0,
    );
  }
}

class DashboardSectionTopQuestions {
  DashboardSectionTopQuestions({
    required this.section,
    required this.title,
    required this.questions,
  });

  final String? section;
  final String title;
  final List<DashboardTopQuestion> questions;

  factory DashboardSectionTopQuestions.fromJson(Map<String, dynamic> json) {
    final questions = (json['questions'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardTopQuestion.fromJson)
        .toList();
    return DashboardSectionTopQuestions(
      section: json['section'] as String?,
      title: (json['title'] as String?)?.trim() ?? '',
      questions: questions,
    );
  }
}

class DashboardAgentStat {
  DashboardAgentStat({
    required this.name,
    required this.dialogs,
    required this.messages,
    required this.avgMessagesPerDialog,
    required this.lastActivity,
  });

  final String name;
  final int dialogs;
  final int messages;
  final double avgMessagesPerDialog;
  final DateTime? lastActivity;

  factory DashboardAgentStat.fromJson(Map<String, dynamic> json) {
    final dialogs = _parseIntValue(json['dialogs']) ?? 0;
    final messages = _parseIntValue(json['messages']) ?? 0;
    final avg = _parseDoubleValue(json['avg_messages_per_dialog']);
    final computedAvg = dialogs > 0
        ? (avg != null && avg.isFinite ? avg : messages / dialogs)
        : 0.0;
    return DashboardAgentStat(
      name: (json['name'] as String?)?.trim() ?? '',
      dialogs: dialogs,
      messages: messages,
      avgMessagesPerDialog: computedAvg,
      lastActivity: _parseDateTime(json['last_activity']),
    );
  }
}

class DashboardActivityPoint {
  DashboardActivityPoint({
    required this.date,
    required this.dialogs,
    required this.incomingMessages,
  });

  final DateTime date;
  final int dialogs;
  final int incomingMessages;

  factory DashboardActivityPoint.fromJson(Map<String, dynamic> json) {
    final parsedDate = _parseDateTime(json['date']) ?? DateTime.now();
    return DashboardActivityPoint(
      date: parsedDate,
      dialogs: _parseIntValue(json['dialogs']) ?? 0,
      incomingMessages: _parseIntValue(json['incoming_messages']) ?? 0,
    );
  }
}

class DialogStatusUpdate {
  const DialogStatusUpdate({
    required this.chatId,
    required this.dialogId,
    required this.dialogClosedAt,
    required this.aiEnabled,
  });

  final int chatId;
  final int dialogId;
  final DateTime? dialogClosedAt;
  final bool aiEnabled;

  factory DialogStatusUpdate.fromJson(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final dialogId = _parseIntValue(json['dialog_id']) ?? chatId;
    final closedAt = _parseDateTime(json['dialog_closed_at']);
    final aiEnabledRaw = json['ai_enabled'];
    final aiEnabled = aiEnabledRaw is bool ? aiEnabledRaw : aiEnabledRaw != false;
    return DialogStatusUpdate(
      chatId: chatId,
      dialogId: dialogId,
      dialogClosedAt: closedAt,
      aiEnabled: aiEnabled,
    );
  }
}

class ChatSummary {
  ChatSummary({
    required this.chatId,
    required this.dialogId,
    required this.title,
    required this.username,
    required this.type,
    required this.updatedAt,
    required this.section,
    required this.sectionTitle,
    required this.bin,
    required this.isFavorite,
    required this.aiEnabled,
    required this.dialogStartedAt,
    required this.dialogClosedAt,
    required this.unreadCount,
  });

  final int chatId;
  final int dialogId;
  final String title;
  final String? username;
  final String type;
  final DateTime updatedAt;
  final String? section;
  final String? sectionTitle;
  final String? bin;
  final bool isFavorite;
  final bool aiEnabled;
  final DateTime? dialogStartedAt;
  final DateTime? dialogClosedAt;
  final int unreadCount;

  String get updatedAtLabel => DateFormat('HH:mm').format(updatedAt.toLocal());
  bool get isClosed => dialogClosedAt != null;

  ChatSummary copyWith({
    bool? isFavorite,
    bool? aiEnabled,
    DateTime? dialogStartedAt,
    DateTime? dialogClosedAt,
    int? unreadCount,
  }) {
    return ChatSummary(
      chatId: chatId,
      dialogId: dialogId,
      title: title,
      username: username,
      type: type,
      updatedAt: updatedAt,
      section: section,
      sectionTitle: sectionTitle,
      bin: bin,
      isFavorite: isFavorite ?? this.isFavorite,
      aiEnabled: aiEnabled ?? this.aiEnabled,
      dialogStartedAt: dialogStartedAt ?? this.dialogStartedAt,
      dialogClosedAt: dialogClosedAt ?? this.dialogClosedAt,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }

  factory ChatSummary.fromJson(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final dialogId = _parseIntValue(json['dialog_id']) ?? chatId;
    final updatedAtRaw = json['updated_at'] as String?;
    final updatedAt = updatedAtRaw != null
        ? DateTime.tryParse(updatedAtRaw) ?? DateTime.now().toUtc()
        : DateTime.now().toUtc();
    final startedAt = _parseDateTime(json['dialog_started_at']);
    final closedAt = _parseDateTime(json['dialog_closed_at']);
    final operatorModeRaw = json['operator_mode'];
    final operatorMode = operatorModeRaw is bool ? operatorModeRaw : operatorModeRaw == true;
    final aiEnabledRaw = json['ai_enabled'];
    final aiEnabled = aiEnabledRaw is bool
        ? aiEnabledRaw
        : aiEnabledRaw == false
            ? false
            : !operatorMode;
    final unreadCount = _parseIntValue(json['unread_count']) ?? 0;
    return ChatSummary(
      chatId: chatId,
      dialogId: dialogId,
      title: json['title'] as String? ?? 'Диалог',
      username: json['username'] as String?,
      type: json['type'] as String? ?? 'unknown',
      updatedAt: updatedAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
      bin: json['bin'] as String?,
      isFavorite: json['is_favorite'] as bool? ?? false,
      aiEnabled: aiEnabled,
      dialogStartedAt: startedAt,
      dialogClosedAt: closedAt,
      unreadCount: unreadCount,
    );
  }
}

class Message {
  Message({
    required this.id,
    required this.chatId,
    required this.direction,
    required this.text,
    required this.author,
    required this.createdAt,
    required this.section,
    required this.sectionTitle,
  });

  final int id;
  final int chatId;
  final String direction;
  final String text;
  final String? author;
  final DateTime createdAt;
  final String? section;
  final String? sectionTitle;

  String get createdAtLabel => DateFormat('HH:mm').format(createdAt.toLocal());

  factory Message.fromJson(Map<String, dynamic> json) {
    final id = _parseIntValue(json['id']) ?? 0;
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final createdAtRaw = json['created_at'] as String?;
    final createdAt = createdAtRaw != null
        ? DateTime.tryParse(createdAtRaw) ?? DateTime.now().toUtc()
        : DateTime.now().toUtc();
    return Message(
      id: id,
      chatId: chatId,
      direction: json['direction'] as String? ?? 'incoming',
      text: json['text'] as String? ?? '',
      author: json['author'] as String?,
      createdAt: createdAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
    );
  }
}

class MessageNotification {
  MessageNotification({
    required this.chatId,
    required this.chatTitle,
    required this.text,
    required this.createdAt,
    required this.section,
    required this.sectionTitle,
  });

  final int chatId;
  final String chatTitle;
  final String text;
  final DateTime createdAt;
  final String? section;
  final String? sectionTitle;

  String get createdAtLabel => DateFormat('HH:mm').format(createdAt.toLocal());

  static MessageNotification? tryParse(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']);
    final createdAtRaw = json['created_at'] as String?;
    if (chatId == null || createdAtRaw == null) {
      return null;
    }
    final createdAt = DateTime.tryParse(createdAtRaw) ?? DateTime.now().toUtc();
    return MessageNotification(
      chatId: chatId,
      chatTitle: json['chat_title'] as String? ?? 'Диалог',
      text: json['text'] as String? ?? '',
      createdAt: createdAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
    );
  }

  factory MessageNotification.fromJson(Map<String, dynamic> json) {
    final notification = tryParse(json);
    if (notification == null) {
      throw const FormatException('Некорректные данные уведомления');
    }
    return notification;
  }
}

class UnassignedBin {
  const UnassignedBin({
    required this.bin,
    required this.openDialogs,
  });

  final String bin;
  final int openDialogs;

  factory UnassignedBin.fromJson(Map<String, dynamic> json) {
    final rawBin = json['bin'] ?? '';
    final parsedBin = rawBin is String ? rawBin.trim() : rawBin.toString();
    final rawCount = json['open_dialogs'];
    final count = rawCount is int
        ? rawCount
        : int.tryParse(rawCount?.toString() ?? '') ?? 0;
    return UnassignedBin(bin: parsedBin, openDialogs: count);
  }
}

class UserBinAssignment {
  const UserBinAssignment({
    required this.bin,
    required this.assignedAt,
    required this.expiresAt,
    this.assignedBy,
  });

  final String bin;
  final DateTime assignedAt;
  final DateTime? expiresAt;
  final int? assignedBy;

  bool get isIndefinite => expiresAt == null;

  UserBinAssignment copyWith({
    DateTime? assignedAt,
    DateTime? expiresAt,
    int? assignedBy,
  }) {
    return UserBinAssignment(
      bin: bin,
      assignedAt: assignedAt ?? this.assignedAt,
      expiresAt: expiresAt ?? this.expiresAt,
      assignedBy: assignedBy ?? this.assignedBy,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'bin': bin,
      'assigned_at': assignedAt.toUtc().toIso8601String(),
      'expires_at': expiresAt?.toUtc().toIso8601String(),
      'assigned_by': assignedBy,
    };
  }

  Map<String, dynamic> toUpdatePayload() {
    return {
      'bin': bin,
      'expires_at': expiresAt?.toUtc().toIso8601String(),
    };
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null) {
      return null;
    }
    if (value is DateTime) {
      return value.toUtc();
    }
    if (value is int) {
      try {
        return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
      } catch (_) {
        return null;
      }
    }
    if (value is String && value.trim().isNotEmpty) {
      try {
        return DateTime.parse(value).toUtc();
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  static UserBinAssignment? tryParse(dynamic raw) {
    if (raw == null) {
      return null;
    }
    if (raw is UserBinAssignment) {
      return raw;
    }
    if (raw is String) {
      final bin = raw.trim();
      if (bin.isEmpty) {
        return null;
      }
      return UserBinAssignment(
        bin: bin,
        assignedAt: DateTime.now().toUtc(),
        expiresAt: null,
        assignedBy: null,
      );
    }
    if (raw is Map<String, dynamic>) {
      final value = raw['bin'] ?? raw['value'] ?? '';
      final bin = value.toString().trim();
      if (bin.isEmpty) {
        return null;
      }
      final assignedRaw = raw['assigned_at'] ?? raw['assignedAt'];
      final expiresRaw = raw['expires_at'] ?? raw['expiresAt'];
      final assignedAt = _parseDate(assignedRaw) ?? DateTime.now().toUtc();
      final expiresAt = _parseDate(expiresRaw);
      final assignedByRaw = raw['assigned_by'] ?? raw['assignedBy'];
      final assignedBy = assignedByRaw is int
          ? assignedByRaw
          : int.tryParse(assignedByRaw?.toString() ?? '');
      return UserBinAssignment(
        bin: bin,
        assignedAt: assignedAt,
        expiresAt: expiresAt,
        assignedBy: assignedBy,
      );
    }
    final bin = raw.toString().trim();
    if (bin.isEmpty) {
      return null;
    }
    return UserBinAssignment(
      bin: bin,
      assignedAt: DateTime.now().toUtc(),
      expiresAt: null,
      assignedBy: null,
    );
  }
}

class Section {
  Section({required this.id, required this.title});

  final String id;
  final String title;

  factory Section.fromJson(Map<String, dynamic> json) {
    return Section(
      id: json['id'] as String,
      title: json['title'] as String,
    );
  }
}

const Map<String, String> _roleTitles = {
  'admin': 'Администратор',
  'moderator': 'Модератор',
  'viewer': 'Пользователь',
};

class UserProfile {
  UserProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.login,
    required this.createdAt,
    required this.jobTitle,
    required this.phone,
    required this.bio,
    required this.role,
    required List<String> sections,
    required List<UserBinAssignment> binAssignments,
    required Set<int> favoriteDialogIds,
  })  : sections = List.unmodifiable(sections),
        binAssignments = List.unmodifiable(binAssignments),
        favoriteDialogIds = Set<int>.unmodifiable(favoriteDialogIds);

  final int id;
  final String name;
  final String email;
  final String login;
  final DateTime createdAt;
  final String jobTitle;
  final String phone;
  final String bio;
  final String role;
  final List<String> sections;
  final List<UserBinAssignment> binAssignments;
  final Set<int> favoriteDialogIds;

  List<String> get bins => binAssignments.map((assignment) => assignment.bin).toList(growable: false);

  bool get canReply => role == 'admin' || role == 'moderator';
  bool get isAdmin => role == 'admin';
  bool get canViewOnly => role == 'viewer';
  String get roleLabel => _roleTitles[role] ?? role;
  bool canSeeSection(String? sectionId) {
    if (isAdmin) {
      return true;
    }
    if (sectionId == null || sectionId.isEmpty) {
      return false;
    }
    return sections.contains(sectionId);
  }

  bool canSeeBin(String? bin) {
    if (isAdmin) {
      return true;
    }
    if (bin == null || bin.isEmpty) {
      return false;
    }
    return binAssignments.any((assignment) => assignment.bin == bin);
  }

  UserProfile copyWith({
    String? name,
    String? jobTitle,
    String? phone,
    String? bio,
    String? role,
    List<String>? sections,
    List<UserBinAssignment>? binAssignments,
    Set<int>? favoriteDialogIds,
  }) {
    return UserProfile(
      id: id,
      name: name ?? this.name,
      email: email,
      login: login,
      createdAt: createdAt,
      jobTitle: jobTitle ?? this.jobTitle,
      phone: phone ?? this.phone,
      bio: bio ?? this.bio,
      role: role ?? this.role,
      sections: sections ?? this.sections,
      binAssignments: binAssignments ?? this.binAssignments,
      favoriteDialogIds: favoriteDialogIds ?? this.favoriteDialogIds,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'login': login,
      'created_at': createdAt.toUtc().toIso8601String(),
      'job_title': jobTitle,
      'phone': phone,
      'bio': bio,
      'role': role,
      'sections': sections,
      'bins': binAssignments.map((assignment) => assignment.toJson()).toList(),
      'favorite_dialog_ids': favoriteDialogIds.toList(),
    };
  }

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    final sectionList = (json['sections'] as List<dynamic>? ?? [])
        .map((item) => item.toString())
        .toList();
    final rawBins = json['bins'];
    final assignments = <UserBinAssignment>[];
    if (rawBins is List) {
      for (final item in rawBins) {
        final parsed = UserBinAssignment.tryParse(item);
        if (parsed != null) {
          assignments.add(parsed);
        }
      }
    } else if (rawBins != null) {
      final parsed = UserBinAssignment.tryParse(rawBins);
      if (parsed != null) {
        assignments.add(parsed);
      }
    }
    assignments.sort((a, b) => a.bin.compareTo(b.bin));
    final rawFavorites = json['favorite_dialog_ids'] ?? json['favorite_chat_ids'];
    final favorites = (rawFavorites as List<dynamic>? ?? [])
        .map((item) => item is int ? item : int.tryParse(item.toString()) ?? 0)
        .where((value) => value > 0)
        .toSet();
    return UserProfile(
      id: json['id'] as int,
      name: json['name'] as String,
      email: json['email'] as String,
      login: json['login'] as String? ?? json['email'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      jobTitle: json['job_title'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      bio: json['bio'] as String? ?? '',
      role: json['role'] as String? ?? 'viewer',
      sections: sectionList,
      binAssignments: assignments,
      favoriteDialogIds: favorites,
    );
  }
}

class RoleInfo {
  RoleInfo({required this.id, required this.title});

  final String id;
  final String title;

  factory RoleInfo.fromJson(Map<String, dynamic> json) {
    return RoleInfo(
      id: json['id'] as String,
      title: json['title'] as String? ?? json['id'] as String,
    );
  }
}

class AuthSession {
  AuthSession({required this.token, required this.user});

  final String token;
  final UserProfile user;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      token: json['token'] as String,
      user: UserProfile.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  AuthSession copyWith({String? token, UserProfile? user}) {
    return AuthSession(
      token: token ?? this.token,
      user: user ?? this.user,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'token': token,
      'user': user.toJson(),
    };
  }
}