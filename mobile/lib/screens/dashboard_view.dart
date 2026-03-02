import 'package:fl_chart/fl_chart.dart';

part of '../main.dart';

enum _DashboardTab { overview, operators, sections, activity, commercial }
enum _TimePreset { today, yesterday, last7, last30, last90, custom }
enum _TopMetric { avgResponse, messages, dialogs }

class DashboardView extends StatefulWidget {
  const DashboardView({required this.apiClient, super.key});

  final ApiClient apiClient;

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  DashboardSummary? _summary;
  bool _loading = true;
  bool _refreshing = false;
  String? _error;
  List<UserProfile> _operators = [];
  bool _operatorsLoading = false;
  String? _operatorsError;
  int? _selectedOperatorId;
  String _selectedQuestionSection = 'all';
  _DashboardTab _dashboardTab = _DashboardTab.overview;
  _TimePreset _timePreset = _TimePreset.last7;
  DateTime? _customStartDate;
  DateTime? _customEndDate;
  _TopMetric _topMetric = _TopMetric.avgResponse;

  int? get _activeOperatorId =>
      _dashboardTab == _DashboardTab.operators ? null : _selectedOperatorId;

  @override
  void initState() {
    super.initState();
    _loadSummary(initial: true);
    _loadOperators();
  }

  Future<void> reloadSummary() => _loadSummary(initial: false);

  DateTime _dateOnly(DateTime value) => DateTime(value.year, value.month, value.day);

  DateTime _shiftDays(DateTime value, int days) => value.add(Duration(days: days));

  ({DateTime? start, DateTime? end, String label}) _activeDateRange() {
    final today = _dateOnly(DateTime.now());
    switch (_timePreset) {
      case _TimePreset.today:
        return (start: today, end: today, label: 'Сегодня');
      case _TimePreset.yesterday:
        final d = _shiftDays(today, -1);
        return (start: d, end: d, label: 'Вчера');
      case _TimePreset.last7:
        return (start: _shiftDays(today, -6), end: today, label: '7 дней');
      case _TimePreset.last30:
        return (start: _shiftDays(today, -29), end: today, label: '30 дней');
      case _TimePreset.last90:
        return (start: _shiftDays(today, -89), end: today, label: '3 месяца');
      case _TimePreset.custom:
        if (_customStartDate == null || _customEndDate == null) {
          return (start: null, end: null, label: 'Свои даты');
        }
        final start = _dateOnly(_customStartDate!);
        final end = _dateOnly(_customEndDate!);
        return (start: start, end: end, label: '${DateFormat('dd.MM').format(start)}-${DateFormat('dd.MM').format(end)}');
    }
  }

  String? _toApiDate(DateTime? value) {
    if (value == null) return null;
    return DateFormat('yyyy-MM-dd').format(value);
  }

