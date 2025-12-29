part of '../main.dart';

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
