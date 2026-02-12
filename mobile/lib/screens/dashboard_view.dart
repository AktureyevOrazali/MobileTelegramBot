part of '../main.dart';

enum _DashboardTab { overview, operators, sections, activity }
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

      final filtered = users
          .where((user) => !user.isAdmin)
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

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final moduleTheme = theme.copyWith(
      cardTheme: theme.cardTheme.copyWith(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.55),
          ),
        ),
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
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              height: 4,
              decoration: BoxDecoration(
                gradient: AppGradients.primaryAction(colorScheme),
              ),
            ),
            Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Статистика',
                          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$selectedOperatorLabel · $rangeLabel · $updatedAtLabel',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(
                    height: 36,
                    child: FilledButton.icon(
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      onPressed: _logButtonPress(
                        'refresh dashboard',
                        _refreshing ? null : () => _loadSummary(initial: false),
                      ),
                      icon: const Icon(Icons.refresh_rounded, size: 16),
                      label: Text(_refreshing ? 'Обновляем…' : 'Обновить'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _DashboardMiniChip(
                    label: 'Сегодня',
                    selected: _timePreset == _TimePreset.today,
                    onTap: () => _setPreset(_TimePreset.today),
                  ),
                  _DashboardMiniChip(
                    label: 'Вчера',
                    selected: _timePreset == _TimePreset.yesterday,
                    onTap: () => _setPreset(_TimePreset.yesterday),
                  ),
                  _DashboardMiniChip(
                    label: '7д',
                    selected: _timePreset == _TimePreset.last7,
                    onTap: () => _setPreset(_TimePreset.last7),
                  ),
                  _DashboardMiniChip(
                    label: '30д',
                    selected: _timePreset == _TimePreset.last30,
                    onTap: () => _setPreset(_TimePreset.last30),
                  ),
                  _DashboardMiniChip(
                    label: '90д',
                    selected: _timePreset == _TimePreset.last90,
                    onTap: () => _setPreset(_TimePreset.last90),
                  ),
                  _DashboardMiniChip(
                    label: _timePreset == _TimePreset.custom ? 'Даты*' : 'Свои даты',
                    selected: _timePreset == _TimePreset.custom,
                    onTap: _pickCustomRange,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<int?>(
                value: _activeOperatorId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Сотрудник', isDense: true),
                items: operatorItems,
                onChanged: _operatorsLoading || _dashboardTab == _DashboardTab.operators
                    ? null
                    : _handleOperatorChanged,
              ),
              if (_dashboardTab == _DashboardTab.operators) ...[
                const SizedBox(height: 6),
                Text(
                  'На вкладке "Сотрудники" показывается агрегированная статистика по всем.',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (_operatorsLoading) ...[
                const SizedBox(height: 10),
                const LinearProgressIndicator(),
              ],
              if (_operatorsError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _operatorsError!,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              if (!hasData && _error == null) ...[
                const SizedBox(height: 10),
                Text(
                  'Нет данных для отображения. Попробуйте выбрать другого сотрудника или обновить дэшборд.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              if (_error != null && hasData) ...[
                const SizedBox(height: 10),
                Text(
                  'Ошибка при обновлении: $_error',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: 12),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                  const SizedBox(width: 8),
                  _DashboardMiniChip(
                    label: 'Обзор',
                    selected: _dashboardTab == _DashboardTab.overview,
                    onTap: () => _setDashboardTab(_DashboardTab.overview),
                  ),
                  const SizedBox(width: 8),
                  _DashboardMiniChip(
                    label: 'Сотрудники',
                    selected: _dashboardTab == _DashboardTab.operators,
                    onTap: () => _setDashboardTab(_DashboardTab.operators),
                  ),
                  const SizedBox(width: 8),
                  _DashboardMiniChip(
                    label: 'Разделы',
                    selected: _dashboardTab == _DashboardTab.sections,
                    onTap: () => _setDashboardTab(_DashboardTab.sections),
                  ),
                  _DashboardMiniChip(
                    label: 'Активность',
                    selected: _dashboardTab == _DashboardTab.activity,
                    onTap: () => _setDashboardTab(_DashboardTab.activity),
                  ),
                  ],
                ),
              ),
              const SizedBox(height: 12),

            ],
          ),
        ),
          ],
        ),
      ),
    );

    final sectionCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Обращения по разделам',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
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
                Column(
                  children: data.sectionBreakdown.map((section) {
                    final progress = (section.percentage / 100).clamp(0, 1);
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(child: Text(section.title, style: theme.textTheme.bodyMedium)),
                              const SizedBox(width: 12),
                              Text(
                                '${numberFormatter.format(section.dialogs)} · ${section.percentage.toStringAsFixed(1)}%',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(999),
                            child: LinearProgressIndicator(
                              minHeight: 6,
                              value: progress.toDouble(),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
            ],
          ),
        ),
      ),
    );

    final questionsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
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
                        Text(
                          'Частые вопросы',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          value: _selectedQuestionSection,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: 'Раздел', isDense: true),
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
                        child: Text(
                          'Частые вопросы',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
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
      ),
    );

    final agentsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Дэшборд сотрудников',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              if (agentStats.isEmpty)
                Text(
                  'Пока нет активности сотрудников.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              else
                LayoutBuilder(
                  builder: (context, constraints) {
                    final columns = constraints.maxWidth >= 760 ? 2 : 1;

                    return GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: agentStats.length,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                        childAspectRatio: columns == 1 ? 2.7 : 3.2,
                      ),
                      itemBuilder: (context, index) {
                        final agent = agentStats[index];
                        final lastActivityLabel = agent.lastActivity != null
                            ? DateFormat('dd.MM.yyyy HH:mm').format(agent.lastActivity!.toLocal())
                            : '-';

                        return Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
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
                                  const SizedBox(width: 8),
                                  Text(
                                    lastActivityLabel,
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: _AgentStatChip(
                                      label: 'Диалогов',
                                      value: numberFormatter.format(agent.dialogs),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: _AgentStatChip(
                                      label: 'Сообщений',
                                      value: numberFormatter.format(agent.messages),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
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
                        );
                      },
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );

     final activityCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Активность по дням',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
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
      ),
    );

    final responseCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Скорость ответа',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
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
                    width: 124,
                    height: 124,
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
      ),
    );

    final topOperatorsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'TOP-10',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
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
                Column(
                  children: List.generate(topOperators.length, (index) {
                    final item = topOperators[index];
                    final metricTitle = switch (_topMetric) {
                      _TopMetric.avgResponse => 'Среднее время ответа',
                      _TopMetric.messages => 'Всего сообщений',
                      _TopMetric.dialogs => 'Всего диалогов',
                    };
                    final metricLabel = switch (_topMetric) {
                      _TopMetric.avgResponse => _formatResponseTime(item.avgResponseTimeMinutes),
                      _TopMetric.messages => numberFormatter.format(item.messages),
                      _TopMetric.dialogs => numberFormatter.format(item.dialogs),
                    };
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          SizedBox(
                            width: 22,
                            child: Text(
                              '${index + 1}.',
                              style: theme.textTheme.labelMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              item.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                metricLabel,
                                style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              Text(
                                metricTitle,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  }),
                ),
            ],
          ),
        ),
      ),
    );

    final dialogsCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Диалоги',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              _DashboardKvRow(
                label: 'Всего',
                value: numberFormatter.format(data.totalDialogs),
              ),
              _DashboardKvRow(
                label: 'Активные',
                value: numberFormatter.format(data.openDialogs),
              ),
              _DashboardKvRow(
                label: 'Закрытые',
                value: numberFormatter.format(data.closedDialogs),
              ),
              const SizedBox(height: 8),
              Divider(height: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.6)),
              const SizedBox(height: 8),
              _DashboardKvRow(
                label: 'Сообщений',
                value: numberFormatter.format(data.totalMessages),
              ),
              _DashboardKvRow(
                label: 'Сообщений/день',
                value: numberFormatter.format(
                  activeRange.start == null || activeRange.end == null
                      ? 0
                      : ((data.totalOutgoingMessages) /
                              (activeRange.end!.difference(activeRange.start!).inDays + 1))
                          .round(),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Период: $rangeLabel',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
    );

    final tabChildren = switch (_dashboardTab) {
      _DashboardTab.overview => <Widget>[responseCard, dialogsCard],
      _DashboardTab.operators => <Widget>[topOperatorsCard, agentsCard],
      _DashboardTab.sections => <Widget>[sectionCard, questionsCard],
      _DashboardTab.activity => <Widget>[activityCard],
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
              colorScheme.primary.withValues(alpha: 0.08),
              colorScheme.surface,
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
  const _DashboardKvRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          Text(value, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
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

class _DashboardDonut extends StatelessWidget {
  const _DashboardDonut({
    required this.segments,
    required this.centerValue,
    required this.centerLabel,
  });

  final List<_DonutSegment> segments;
  final String centerValue;
  final String centerLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Stack(
      alignment: Alignment.center,
      children: [
        CustomPaint(
          size: const Size.square(124),
          painter: _DonutPainter(
            segments: segments,
            trackColor: theme.colorScheme.outlineVariant.withOpacity(0.35),
          ),
        ),
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              centerValue,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
            ),
            Text(
              centerLabel,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ],
    );
  }
}

class _DonutPainter extends CustomPainter {
  const _DonutPainter({required this.segments, required this.trackColor});

  final List<_DonutSegment> segments;
  final Color trackColor;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.16;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - stroke) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke
      ..color = trackColor;
    canvas.drawCircle(center, radius, trackPaint);

    final arcPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke;

    var start = -math.pi / 2;
    for (final segment in segments) {
      final sweep = (segment.percentage.clamp(0, 100) / 100) * math.pi * 2;
      if (sweep <= 0) continue;
      arcPaint.color = segment.color();
      canvas.drawArc(rect, start, sweep, false, arcPaint);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) {
    return oldDelegate.segments != segments || oldDelegate.trackColor != trackColor;
  }
}

class _DashboardLineChart extends StatefulWidget {
  const _DashboardLineChart({required this.items});

  final List<DashboardActivityPoint> items;

  @override
  State<_DashboardLineChart> createState() => _DashboardLineChartState();
}

class _DashboardLineChartState extends State<_DashboardLineChart> {
  static const double _padL = 12;
  static const double _padR = 12;
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

  void _selectFromPosition(double dx, double width) {
    if (widget.items.isEmpty) return;
    final plotW = (width - _padL - _padR).clamp(1.0, double.infinity);
    final clampedDx = dx.clamp(_padL, width - _padR);
    final ratio = (clampedDx - _padL) / plotW;
    final raw = ratio * (widget.items.length - 1);
    final index = raw.round().clamp(0, widget.items.length - 1);
    if (index != _selectedIndex) {
      setState(() {
        _selectedIndex = index;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final numberFormatter = NumberFormat.decimalPattern('ru');

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final labels = widget.items
            .map((e) => DateFormat('dd.MM').format(e.date.toLocal()))
            .toList();
        final showLabelAt = (int index) {
          if (labels.length <= 4) return true;
          if (index == 0 || index == labels.length - 1) return true;
          final step = (labels.length / 4).ceil();
          return index % step == 0;
        };
        final selectedIndex = _selectedIndex;
        final selected = selectedIndex != null ? widget.items[selectedIndex] : null;

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
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (details) =>
                    _selectFromPosition(details.localPosition.dx, width),
                onHorizontalDragStart: (details) =>
                    _selectFromPosition(details.localPosition.dx, width),
                onHorizontalDragUpdate: (details) =>
                    _selectFromPosition(details.localPosition.dx, width),
                child: CustomPaint(
                  size: Size(width, 180),
                  painter: _LineChartPainter(
                    items: widget.items,
                    gridColor: theme.colorScheme.outlineVariant.withValues(alpha: 0.45),
                    selectedIndex: selectedIndex,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            Row(
                children: labels
                  .asMap()
                  .entries
                  .map(
                    (entry) => Expanded(
                      child: Text(
                        showLabelAt(entry.key) ? entry.value : '',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: entry.key == selectedIndex
                              ? theme.colorScheme.primary
                              : theme.colorScheme.onSurfaceVariant,
                          fontWeight: entry.key == selectedIndex
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        );
      },
    );
  }
}

class _LineChartPainter extends CustomPainter {
  const _LineChartPainter({
    required this.items,
    required this.gridColor,
    this.selectedIndex,
  });

  final List<DashboardActivityPoint> items;
  final Color gridColor;
  final int? selectedIndex;

  @override
  void paint(Canvas canvas, Size size) {
    if (items.isEmpty) return;

    final maxValue = items
        .map((e) => math.max(e.dialogs, e.incomingMessages))
        .fold<int>(1, (acc, value) => math.max(acc, value));

    const padL = 12.0;
    const padR = 12.0;
    const padT = 8.0;
    const padB = 10.0;
    final plotW = size.width - padL - padR;
    final plotH = size.height - padT - padB;
    final stepX = items.length > 1 ? plotW / (items.length - 1) : 0.0;

    double toX(int i) => padL + (items.length > 1 ? i * stepX : plotW / 2);
    double toY(int value) => padT + plotH - (value / maxValue) * plotH;

    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = padT + (plotH / 3) * i;
      canvas.drawLine(Offset(padL, y), Offset(size.width - padR, y), gridPaint);
    }

    final dialogsPaint = Paint()
      ..color = const Color(0xFF5A7AB8)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final incomingPaint = Paint()
      ..color = const Color(0xFF22C55E)
      ..strokeWidth = 2.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final dialogsPath = Path();
    final incomingPath = Path();
    for (var i = 0; i < items.length; i++) {
      final x = toX(i);
      final dialogsY = toY(items[i].dialogs);
      final incomingY = toY(items[i].incomingMessages);
      if (i == 0) {
        dialogsPath.moveTo(x, dialogsY);
        incomingPath.moveTo(x, incomingY);
      } else {
        dialogsPath.lineTo(x, dialogsY);
        incomingPath.lineTo(x, incomingY);
      }
    }
    canvas.drawPath(dialogsPath, dialogsPaint);
    canvas.drawPath(incomingPath, incomingPaint);

    final pointPaintDialogs = Paint()..color = const Color(0xFF5A7AB8);
    final pointPaintIncoming = Paint()..color = const Color(0xFF22C55E);
    for (var i = 0; i < items.length; i++) {
      final x = toX(i);
      canvas.drawCircle(Offset(x, toY(items[i].dialogs)), 3.5, pointPaintDialogs);
      canvas.drawCircle(Offset(x, toY(items[i].incomingMessages)), 3.5, pointPaintIncoming);
    }

    if (selectedIndex != null &&
        selectedIndex! >= 0 &&
        selectedIndex! < items.length) {
      final x = toX(selectedIndex!);
      final selectedDialogsY = toY(items[selectedIndex!].dialogs);
      final selectedIncomingY = toY(items[selectedIndex!].incomingMessages);

      final indicatorPaint = Paint()
        ..color = gridColor.withValues(alpha: 0.9)
        ..strokeWidth = 1.2;
      canvas.drawLine(
        Offset(x, padT),
        Offset(x, size.height - padB),
        indicatorPaint,
      );

      final selectedDialogsPoint = Paint()..color = const Color(0xFF5A7AB8);
      final selectedIncomingPoint = Paint()..color = const Color(0xFF22C55E);
      final haloPaint = Paint()..color = Colors.white;

      canvas.drawCircle(Offset(x, selectedDialogsY), 6.2, haloPaint);
      canvas.drawCircle(Offset(x, selectedDialogsY), 4.4, selectedDialogsPoint);
      canvas.drawCircle(Offset(x, selectedIncomingY), 6.2, haloPaint);
      canvas.drawCircle(Offset(x, selectedIncomingY), 4.4, selectedIncomingPoint);
    }
  }

  @override
  bool shouldRepaint(covariant _LineChartPainter oldDelegate) {
    return oldDelegate.items != items ||
        oldDelegate.gridColor != gridColor ||
        oldDelegate.selectedIndex != selectedIndex;
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colorScheme.outlineVariant.withValues(alpha: 0.6)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelSmall?.copyWith(color: colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
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





