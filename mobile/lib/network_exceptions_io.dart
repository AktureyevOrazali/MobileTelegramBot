import 'dart:io';

bool isNetworkException(Object? error) => error is SocketException;