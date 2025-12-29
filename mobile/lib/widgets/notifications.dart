part of '../main.dart';


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
        onPressed:
            _logButtonPress('close notification banner', () => messenger.hideCurrentMaterialBanner()),
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

