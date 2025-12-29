part of '../main.dart';

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
    UiLogger.page('app', state: 'initializing');
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
      UiLogger.action(
        'SESSION',
        'restored from storage',
        details: {'user': restored.user.email},
      );
    } else {
      setState(() {
        _initializing = false;
      });
      UiLogger.action('SESSION', 'no cached session');
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
    UiLogger.action('THEME', 'mode changed', details: {'mode': mode.name});
    unawaited(_themePreferences.save(mode));
  }

  void _handleAuthenticated(AuthSession session) {
    apiClient.setSession(session);
    setState(() {
      _session = session;
    });
    UiLogger.action('SESSION', 'authenticated', details: {'user': session.user.email});
    unawaited(_sessionStorage.save(session));
  }

  void _handleLogout() {
    apiClient.clearSession();
    setState(() {
      _session = null;
    });
    UiLogger.action('SESSION', 'logged out');
    unawaited(_sessionStorage.clear());
  }

  void _handleProfileUpdated(UserProfile profile) {
    apiClient.updateCurrentUser(profile);
    setState(() {
      if (_session != null) {
        _session = _session!.copyWith(user: profile);
      }
    });
    UiLogger.action('PROFILE', 'updated', details: {'name': profile.name});
    _persistCurrentSession();
  }

  void _handleSessionRefreshed(AuthSession session) {
    apiClient.setSession(session);
    setState(() {
      _session = session;
    });
    UiLogger.action('SESSION', 'refreshed', details: {'user': session.user.email});
    unawaited(_sessionStorage.save(session));
  }

  void _persistCurrentSession() {
    final session = _session;
    if (session != null) {
      unawaited(_sessionStorage.save(session));
    }
  }

  ThemeData _buildTheme(ColorScheme colorScheme, AppColors appColors) {
    final outlineBorder = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.25)),
    );

    final isLight = colorScheme.brightness == Brightness.light;

    return ThemeData(
      colorScheme: colorScheme,
      useMaterial3: true,
      extensions: <ThemeExtension<dynamic>>[appColors],

      // ВАЖНО: в тёмной теме фон должен быть background, а не surface,
      // иначе карточки (surface) сливаются с фоном и "слои" пропадают.
      scaffoldBackgroundColor: isLight ? appColors.scaffoldBackground : colorScheme.background,

      appBarTheme: AppBarTheme(
        backgroundColor: appColors.appBarColor,
        foregroundColor: isLight ? appColors.appBarForeground : colorScheme.onBackground,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: isLight ? appColors.appBarForeground : colorScheme.onBackground,
        ),
      ),

      cardTheme: CardThemeData(
        color: isLight ? Colors.white : colorScheme.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colorScheme.brightness == Brightness.light
            ? Colors.white
            : colorScheme.background, // <-- было surfaceVariant
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

      // ВАЖНО: сейчас у тебя всегда белый navigation bar — в тёмной теме это ломает стиль.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isLight ? Colors.white : colorScheme.surface,
        indicatorColor: colorScheme.secondary,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        labelTextStyle: MaterialStateProperty.resolveWith(
          (states) => TextStyle(
            color: states.contains(MaterialState.selected)
                ? colorScheme.secondary
                : appColors.bottomBarInactive,
            fontWeight: FontWeight.w600,
          ),
        ),
        iconTheme: MaterialStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(MaterialState.selected)
                ? colorScheme.secondary
                : appColors.bottomBarInactive,
          ),
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colorScheme.primary,
          side: BorderSide(color: colorScheme.primary),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
  }


  @override
  Widget build(BuildContext context) {
    final lightTheme = _buildTheme(brandLightColorScheme, AppColors.light);
    final darkTheme = _buildTheme(brandDarkColorScheme, AppColors.dark);

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
