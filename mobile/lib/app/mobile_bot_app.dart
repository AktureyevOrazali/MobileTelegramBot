part of '../main.dart';

class MobileBotModule extends StatefulWidget {
  const MobileBotModule({
    super.key,
    this.apiBaseUrl,
    this.apiToken,
    this.isLogin,
    required this.initialThemeMode,
  });

  /// Optional override for API base URL.
  /// If null, resolves from .env / compile-time value.
  final String? apiBaseUrl;

  /// Optional override for API token.
  /// If null, resolves from .env / compile-time value.
  final String? apiToken;

  final bool? isLogin;
  final ThemeMode initialThemeMode;

  @override
  State<MobileBotModule> createState() => _MobileBotModuleState();
}

class _MobileBotModuleState extends State<MobileBotModule> {
  late final ApiClient apiClient;
  final SessionStorage _sessionStorage = const SessionStorage();
  final ThemePreferences _themePreferences = const ThemePreferences();
  AuthSession? _session;
  bool _initializing = true;
  late ThemeMode _themeMode;

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
    UiLogger.page('module', state: 'initializing');
    _themeMode = widget.initialThemeMode;

    final apiBaseUrl = widget.apiBaseUrl ?? _requireConfig('API_BASE_URL');
    final apiToken = widget.apiToken ?? _requireConfig('API_TOKEN');
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
    UiLogger.action(
      'SESSION',
      'authenticated',
      details: {'user': session.user.email},
    );
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
    UiLogger.action(
      'SESSION',
      'refreshed',
      details: {'user': session.user.email},
    );
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
      borderRadius: BorderRadius.circular(AppRadii.field),
      borderSide: BorderSide(color: colorScheme.outline.withOpacity(0.25)),
    );

    final isLight = colorScheme.brightness == Brightness.light;

    // Base theme with guaranteed non-null text styles.
    final ThemeData base = ThemeData.from(
      colorScheme: colorScheme,
      useMaterial3: true,
    );

    // Safety: ensure bodyMedium is never null to avoid DefaultTextStyle crashes.
    final TextTheme safeTextTheme = base.textTheme.copyWith(
      bodyMedium: base.textTheme.bodyMedium ?? const TextStyle(fontSize: 14),
    );

    return base.copyWith(
      textTheme: safeTextTheme,
      primaryTextTheme: safeTextTheme,
      extensions: <ThemeExtension<dynamic>>[appColors],
      scaffoldBackgroundColor:
          isLight ? appColors.scaffoldBackground : colorScheme.background,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor:
            isLight ? appColors.appBarForeground : colorScheme.onBackground,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: isLight ? Brightness.dark : Brightness.light,
          statusBarBrightness: isLight ? Brightness.light : Brightness.dark,
        ),
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color:
              isLight ? appColors.appBarForeground : colorScheme.onBackground,
        ),
      ),
      cardTheme: CardThemeData(
        color: isLight ? Colors.white : colorScheme.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.card),
          side: BorderSide(
            color: colorScheme.outlineVariant.withOpacity(0.3),
          ),
        ),
        shadowColor: appColors.accentGlow,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isLight
            ? colorScheme.surface.withOpacity(0.88)
            : colorScheme.surface.withOpacity(0.74),
        border: outlineBorder,
        enabledBorder: outlineBorder,
        focusedBorder: outlineBorder.copyWith(
          borderSide: BorderSide(color: colorScheme.primary, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colorScheme.inverseSurface,
        contentTextStyle: TextStyle(color: colorScheme.onInverseSurface),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: isLight ? colorScheme.surface : colorScheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.card),
          side: BorderSide(color: colorScheme.outlineVariant.withOpacity(0.35)),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isLight ? colorScheme.surface : colorScheme.surface,
        modalBackgroundColor: isLight ? colorScheme.surface : colorScheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AppRadii.card),
          ),
          side: BorderSide(color: colorScheme.outlineVariant.withOpacity(0.35)),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: colorScheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.field),
          side: BorderSide(color: colorScheme.outlineVariant.withOpacity(0.35)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isLight ? Colors.white : colorScheme.surface,
        indicatorColor: colorScheme.secondary,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            color: states.contains(WidgetState.selected)
                ? colorScheme.secondary
                : appColors.bottomBarInactive,
            fontWeight: FontWeight.w600,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? colorScheme.secondary
                : appColors.bottomBarInactive,
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.control),
        ),
        side: BorderSide(
          color: colorScheme.outlineVariant.withOpacity(0.4),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          elevation: 0,
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.field),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.field),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colorScheme.primary,
          side: BorderSide(color: colorScheme.primary.withOpacity(0.5)),
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.field),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: colorScheme.primary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.control),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lightTheme = _buildTheme(brandLightColorScheme, AppColors.light);
    final darkTheme = _buildTheme(brandDarkColorScheme, AppColors.dark);

    final bool isAuth = _session == null;

    final Widget home = isAuth
        ? AuthScreen(
            apiClient: apiClient,
            onAuthenticated: _handleAuthenticated,
            themeMode: _themeMode,
            onThemeModeChanged: _handleThemeModeChanged,
            isLogin: widget.isLogin,
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

    final platformBrightness =
        MediaQuery.maybeOf(context)?.platformBrightness ?? Brightness.light;

    final effectiveBrightness = switch (_themeMode) {
      ThemeMode.light => Brightness.light,
      ThemeMode.dark => Brightness.dark,
      ThemeMode.system => platformBrightness,
    };

    final ThemeData effectiveTheme =
        effectiveBrightness == Brightness.dark ? darkTheme : lightTheme;
    final bool useDarkSystemUi = effectiveBrightness == Brightness.dark;
    final SystemUiOverlayStyle overlayStyle = SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness:
          useDarkSystemUi ? Brightness.light : Brightness.dark,
      statusBarBrightness:
          useDarkSystemUi ? Brightness.dark : Brightness.light,
      systemNavigationBarColor:
          useDarkSystemUi ? darkTheme.colorScheme.surface : Colors.white,
      systemNavigationBarIconBrightness:
          useDarkSystemUi ? Brightness.light : Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    );

    final Widget content = _initializing
        ? const Scaffold(body: Center(child: CircularProgressIndicator()))
        : home;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: overlayStyle,
      child: AnimatedTheme(
        data: effectiveTheme,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        child: ScaffoldMessenger(child: Material(child: content)),
      ),
    );
  }
}

class MobileBotApp extends StatefulWidget {
  const MobileBotApp({
    super.key,
    this.isLogin,
    required this.initialThemeMode,
  });

  final bool? isLogin;
  final ThemeMode initialThemeMode;

  @override
  State<MobileBotApp> createState() => _MobileBotAppState();
}

class _MobileBotAppState extends State<MobileBotApp> {
  @override
  void initState() {
    super.initState();
    UiLogger.page('app', state: 'initializing');
  }

  @override
  Widget build(BuildContext context) {
    // Standalone launcher: keep MaterialApp only here.
    // For embedding into another app, use [MobileBotModule] directly.
    return MaterialApp(
      title: 'MobileBot Companion',
      debugShowCheckedModeBanner: false,
      home: MobileBotModule(
        isLogin: widget.isLogin,
        initialThemeMode: widget.initialThemeMode,
      ),
    );
  }
}


