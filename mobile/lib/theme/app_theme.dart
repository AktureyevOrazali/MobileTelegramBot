import 'package:flutter/material.dart';

const Color brandPrimaryGreen = Color(0xFF22C55E);
const Color brandTeal = Color(0xFF1A9B8A);
const Color brandScaffoldBackground = Color(0xFFF7F8FA);
const Color brandPrimaryText = Color(0xFF1A1A1A);
const Color brandError = Color(0xFFDC2626);
const Color brandAccentMint = Color(0xFF6EE7B7);
const Color brandAccentSky = Color(0xFF6B9EEB);
const Color brandAccentIris = Color(0xFF8A8FD8);
const Color brandAccentWarm = Color(0xFFE3A85A);
const Color brandAccentAlert = Color(0xFFE07D76);

class AppRadii {
  const AppRadii._();

  static const double card = 22;
  static const double field = 16;
  static const double control = 14;
  static const double chip = 999;
}

class AppSurfaces {
  const AppSurfaces._();

  static LinearGradient dashboardBg(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: isDark
          ? [
              const Color(0xFF142A24),
              const Color(0xFF0F172A),
            ]
          : [
              const Color(0xFFF2F8F5),
              const Color(0xFFDBEEE8),
            ],
    );
  }

  static Color dashboardScaffold(ColorScheme colorScheme) {
    return colorScheme.brightness == Brightness.dark
        ? const Color(0xFF0F172A)
        : const Color(0xFFDBEEE8);
  }

  static Color dashboardCard(ColorScheme colorScheme) {
    return colorScheme.brightness == Brightness.dark
        ? Color.alphaBlend(
            colorScheme.primary.withValues(alpha: 0.08),
            colorScheme.surfaceContainerHigh,
          )
        : Colors.white;
  }

  static Color dashboardCardBorder(ColorScheme colorScheme) {
    return colorScheme.brightness == Brightness.dark
        ? colorScheme.outlineVariant.withValues(alpha: 0.72)
        : colorScheme.outlineVariant.withValues(alpha: 0.35);
  }

  static Color dashboardCardShadow(ColorScheme colorScheme) {
    return colorScheme.brightness == Brightness.dark
        ? colorScheme.shadow.withValues(alpha: 0.22)
        : colorScheme.shadow.withValues(alpha: 0.03);
  }
}
class AppGradients {
  const AppGradients._();

