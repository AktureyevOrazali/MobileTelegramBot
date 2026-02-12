import 'package:flutter/material.dart';

const Color brandPrimaryGreen = Color(0xFF4CAF50);
const Color brandTeal = Color(0xFF0F7F71);
const Color brandScaffoldBackground = Color(0xFFF1F6EF);
const Color brandPrimaryText = Color(0xFF1F1F1F);
const Color brandError = Color(0xFFB00020);
const Color brandAccentMint = Color(0xFF7ED9B7);

class AppGradients {
  const AppGradients._();

  static LinearGradient authBackground(ColorScheme colorScheme) {
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [
        colorScheme.primary.withOpacity(0.22),
        colorScheme.secondary.withOpacity(0.15),
        colorScheme.tertiary.withOpacity(0.08),
        colorScheme.surface,
      ],
      stops: const [0, 0.3, 0.6, 1],
    );
  }

  static LinearGradient primaryAction(ColorScheme colorScheme) {
    return LinearGradient(
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
      colors: [
        colorScheme.primary,
        brandAccentMint,
      ],
    );
  }

  static LinearGradient appBar(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: isDark
          ? [
              const Color(0xFF1A2F28),
              const Color(0xFF0D1F1A),
            ]
          : [
              brandTeal,
              const Color(0xFF0A6B5E),
            ],
    );
  }

  static LinearGradient cardHeader(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: isDark
          ? [
              colorScheme.primary.withOpacity(0.18),
              colorScheme.secondary.withOpacity(0.10),
            ]
          : [
              colorScheme.primary.withOpacity(0.08),
              colorScheme.secondary.withOpacity(0.04),
            ],
    );
  }

  static LinearGradient surfaceOverlay(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: isDark
          ? [
              colorScheme.surface.withOpacity(0.85),
              colorScheme.surface.withOpacity(0.95),
            ]
          : [
              colorScheme.surface.withOpacity(0.88),
              colorScheme.surface.withOpacity(0.96),
            ],
    );
  }

  static LinearGradient selectedChip(ColorScheme colorScheme) {
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [
        colorScheme.primary,
        colorScheme.primary.withOpacity(0.78),
      ],
    );
  }

  static LinearGradient outgoingBubble(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: isDark
          ? [
              const Color(0xFF164D38),
              const Color(0xFF103D2D),
            ]
          : [
              const Color(0xFFDAFDD4),
              const Color(0xFFC8F0C0),
            ],
    );
  }
}

class AppBadgeColors {
  final Color background;
  final Color border;
  final Color foreground;

  const AppBadgeColors({
    required this.background,
    required this.border,
    required this.foreground,
  });

  AppBadgeColors copyWith(
      {Color? background, Color? border, Color? foreground}) {
    return AppBadgeColors(
      background: background ?? this.background,
      border: border ?? this.border,
      foreground: foreground ?? this.foreground,
    );
  }

  static AppBadgeColors lerp(AppBadgeColors? a, AppBadgeColors? b, double t) {
    if (a == null && b == null) {
      return const AppBadgeColors(
        background: Colors.transparent,
        border: Colors.transparent,
        foreground: Colors.transparent,
      );
    }
    if (a == null) return b!;
    if (b == null) return a;

    return AppBadgeColors(
      background:
          Color.lerp(a.background, b.background, t) ?? Colors.transparent,
      border: Color.lerp(a.border, b.border, t) ?? Colors.transparent,
      foreground:
          Color.lerp(a.foreground, b.foreground, t) ?? Colors.transparent,
    );
  }
}

@immutable
class AppColors extends ThemeExtension<AppColors> {
  final AppBadgeColors statusOpenBadge;
  final AppBadgeColors statusClosedBadge;
  final AppBadgeColors aiEnabledBadge;
  final AppBadgeColors aiDisabledBadge;
  final Color incomingMessageBackground;
  final Color incomingMessageText;
  final Color outgoingMessageBackground;
  final Color outgoingMessageText;
  final Color bottomBarInactive;
  final Color scaffoldBackground;
  final Color appBarColor;
  final Color appBarForeground;
  final Color cardGradientStart;
  final Color cardGradientEnd;
  final Color accentGlow;

  const AppColors({
    required this.statusOpenBadge,
    required this.statusClosedBadge,
    required this.aiEnabledBadge,
    required this.aiDisabledBadge,
    required this.incomingMessageBackground,
    required this.incomingMessageText,
    required this.outgoingMessageBackground,
    required this.outgoingMessageText,
    required this.bottomBarInactive,
    required this.scaffoldBackground,
    required this.appBarColor,
    required this.appBarForeground,
    required this.cardGradientStart,
    required this.cardGradientEnd,
    required this.accentGlow,
  });

