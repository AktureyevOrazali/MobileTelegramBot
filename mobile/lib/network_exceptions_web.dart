bool isNetworkException(Object? error) {
  if (error == null) {
    return false;
  }
  final description = error.toString();
  return description.contains('XMLHttpRequest error') ||
      description.contains('Failed host lookup') ||
      description.contains('Connection closed before full header was received');
}