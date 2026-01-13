part of '../main.dart';

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => message;
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

  String _decodeBody(http.Response response) {
    return utf8.decode(response.bodyBytes);
  }

  Future<AuthSession> register(String name, String email, String password) async {
    final uri = _buildUri('auth/register');
    final response = await _sendRequest(
      () => http.post(
        uri,
        headers: _headers,
        body: jsonEncode({'name': name, 'email': email, 'password': password}),
      ),
      'Соединение с сервером не удалось.',
    );
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
      'Соединение с сервером не удалось.',
    );
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
    return decoded.map((item) => item.toString()).toList();
  }

  Future<List<UnassignedBin>> fetchUnassignedBins() async {
    List<UnassignedBin> parseResponse(http.Response response) {
      final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
    return DialogStatusUpdate.fromJson(decoded);
  }

  Future<DialogStatusUpdate> openDialog(int dialogId) async {
    final uri = _buildUri('dialogs/$dialogId/open');
    final response = await _sendRequest(
      () => http.post(uri, headers: _headers),
      'Не удалось открыть диалог.',
    );
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
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
    return UserProfile.fromJson(jsonDecode(_decodeBody(response)) as Map<String, dynamic>);
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
    return UserProfile.fromJson(jsonDecode(_decodeBody(response)) as Map<String, dynamic>);
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
    return UserProfile.fromJson(jsonDecode(_decodeBody(response)) as Map<String, dynamic>);
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
    final decoded = jsonDecode(_decodeBody(response)) as List<dynamic>;
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
    final decoded = jsonDecode(_decodeBody(response)) as Map<String, dynamic>;
    return DashboardSummary.fromJson(decoded);
  }

  Future<http.Response> _sendRequest(
    Future<http.Response> Function() request,
    String fallbackMessage,
    ) async {
      try {
        final response = await request().timeout(const Duration(seconds: 12));
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
    final body = _decodeBody(response).trim();
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