  static const light = AppColors(
    statusOpenBadge: AppBadgeColors(
      background: Color(0xFFE8F5E9),
      border: Color(0xFFA5D6A7),
      foreground: Color(0xFF388E3C),
    ),
    statusClosedBadge: AppBadgeColors(
      background: Color(0xFFFFEBEE),
      border: Color(0xFFEF9A9A),
      foreground: Color(0xFFD32F2F),
    ),
    aiEnabledBadge: AppBadgeColors(
      background: Color(0xFFE8EAF6),
      border: Color(0xFF9FA8DA),
      foreground: Color(0xFF303F9F),
    ),
    aiDisabledBadge: AppBadgeColors(
      background: Color(0xFFEEEEEE),
      border: Color(0xFFE0E0E0),
      foreground: Color(0xFF616161),
    ),
    incomingMessageBackground: Colors.white,
    incomingMessageText: brandPrimaryText,
    outgoingMessageBackground: Color(0xFFD9FDD3),
    outgoingMessageText: brandPrimaryText,
    bottomBarInactive: Color(0xFF9E9E9E),
    scaffoldBackground: brandScaffoldBackground,
    appBarColor: brandTeal,
    appBarForeground: Colors.white,
    cardGradientStart: Color(0xFFF0FAF0),
    cardGradientEnd: Colors.white,
    accentGlow: Color(0x2A4CAF50),
  );

  static const dark = AppColors(
    statusOpenBadge: AppBadgeColors(
      background: Color(0xFF1F3326),
      border: Color(0xFF2F5D3A),
      foreground: Color(0xFF9CE6B3),
    ),
    statusClosedBadge: AppBadgeColors(
      background: Color(0xFF3A2226),
      border: Color(0xFF6A2D35),
      foreground: Color(0xFFFFB3C0),
    ),
    aiEnabledBadge: AppBadgeColors(
      background: Color(0xFF1F2B46),
      border: Color(0xFF304B7A),
      foreground: Color(0xFFB8CCFF),
    ),
    aiDisabledBadge: AppBadgeColors(
      background: Color(0xFF2A2C33),
      border: Color(0xFF3C4048),
      foreground: Color(0xFFB0B4BE),
    ),
    incomingMessageBackground: Color(0xFF1E1E1E),
    incomingMessageText: Colors.white,
    outgoingMessageBackground: Color(0xFF144D37),
    outgoingMessageText: Colors.white,
    bottomBarInactive: Color(0xFF9E9E9E),
    scaffoldBackground: Color(0xFF121212),
    appBarColor: Color(0xFF121212),
    appBarForeground: Colors.white,
    cardGradientStart: Color(0xFF1A2A22),
    cardGradientEnd: Color(0xFF1E1E1E),
    accentGlow: Color(0x3A4CAF50),
  );

