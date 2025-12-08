export 'network_exceptions_stub.dart'
    if (dart.library.io) 'network_exceptions_io.dart'
    if (dart.library.html) 'network_exceptions_web.dart';