  Future<void> _loadSummary({
    required bool initial,
    int? operatorOverride,
    DateTime? startDateOverride,
    DateTime? endDateOverride,
  }) async {
    if (initial) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() {
        _refreshing = true;
      });
    }
    try {
      final range = _activeDateRange();
      final startDate = startDateOverride ?? range.start;
      final endDate = endDateOverride ?? range.end;
      final summary = await widget.apiClient.fetchDashboardSummary(
        operatorId: operatorOverride ?? _activeOperatorId,
        startDate: _toApiDate(startDate),
        endDate: _toApiDate(endDate),
      );
      if (!mounted) return;

      setState(() {
        _summary = summary;
        _error = null;

        if (_selectedQuestionSection != 'all') {
          final validKeys = summary.questionsBySection
              .map((section) =>
                  section.section ?? (section.title.isNotEmpty ? section.title : 'no-section'))
              .toSet();
          if (!validKeys.contains(_selectedQuestionSection)) {
            _selectedQuestionSection = 'all';
          }
        }
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error.toString();
        if (initial) {
          _summary = null;
        }
      });
    } finally {
      if (!mounted) return;

      setState(() {
        if (initial) {
          _loading = false;
        } else {
          _refreshing = false;
        }
      });
    }
  }

  Future<void> _loadOperators() async {
    setState(() {
      _operatorsLoading = true;
      _operatorsError = null;
    });
    try {
      final users = await widget.apiClient.fetchUsers();
      if (!mounted) return;

      // Filter pending users (same logic as AdminUserManagementView)
      List<PendingRegistration> pending = [];
      try {
        pending = await widget.apiClient.fetchPendingRegistrations();
      } catch (_) {
        // Ignore errors (e.g. if user has no permission to list pending)
      }
      final pendingIds = pending.map((p) => p.id).toSet();

      final filtered = users
          .where((user) => !user.isAdmin && !pendingIds.contains(user.id))
          .where((user) {
            final normalized = ('${user.name} ${user.login}').toLowerCase();
            if (normalized.trim().isEmpty) return true;
            return !normalized.contains('bot') && !normalized.contains('бот');
          })
          .toList()
        ..sort((a, b) {
          final nameA = a.name.isNotEmpty ? a.name : a.login;
          final nameB = b.name.isNotEmpty ? b.name : b.login;
          return nameA.toLowerCase().compareTo(nameB.toLowerCase());
        });

      setState(() {
        _operators = filtered;
        if (_selectedOperatorId != null &&
            !_operators.any((operator) => operator.id == _selectedOperatorId)) {
          _selectedOperatorId = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _operatorsError = error.toString();
      });
    } finally {
      if (!mounted) return;
      setState(() {
        _operatorsLoading = false;
      });
    }
  }

  Future<void> _handleRefresh() => _loadSummary(initial: false);

  void _handleOperatorChanged(int? value) {
    setState(() {
      _selectedOperatorId = value;
    });
    _loadSummary(initial: false, operatorOverride: value);
  }

  void _setDashboardTab(_DashboardTab tab) {
    if (_dashboardTab == tab) return;
    final prevActiveOperatorId = _activeOperatorId;
    setState(() {
      _dashboardTab = tab;
    });
    if (prevActiveOperatorId != _activeOperatorId) {
      _loadSummary(initial: false, operatorOverride: _activeOperatorId);
    }
  }

  Future<void> _setPreset(_TimePreset preset) async {
    if (_timePreset == preset) return;
    setState(() {
      _timePreset = preset;
    });
    await _loadSummary(initial: false);
  }

  Future<void> _pickCustomRange() async {
    final now = DateTime.now();
    final initialStart = _customStartDate ?? _shiftDays(_dateOnly(now), -6);
    final initialEnd = _customEndDate ?? _dateOnly(now);

    final pickedStart = await showDatePicker(
      context: context,
      initialDate: initialStart,
      firstDate: DateTime(now.year - 2, 1, 1),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (pickedStart == null || !mounted) return;

    final pickedEnd = await showDatePicker(
      context: context,
      initialDate: initialEnd.isBefore(pickedStart) ? pickedStart : initialEnd,
      firstDate: pickedStart,
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (pickedEnd == null || !mounted) return;

    setState(() {
      _customStartDate = _dateOnly(pickedStart);
      _customEndDate = _dateOnly(pickedEnd);
      _timePreset = _TimePreset.custom;
    });
    await _loadSummary(initial: false);
  }

  String _formatResponseTime(double? minutes) {
    if (minutes == null) return '-';
    final totalSeconds = (minutes * 60).round();
    final minutesPart = totalSeconds ~/ 60;
    final secondsPart = totalSeconds % 60;
    if (minutesPart > 0 && secondsPart > 0) return '$minutesPart мин $secondsPart с';
    if (minutesPart > 0) return '$minutesPart мин';
    return '$secondsPart с';
  }

  Widget _buildDashboardShimmer(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final shimmerBase = colorScheme.onSurface.withValues(alpha: 0.07);

    Widget shimmerBox({
      required double width,
      required double height,
      double radius = 8,
      bool isCircle = false,
    }) {
      return TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.4, end: 1.0),
        duration: const Duration(milliseconds: 900),
        curve: Curves.easeInOut,
        builder: (context, value, child) {
          return Opacity(opacity: 0.5 + 0.5 * value, child: child);
        },
        child: Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            color: shimmerBase,
            borderRadius: isCircle ? null : BorderRadius.circular(radius),
            shape: isCircle ? BoxShape.circle : BoxShape.rectangle,
          ),
        ),
      );
    }

    Widget shimmerCard({required List<Widget> children}) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: colorScheme.surface,
            borderRadius: BorderRadius.circular(18),
            boxShadow: [
              BoxShadow(
                color: colorScheme.shadow.withValues(alpha: 0.06),
                blurRadius: 12,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: children,
          ),
        ),
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            colorScheme.primary.withValues(alpha: 0.12),
            colorScheme.secondaryContainer.withValues(alpha: 0.05),
            colorScheme.surface,
          ],
        ),
      ),
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: [
          // ── Header card skeleton ──
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
            child: Container(
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: colorScheme.surface,
                borderRadius: BorderRadius.circular(18),
                boxShadow: [
                  BoxShadow(
                    color: colorScheme.shadow.withValues(alpha: 0.06),
                    blurRadius: 12,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Card header shimmer
                  Container(
                    width: double.infinity,
                    height: 52,
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
                    child: Row(
                      children: [
                        shimmerBox(width: 100, height: 16, radius: 6),
                        const Spacer(),
                        shimmerBox(width: 70, height: 26, radius: 8),
                      ],
                    ),
                  ),
                  // Date chips
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: List.generate(6, (i) =>
                        shimmerBox(width: 44 + (i % 3) * 12, height: 28, radius: 999),
                      ),
                    ),
                  ),
                  // Operator dropdown
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
                    child: shimmerBox(width: double.infinity, height: 44, radius: 14),
                  ),
                  // Tab bar
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                    child: shimmerBox(width: double.infinity, height: 36, radius: 999),
                  ),
                ],
              ),
            ),
          ),
          // ── Content card 1 skeleton ──
          shimmerCard(
            children: [
              shimmerBox(width: 140, height: 14, radius: 6),
              const SizedBox(height: 14),
              Row(
                children: [
                  shimmerBox(width: 80, height: 80, radius: 999),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        shimmerBox(width: double.infinity, height: 12),
                        const SizedBox(height: 10),
                        shimmerBox(width: double.infinity, height: 12),
                        const SizedBox(height: 10),
                        shimmerBox(width: double.infinity, height: 12),
                        const SizedBox(height: 14),
                        shimmerBox(width: double.infinity, height: 1, radius: 0),
                        const SizedBox(height: 10),
                        shimmerBox(width: double.infinity, height: 12),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
          // ── Content card 2 skeleton ──
          shimmerCard(
            children: [
              shimmerBox(width: 100, height: 14, radius: 6),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: shimmerBox(width: double.infinity, height: 50, radius: 12)),
                  const SizedBox(width: 8),
                  Expanded(child: shimmerBox(width: double.infinity, height: 50, radius: 12)),
                  const SizedBox(width: 8),
                  Expanded(child: shimmerBox(width: double.infinity, height: 50, radius: 12)),
                ],
              ),
              const SizedBox(height: 14),
              shimmerBox(width: double.infinity, height: 1, radius: 0),
              const SizedBox(height: 10),
              shimmerBox(width: 160, height: 12),
              const SizedBox(height: 8),
              shimmerBox(width: 120, height: 12),
            ],
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return _buildDashboardShimmer(context);
    }

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final moduleTheme = theme.copyWith(
      cardTheme: theme.cardTheme.copyWith(
        elevation: 2,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
        ),
        shadowColor: colorScheme.shadow.withValues(alpha: 0.08),
        color: colorScheme.surface.withValues(alpha: 0.97),
      ),
      inputDecorationTheme: theme.inputDecorationTheme.copyWith(
        filled: true,
        fillColor: colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.75),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: colorScheme.primary, width: 1.4),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant.withValues(alpha: 0.6),
      ),
    );
    final numberFormatter = NumberFormat.decimalPattern('ru');
    final summary = _summary;
    final hasData = summary != null;
    final data = summary ?? DashboardSummary.empty();

    final updatedAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(data.updatedAt.toLocal());
    final activeRange = _activeDateRange();
    final rangeLabel = activeRange.label;

    final faqPrefixRegex = RegExp(r'^\[(faq)\]\s*', caseSensitive: false);
    final commandTagRegex = RegExp(r'^\[[^\]]*команда[^\]]*\]', caseSensitive: false);

    String normalizeQuestion(String raw) {
      final withoutFaq = raw.trim().replaceFirst(faqPrefixRegex, '');
      return withoutFaq.trim().toLowerCase();
    }

    final normalizedSectionTitles = <String>{};
    for (final section in data.sectionBreakdown) {
      final normalized = section.title.trim().toLowerCase();
      if (normalized.isNotEmpty) normalizedSectionTitles.add(normalized);
    }
    for (final section in data.questionsBySection) {
      final normalized = section.title.trim().toLowerCase();
      if (normalized.isNotEmpty) normalizedSectionTitles.add(normalized);
    }

    final operatorNameSet = <String>{};
    for (final operator in _operators) {
      if (operator.name.trim().isNotEmpty) operatorNameSet.add(operator.name.trim().toLowerCase());
      if (operator.login.trim().isNotEmpty)
        operatorNameSet.add(operator.login.trim().toLowerCase());
    }
    final hasOperatorNames = operatorNameSet.isNotEmpty;

    final operatorItems = <DropdownMenuItem<int?>>[
      const DropdownMenuItem<int?>(value: null, child: Text('Все сотрудники')),
      ..._operators.map(
        (operator) => DropdownMenuItem<int?>(
          value: operator.id,
          child: Text(
            operator.name.isNotEmpty ? operator.name : operator.login,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    ];

    final selectedOperatorLabel = () {
      if (_activeOperatorId == null) return 'Все сотрудники';
      for (final operator in _operators) {
        if (operator.id == _activeOperatorId) {
          return operator.name.isNotEmpty ? operator.name : operator.login;
        }
      }
      return 'Сотрудник';
    }();

    final sectionEntries = <_QuestionSectionEntry>[];
    final seenKeys = <String>{};
    for (final section in data.questionsBySection) {
      final key = section.section ?? (section.title.isNotEmpty ? section.title : 'no-section');
      if (seenKeys.contains(key)) continue;
      seenKeys.add(key);

      final normalizedTitle = section.title.trim().toLowerCase();
      final seenQuestions = <String>{};

      final filteredQuestions = section.questions.where((question) {
        final normalizedQuestion = normalizeQuestion(question.question);
        if (normalizedQuestion.isEmpty) return false;
        if (normalizedSectionTitles.contains(normalizedQuestion)) return false;
        if (normalizedTitle.isNotEmpty && normalizedQuestion == normalizedTitle) return false;
        if (commandTagRegex.hasMatch(question.question.trim())) return false;
        if (seenQuestions.contains(normalizedQuestion)) return false;
        seenQuestions.add(normalizedQuestion);
        return true;
      }).toList();

      if (filteredQuestions.isEmpty) continue;

      final totalCount = filteredQuestions.fold<int>(0, (acc, q) => acc + q.count);
      sectionEntries.add(
        _QuestionSectionEntry(
          key: key,
          title: section.title.isNotEmpty ? section.title : 'Без раздела',
          section: DashboardSectionTopQuestions(
            section: section.section,
            title: section.title,
            questions: filteredQuestions,
          ),
          totalCount: totalCount,
        ),
      );
    }
    sectionEntries.sort((a, b) => b.totalCount.compareTo(a.totalCount));

    final questionSectionItems = <DropdownMenuItem<String>>[
      const DropdownMenuItem<String>(value: 'all', child: Text('Все разделы')),
      ...sectionEntries.map(
        (entry) => DropdownMenuItem<String>(
          value: entry.key,
          child: Text(
            entry.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    ];

    final filteredTopQuestions = () {
      final seen = <String>{};
      return data.topQuestions.where((question) {
        final normalized = normalizeQuestion(question.question);
        if (normalized.isEmpty) return false;
        if (normalizedSectionTitles.contains(normalized)) return false;
        if (commandTagRegex.hasMatch(question.question.trim())) return false;
        if (seen.contains(normalized)) return false;
        seen.add(normalized);
        return true;
      }).take(5).toList();
    }();

    final selectedSectionTitle = _selectedQuestionSection == 'all'
        ? 'Все разделы'
        : sectionEntries
            .firstWhere(
              (entry) => entry.key == _selectedQuestionSection,
              orElse: () => _QuestionSectionEntry(
                key: 'all',
                title: 'Все разделы',
                section: DashboardSectionTopQuestions(
                  section: null,
                  title: 'Все разделы',
                  questions: const <DashboardTopQuestion>[],
                ),
                totalCount: 0,
              ),
            )
            .title;

    final selectedQuestions = () {
      if (_selectedQuestionSection == 'all') return filteredTopQuestions;

      final match = sectionEntries.firstWhere(
        (entry) => entry.key == _selectedQuestionSection,
        orElse: () => _QuestionSectionEntry(
          key: 'all',
          title: 'Все разделы',
          section: DashboardSectionTopQuestions(
            section: null,
            title: 'Все разделы',
            questions: const <DashboardTopQuestion>[],
          ),
          totalCount: 0,
        ),
      );
      return match.section.questions.take(5).toList();
    }();

    final agentStats = data.agentBreakdown
        .where((agent) {
          final normalized = agent.name.trim().toLowerCase();
          if (normalized.isEmpty) return false;
          if (normalized.contains('bot') || normalized.contains('бот')) return false;
          if (normalized.contains('admin') ||
              normalized.contains('administrator') ||
              normalized.contains('администратор')) return false;
          if (normalized.contains('ai assistant')) return false;
          if (hasOperatorNames && !operatorNameSet.contains(normalized)) return false;
          return true;
        })
        .toList()
      ..sort((a, b) => b.messages.compareTo(a.messages));

    final selectedOperatorNames = () {
      if (_activeOperatorId == null) return null;
      UserProfile? selected;
      for (final operator in _operators) {
        if (operator.id == _activeOperatorId) {
          selected = operator;
          break;
        }
      }
      if (selected == null) return null;
      final names = <String>{};
      final selectedName = selected.name.trim().toLowerCase();
      final selectedLogin = selected.login.trim().toLowerCase();
      if (selectedName.isNotEmpty) names.add(selectedName);
      if (selectedLogin.isNotEmpty) names.add(selectedLogin);
      return names;
    }();

    final responseDialogs = () {
      final dialogs = data.responseTimeDialogs;
      if (_activeOperatorId == null) return dialogs;
      if (selectedOperatorNames == null || selectedOperatorNames.isEmpty) return <DashboardResponseTimeDialog>[];
      return dialogs
          .where((dialog) => selectedOperatorNames.contains(dialog.author.trim().toLowerCase()))
          .toList();
    }();

    final avgResponseMinutes = () {
      if (_activeOperatorId == null) {
        final allDialogs = data.responseTimeDialogs;
        if (allDialogs.isEmpty) return data.avgResponseTimeMinutes;
        final total = allDialogs.fold<double>(0, (sum, item) => sum + item.responseTimeMinutes);
        return total / allDialogs.length;
      }
      if (responseDialogs.isEmpty) {
        if (selectedOperatorNames == null || selectedOperatorNames.isEmpty) return null;
        for (final agent in data.agentBreakdown) {
          final normalized = agent.name.trim().toLowerCase();
          if (selectedOperatorNames.contains(normalized)) return agent.avgResponseTimeMinutes;
        }
        return null;
      }
      final total = responseDialogs.fold<double>(0, (sum, item) => sum + item.responseTimeMinutes);
      return total / responseDialogs.length;
    }();

    final responseSegments = () {
      final buckets = <String, ({int count, double totalMinutes})>{
        'fast': (count: 0, totalMinutes: 0),
        'medium': (count: 0, totalMinutes: 0),
        'slow': (count: 0, totalMinutes: 0),
      };

      String? classify(double minutes) {
        if (minutes <= 2) return 'fast';
        if (minutes <= 7) return 'medium';
        if (minutes.isFinite) return 'slow';
        return null;
      }

      if (_activeOperatorId == null) {
        final operatorAverages = <String, List<double>>{};
        for (final dialog in data.responseTimeDialogs) {
          final name = dialog.author.trim().toLowerCase();
          if (name.isEmpty) continue;
          operatorAverages.putIfAbsent(name, () => <double>[]).add(dialog.responseTimeMinutes);
        }
        for (final times in operatorAverages.values) {
          if (times.isEmpty) continue;
          final avg = times.fold<double>(0, (sum, item) => sum + item) / times.length;
          final key = classify(avg);
          if (key == null) continue;
          final current = buckets[key]!;
          buckets[key] = (count: current.count + 1, totalMinutes: current.totalMinutes + avg);
        }
      } else {
        for (final dialog in responseDialogs) {
          final key = classify(dialog.responseTimeMinutes);
          if (key == null) continue;
          final current = buckets[key]!;
          buckets[key] = (count: current.count + 1, totalMinutes: current.totalMinutes + dialog.responseTimeMinutes);
        }
      }

      final total = buckets.values.fold<int>(0, (sum, item) => sum + item.count);
      return ['fast', 'medium', 'slow'].map((key) {
        final bucket = buckets[key]!;
        final avg = bucket.count > 0 ? bucket.totalMinutes / bucket.count : null;
        final pct = total > 0 ? (bucket.count / total) * 100 : 0.0;
        return (key: key, count: bucket.count, avgMinutes: avg, percentage: pct);
      }).toList();
    }();

    final topOperators = () {
      final list = List<DashboardAgentStat>.from(agentStats);
      num metricValue(DashboardAgentStat item) {
        switch (_topMetric) {
          case _TopMetric.avgResponse:
            return item.avgResponseTimeMinutes ?? double.infinity;
          case _TopMetric.messages:
            return item.messages;
          case _TopMetric.dialogs:
            return item.dialogs;
        }
      }

      list.sort((a, b) {
        final aValue = metricValue(a);
        final bValue = metricValue(b);
        if (_topMetric == _TopMetric.avgResponse) {
          return aValue.compareTo(bValue);
        }
        return bValue.compareTo(aValue);
      });
      return list.take(10).toList();
    }();

    final headerCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Card header ──
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Статистика',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$selectedOperatorLabel · $rangeLabel',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    height: 32,
                    child: FilledButton.tonalIcon(
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        backgroundColor: colorScheme.primary.withValues(alpha: 0.1),
                        foregroundColor: colorScheme.primary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        elevation: 0,
                      ),
                      onPressed: _logButtonPress(
                        'refresh dashboard',
                        _refreshing ? null : () => _loadSummary(initial: false),
                      ),
                      icon: Icon(
                        _refreshing ? Icons.hourglass_top_rounded : Icons.refresh_rounded,
                        size: 14,
                      ),
                      label: Text(
                        _refreshing ? 'Обновляем…' : 'Обновить',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  SizedBox(
                    height: 32,
                    child: PopupMenuButton<String>(
                      onSelected: (fmt) async {
                        final range = _activeDateRange();
                        try {
                          final path = await widget.apiClient.downloadDashboardExport(
                            operatorId: _activeOperatorId,
                            startDate: _toApiDate(range.start),
                            endDate: _toApiDate(range.end),
                            format: fmt,
                          );
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Отчёт сохранён: $path')),
                          );
                        } catch (error) {
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Ошибка: $error')),
                          );
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'xlsx', child: Text('📥 Excel')),
                        PopupMenuItem(value: 'pdf', child: Text('📄 PDF')),
                      ],
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        decoration: BoxDecoration(
                          color: Colors.green.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.download_rounded, size: 14, color: Colors.green.shade700),
                            const SizedBox(width: 4),
                            Text(
                              'Экспорт',
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.green.shade700),
                            ),
                            Icon(Icons.arrow_drop_down, size: 16, color: Colors.green.shade700),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // ── Quick stats row ──

            // ── Body ──
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Time preset chips (compact) ──
                  SizedBox(
                    width: double.infinity,
                    child: Builder(
                      builder: (context) {
                        final presets = [
                          ('Сегодня', _TimePreset.today),
                          ('Вчера', _TimePreset.yesterday),
                          ('7д', _TimePreset.last7),
                          ('30д', _TimePreset.last30),
                          ('90д', _TimePreset.last90),
                          (_timePreset == _TimePreset.custom ? 'Даты*' : 'Даты', _TimePreset.custom),
                        ];
                        return Row(
                          children: presets.asMap().entries.map((entry) {
                            final index = entry.key;
                            final (label, preset) = entry.value;
                            final isSelected = _timePreset == preset;
                            return Flexible(
                              child: Padding(
                                padding: EdgeInsets.only(left: index == 0 ? 0 : 4),
                                child: GestureDetector(
                                  onTap: preset == _TimePreset.custom
                                      ? _pickCustomRange
                                      : () => _setPreset(preset),
                                  child: AnimatedContainer(
                                    duration: const Duration(milliseconds: 150),
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      gradient: isSelected
                                          ? AppGradients.selectedChip(colorScheme)
                                          : null,
                                      color: isSelected
                                          ? null
                                          : colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
                                      borderRadius: BorderRadius.circular(999),
                                      border: Border.all(
                                        color: isSelected
                                            ? colorScheme.primary.withValues(alpha: 0.4)
                                            : colorScheme.outlineVariant.withValues(alpha: 0.5),
                                        width: 0.8,
                                      ),
                                      boxShadow: isSelected
                                          ? [
                                              BoxShadow(
                                                color: colorScheme.primary.withValues(alpha: 0.15),
                                                blurRadius: 8,
                                                offset: const Offset(0, 2),
                                              ),
                                            ]
                                          : null,
                                    ),
                                    child: FittedBox(
                                      fit: BoxFit.scaleDown,
                                      child: Text(
                                        label,
                                        style: theme.textTheme.labelSmall?.copyWith(
                                          fontWeight: FontWeight.w700,
                                          color: isSelected
                                              ? colorScheme.onPrimary
                                              : colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 12),
                  // ── Operator dropdown (compact) ──
                  SizedBox(
                    height: 48,
                    child: DropdownButtonFormField<int?>(
                      value: _activeOperatorId,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: 'Сотрудник',
                        isDense: true,
                        prefixIcon: Icon(Icons.person_outline_rounded, size: 20, color: colorScheme.primary.withValues(alpha: 0.7)),
                        prefixIconConstraints: const BoxConstraints(minWidth: 40),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                      ),
                      style: theme.textTheme.bodySmall,
                      items: operatorItems,
                      onChanged: _operatorsLoading || _dashboardTab == _DashboardTab.operators
                          ? null
                          : _handleOperatorChanged,
                    ),
                  ),
                  if (_dashboardTab == _DashboardTab.operators) ...[
                    const SizedBox(height: 4),
                    Text(
                      'На вкладке "Сотрудники" показывается агрегированная статистика по всем.',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  if (_operatorsLoading) ...[
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: const LinearProgressIndicator(minHeight: 3),
                    ),
                  ],
                  if (_operatorsError != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      _operatorsError!,
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                    ),
                  ],
                  if (!hasData && _error == null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Нет данных для отображения. Попробуйте выбрать другого сотрудника или обновить дэшборд.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  if (_error != null && hasData) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Ошибка при обновлении: $_error',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: 8),
                  // ── Tab navigation (segmented style) ──
                  Container(
                    height: 36,
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(
                      children: [
                        _TabSegment(
                          label: 'Обзор',
                          selected: _dashboardTab == _DashboardTab.overview,
                          onTap: () => _setDashboardTab(_DashboardTab.overview),
                        ),
                        _TabSegment(
                          label: 'Сотрудники',
                          selected: _dashboardTab == _DashboardTab.operators,
                          onTap: () => _setDashboardTab(_DashboardTab.operators),
                        ),
                        _TabSegment(
                          label: 'Разделы',
                          selected: _dashboardTab == _DashboardTab.sections,
                          onTap: () => _setDashboardTab(_DashboardTab.sections),
                        ),
                        _TabSegment(
                          label: 'Активность',
                          selected: _dashboardTab == _DashboardTab.activity,
                          onTap: () => _setDashboardTab(_DashboardTab.activity),
                        ),
                        _DashboardMiniChip(
                          label: 'Аналитика',
                          selected: _dashboardTab == _DashboardTab.commercial,
                          onTap: () => _setDashboardTab(_DashboardTab.commercial),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    final sectionCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.pie_chart_outline_rounded, size: 18, color: colorScheme.primary),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Обращения по разделам',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (data.sectionBreakdown.isEmpty)
                Text(
                  'Данных пока нет.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                )
              else
                Builder(
                  builder: (context) {
                    final colors = const [
                      Color(0xFF6366F1),
                      Color(0xFF3B82F6),
                      Color(0xFF06B6D4),
                      Color(0xFF10B981),
                      Color(0xFFF59E0B),
                      Color(0xFFEF4444),
                      Color(0xFF8B5CF6),
                      Color(0xFFEC4899),
                    ];
                    return Column(
                      children: [
                        SizedBox(
                          height: 160,
                          child: PieChart(
                            PieChartData(
                              sectionsSpace: 2,
                              centerSpaceRadius: 40,
                              sections: List.generate(
                                data.sectionBreakdown.length,
                                (i) {
                                  final section = data.sectionBreakdown[i];
                                  return PieChartSectionData(
                                    color: colors[i % colors.length],
                                    value: section.percentage,
                                    title: '${section.percentage.toStringAsFixed(0)}%',
                                    radius: 20,
                                    titleStyle: const TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                    ),
                                  );
                                },
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        ...List.generate(data.sectionBreakdown.length, (i) {
                          final section = data.sectionBreakdown[i];
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                Container(
                                  width: 12,
                                  height: 12,
                                  decoration: BoxDecoration(
                                    color: colors[i % colors.length],
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    section.title,
                                    style: theme.textTheme.bodyMedium,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  numberFormatter.format(section.dialogs),
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }),
                      ],
                    );
                  },
                ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

    final questionsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // FIX: без SizedBox(width: 150/220), чтобы не схлопывалось до 90 и не было overflow
              LayoutBuilder(
                builder: (context, constraints) {
                  final narrow = constraints.maxWidth < 420;
                  if (narrow) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: colorScheme.primary.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(Icons.question_answer_outlined, size: 18, color: colorScheme.primary),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Частые вопросы',
                              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          value: _selectedQuestionSection,
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: 'Раздел',
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                            prefixIcon: Icon(Icons.category_outlined, size: 20, color: colorScheme.onSurfaceVariant.withValues(alpha: 0.7)),
                            prefixIconConstraints: const BoxConstraints(minWidth: 40),
                          ),
                          items: questionSectionItems,
                          onChanged: (value) {
                            if (value == null) return;
                            setState(() => _selectedQuestionSection = value);
                          },
                        ),
                      ],
                    );
                  }

                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: colorScheme.primary.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Icon(Icons.question_answer_outlined, size: 18, color: colorScheme.primary),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Частые вопросы',
                              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        flex: 2,
                        child: DropdownButtonFormField<String>(
                          value: _selectedQuestionSection,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: 'Раздел', isDense: true),
                          items: questionSectionItems,
                          onChanged: (value) {
                            if (value == null) return;
                            setState(() => _selectedQuestionSection = value);
                          },
                        ),
                      ),
                    ],
                  );
                },
              ),

              const SizedBox(height: 8),
              Text(
                'ТОП-5 · $selectedSectionTitle',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              if (selectedQuestions.isEmpty)
                Text(
                  'Пока нет популярных вопросов для выбранного раздела.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                Column(
                  children: List.generate(selectedQuestions.length, (index) {
                    final question = selectedQuestions[index];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${index + 1}.',
                            style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(width: 8),
                          Expanded(child: Text(question.question, style: theme.textTheme.bodyMedium)),
                          const SizedBox(width: 8),
                          Text(
                            numberFormatter.format(question.count),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

    final agentsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.groups_rounded, size: 18, color: colorScheme.primary),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Дэшборд сотрудников',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (agentStats.isEmpty)
                Text(
                  'Пока нет активности сотрудников.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: agentStats.length,
                  separatorBuilder: (context, index) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final agent = agentStats[index];
                    final lastActivityLabel = agent.lastActivity != null
                        ? DateFormat('dd.MM.yyyy HH:mm').format(agent.lastActivity!.toLocal())
                        : '-';

                    return Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
                          width: 0.8,
                        ),
                      ),
                      child: IntrinsicHeight(
                        child: Row(
                          children: [
                            // Gradient accent bar on the left
                            Container(
                              width: 3,
                              decoration: BoxDecoration(
                                gradient: AppGradients.primaryAction(colorScheme),
                                borderRadius: BorderRadius.circular(2),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      CircleAvatar(
                                        radius: 14,
                                        backgroundColor: colorScheme.primary.withValues(alpha: 0.1),
                                        child: Text(
                                          agent.name.isNotEmpty ? agent.name[0].toUpperCase() : '?',
                                          style: theme.textTheme.labelSmall?.copyWith(
                                            fontWeight: FontWeight.w700,
                                            color: colorScheme.primary,
                                            fontSize: 11,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          agent.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: theme.textTheme.titleSmall?.copyWith(
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        lastActivityLabel,
                                        style: theme.textTheme.labelSmall?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant,
                                          fontSize: 10,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      Expanded(
                                        child: _AgentStatChip(
                                          label: 'Диалогов',
                                          value: numberFormatter.format(agent.dialogs),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: _AgentStatChip(
                                          label: 'Сообщений',
                                          value: numberFormatter.format(agent.messages),
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: _AgentStatChip(
                                          label: 'Среднее',
                                          value: agent.avgMessagesPerDialog.toStringAsFixed(1),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

     final activityCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.show_chart_rounded, size: 18, color: colorScheme.primary),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Активность по дням',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (data.recentActivity.isEmpty)
                Text(
                  'Данных пока нет.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else ...[
                Builder(
                  builder: (context) {
                    final sorted = [...data.recentActivity]
                      ..sort((a, b) => a.date.compareTo(b.date));
                    final items = sorted.length <= 7 ? sorted : sorted.sublist(sorted.length - 7);
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: const BoxDecoration(
                                color: Color(0xFF5A7AB8),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'Новые диалоги',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                            const SizedBox(width: 14),
                            Container(
                              width: 10,
                              height: 10,
                              decoration: const BoxDecoration(
                                color: Color(0xFF22C55E),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'Входящие сообщения',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        SizedBox(
                          height: 220,
                          child: _DashboardLineChart(items: items),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Нажмите на точку графика, чтобы посмотреть значения за день.',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ],

            ],
          ),
        ),
          ],
        ),
      ),
    );

    final aiCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: const Color(0xFF8B5CF6).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.smart_toy_rounded, size: 18, color: Color(0xFF8B5CF6)),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'AI Ассистент',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  _DashboardKvRow(
                    label: 'Решено ботом',
                    value: numberFormatter.format(data.aiClosedDialogs),
                    valueColor: const Color(0xFF3B82F6),
                  ),
                  _DashboardKvRow(
                    label: 'Переведено оператору',
                    value: numberFormatter.format(data.transferredToOperatorDialogs),
                  ),
                  const SizedBox(height: 6),
                  Divider(height: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
                  const SizedBox(height: 8),
                  _DashboardKvRow(
                    label: 'Сообщений от бота',
                    value: numberFormatter.format(data.aiMessagesCount),
                  ),
                  _DashboardKvRow(
                    label: 'Ср. до перевода',
                    value: data.avgMessagesBeforeTransfer != null
                        ? data.avgMessagesBeforeTransfer!.toStringAsFixed(1)
                        : '—',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    final slaCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: colorScheme.primary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(Icons.health_and_safety_rounded, size: 18, color: colorScheme.primary),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Качество обслуживания',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Builder(
                    builder: (context) {
                      final slaValue = data.slaCompliancePercentage ?? 0.0;
                      final gaugeColor = slaValue >= 80 ? const Color(0xFF22C55E) : const Color(0xFFEF4444);
                      return Column(
                        children: [
                          Stack(
                            alignment: Alignment.bottomCenter,
                            children: [
                              SizedBox(
                                height: 110,
                                width: 220,
                                child: PieChart(
                                  PieChartData(
                                    startDegreeOffset: 180,
                                    sectionsSpace: 0,
                                    centerSpaceRadius: double.infinity,
                                    sections: [
                                      PieChartSectionData(
                                        value: slaValue,
                                        color: gaugeColor,
                                        showTitle: false,
                                        radius: 12,
                                      ),
                                      PieChartSectionData(
                                        value: 100 - slaValue,
                                        color: theme.colorScheme.outlineVariant.withOpacity(0.3),
                                        showTitle: false,
                                        radius: 12,
                                      ),
                                      PieChartSectionData(
                                        value: 100,
                                        color: Colors.transparent,
                                        showTitle: false,
                                        radius: 12,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.only(bottom: 12),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      data.slaCompliancePercentage != null
                                          ? '${data.slaCompliancePercentage!.toStringAsFixed(1)}%'
                                          : '—',
                                      style: theme.textTheme.headlineLarge?.copyWith(
                                        fontWeight: FontWeight.w800,
                                        color: gaugeColor,
                                      ),
                                    ),
                                    Text(
                                      'SLA (ответ до 5 мин)',
                                      style: theme.textTheme.labelMedium?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          _DashboardKvRow(
                            label: 'Ответов с задержкой',
                            value: numberFormatter.format(data.slaViolationsCount),
                            valueColor: data.slaViolationsCount > 0 ? const Color(0xFFEF4444) : null,
                          ),
                          const SizedBox(height: 6),
                          Divider(height: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
                          const SizedBox(height: 8),
                          _DashboardKvRow(
                            label: 'Повторные обращения',
                            value: numberFormatter.format(data.recurringRequestsCount),
                          ),
                          _DashboardKvRow(
                            label: 'Доля повторных',
                            value: data.recurringRequestsPercentage != null
                                ? '${data.recurringRequestsPercentage!.toStringAsFixed(1)}%'
                                : '—',
                          ),
                        ],
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    final csatCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEAB308).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Icon(Icons.star_rounded, size: 18, color: Color(0xFFEAB308)),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Удовлетворенность (CSAT)',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (data.csatCount == 0)
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 20),
                        child: Column(
                          children: [
                            Icon(Icons.star_outline_rounded, size: 32, color: theme.colorScheme.onSurfaceVariant.withOpacity(0.5)),
                            const SizedBox(height: 8),
                            Text(
                              'Пока нет оценок.',
                              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                            ),
                          ],
                        ),
                      ),
                    )
                  else
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          flex: 2,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                data.csatAverage?.toStringAsFixed(1) ?? '—',
                                style: theme.textTheme.displayMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: colorScheme.primary,
                                  height: 1.1,
                                ),
                              ),
                              Text(
                                'Средняя оценка',
                                style: theme.textTheme.labelMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${numberFormatter.format(data.csatCount)} отзывов',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          flex: 3,
                          child: SizedBox(
                            height: 120,
                            child: BarChart(
                              BarChartData(
                                alignment: BarChartAlignment.spaceAround,
                                maxY: data.csatDistribution.isEmpty
                                    ? 10
                                    : data.csatDistribution.map((e) => e.count.toDouble()).reduce(math.max) * 1.2,
                                barTouchData: BarTouchData(
                                  enabled: true,
                                  touchTooltipData: BarTouchTooltipData(
                                    getTooltipColor: (_) => theme.colorScheme.surfaceContainerHighest,
                                    getTooltipItem: (group, groupIndex, rod, rodIndex) {
                                      final rating = 5 - group.x;
                                      return BarTooltipItem(
                                        '$rating Звезд\n${numberFormatter.format(rod.toY)}',
                                        theme.textTheme.labelMedium!.copyWith(
                                          color: theme.colorScheme.onSurface,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      );
                                    },
                                  ),
                                ),
                                  titlesData: FlTitlesData(
                                    show: true,
                                    bottomTitles: AxisTitles(
                                      sideTitles: SideTitles(
                                        showTitles: true,
                                        getTitlesWidget: (value, meta) {
                                          final rating = value.toInt() + 1;
                                          return Padding(
                                            padding: const EdgeInsets.only(top: 6),
                                            child: Text(
                                              rating.toString(),
                                              style: theme.textTheme.labelSmall?.copyWith(
                                                color: theme.colorScheme.onSurfaceVariant,
                                                fontSize: 11,
                                              ),
                                            ),
                                          );
                                        },
                                        reservedSize: 24,
                                      ),
                                    ),
                                    leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                  ),
                                  gridData: const FlGridData(show: false),
                                  borderData: FlBorderData(show: false),
                                  barGroups: List.generate(
                                    5,
                                    (index) {
                                      final rating = index + 1;
                                      final match = data.csatDistribution.firstWhere(
                                        (e) => e.rating == rating,
                                        orElse: () => CsatDistributionEntry(rating: rating, count: 0),
                                      );
                                      
                                      Color barColor = const Color(0xFFEF4444); // 1, 2
                                      if (rating == 3) barColor = const Color(0xFFF59E0B);
                                      if (rating >= 4) barColor = const Color(0xFF22C55E);

                                      return BarChartGroupData(
                                        x: index,
                                        barRods: [
                                          BarChartRodData(
                                            toY: match.count.toDouble(),
                                            color: barColor,
                                            width: 16,
                                            borderRadius: const BorderRadius.only(
                                              topLeft: Radius.circular(4),
                                              topRight: Radius.circular(4),
                                            ),
                                        ),
                                      ],
                                    );
                                  },
                                ),
                              ),
                              swapAnimationDuration: Duration.zero,
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    final responseCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: colorScheme.primary.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(Icons.speed_rounded, size: 18, color: colorScheme.primary),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Скорость ответа',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    _activeOperatorId == null
                        ? '${numberFormatter.format(agentStats.length > 0 ? agentStats.length : _operators.length)} оператор'
                        : '1 оператор',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 100,
                    height: 100,
                    child: _DashboardDonut(
                      segments: responseSegments
                          .map((item) => _DonutSegment(
                                key: item.key,
                                percentage: item.percentage,
                              ))
                          .toList(),
                      centerValue:
                          numberFormatter.format(responseSegments.fold<int>(0, (sum, item) => sum + item.count)),
                      centerLabel: _activeOperatorId == null ? 'операторов' : 'диалогов',
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      children: [
                        _LegendRow(
                          label: 'Быстрые',
                          count: responseSegments.firstWhere((e) => e.key == 'fast').count,
                          dotColor: const Color(0xFF22C55E),
                        ),
                        _LegendRow(
                          label: 'Средние',
                          count: responseSegments.firstWhere((e) => e.key == 'medium').count,
                          dotColor: const Color(0xFFEAB308),
                        ),
                        _LegendRow(
                          label: 'Медленные',
                          count: responseSegments.firstWhere((e) => e.key == 'slow').count,
                          dotColor: const Color(0xFFEF4444),
                        ),
                        const SizedBox(height: 6),
                        Divider(height: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.6)),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Среднее время ответа',
                                style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                              ),
                            ),
                            Text(
                              _formatResponseTime(avgResponseMinutes),
                              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Период: $rangeLabel',
                style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

    final topOperatorsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: colorScheme.primary.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(Icons.emoji_events_rounded, size: 18, color: colorScheme.primary),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'TOP-10',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      _DashboardMiniChip(
                        label: 'Ответ',
                        selected: _topMetric == _TopMetric.avgResponse,
                        onTap: () => setState(() => _topMetric = _TopMetric.avgResponse),
                      ),
                      _DashboardMiniChip(
                        label: 'Сообщения',
                        selected: _topMetric == _TopMetric.messages,
                        onTap: () => setState(() => _topMetric = _TopMetric.messages),
                      ),
                      _DashboardMiniChip(
                        label: 'Диалоги',
                        selected: _topMetric == _TopMetric.dialogs,
                        onTap: () => setState(() => _topMetric = _TopMetric.dialogs),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              if (topOperators.isEmpty)
                Text(
                  'Пока нет активности сотрудников.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                SizedBox(
                  height: 300,
                  child: RotatedBox(
                    quarterTurns: 1,
                    child: BarChart(
                      BarChartData(
                        alignment: BarChartAlignment.spaceAround,
                        maxY: topOperators.isEmpty
                            ? 10
                            : topOperators.map((e) {
                                switch (_topMetric) {
                                  case _TopMetric.avgResponse:
                                    return e.avgResponseTimeMinutes ?? 0.0;
                                  case _TopMetric.messages:
                                    return e.messages.toDouble();
                                  case _TopMetric.dialogs:
                                    return e.dialogs.toDouble();
                                }
                              }).reduce(math.max) * 1.2,
                        barTouchData: BarTouchData(
                          enabled: true,
                          touchTooltipData: BarTouchTooltipData(
                            getTooltipColor: (_) => theme.colorScheme.surfaceContainerHighest,
                            getTooltipItem: (group, groupIndex, rod, rodIndex) {
                              final item = topOperators[group.x];
                              final metricLabel = switch (_topMetric) {
                                _TopMetric.avgResponse => _formatResponseTime(item.avgResponseTimeMinutes),
                                _TopMetric.messages => numberFormatter.format(item.messages),
                                _TopMetric.dialogs => numberFormatter.format(item.dialogs),
                              };
                              return BarTooltipItem(
                                '${item.name}\n$metricLabel',
                                theme.textTheme.labelMedium!.copyWith(
                                  color: theme.colorScheme.onSurface,
                                  fontWeight: FontWeight.w700,
                                ),
                              );
                            },
                          ),
                        ),
                        titlesData: FlTitlesData(
                          show: true,
                          bottomTitles: AxisTitles(
                            sideTitles: SideTitles(
                              showTitles: true,
                              getTitlesWidget: (value, meta) {
                                if (value < 0 || value >= topOperators.length) return const SizedBox();
                                final name = topOperators[value.toInt()].name;
                                return RotatedBox(
                                  quarterTurns: -1,
                                  child: Container(
                                    width: 80,
                                    padding: const EdgeInsets.only(right: 8),
                                    alignment: Alignment.centerRight,
                                    child: Text(
                                      name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.labelSmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                        fontSize: 10,
                                      ),
                                    ),
                                  ),
                                );
                              },
                              reservedSize: 80,
                            ),
                          ),
                          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        ),
                        gridData: const FlGridData(show: false),
                        borderData: FlBorderData(show: false),
                        barGroups: List.generate(
                          topOperators.length,
                          (index) {
                            final item = topOperators[index];
                            final value = switch (_topMetric) {
                              _TopMetric.avgResponse => item.avgResponseTimeMinutes ?? 0.0,
                              _TopMetric.messages => item.messages.toDouble(),
                              _TopMetric.dialogs => item.dialogs.toDouble(),
                            };
                            return BarChartGroupData(
                              x: index,
                              barRods: [
                                BarChartRodData(
                                  toY: value,
                                  color: colorScheme.primary,
                                  width: 16,
                                  borderRadius: const BorderRadius.only(
                                    topLeft: Radius.circular(4),
                                    topRight: Radius.circular(4),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

    final messagesPerDay = activeRange.start == null || activeRange.end == null
        ? 0
        : ((data.totalOutgoingMessages) /
                (activeRange.end!.difference(activeRange.start!).inDays + 1))
            .round();

    final dialogsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            _cardAccentStrip(colorScheme),
            Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.chat_bubble_outline_rounded, size: 18, color: colorScheme.primary),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Диалоги',
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              // ── KPI metric tiles row ──
              Row(
                children: [
                  Expanded(
                    child: _KpiTile(
                      icon: Icons.forum_rounded,
                      iconColor: colorScheme.primary,
                      label: 'Всего',
                      value: numberFormatter.format(data.totalDialogs),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _KpiTile(
                      icon: Icons.mark_chat_unread_rounded,
                      iconColor: const Color(0xFF22C55E),
                      label: 'Активные',
                      value: numberFormatter.format(data.openDialogs),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _KpiTile(
                      icon: Icons.check_circle_outline_rounded,
                      iconColor: colorScheme.onSurfaceVariant,
                      label: 'Закрытые',
                      value: numberFormatter.format(data.closedDialogs),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Divider(height: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
              const SizedBox(height: 10),
              // ── Messages row (compact) ──
              Row(
                children: [
                  Expanded(
                    child: _AgentStatChip(
                      label: 'Сообщений',
                      value: numberFormatter.format(data.totalMessages),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _AgentStatChip(
                      label: 'Сообщений/день',
                      value: numberFormatter.format(messagesPerDay),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Период: $rangeLabel',
                style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
          ],
        ),
      ),
    );

    final tabChildren = switch (_dashboardTab) {
      _DashboardTab.overview => <Widget>[responseCard, dialogsCard],
      _DashboardTab.operators => <Widget>[topOperatorsCard, agentsCard],
      _DashboardTab.sections => <Widget>[sectionCard, questionsCard],
      _DashboardTab.activity => <Widget>[activityCard],
      _DashboardTab.commercial => <Widget>[aiCard, slaCard, csatCard],
    };

    final listChildren = <Widget>[headerCard, ...tabChildren, const SizedBox(height: 24)];

    return Theme(
      data: moduleTheme,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              colorScheme.primary.withValues(alpha: 0.12),
              colorScheme.secondaryContainer.withValues(alpha: 0.05),
              colorScheme.surface,
            ],
          ),
        ),
        child: RefreshIndicator(
          onRefresh: _handleRefresh,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            children: listChildren,
          ),
        ),
      ),
    );
  }
}

class _DashboardKvRow extends StatelessWidget {
  const _DashboardKvRow({required this.label, required this.value, this.valueColor});

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.onSurfaceVariant),
            ),
          ),
          Text(
            value,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: valueColor ?? colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}

class _LegendRow extends StatelessWidget {
  const _LegendRow({
    required this.label,
    required this.count,
    required this.dotColor,
  });

  final String label;
  final int count;
  final Color dotColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
          Text('$count', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _DonutSegment {
  const _DonutSegment({required this.key, required this.percentage});

  final String key;
  final double percentage;

  Color color() {
    switch (key) {
      case 'fast':
        return const Color(0xFF22C55E);
      case 'medium':
        return const Color(0xFFEAB308);
      case 'slow':
      default:
        return const Color(0xFFEF4444);
    }
  }
}

class _DashboardDonut extends StatefulWidget {
  const _DashboardDonut({
    required this.segments,
    required this.centerValue,
    required this.centerLabel,
  });

  final List<_DonutSegment> segments;
  final String centerValue;
  final String centerLabel;

  @override
  State<_DashboardDonut> createState() => _DashboardDonutState();
}

class _DashboardDonutState extends State<_DashboardDonut> {
  int touchedIndex = -1;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Stack(
      alignment: Alignment.center,
      children: [
        PieChart(
          PieChartData(
            pieTouchData: PieTouchData(
              touchCallback: (FlTouchEvent event, pieTouchResponse) {
                setState(() {
                  if (!event.isInterestedForInteractions ||
                      pieTouchResponse == null ||
                      pieTouchResponse.touchedSection == null) {
                    touchedIndex = -1;
                    return;
                  }
                  touchedIndex = pieTouchResponse.touchedSection!.touchedSectionIndex;
                });
              },
            ),
            startDegreeOffset: -90,
            borderData: FlBorderData(show: false),
            sectionsSpace: 2,
            centerSpaceRadius: double.infinity,
            sections: widget.segments.asMap().entries.map((entry) {
              final isTouched = entry.key == touchedIndex;
              final radius = isTouched ? 16.0 : 12.0;

              return PieChartSectionData(
                color: entry.value.color(),
                value: entry.value.percentage,
                title: '',
                radius: radius,
              );
            }).toList(),
          ),
        ),
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              widget.centerValue,
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            Text(
              widget.centerLabel,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontSize: 9,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _DashboardLineChart extends StatefulWidget {
  const _DashboardLineChart({required this.items});

  final List<DashboardActivityPoint> items;

  @override
  State<_DashboardLineChart> createState() => _DashboardLineChartState();
}

class _DashboardLineChartState extends State<_DashboardLineChart> {
  int? _selectedIndex;

  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.items.isNotEmpty ? widget.items.length - 1 : null;
  }

  @override
  void didUpdateWidget(covariant _DashboardLineChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.items.isEmpty) {
      _selectedIndex = null;
      return;
    }
    if (_selectedIndex == null || _selectedIndex! >= widget.items.length) {
      _selectedIndex = widget.items.length - 1;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final numberFormatter = NumberFormat.decimalPattern('ru');

    final labels = widget.items
        .map((e) => DateFormat('dd.MM').format(e.date.toLocal()))
        .toList();
    final selectedIndex = _selectedIndex;
    final selected = selectedIndex != null ? widget.items[selectedIndex] : null;

    final maxDialogs = widget.items.isEmpty ? 0 : widget.items.map((e) => e.dialogs).reduce(math.max);
    final maxIncoming = widget.items.isEmpty ? 0 : widget.items.map((e) => e.incomingMessages).reduce(math.max);
    final maxY = math.max(maxDialogs, maxIncoming).toDouble() * 1.2;

    return Column(
      children: [
        if (selected != null)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
              ),
            ),
            child: Row(
              children: [
                Text(
                  DateFormat('dd.MM').format(selected.date.toLocal()),
                  style: theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                Text(
                  'Диалоги: ${numberFormatter.format(selected.dialogs)}',
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(width: 12),
                Text(
                  'Входящие: ${numberFormatter.format(selected.incomingMessages)}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
        Expanded(
          child: LineChart(
            LineChartData(
              maxY: maxY == 0 ? 10 : maxY,
              minY: 0,
              lineTouchData: LineTouchData(
                enabled: true,
                touchCallback: (FlTouchEvent event, LineTouchResponse? touchResponse) {
                  if (touchResponse?.lineBarSpots == null || touchResponse!.lineBarSpots!.isEmpty) {
                    return;
                  }
                  final index = touchResponse.lineBarSpots!.first.spotIndex;
                  if (_selectedIndex != index) {
                    setState(() => _selectedIndex = index);
                  }
                },
                getTouchedSpotIndicator: (LineChartBarData barData, List<int> spotIndexes) {
                  return spotIndexes.map((spotIndex) {
                    return TouchedSpotIndicatorData(
                      FlLine(color: theme.colorScheme.outlineVariant, strokeWidth: 1.5),
                      FlDotData(
                        getDotPainter: (spot, percent, barData, index) {
                          return FlDotCirclePainter(
                            radius: 4.5,
                            color: barData.color ?? theme.colorScheme.primary,
                            strokeWidth: 2,
                            strokeColor: Colors.white,
                          );
                        },
                      ),
                    );
                  }).toList();
                },
                touchTooltipData: LineTouchTooltipData(
                  getTooltipColor: (_) => Colors.transparent,
                  getTooltipItems: (touchedSpots) => touchedSpots.map((_) => null).toList(),
                ),
              ),
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                horizontalInterval: maxY > 0 ? maxY / 3 : 1,
                getDrawingHorizontalLine: (value) {
                  return FlLine(
                    color: theme.colorScheme.outlineVariant.withValues(alpha: 0.45),
                    strokeWidth: 1,
                  );
                },
              ),
              titlesData: FlTitlesData(
                show: true,
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 22,
                    interval: 1,
                    getTitlesWidget: (value, meta) {
                      final index = value.toInt();
                      if (index < 0 || index >= labels.length) return const SizedBox();
                      if (labels.length > 4 && index % (labels.length / 4).ceil() != 0 && index != labels.length - 1 && index != 0) {
                        return const SizedBox();
                      }
                      return Padding(
                        padding: const EdgeInsets.only(top: 8.0),
                        child: Text(
                          labels[index],
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: index == _selectedIndex
                                ? theme.colorScheme.primary
                                : theme.colorScheme.onSurfaceVariant,
                            fontWeight: index == _selectedIndex ? FontWeight.w700 : FontWeight.w500,
                            fontSize: 10,
                          ),
                        ),
                      );
                    },
                  ),
                ),
                leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData: [
                LineChartBarData(
                  spots: widget.items.asMap().entries.map((e) => FlSpot(e.key.toDouble(), e.value.dialogs.toDouble())).toList(),
                  isCurved: true,
                  color: const Color(0xFF5A7AB8),
                  barWidth: 2.5,
                  isStrokeCapRound: true,
                  dotData: FlDotData(
                    show: true,
                    getDotPainter: (spot, percent, barData, index) {
                      return FlDotCirclePainter(
                        radius: 3.5,
                        color: const Color(0xFF5A7AB8),
                        strokeWidth: 0,
                      );
                    },
                  ),
                  belowBarData: BarAreaData(show: false),
                ),
                LineChartBarData(
                  spots: widget.items.asMap().entries.map((e) => FlSpot(e.key.toDouble(), e.value.incomingMessages.toDouble())).toList(),
                  isCurved: true,
                  color: const Color(0xFF22C55E),
                  barWidth: 2.5,
                  isStrokeCapRound: true,
                  dotData: FlDotData(
                    show: true,
                    getDotPainter: (spot, percent, barData, index) {
                      return FlDotCirclePainter(
                        radius: 3.5,
                        color: const Color(0xFF22C55E),
                        strokeWidth: 0,
                      );
                    },
                  ),
                  belowBarData: BarAreaData(show: false),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _AgentStatChip extends StatelessWidget {
  const _AgentStatChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.22),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colorScheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              fontSize: 9,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}

// ── KPI metric tile with colored icon container ──
class _KpiTile extends StatelessWidget {
  const _KpiTile({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colorScheme.outlineVariant.withValues(alpha: 0.3)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w800,
              color: colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 1),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }
}

class _DashboardMiniChip extends StatelessWidget {
  const _DashboardMiniChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        boxShadow: selected
            ? [
                BoxShadow(
                  color: colorScheme.primary.withValues(alpha: 0.16),
                  blurRadius: 12,
                  offset: const Offset(0, 3),
                ),
              ]
            : null,
      ),
      child: Material(
        color: selected
            ? Colors.transparent
            : colorScheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(999),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            gradient: selected
                ? AppGradients.selectedChip(colorScheme)
                : null,
            border: Border.all(
              color: selected
                  ? colorScheme.primary.withValues(alpha: 0.4)
                  : colorScheme.outlineVariant.withValues(alpha: 0.55),
            ),
          ),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(999),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 34),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                child: Text(
                  label,
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: selected
                        ? colorScheme.onPrimary
                        : colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Quick stat in the header hero row ──
class _QuickStat extends StatelessWidget {
  const _QuickStat({
    required this.label,
    required this.value,
    required this.icon,
    this.valueColor,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: colorScheme.primary.withValues(alpha: 0.5)),
            const SizedBox(height: 2),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
                color: valueColor ?? colorScheme.onSurface,
              ),
            ),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
                fontSize: 9,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Segmented tab button ──
class _TabSegment extends StatelessWidget {
  const _TabSegment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          height: 34,
          margin: const EdgeInsets.all(1),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: selected ? AppGradients.selectedChip(colorScheme) : null,
            borderRadius: BorderRadius.circular(999),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: colorScheme.primary.withValues(alpha: 0.15),
                      blurRadius: 6,
                      offset: const Offset(0, 1),
                    ),
                  ]
                : null,
          ),
          child: Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: selected ? colorScheme.onPrimary : colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

// ── Gradient accent strip for sub-cards ──
Widget _cardAccentStrip(ColorScheme colorScheme) {
  return const SizedBox.shrink();
}



