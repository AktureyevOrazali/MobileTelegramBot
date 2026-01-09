part of '../main.dart';

class OperatorProfileView extends StatefulWidget {
  const OperatorProfileView({
    required this.apiClient,
    required this.onProfileUpdated,
    required this.onSessionRefreshed,
    super.key,
  });

  final ApiClient apiClient;
  final ValueChanged<UserProfile> onProfileUpdated;
  final ValueChanged<AuthSession> onSessionRefreshed;

  @override
  State<OperatorProfileView> createState() => _OperatorProfileViewState();
}

class _QuestionSectionEntry {
  _QuestionSectionEntry({
    required this.key,
    required this.title,
    required this.section,
    required this.totalCount,
  });

  final String key;
  final String title;
  final DashboardSectionTopQuestions section;
  final int totalCount;
}