  @override
  AppColors copyWith({
    AppBadgeColors? statusOpenBadge,
    AppBadgeColors? statusClosedBadge,
    AppBadgeColors? aiEnabledBadge,
    AppBadgeColors? aiDisabledBadge,
    Color? incomingMessageBackground,
    Color? incomingMessageText,
    Color? outgoingMessageBackground,
    Color? outgoingMessageText,
    Color? bottomBarInactive,
    Color? scaffoldBackground,
    Color? appBarColor,
    Color? appBarForeground,
    Color? cardGradientStart,
    Color? cardGradientEnd,
    Color? accentGlow,
  }) {
    return AppColors(
      statusOpenBadge: statusOpenBadge ?? this.statusOpenBadge,
      statusClosedBadge: statusClosedBadge ?? this.statusClosedBadge,
      aiEnabledBadge: aiEnabledBadge ?? this.aiEnabledBadge,
      aiDisabledBadge: aiDisabledBadge ?? this.aiDisabledBadge,
      incomingMessageBackground:
          incomingMessageBackground ?? this.incomingMessageBackground,
      incomingMessageText: incomingMessageText ?? this.incomingMessageText,
      outgoingMessageBackground:
          outgoingMessageBackground ?? this.outgoingMessageBackground,
      outgoingMessageText: outgoingMessageText ?? this.outgoingMessageText,
      bottomBarInactive: bottomBarInactive ?? this.bottomBarInactive,
      scaffoldBackground: scaffoldBackground ?? this.scaffoldBackground,
      appBarColor: appBarColor ?? this.appBarColor,
      appBarForeground: appBarForeground ?? this.appBarForeground,
      cardGradientStart: cardGradientStart ?? this.cardGradientStart,
      cardGradientEnd: cardGradientEnd ?? this.cardGradientEnd,
      accentGlow: accentGlow ?? this.accentGlow,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;

    return AppColors(
      statusOpenBadge:
          AppBadgeColors.lerp(statusOpenBadge, other.statusOpenBadge, t),
      statusClosedBadge:
          AppBadgeColors.lerp(statusClosedBadge, other.statusClosedBadge, t),
      aiEnabledBadge:
          AppBadgeColors.lerp(aiEnabledBadge, other.aiEnabledBadge, t),
      aiDisabledBadge:
          AppBadgeColors.lerp(aiDisabledBadge, other.aiDisabledBadge, t),
      incomingMessageBackground: Color.lerp(
              incomingMessageBackground, other.incomingMessageBackground, t) ??
          incomingMessageBackground,
      incomingMessageText:
          Color.lerp(incomingMessageText, other.incomingMessageText, t) ??
              incomingMessageText,
      outgoingMessageBackground: Color.lerp(
              outgoingMessageBackground, other.outgoingMessageBackground, t) ??
          outgoingMessageBackground,
      outgoingMessageText:
          Color.lerp(outgoingMessageText, other.outgoingMessageText, t) ??
              outgoingMessageText,
      bottomBarInactive:
          Color.lerp(bottomBarInactive, other.bottomBarInactive, t) ??
              bottomBarInactive,
      scaffoldBackground:
          Color.lerp(scaffoldBackground, other.scaffoldBackground, t) ??
              scaffoldBackground,
      appBarColor: Color.lerp(appBarColor, other.appBarColor, t) ?? appBarColor,
      appBarForeground:
          Color.lerp(appBarForeground, other.appBarForeground, t) ??
              appBarForeground,
      cardGradientStart:
          Color.lerp(cardGradientStart, other.cardGradientStart, t) ??
              cardGradientStart,
      cardGradientEnd:
          Color.lerp(cardGradientEnd, other.cardGradientEnd, t) ??
              cardGradientEnd,
      accentGlow:
          Color.lerp(accentGlow, other.accentGlow, t) ?? accentGlow,
    );
  }
}

const ColorScheme brandLightColorScheme = ColorScheme(
  brightness: Brightness.light,
  primary: brandPrimaryGreen,
  onPrimary: Colors.white,
  primaryContainer: Color(0xFFC8E6C9),
  onPrimaryContainer: brandPrimaryText,
  secondary: brandTeal,
  onSecondary: Colors.white,
  secondaryContainer: Color(0xFFB2DFDB),
  onSecondaryContainer: brandPrimaryText,
  tertiary: Color(0xFF4DB6AC),
  onTertiary: Colors.white,
  tertiaryContainer: Color(0xFFB2EBF2),
  onTertiaryContainer: brandPrimaryText,
  error: brandError,
  onError: Colors.white,
  background: brandScaffoldBackground,
  onBackground: brandPrimaryText,
  surface: Colors.white,
  onSurface: brandPrimaryText,
  surfaceVariant: Color(0xFFE5E8E3),
  onSurfaceVariant: Color(0xFF6F6F6F),
  outline: Color(0xFFBDBDBD),
  outlineVariant: Color(0xFFE0E0E0),
  shadow: Colors.black,
  scrim: Colors.black,
  inverseSurface: Color(0xFF2E2E2E),
  onInverseSurface: Colors.white,
  inversePrimary: brandPrimaryGreen,
);

final ColorScheme brandDarkColorScheme = ColorScheme(
  brightness: Brightness.dark,
  primary: brandPrimaryGreen,
  onPrimary: Colors.white,
  primaryContainer: const Color(0xFF1B5E20),
  onPrimaryContainer: Colors.white,
  secondary: brandTeal,
  onSecondary: Colors.white,
  secondaryContainer: const Color(0xFF0C5F56),
  onSecondaryContainer: Colors.white,
  tertiary: const Color(0xFF26A69A),
  onTertiary: Colors.black,
  tertiaryContainer: const Color(0xFF16433E),
  onTertiaryContainer: Colors.white,
  error: brandError,
  onError: Colors.white,
  background: const Color(0xFF121212),
  onBackground: Colors.white,
  surface: const Color(0xFF1E1E1E),
  onSurface: Colors.white,
  surfaceVariant: const Color(0xFF2C2F2B),
  onSurfaceVariant: Colors.white70,
  outline: Colors.white24,
  outlineVariant: Colors.white10,
  shadow: Colors.black,
  scrim: Colors.black,
  inverseSurface: Colors.white,
  onInverseSurface: brandPrimaryText,
  inversePrimary: brandPrimaryGreen,
);
