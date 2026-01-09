import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_theme.dart';

class ThemeManager extends ChangeNotifier {
  static const _storageKey = 'isDarkMode';

  bool _isDarkMode = false;

  bool get isDarkMode => _isDarkMode;

  AppColors get appColors => _isDarkMode ? AppColors.dark : AppColors.light;

  ColorScheme get colorScheme =>
      _isDarkMode ? brandDarkColorScheme : brandLightColorScheme;

  IconData get themeIcon => _isDarkMode ? Icons.wb_sunny : Icons.nights_stay;

  Color get iconColor => _isDarkMode ? Colors.white : Colors.black;

  Color get appBarColor => appColors.appBarColor;

  Color get appBarForeground => appColors.appBarForeground;

  Color get primaryBackgroundColor => appColors.scaffoldBackground;

  Color get primaryTextColor =>
      _isDarkMode ? Colors.white : brandPrimaryText;

  Color get secondaryTextColor =>
      _isDarkMode ? Colors.white70 : colorScheme.onSurfaceVariant;

  Future<void> loadTheme() async {
    final prefs = await SharedPreferences.getInstance();
    _isDarkMode = prefs.getBool(_storageKey) ?? false;
    notifyListeners();
  }

  Future<void> toggleTheme() async {
    final prefs = await SharedPreferences.getInstance();
    _isDarkMode = !_isDarkMode;
    await prefs.setBool(_storageKey, _isDarkMode);
    notifyListeners();
  }
}