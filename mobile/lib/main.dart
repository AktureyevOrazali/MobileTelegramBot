import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'bottom_bar/bottom_bar_divider.dart';
import 'bottom_bar/tab_item.dart';
import 'network_exceptions.dart';
import 'theme/app_theme.dart';

part 'app/ui_logger.dart';
part 'app/mobile_bot_app.dart';
part 'api/api_client.dart';
part 'storage/session_storage.dart';
part 'storage/theme_preferences.dart';
part 'screens/auth_screen.dart';
part 'screens/chat_list_screen.dart';
part 'screens/chat_detail_screen.dart';
part 'screens/operator_profile_view.dart';
part 'screens/dashboard_view.dart';
part 'screens/admin_user_management_view.dart';
part 'models/models.dart';
part 'widgets/notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: '.env');
  runApp(const MobileBotApp());
}