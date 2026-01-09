part of '../main.dart';

class UiLogger {
  UiLogger._();

  static final DateFormat _clock = DateFormat('HH:mm:ss.SSS');

  static String _formatDetails(Map<String, Object?>? details) {
    if (details == null || details.isEmpty) {
      return '';
    }
    return details.entries.map((entry) => '${entry.key}=${entry.value}').join(' · ');
  }

  static void event(String channel, String message, {Map<String, Object?>? details}) {
    final timestamp = _clock.format(DateTime.now());
    final detailText = _formatDetails(details);
    final suffix = detailText.isEmpty ? '' : '  |  $detailText';
    debugPrint('✨ [$channel] $timestamp — $message$suffix');
  }

  static VoidCallback? button(String label, VoidCallback? action, {String scope = 'BUTTON'}) {
    if (action == null) {
      return null;
    }
    return () {
      event(scope, 'tap: $label');
      action();
    };
  }

  static void page(String name, {String state = 'opened', Map<String, Object?>? details}) {
    event('PAGE', '$name $state', details: details);
  }

  static void navigation(String from, String to, {String? reason, Map<String, Object?>? details}) {
    event(
      'NAV',
      '$from → $to',
      details: {
        if (reason != null) 'reason': reason,
        ...?details,
      },
    );
  }

  static void action(String area, String description, {Map<String, Object?>? details}) {
    event(area, description, details: details);
  }
}

AppBadgeColors _statusBadgeColors(ThemeData theme, {required bool isClosed}) {
  final palette = theme.extension<AppColors>()!;
  return isClosed ? palette.statusClosedBadge : palette.statusOpenBadge;
}

AppBadgeColors _aiBadgeColors(ThemeData theme, {required bool enabled}) {
  final palette = theme.extension<AppColors>()!;
  return enabled ? palette.aiEnabledBadge : palette.aiDisabledBadge;
}

VoidCallback? _logButtonPress(String label, VoidCallback? action) {
  return UiLogger.button(label, action);
}