  static LinearGradient pageBackground(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: isDark
          ? [
              colorScheme.primary.withValues(alpha: 0.08),
              colorScheme.surface,
              colorScheme.surface,
            ]
          : [
              colorScheme.primary.withValues(alpha: 0.05),
              colorScheme.secondary.withValues(alpha: 0.02),
              brandScaffoldBackground,
            ],
    );
  }

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
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      stops: isDark ? null : const [0.0, 0.3, 1.0],
      colors: isDark
          ? [
              const Color(0xFF152E25),
              const Color(0xFF0F172A),
            ]
          : [
              colorScheme.primary.withValues(alpha: 0.08),
              colorScheme.surface.withValues(alpha: 0.94),
              colorScheme.surface,
            ],
    );
  }

  /// Teal gradient for content hero banners (dashboard header, chat detail bar).
  /// Kept separate from [appBar] which is now light/white.
  static LinearGradient heroBanner(ColorScheme colorScheme) {
    final isDark = colorScheme.brightness == Brightness.dark;
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: isDark
          ? [
              const Color(0xFF152E25),
              const Color(0xFF0F2018),
            ]
          : [
              const Color(0xFF1A9B8A),
              const Color(0xFF148577),
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
              const Color(0xFF1A5C42),
              const Color(0xFF134A34),
            ]
          : [
              const Color(0xFFDCFCE7),
              const Color(0xFFC6F5D5),
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
      background: Color(0xFFECFDF5),
      border: Color(0xFFA7F3D0),
      foreground: Color(0xFF059669),
    ),
    statusClosedBadge: AppBadgeColors(
      background: Color(0xFFFFF7ED),
      border: Color(0xFFFED7AA),
      foreground: Color(0xFFEA580C),
    ),
    aiEnabledBadge: AppBadgeColors(
      background: Color(0xFFEFF6FF),
      border: Color(0xFFBFDBFE),
      foreground: Color(0xFF2563EB),
    ),
    aiDisabledBadge: AppBadgeColors(
      background: Color(0xFFF1F5F9),
      border: Color(0xFFE2E8F0),
      foreground: Color(0xFF64748B),
    ),
    incomingMessageBackground: Colors.white,
    incomingMessageText: brandPrimaryText,
    outgoingMessageBackground: Color(0xFFDCFCE7),
    outgoingMessageText: brandPrimaryText,
    bottomBarInactive: Color(0xFF94A3B8),
    scaffoldBackground: brandScaffoldBackground,
    appBarColor: Colors.white,
    appBarForeground: brandPrimaryText,
    cardGradientStart: Color(0xFFF0FDF4),
    cardGradientEnd: Colors.white,
    accentGlow: Color(0x2A22C55E),
  );

  static const dark = AppColors(
    statusOpenBadge: AppBadgeColors(
      background: Color(0xFF1A3A2A),
      border: Color(0xFF2D6B4A),
      foreground: Color(0xFF86EFAC),
    ),
    statusClosedBadge: AppBadgeColors(
      background: Color(0xFF3D2814),
      border: Color(0xFF7C5230),
      foreground: Color(0xFFFBBF7E),
    ),
    aiEnabledBadge: AppBadgeColors(
      background: Color(0xFF1E2D4D),
      border: Color(0xFF3B5998),
      foreground: Color(0xFF93C5FD),
    ),
    aiDisabledBadge: AppBadgeColors(
      background: Color(0xFF1E293B),
      border: Color(0xFF334155),
      foreground: Color(0xFF94A3B8),
    ),
    incomingMessageBackground: Color(0xFF1E293B),
    incomingMessageText: Color(0xFFF1F5F9),
    outgoingMessageBackground: Color(0xFF1A5C42),
    outgoingMessageText: Color(0xFFF1F5F9),
    bottomBarInactive: Color(0xFF64748B),
    scaffoldBackground: Color(0xFF0F172A),
    appBarColor: Color(0xFF0F172A),
    appBarForeground: Colors.white,
    cardGradientStart: Color(0xFF162A20),
    cardGradientEnd: Color(0xFF1E293B),
    accentGlow: Color(0x3A22C55E),
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
  primaryContainer: Color(0xFFDCFCE7),
  onPrimaryContainer: Color(0xFF14532D),
  secondary: brandTeal,
  onSecondary: Colors.white,
  secondaryContainer: Color(0xFFCCFBF1),
  onSecondaryContainer: Color(0xFF134E4A),
  tertiary: Color(0xFF14B8A6),
  onTertiary: Colors.white,
  tertiaryContainer: Color(0xFFCCFBF1),
  onTertiaryContainer: Color(0xFF134E4A),
  error: brandError,
  onError: Colors.white,
  background: brandScaffoldBackground,
  onBackground: brandPrimaryText,
  surface: Colors.white,
  onSurface: brandPrimaryText,
  surfaceVariant: Color(0xFFF1F5F9),
  onSurfaceVariant: Color(0xFF64748B),
  outline: Color(0xFFCBD5E1),
  outlineVariant: Color(0xFFE2E8F0),
  shadow: Colors.black,
  scrim: Colors.black,
  inverseSurface: Color(0xFF1E293B),
  onInverseSurface: Colors.white,
  inversePrimary: brandPrimaryGreen,
);

final ColorScheme brandDarkColorScheme = ColorScheme(
  brightness: Brightness.dark,
  primary: brandPrimaryGreen,
  onPrimary: Colors.white,
  primaryContainer: const Color(0xFF166534),
  onPrimaryContainer: const Color(0xFFBBF7D0),
  secondary: brandTeal,
  onSecondary: Colors.white,
  secondaryContainer: const Color(0xFF115E59),
  onSecondaryContainer: const Color(0xFF99F6E4),
  tertiary: const Color(0xFF2DD4BF),
  onTertiary: Colors.black,
  tertiaryContainer: const Color(0xFF134E4A),
  onTertiaryContainer: const Color(0xFF99F6E4),
  error: const Color(0xFFEF4444),
  onError: Colors.white,
  background: const Color(0xFF0F172A),
  onBackground: const Color(0xFFF1F5F9),
  surface: const Color(0xFF1E293B),
  onSurface: const Color(0xFFF1F5F9),
  surfaceVariant: const Color(0xFF334155),
  onSurfaceVariant: const Color(0xFFCBD5E1),
  outline: const Color(0xFF475569),
  outlineVariant: const Color(0xFF334155),
  shadow: Colors.black,
  scrim: Colors.black,
  inverseSurface: const Color(0xFFF1F5F9),
  onInverseSurface: const Color(0xFF0F172A),
  inversePrimary: brandPrimaryGreen,
);



