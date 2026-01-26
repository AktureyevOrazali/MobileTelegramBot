part of '../main.dart';

class DashboardSummary {
  DashboardSummary({
    required this.totalDialogs,
    required this.openDialogs,
    required this.closedDialogs,
    required this.totalChats,
    required this.totalMessages,
    required this.totalIncomingMessages,
    required this.totalOutgoingMessages,
    required this.averageMessagesPerDialog,
    required this.avgDialogDurationMinutes,
    required this.avgResponseTimeMinutes,
    required this.sectionBreakdown,
    required this.topQuestions,
    required this.questionsBySection,
    required this.agentBreakdown,
    required this.recentActivity,
    required this.updatedAt,
  });

  final int totalDialogs;
  final int openDialogs;
  final int closedDialogs;
  final int totalChats;
  final int totalMessages;
  final int totalIncomingMessages;
  final int totalOutgoingMessages;
  final double averageMessagesPerDialog;
  final double? avgDialogDurationMinutes;
  final double? avgResponseTimeMinutes;
  final List<DashboardSectionStat> sectionBreakdown;
  final List<DashboardTopQuestion> topQuestions;
  final List<DashboardSectionTopQuestions> questionsBySection;
  final List<DashboardAgentStat> agentBreakdown;
  final List<DashboardActivityPoint> recentActivity;
  final DateTime updatedAt;

  factory DashboardSummary.empty() {
    final now = DateTime.now();
    return DashboardSummary(
      totalDialogs: 0,
      openDialogs: 0,
      closedDialogs: 0,
      totalChats: 0,
      totalMessages: 0,
      totalIncomingMessages: 0,
      totalOutgoingMessages: 0,
      averageMessagesPerDialog: 0,
      avgDialogDurationMinutes: null,
      avgResponseTimeMinutes: null,
      sectionBreakdown: const [],
      topQuestions: const [],
      questionsBySection: const [],
      agentBreakdown: const [],
      recentActivity: const [],
      updatedAt: now,
    );
  }

