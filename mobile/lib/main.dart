import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';

import 'network_exceptions.dart';

const defaultApiBaseUrl =
    'https://exclamatorily-nonaffecting-chelsey.ngrok-free.dev';
const defaultApiToken = 'MySecretTokenSayCheese';

void main() {
  runApp(const TelegramCompanionApp());
}

class TelegramCompanionApp extends StatefulWidget {
  const TelegramCompanionApp({super.key});

  @override
  State<TelegramCompanionApp> createState() => _TelegramCompanionAppState();
}

class _TelegramCompanionAppState extends State<TelegramCompanionApp> {
  late final ApiClient apiClient;
  final SessionStorage _sessionStorage = const SessionStorage();
  AuthSession? _session;
  bool _initializing = true;

  @override
  void initState() {
    super.initState();
    const apiBaseUrl = String.fromEnvironment(
      'API_BASE_URL',
      defaultValue: defaultApiBaseUrl,
    );
    const apiToken = String.fromEnvironment(
      'API_TOKEN',
      defaultValue: defaultApiToken,
    );
    apiClient = ApiClient(apiBaseUrl, apiToken);
    _restoreSession();
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

  @override
  Widget build(BuildContext context) {
    final colorScheme = ColorScheme.fromSeed(seedColor: const Color(0xFF3E5AA8));
    final outlineBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.4)),
    );
    final theme = ThemeData(
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

    final home = _session == null
        ? AuthScreen(
            apiClient: apiClient,
            onAuthenticated: _handleAuthenticated,
          )
        : ChatListScreen(
            apiClient: apiClient,
            session: _session!,
            onLogout: _handleLogout,
            onProfileUpdated: _handleProfileUpdated,
            onSessionRefreshed: _handleSessionRefreshed,
          );

    if (_initializing) {
      return MaterialApp(
        title: 'Telegram Companion',
        theme: theme,
        home: const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    return MaterialApp(
      title: 'Telegram Companion',
      theme: theme,
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
      : baseUrl = baseUrl.isNotEmpty ? baseUrl : defaultApiBaseUrl,
        apiToken = apiToken.isNotEmpty ? apiToken : defaultApiToken;

  final String baseUrl;
  final String apiToken;
  String? _sessionToken;
  UserProfile? _currentUser;
  final Set<int> _favoriteChatIds = <int>{};

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
    _favoriteChatIds
      ..clear()
      ..addAll(session.user.favoriteChatIds);
  }

  void clearSession() {
    _sessionToken = null;
    _currentUser = null;
    _favoriteChatIds.clear();
  }

  UserProfile? get currentUser => _currentUser;

  AuthSession? get currentSession =>
      _sessionToken != null && _currentUser != null
          ? AuthSession(token: _sessionToken!, user: _currentUser!)
          : null;

  void updateCurrentUser(UserProfile profile) {
    _currentUser = profile;
    _favoriteChatIds
      ..clear()
      ..addAll(profile.favoriteChatIds);
  }

  Set<int> get favoriteChatIds => _favoriteChatIds;

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

  Future<List<Message>> fetchMessages(int chatId) async {
    final uri = _buildUri('chats/$chatId/messages', {'limit': 100});
    final response = await _sendRequest(
      () => http.get(uri, headers: _headers),
      'Не удалось загрузить сообщения.',
    );
    final decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded
        .map((item) => Message.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<void> sendMessage(int chatId, String text) async {
    final uri = _buildUri('messages/send');
    final body = jsonEncode({'chat_id': chatId, 'text': text});
    await _sendRequest(
      () => http.post(uri, headers: _headers, body: body),
      'Не удалось отправить сообщение.',
    );
  }

  Future<void> setFavorite(int chatId, bool favorite) async {
    final uri = _buildUri('chats/$chatId/favorite');
    await _sendRequest(
      () => favorite
          ? http.post(uri, headers: _headers)
          : http.delete(uri, headers: _headers),
      'Не удалось обновить избранное.',
    );
    if (_currentUser != null) {
      final updatedFavorites = Set<int>.from(_currentUser!.favoriteChatIds);
      if (favorite) {
        updatedFavorites.add(chatId);
      } else {
        updatedFavorites.remove(chatId);
      }
      _currentUser = _currentUser!.copyWith(favoriteChatIds: updatedFavorites);
      _favoriteChatIds
        ..clear()
        ..addAll(updatedFavorites);
    }
  }

  Future<void> deleteChat(int chatId) async {
    final uri = _buildUri('chats/$chatId');
    await _sendRequest(
      () => http.delete(uri, headers: _headers),
      'Не удалось удалить диалог.',
    );
    if (_currentUser != null) {
      final updatedFavorites = Set<int>.from(_favoriteChatIds)..remove(chatId);
      _favoriteChatIds
        ..clear()
        ..addAll(updatedFavorites);
      _currentUser = _currentUser!.copyWith(favoriteChatIds: updatedFavorites);
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

  Future<UserProfile> updateUserBins(int userId, List<String> bins) async {
    final uri = _buildUri('users/$userId/bins');
    final response = await _sendRequest(
      () => http.put(
        uri,
        headers: _headers,
        body: jsonEncode({'bins': bins}),
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
    return decoded
        .map((item) => MessageNotification.fromJson(item as Map<String, dynamic>))
        .toList();
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

class AuthScreen extends StatefulWidget {
  const AuthScreen({required this.apiClient, required this.onAuthenticated, super.key});

  final ApiClient apiClient;
  final void Function(AuthSession session) onAuthenticated;

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
    final title = _isLogin ? 'Добро пожаловать' : 'Создание аккаунта';
    final description = _isLogin
        ? 'Введите логин или e-mail и пароль, чтобы продолжить работу.'
        : 'Заполните форму, чтобы подключиться. Пароль должен содержать минимум 5 символов.';

    return Scaffold(
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
              final minHeight = constraints.maxHeight.isFinite
                  ? (constraints.maxHeight - 64).clamp(0.0, double.infinity)
                  : 0.0;
              return SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 440),
                    child: Card(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minHeight: minHeight),
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
    super.key,
  });

  final ApiClient apiClient;
  final AuthSession session;
  final VoidCallback onLogout;
  final ValueChanged<UserProfile> onProfileUpdated;
  final ValueChanged<AuthSession> onSessionRefreshed;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
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
  Timer? _updatesTimer;
  DateTime? _lastUpdateCursor;
  final GlobalKey<_OperatorProfileViewState> _profileKey = GlobalKey<_OperatorProfileViewState>();
  final GlobalKey<_AdminUserManagementViewState> _adminKey = GlobalKey<_AdminUserManagementViewState>();

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
      final chats = await widget.apiClient.fetchChats(binQuery: _selectedBin);
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
          .map((item) => item.chatId == chat.chatId
              ? item.copyWith(isFavorite: newValue)
              : item)
          .toList();
    });
    try {
      await widget.apiClient.setFavorite(chat.chatId, newValue);
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
            .map((item) => item.chatId == chat.chatId
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
    return result.toList();
  }

  PreferredSizeWidget _buildAppBar(int index, bool isAdmin) {
    if (index == 0) {
      return AppBar(
        title: const Text('Диалоги Telegram'),
        actions: [
          IconButton(
            tooltip: 'Обновить',
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadData(),
          ),
          IconButton(
            tooltip: 'Выход',
            icon: const Icon(Icons.logout),
            onPressed: widget.onLogout,
          ),
        ],
      );
    }
    if (isAdmin && index == 1) {
      return AppBar(
        title: const Text('Управление ролями'),
        actions: [
          IconButton(
            tooltip: 'Обновить список',
            icon: const Icon(Icons.refresh),
            onPressed: () => _adminKey.currentState?.refreshAdminData(),
          ),
          IconButton(
            tooltip: 'Выход',
            icon: const Icon(Icons.logout),
            onPressed: widget.onLogout,
          ),
        ],
      );
    }
    return AppBar(
      title: const Text('Профиль оператора'),
      actions: [
        IconButton(
          tooltip: 'Выход',
          icon: const Icon(Icons.logout),
          onPressed: widget.onLogout,
        ),
      ],
    );
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
    final filtersCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButtonFormField<String?>(
                value: _selectedSection,
                decoration: const InputDecoration(labelText: 'Раздел'),
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('Все разделы'),
                  ),
                  ..._sections.map(
                    (section) => DropdownMenuItem<String?>(
                      value: section.id,
                      child: Text(section.title),
                    ),
                  ),
                ],
                onChanged: (value) {
                  setState(() {
                    _selectedSection = value;
                  });
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                value: _selectedBin,
                decoration: const InputDecoration(labelText: 'БИН'),
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('Все БИНы'),
                  ),
                  ..._availableBins.map(
                    (bin) => DropdownMenuItem<String?>(
                      value: bin,
                      child: Text(bin),
                    ),
                  ),
                ],
                onChanged: (value) {
                  setState(() {
                    _selectedBin = value;
                  });
                  _loadData(showLoading: false);
                },
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  FilterChip(
                    label: const Text('Только избранные'),
                    selected: _showFavoritesOnly,
                    showCheckmark: false,
                    onSelected: (value) {
                      setState(() {
                        _showFavoritesOnly = value;
                      });
                    },
                  ),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: () => _loadData(),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Обновить'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    final chats = _filteredChats;
    final currentUser = widget.apiClient.currentUser ?? widget.session.user;
    final canDeleteChats = currentUser.isAdmin || currentUser.canReply;

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
                'Сообщения из Telegram появятся здесь автоматически.',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        )
      else
        ...chats.map((chat) {
          final updatedAt = DateFormat('dd.MM.yyyy HH:mm').format(chat.updatedAt.toLocal());
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () async {
                  final deleted = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => ChatDetailScreen(
                        apiClient: widget.apiClient,
                        chat: chat,
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
                        children: [
                          Expanded(
                            child: Text(
                              chat.title,
                              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                            ),
                          ),
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
                          if (canDeleteChats)
                            PopupMenuButton<String>(
                              onSelected: (value) {
                                if (value == 'delete') {
                                  _confirmDeleteChat(chat);
                                }
                              },
                              itemBuilder: (context) => const [
                                PopupMenuItem(
                                  value: 'delete',
                                  child: Text('Удалить диалог'),
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
                      const SizedBox(height: 4),
                      Text(
                        'Обновлён: $updatedAt',
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
  late Timer _timer;
  final TextEditingController _messageController = TextEditingController();
  List<Message> _messages = [];
  bool _loading = true;
  String? _error;
  bool _isFavorite = false;
  bool _updatingFavorite = false;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _fetchMessages();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _fetchMessages());
    _isFavorite = widget.chat.isFavorite;
  }

  @override
  void dispose() {
    _timer.cancel();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _fetchMessages() async {
    try {
      final messages = await widget.apiClient.fetchMessages(widget.chat.chatId);
      setState(() {
        _messages = messages;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
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
      await widget.apiClient.sendMessage(widget.chat.chatId, text);
      _messageController.clear();
      await _fetchMessages();
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
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
      await widget.apiClient.setFavorite(widget.chat.chatId, _isFavorite);
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

  Future<void> _deleteChat() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить диалог?'),
          content: Text('Переписка с "${widget.chat.title}" будет удалена без возможности восстановления.'),
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
      await widget.apiClient.deleteChat(widget.chat.chatId);
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
        ? (_messages.last.sectionTitle ?? widget.chat.sectionTitle)
        : widget.chat.sectionTitle;
    final sectionTitle = latestSectionTitle ?? 'Раздел не выбран';
    final user = widget.apiClient.currentUser;
    final canSend = user?.canReply ?? false;
    final operatorSuffix = user != null
        ? ' (${user.name}${user.jobTitle.isNotEmpty ? ', ${user.jobTitle}' : ''})'
        : '';
    final canDelete = (user?.isAdmin ?? false) || (user?.canReply ?? false);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.chat.title),
        actions: [
          IconButton(
            tooltip: _isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
            icon: Icon(_isFavorite ? Icons.star : Icons.star_border),
            color: _isFavorite ? colorScheme.tertiary : null,
            onPressed: (_updatingFavorite || _deleting) ? null : _toggleFavorite,
          ),
          if (canDelete)
            PopupMenuButton<String>(
              enabled: !_deleting,
              onSelected: (value) {
                if (value == 'delete') {
                  _deleteChat();
                }
              },
              itemBuilder: (context) => const [
                PopupMenuItem(
                  value: 'delete',
                  child: Text('Удалить диалог'),
                ),
              ],
            ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              children: [
                Text('Раздел: $sectionTitle'),
                if (widget.chat.bin != null && widget.chat.bin!.isNotEmpty)
                  Text('БИН: ${widget.chat.bin}', style: const TextStyle(fontSize: 12)),
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
                    ),
                    enabled: canSend && !_deleting,
                    keyboardType: TextInputType.multiline,
                    textCapitalization: TextCapitalization.sentences,
                    minLines: 1,
                    maxLines: 4,
                    onSubmitted: canSend && !_deleting ? (_) => _sendMessage() : null,
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: canSend && !_deleting ? _sendMessage : null,
                  icon: const Icon(Icons.send),
                  label: const Text('Отправить'),
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
  final Set<int> _updatingUserIds = <int>{};
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _binSearchController = TextEditingController();
  Timer? _searchDebounce;
  Timer? _binSearchDebounce;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    refreshAdminData();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _binSearchDebounce?.cancel();
    _searchController.dispose();
    _binSearchController.dispose();
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
      final roles = await widget.apiClient.fetchRoles();
      final query = _searchQuery.trim().isEmpty ? null : _searchQuery.trim();
      final users = await widget.apiClient.fetchUsers(query: query);
      final sections = await widget.apiClient.fetchSections();
      final bins = await widget.apiClient.fetchBins();
      if (!mounted) {
        return;
      }
      setState(() {
        _roles = roles;
        _users = users;
        _availableSections = sections;
        _availableBins = bins;
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

  void _onBinSearchChanged(String value) {
    _binSearchDebounce?.cancel();
    _binSearchDebounce = Timer(const Duration(milliseconds: 300), () async {
      try {
        final bins = await widget.apiClient.fetchBins(query: value);
        if (!mounted) return;
        setState(() {
          _availableBins = bins;
        });
      } catch (error) {
        debugPrint('Не удалось загрузить БИНы: $error');
      }
    });
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

  Future<void> _updateUserBins(UserProfile user, Set<String> bins) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserBins(user.id, bins.toList());
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
          final badgeColor = user.isAdmin
              ? theme.colorScheme.errorContainer
              : (user.canReply
                  ? theme.colorScheme.primaryContainer
                  : theme.colorScheme.surfaceVariant);
          final badgeTextColor = user.isAdmin
              ? theme.colorScheme.onErrorContainer
              : (user.canReply
                  ? theme.colorScheme.onPrimaryContainer
                  : theme.colorScheme.onSurfaceVariant);
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
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
                            user.name,
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        Chip(
                          label: Text(user.roleLabel),
                          backgroundColor: badgeColor,
                          labelStyle: TextStyle(color: badgeTextColor, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text('Email: ${user.email}'),
                    Text('Логин: ${user.login}'),
                    Text('Создан: ${DateFormat('dd.MM.yyyy HH:mm').format(user.createdAt.toLocal())}'),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        const Text('Роль:'),
                        const SizedBox(width: 12),
                        Expanded(
                          child: DropdownButtonHideUnderline(
                            child: DropdownButton<String>(
                              value: user.role,
                              isExpanded: true,
                              items: roleItems,
                              onChanged: (!isSelf && !isUpdating)
                                  ? (value) {
                                      if (value == null || value == user.role) {
                                        return;
                                      }
                                      _changeRole(user, value);
                                    }
                                  : null,
                            ),
                          ),
                        ),
                        if (isUpdating)
                          const Padding(
                            padding: EdgeInsets.only(left: 12),
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Доступные разделы:',
                      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: _availableSections.map((section) {
                        final selected = user.sections.contains(section.id);
                        return FilterChip(
                          label: Text(section.title),
                          selected: selected,
                          showCheckmark: false,
                          selectedColor: theme.colorScheme.primaryContainer,
                          onSelected: (!isUpdating)
                              ? (value) {
                                  final updatedSections = Set<String>.from(user.sections);
                                  if (value) {
                                    updatedSections.add(section.id);
                                  } else {
                                    updatedSections.remove(section.id);
                                  }
                                  _updateUserSections(user, updatedSections);
                                }
                              : null,
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Назначенные БИНы:',
                      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    // Поле поиска и добавления БИНов
                    TextField(
                      controller: _binSearchController,
                      decoration: const InputDecoration(
                        labelText: 'Поиск БИНов',
                        prefixIcon: Icon(Icons.search),
                        suffixIcon: Icon(Icons.add),
                      ),
                      onChanged: _onBinSearchChanged,
                      onSubmitted: (value) {
                        if (value.trim().isNotEmpty && !user.bins.contains(value.trim())) {
                          final updatedBins = Set<String>.from(user.bins)..add(value.trim());
                          _updateUserBins(user, updatedBins);
                          _binSearchController.clear();
                        }
                      },
                    ),
                    const SizedBox(height: 8),
                    // Список доступных БИНов для выбора
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: _availableBins.map((bin) {
                        final selected = user.bins.contains(bin);
                        return FilterChip(
                          label: Text(bin),
                          selected: selected,
                          showCheckmark: false,
                          selectedColor: theme.colorScheme.primaryContainer,
                          onSelected: (!isUpdating)
                              ? (value) {
                                  final updatedBins = Set<String>.from(user.bins);
                                  if (value) {
                                    updatedBins.add(bin);
                                  } else {
                                    updatedBins.remove(bin);
                                  }
                                  _updateUserBins(user, updatedBins);
                                }
                              : null,
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 8),
                    // Текущие назначенные БИНы
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: user.bins.map((bin) {
                        return Chip(
                          label: Text(bin),
                          backgroundColor: theme.colorScheme.primaryContainer,
                          onDeleted: (!isUpdating)
                              ? () {
                                  final updatedBins = Set<String>.from(user.bins)..remove(bin);
                                  _updateUserBins(user, updatedBins);
                                }
                              : null,
                        );
                      }).toList(),
                    ),
                    if (isSelf)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Нельзя изменять собственную роль администратора.',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                        ),
                      ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        OutlinedButton.icon(
                          icon: const Icon(Icons.lock_reset),
                          label: const Text('Сменить пароль'),
                          onPressed: isUpdating ? null : () => _promptResetPassword(user),
                        ),
                      ],
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
            if (_profile != null)
              Text(
                'Аккаунт создан: ${DateFormat('dd.MM.yyyy HH:mm').format(_profile!.createdAt.toLocal())}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (_profile != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Текущая роль: ${_profile!.roleLabel}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            if (_profile != null) ...[
              const SizedBox(height: 12),
              Text(
                'Назначенные разделы:',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              if (_profile!.sections.isEmpty)
                const Text(
                  'Разделы ещё не назначены. Обратитесь к администратору.',
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: _profile!.sections.map((sectionId) {
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
              if (_profile!.bins.isEmpty)
                const Text(
                  'БИНы ещё не назначены. Обратитесь к администратору.',
                )
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: _profile!.bins.map((bin) {
                    return Chip(label: Text(bin));
                  }).toList(),
                ),
              const SizedBox(height: 8),
              Text(
                'Избранных диалогов: ${_profile!.favoriteChatIds.length}',
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
                  onPressed: _saving ? null : refreshProfile,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Обновить'),
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

class ChatSummary {
  ChatSummary({
    required this.chatId,
    required this.title,
    required this.username,
    required this.type,
    required this.updatedAt,
    required this.section,
    required this.sectionTitle,
    required this.bin,
    required this.isFavorite,
  });

  final int chatId;
  final String title;
  final String? username;
  final String type;
  final DateTime updatedAt;
  final String? section;
  final String? sectionTitle;
  final String? bin;
  final bool isFavorite;

  String get updatedAtLabel => DateFormat('HH:mm').format(updatedAt.toLocal());

  ChatSummary copyWith({bool? isFavorite}) {
    return ChatSummary(
      chatId: chatId,
      title: title,
      username: username,
      type: type,
      updatedAt: updatedAt,
      section: section,
      sectionTitle: sectionTitle,
      bin: bin,
      isFavorite: isFavorite ?? this.isFavorite,
    );
  }

  factory ChatSummary.fromJson(Map<String, dynamic> json) {
    return ChatSummary(
      chatId: json['chat_id'] as int,
      title: json['title'] as String,
      username: json['username'] as String?,
      type: json['type'] as String,
      updatedAt: DateTime.parse(json['updated_at'] as String),
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
      bin: json['bin'] as String?,
      isFavorite: json['is_favorite'] as bool? ?? false,
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
    return Message(
      id: json['id'] as int,
      chatId: json['chat_id'] as int,
      direction: json['direction'] as String,
      text: json['text'] as String,
      author: json['author'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
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

  factory MessageNotification.fromJson(Map<String, dynamic> json) {
    return MessageNotification(
      chatId: json['chat_id'] as int,
      chatTitle: json['chat_title'] as String,
      text: json['text'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
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
    required List<String> bins,
    required Set<int> favoriteChatIds,
  })  : sections = List.unmodifiable(sections),
        bins = List.unmodifiable(bins),
        favoriteChatIds = Set<int>.unmodifiable(favoriteChatIds);

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
  final List<String> bins;
  final Set<int> favoriteChatIds;

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
    return bins.contains(bin);
  }

  UserProfile copyWith({
    String? name,
    String? jobTitle,
    String? phone,
    String? bio,
    String? role,
    List<String>? sections,
    List<String>? bins,
    Set<int>? favoriteChatIds,
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
      bins: bins ?? this.bins,
      favoriteChatIds: favoriteChatIds ?? this.favoriteChatIds,
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
      'bins': bins,
      'favorite_chat_ids': favoriteChatIds.toList(),
    };
  }

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    final sectionList = (json['sections'] as List<dynamic>? ?? [])
        .map((item) => item.toString())
        .toList();
    final binList = (json['bins'] as List<dynamic>? ?? [])
        .map((item) => item.toString())
        .toList();
    final favorites = (json['favorite_chat_ids'] as List<dynamic>? ?? [])
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
      bins: binList,
      favoriteChatIds: favorites,
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
