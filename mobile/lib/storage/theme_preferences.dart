part of '../main.dart';

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