  factory DashboardSummary.fromJson(Map<String, dynamic> json) {
    int parseInt(dynamic value) => _parseIntValue(value) ?? 0;
    double parseDouble(dynamic value) => _parseDoubleValue(value) ?? 0.0;
    double? parseDoubleNullable(dynamic value) => _parseDoubleValue(value);

    double? parseResponseMinutes(dynamic minutesRaw, dynamic secondsRaw) {
      final minutes = parseDoubleNullable(minutesRaw);
      if (minutes != null && minutes.isFinite) {
        return minutes;
      }
      final seconds = parseDoubleNullable(secondsRaw);
      if (seconds != null && seconds.isFinite) {
        return seconds / 60;
      }
      if (minutesRaw is String) {
        final pattern = RegExp(r'^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[\.,]\d+)?)S)?$', caseSensitive: false);
        final match = pattern.firstMatch(minutesRaw.trim().toUpperCase());
        if (match != null) {
          final hours = int.tryParse(match.group(1) ?? '') ?? 0;
          final mins = int.tryParse(match.group(2) ?? '') ?? 0;
          final secs = double.tryParse((match.group(3) ?? '').replaceAll(',', '.')) ?? 0.0;
          return hours * 60 + mins + secs / 60;
        }
      }
      return null;
    }

    final sectionBreakdown = (json['section_breakdown'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardSectionStat.fromJson)
        .toList();
    final topQuestions = (json['top_questions'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardTopQuestion.fromJson)
        .toList();
    final questionsBySection = (json['questions_by_section'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardSectionTopQuestions.fromJson)
        .toList();
    final agentBreakdown = (json['agent_breakdown'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardAgentStat.fromJson)
        .toList();
    final recentActivity = (json['recent_activity'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardActivityPoint.fromJson)
        .toList();

    final avgDialogDuration = parseDoubleNullable(json['avg_dialog_duration_minutes']);
    final avgResponseMinutes = parseResponseMinutes(
      json['avg_response_time_minutes'],
      json['avg_response_time_seconds'],
    );

    final updatedAt = _parseDateTime(json['updated_at']) ?? DateTime.now();

    return DashboardSummary(
      totalDialogs: parseInt(json['total_dialogs']),
      openDialogs: parseInt(json['open_dialogs']),
      closedDialogs: parseInt(json['closed_dialogs']),
      totalChats: parseInt(json['total_chats']),
      totalMessages: parseInt(json['total_messages']),
      totalIncomingMessages: parseInt(json['total_incoming_messages']),
      totalOutgoingMessages: parseInt(json['total_outgoing_messages']),
      averageMessagesPerDialog: parseDouble(json['average_messages_per_dialog']),
      avgDialogDurationMinutes: avgDialogDuration?.isFinite == true ? avgDialogDuration : null,
      avgResponseTimeMinutes: avgResponseMinutes?.isFinite == true ? avgResponseMinutes : null,
      sectionBreakdown: sectionBreakdown,
      topQuestions: topQuestions,
      questionsBySection: questionsBySection,
      agentBreakdown: agentBreakdown,
      recentActivity: recentActivity,
      updatedAt: updatedAt,
    );
  }
}

class DashboardSectionStat {
  DashboardSectionStat({
    required this.section,
    required this.title,
    required this.dialogs,
    required this.percentage,
  });

  final String? section;
  final String title;
  final int dialogs;
  final double percentage;

  factory DashboardSectionStat.fromJson(Map<String, dynamic> json) {
    return DashboardSectionStat(
      section: json['section'] as String?,
      title: (json['title'] as String?)?.trim() ?? '',
      dialogs: _parseIntValue(json['dialogs']) ?? 0,
      percentage: _parseDoubleValue(json['percentage']) ?? 0,
    );
  }
}

class DashboardTopQuestion {
  DashboardTopQuestion({required this.question, required this.count});

  final String question;
  final int count;

  factory DashboardTopQuestion.fromJson(Map<String, dynamic> json) {
    return DashboardTopQuestion(
      question: (json['question'] as String?)?.trim() ?? '',
      count: _parseIntValue(json['count']) ?? 0,
    );
  }
}

class DashboardSectionTopQuestions {
  DashboardSectionTopQuestions({
    required this.section,
    required this.title,
    required this.questions,
  });

  final String? section;
  final String title;
  final List<DashboardTopQuestion> questions;

  factory DashboardSectionTopQuestions.fromJson(Map<String, dynamic> json) {
    final questions = (json['questions'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(DashboardTopQuestion.fromJson)
        .toList();
    return DashboardSectionTopQuestions(
      section: json['section'] as String?,
      title: (json['title'] as String?)?.trim() ?? '',
      questions: questions,
    );
  }
}

class DashboardAgentStat {
  DashboardAgentStat({
    required this.name,
    required this.dialogs,
    required this.messages,
    required this.avgMessagesPerDialog,
    required this.lastActivity,
  });

  final String name;
  final int dialogs;
  final int messages;
  final double avgMessagesPerDialog;
  final DateTime? lastActivity;

  factory DashboardAgentStat.fromJson(Map<String, dynamic> json) {
    final dialogs = _parseIntValue(json['dialogs']) ?? 0;
    final messages = _parseIntValue(json['messages']) ?? 0;
    final avg = _parseDoubleValue(json['avg_messages_per_dialog']);
    final computedAvg = dialogs > 0
        ? (avg != null && avg.isFinite ? avg : messages / dialogs)
        : 0.0;
    return DashboardAgentStat(
      name: (json['name'] as String?)?.trim() ?? '',
      dialogs: dialogs,
      messages: messages,
      avgMessagesPerDialog: computedAvg,
      lastActivity: _parseDateTime(json['last_activity']),
    );
  }
}

class DashboardActivityPoint {
  DashboardActivityPoint({
    required this.date,
    required this.dialogs,
    required this.incomingMessages,
  });

  final DateTime date;
  final int dialogs;
  final int incomingMessages;

  factory DashboardActivityPoint.fromJson(Map<String, dynamic> json) {
    final parsedDate = _parseDateTime(json['date']) ?? DateTime.now();
    return DashboardActivityPoint(
      date: parsedDate,
      dialogs: _parseIntValue(json['dialogs']) ?? 0,
      incomingMessages: _parseIntValue(json['incoming_messages']) ?? 0,
    );
  }
}

class DialogStatusUpdate {
  const DialogStatusUpdate({
    required this.chatId,
    required this.dialogId,
    required this.dialogClosedAt,
    required this.aiEnabled,
  });

  final int chatId;
  final int dialogId;
  final DateTime? dialogClosedAt;
  final bool aiEnabled;

  factory DialogStatusUpdate.fromJson(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final dialogId = _parseIntValue(json['dialog_id']) ?? chatId;
    final closedAt = _parseDateTime(json['dialog_closed_at']);
    final aiEnabledRaw = json['ai_enabled'];
    final aiEnabled = aiEnabledRaw is bool ? aiEnabledRaw : aiEnabledRaw != false;
    return DialogStatusUpdate(
      chatId: chatId,
      dialogId: dialogId,
      dialogClosedAt: closedAt,
      aiEnabled: aiEnabled,
    );
  }
}

class ChatSummary {
  ChatSummary({
    required this.chatId,
    required this.dialogId,
    required this.title,
    required this.username,
    required this.type,
    required this.updatedAt,
    required this.section,
    required this.sectionTitle,
    required this.bin,
    required this.isFavorite,
    required this.aiEnabled,
    required this.dialogStartedAt,
    required this.dialogClosedAt,
    required this.unreadCount,
  });

  final int chatId;
  final int dialogId;
  final String title;
  final String? username;
  final String type;
  final DateTime updatedAt;
  final String? section;
  final String? sectionTitle;
  final String? bin;
  final bool isFavorite;
  final bool aiEnabled;
  final DateTime? dialogStartedAt;
  final DateTime? dialogClosedAt;
  final int unreadCount;

  String get updatedAtLabel => DateFormat('HH:mm').format(updatedAt.toLocal());
  bool get isClosed => dialogClosedAt != null;

  ChatSummary copyWith({
    bool? isFavorite,
    bool? aiEnabled,
    DateTime? dialogStartedAt,
    DateTime? dialogClosedAt,
    int? unreadCount,
  }) {
    return ChatSummary(
      chatId: chatId,
      dialogId: dialogId,
      title: title,
      username: username,
      type: type,
      updatedAt: updatedAt,
      section: section,
      sectionTitle: sectionTitle,
      bin: bin,
      isFavorite: isFavorite ?? this.isFavorite,
      aiEnabled: aiEnabled ?? this.aiEnabled,
      dialogStartedAt: dialogStartedAt ?? this.dialogStartedAt,
      dialogClosedAt: dialogClosedAt ?? this.dialogClosedAt,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }

  factory ChatSummary.fromJson(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final dialogId = _parseIntValue(json['dialog_id']) ?? chatId;
    final updatedAtRaw = json['updated_at'] as String?;
    final updatedAt = updatedAtRaw != null
        ? DateTime.tryParse(updatedAtRaw) ?? DateTime.now().toUtc()
        : DateTime.now().toUtc();
    final startedAt = _parseDateTime(json['dialog_started_at']);
    final closedAt = _parseDateTime(json['dialog_closed_at']);
    final operatorModeRaw = json['operator_mode'];
    final operatorMode = operatorModeRaw is bool ? operatorModeRaw : operatorModeRaw == true;
    final aiEnabledRaw = json['ai_enabled'];
    final aiEnabled = aiEnabledRaw is bool
        ? aiEnabledRaw
        : aiEnabledRaw == false
            ? false
            : !operatorMode;
    final unreadCount = _parseIntValue(json['unread_count']) ?? 0;
    return ChatSummary(
      chatId: chatId,
      dialogId: dialogId,
      title: json['title'] as String? ?? 'Диалог',
      username: json['username'] as String?,
      type: json['type'] as String? ?? 'unknown',
      updatedAt: updatedAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
      bin: json['bin'] as String?,
      isFavorite: json['is_favorite'] as bool? ?? false,
      aiEnabled: aiEnabled,
      dialogStartedAt: startedAt,
      dialogClosedAt: closedAt,
      unreadCount: unreadCount,
    );
  }
}

class Message {
  Message({
    required this.id,
    required this.chatId,
    required this.direction,
    required this.text,
    required this.author,
    required this.createdAt,
    required this.section,
    required this.sectionTitle,
  });

  final int id;
  final int chatId;
  final String direction;
  final String text;
  final String? author;
  final DateTime createdAt;
  final String? section;
  final String? sectionTitle;

  String get createdAtLabel => DateFormat('HH:mm').format(createdAt.toLocal());

  factory Message.fromJson(Map<String, dynamic> json) {
    final id = _parseIntValue(json['id']) ?? 0;
    final chatId = _parseIntValue(json['chat_id']) ?? 0;
    final createdAtRaw = json['created_at'] as String?;
    final createdAt = createdAtRaw != null
        ? DateTime.tryParse(createdAtRaw) ?? DateTime.now().toUtc()
        : DateTime.now().toUtc();
    return Message(
      id: id,
      chatId: chatId,
      direction: json['direction'] as String? ?? 'incoming',
      text: json['text'] as String? ?? '',
      author: json['author'] as String?,
      createdAt: createdAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
    );
  }
}

class MessageNotification {
  MessageNotification({
    required this.chatId,
    required this.chatTitle,
    required this.text,
    required this.createdAt,
    required this.section,
    required this.sectionTitle,
  });

  final int chatId;
  final String chatTitle;
  final String text;
  final DateTime createdAt;
  final String? section;
  final String? sectionTitle;

  String get createdAtLabel => DateFormat('HH:mm').format(createdAt.toLocal());

  static MessageNotification? tryParse(Map<String, dynamic> json) {
    final chatId = _parseIntValue(json['chat_id']);
    final createdAtRaw = json['created_at'] as String?;
    if (chatId == null || createdAtRaw == null) {
      return null;
    }
    final createdAt = DateTime.tryParse(createdAtRaw) ?? DateTime.now().toUtc();
    return MessageNotification(
      chatId: chatId,
      chatTitle: json['chat_title'] as String? ?? 'Диалог',
      text: json['text'] as String? ?? '',
      createdAt: createdAt,
      section: json['section'] as String?,
      sectionTitle: json['section_title'] as String?,
    );
  }

  factory MessageNotification.fromJson(Map<String, dynamic> json) {
    final notification = tryParse(json);
    if (notification == null) {
      throw const FormatException('Некорректные данные уведомления');
    }
    return notification;
  }
}

class UnassignedBin {
  const UnassignedBin({
    required this.bin,
    required this.openDialogs,
  });

  final String bin;
  final int openDialogs;

  factory UnassignedBin.fromJson(Map<String, dynamic> json) {
    final rawBin = json['bin'] ?? '';
    final parsedBin = rawBin is String ? rawBin.trim() : rawBin.toString();
    final rawCount = json['open_dialogs'];
    final count = rawCount is int
        ? rawCount
        : int.tryParse(rawCount?.toString() ?? '') ?? 0;
    return UnassignedBin(bin: parsedBin, openDialogs: count);
  }
}

class UserBinAssignment {
  const UserBinAssignment({
    required this.bin,
    required this.assignedAt,
    required this.expiresAt,
    this.assignedBy,
  });

  final String bin;
  final DateTime assignedAt;
  final DateTime? expiresAt;
  final int? assignedBy;

  bool get isIndefinite => expiresAt == null;

  UserBinAssignment copyWith({
    DateTime? assignedAt,
    DateTime? expiresAt,
    int? assignedBy,
  }) {
    return UserBinAssignment(
      bin: bin,
      assignedAt: assignedAt ?? this.assignedAt,
      expiresAt: expiresAt ?? this.expiresAt,
      assignedBy: assignedBy ?? this.assignedBy,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'bin': bin,
      'assigned_at': assignedAt.toUtc().toIso8601String(),
      'expires_at': expiresAt?.toUtc().toIso8601String(),
      'assigned_by': assignedBy,
    };
  }

  Map<String, dynamic> toUpdatePayload() {
    return {
      'bin': bin,
      'expires_at': expiresAt?.toUtc().toIso8601String(),
    };
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null) {
      return null;
    }
    if (value is DateTime) {
      return value.toUtc();
    }
    if (value is int) {
      try {
        return DateTime.fromMillisecondsSinceEpoch(value, isUtc: true);
      } catch (_) {
        return null;
      }
    }
    if (value is String && value.trim().isNotEmpty) {
      try {
        return DateTime.parse(value).toUtc();
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  static UserBinAssignment? tryParse(dynamic raw) {
    if (raw == null) {
      return null;
    }
    if (raw is UserBinAssignment) {
      return raw;
    }
    if (raw is String) {
      final bin = raw.trim();
      if (bin.isEmpty) {
        return null;
      }
      return UserBinAssignment(
        bin: bin,
        assignedAt: DateTime.now().toUtc(),
        expiresAt: null,
        assignedBy: null,
      );
    }
    if (raw is Map<String, dynamic>) {
      final value = raw['bin'] ?? raw['value'] ?? '';
      final bin = value.toString().trim();
      if (bin.isEmpty) {
        return null;
      }
      final assignedRaw = raw['assigned_at'] ?? raw['assignedAt'];
      final expiresRaw = raw['expires_at'] ?? raw['expiresAt'];
      final assignedAt = _parseDate(assignedRaw) ?? DateTime.now().toUtc();
      final expiresAt = _parseDate(expiresRaw);
      final assignedByRaw = raw['assigned_by'] ?? raw['assignedBy'];
      final assignedBy = assignedByRaw is int
          ? assignedByRaw
          : int.tryParse(assignedByRaw?.toString() ?? '');
      return UserBinAssignment(
        bin: bin,
        assignedAt: assignedAt,
        expiresAt: expiresAt,
        assignedBy: assignedBy,
      );
    }
    final bin = raw.toString().trim();
    if (bin.isEmpty) {
      return null;
    }
    return UserBinAssignment(
      bin: bin,
      assignedAt: DateTime.now().toUtc(),
      expiresAt: null,
      assignedBy: null,
    );
  }
}

class Section {
  Section({required this.id, required this.title});

  final String id;
  final String title;

  factory Section.fromJson(Map<String, dynamic> json) {
    return Section(
      id: json['id'] as String,
      title: json['title'] as String,
    );
  }
}

const Map<String, String> _roleTitles = {
  'admin': 'Администратор',
  'moderator': 'Модератор',
  'operator': 'Оператор',
  'viewer': 'Оператор',
};

class UserProfile {
  UserProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.login,
    required this.createdAt,
    required this.jobTitle,
    required this.phone,
    required this.bio,
    required this.role,
    required List<String> sections,
    required List<UserBinAssignment> binAssignments,
    required Set<int> favoriteDialogIds,
  })  : sections = List.unmodifiable(sections),
        binAssignments = List.unmodifiable(binAssignments),
        favoriteDialogIds = Set<int>.unmodifiable(favoriteDialogIds);

  final int id;
  final String name;
  final String email;
  final String login;
  final DateTime createdAt;
  final String jobTitle;
  final String phone;
  final String bio;
  final String role;
  final List<String> sections;
  final List<UserBinAssignment> binAssignments;
  final Set<int> favoriteDialogIds;

  List<String> get bins => binAssignments.map((assignment) => assignment.bin).toList(growable: false);

  bool get canReply => role == 'admin' || role == 'moderator' || role == 'operator';
  bool get isAdmin => role == 'admin' || role == 'moderator';
  bool get canViewOnly => role == 'viewer';
  String get roleLabel => _roleTitles[role] ?? role;
  bool canSeeSection(String? sectionId) {
    if (isAdmin) {
      return true;
    }
    if (sectionId == null || sectionId.isEmpty) {
      return false;
    }
    return sections.contains(sectionId);
  }

  bool canSeeBin(String? bin) {
    if (isAdmin) {
      return true;
    }
    if (bin == null || bin.isEmpty) {
      return false;
    }
    return binAssignments.any((assignment) => assignment.bin == bin);
  }

  UserProfile copyWith({
    String? name,
    String? jobTitle,
    String? phone,
    String? bio,
    String? role,
    List<String>? sections,
    List<UserBinAssignment>? binAssignments,
    Set<int>? favoriteDialogIds,
  }) {
    return UserProfile(
      id: id,
      name: name ?? this.name,
      email: email,
      login: login,
      createdAt: createdAt,
      jobTitle: jobTitle ?? this.jobTitle,
      phone: phone ?? this.phone,
      bio: bio ?? this.bio,
      role: role ?? this.role,
      sections: sections ?? this.sections,
      binAssignments: binAssignments ?? this.binAssignments,
      favoriteDialogIds: favoriteDialogIds ?? this.favoriteDialogIds,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'login': login,
      'created_at': createdAt.toUtc().toIso8601String(),
      'job_title': jobTitle,
      'phone': phone,
      'bio': bio,
      'role': role,
      'sections': sections,
      'bins': binAssignments.map((assignment) => assignment.toJson()).toList(),
      'favorite_dialog_ids': favoriteDialogIds.toList(),
    };
  }

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    final sectionList = (json['sections'] as List<dynamic>? ?? [])
        .map((item) => item.toString())
        .toList();
    final rawBins = json['bins'];
    final assignments = <UserBinAssignment>[];
    if (rawBins is List) {
      for (final item in rawBins) {
        final parsed = UserBinAssignment.tryParse(item);
        if (parsed != null) {
          assignments.add(parsed);
        }
      }
    } else if (rawBins != null) {
      final parsed = UserBinAssignment.tryParse(rawBins);
      if (parsed != null) {
        assignments.add(parsed);
      }
    }
    assignments.sort((a, b) => a.bin.compareTo(b.bin));
    final rawFavorites = json['favorite_dialog_ids'] ?? json['favorite_chat_ids'];
    final favorites = (rawFavorites as List<dynamic>? ?? [])
        .map((item) => item is int ? item : int.tryParse(item.toString()) ?? 0)
        .where((value) => value > 0)
        .toSet();
    final rawRole = json['role'] as String? ?? 'operator';
    final role = rawRole == 'viewer' ? 'operator' : rawRole;
    return UserProfile(
      id: json['id'] as int,
      name: json['name'] as String,
      email: json['email'] as String,
      login: json['login'] as String? ?? json['email'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
      jobTitle: json['job_title'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      bio: json['bio'] as String? ?? '',
      role: role,
      sections: sectionList,
      binAssignments: assignments,
      favoriteDialogIds: favorites,
    );
  }
}

class RoleInfo {
  RoleInfo({required this.id, required this.title});

  final String id;
  final String title;

  factory RoleInfo.fromJson(Map<String, dynamic> json) {
    return RoleInfo(
      id: json['id'] as String,
      title: json['title'] as String? ?? json['id'] as String,
    );
  }
}

class PendingRegistration {
  PendingRegistration({
    required this.id,
    required this.name,
    required this.email,
    required this.createdAt,
  });

  final int id;
  final String name;
  final String email;
  final DateTime createdAt;

  factory PendingRegistration.fromJson(Map<String, dynamic> json) {
    return PendingRegistration(
      id: json['id'] as int,
      name: json['name'] as String,
      email: json['email'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}

class AuthSession {
  AuthSession({required this.token, required this.user});

  final String token;
  final UserProfile user;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      token: json['token'] as String,
      user: UserProfile.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  AuthSession copyWith({String? token, UserProfile? user}) {
    return AuthSession(
      token: token ?? this.token,
      user: user ?? this.user,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'token': token,
      'user': user.toJson(),
    };
  }
}