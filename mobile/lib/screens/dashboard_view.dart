
part of '../main.dart';

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

  @override
  void initState() {
    super.initState();
    _loadSummary(initial: true);
    _loadOperators();
  }

  Future<void> reloadSummary() => _loadSummary(initial: false);

  Future<void> _loadSummary({required bool initial, int? operatorOverride}) async {
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
      final summary = await widget.apiClient.fetchDashboardSummary(
        operatorId: operatorOverride ?? _selectedOperatorId,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _summary = summary;
        _error = null;
        if (_selectedQuestionSection != 'all') {
          final validKeys = summary.questionsBySection
              .map((section) => section.section ?? (section.title.isNotEmpty ? section.title : 'no-section'))
              .toSet();
          if (!validKeys.contains(_selectedQuestionSection)) {
            _selectedQuestionSection = 'all';
          }
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        if (initial) {
          _summary = null;
        }
      });
} finally {
      if (!mounted) {
        return;
      }
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
      if (!mounted) {
        return;
      }
      final filtered = users
          .where((user) => !user.isAdmin && (user.role == 'moderator' || user.role == 'viewer'))
          .where((user) {
            final normalized = ('${user.name} ${user.login}').toLowerCase();
            if (normalized.trim().isEmpty) {
              return true;
            }
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
      if (!mounted) {
        return;
      }
      setState(() {
        _operatorsError = error.toString();
      });
    } finally {
      if (!mounted) {
        return;
      }
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

  String _formatResponseTime(double? minutes) {
    if (minutes == null) {
      return '—';
    }
    final totalSeconds = (minutes * 60).round();
    final minutesPart = totalSeconds ~/ 60;
    final secondsPart = totalSeconds % 60;
    if (minutesPart > 0 && secondsPart > 0) {
      return '$minutesPart мин $secondsPart с';
    }
    if (minutesPart > 0) {
      return '$minutesPart мин';
    }
    return '$secondsPart с';
  }

  String _describeResponseTime(double? minutes) {
    if (minutes == null) {
      return 'Недостаточно данных';
    }
    if (minutes <= 2) {
      return 'Отвечает быстро';
    }
    if (minutes <= 7) {
      return 'Отвечает в среднем темпе';
    }
    return 'Отвечает медленно';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final theme = Theme.of(context);
    final numberFormatter = NumberFormat.decimalPattern('ru');
    final summary = _summary;
    final hasData = summary != null;
    final data = summary ?? DashboardSummary.empty();
    final updatedAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(data.updatedAt.toLocal());
    final avgMessagesLabel = data.averageMessagesPerDialog.toStringAsFixed(1);
    final responseTimeLabel = _formatResponseTime(data.avgResponseTimeMinutes);
    final responseTimeMood = _describeResponseTime(data.avgResponseTimeMinutes);

    final faqPrefixRegex = RegExp(r'^\[(faq)\]\s*', caseSensitive: false);
    final commandTagRegex = RegExp(r'^\[[^\]]*команда[^\]]*\]', caseSensitive: false);

    String normalizeQuestion(String raw) {
      final withoutFaq = raw.trim().replaceFirst(faqPrefixRegex, '');
      return withoutFaq.trim().toLowerCase();
    }

    final normalizedSectionTitles = <String>{};
    for (final section in data.sectionBreakdown) {
      final normalized = section.title.trim().toLowerCase();
      if (normalized.isNotEmpty) {
        normalizedSectionTitles.add(normalized);
      }
    }
    for (final section in data.questionsBySection) {
      final normalized = section.title.trim().toLowerCase();
      if (normalized.isNotEmpty) {
        normalizedSectionTitles.add(normalized);
      }
    }

    final operatorNameSet = <String>{};
    for (final operator in _operators) {
      if (operator.name.trim().isNotEmpty) {
        operatorNameSet.add(operator.name.trim().toLowerCase());
      }
      if (operator.login.trim().isNotEmpty) {
        operatorNameSet.add(operator.login.trim().toLowerCase());
      }
    }
    final hasOperatorNames = operatorNameSet.isNotEmpty;

    final operatorItems = <DropdownMenuItem<int?>>[
      const DropdownMenuItem<int?>(
        value: null,
        child: Text('Все сотрудники'),
      ),
      ..._operators.map(
        (operator) => DropdownMenuItem<int?>(
          value: operator.id,
          child: Text(operator.name.isNotEmpty ? operator.name : operator.login),
        ),
      ),
    ];

    final sectionEntries = <_QuestionSectionEntry>[];
    final seenKeys = <String>{};
    for (final section in data.questionsBySection) {
      final key = section.section ?? (section.title.isNotEmpty ? section.title : 'no-section');
      if (seenKeys.contains(key)) {
        continue;
      }
      seenKeys.add(key);
      final normalizedTitle = section.title.trim().toLowerCase();
      final seenQuestions = <String>{};
      final filteredQuestions = section.questions.where((question) {
        final normalizedQuestion = normalizeQuestion(question.question);
        if (normalizedQuestion.isEmpty) {
          return false;
        }
        if (normalizedSectionTitles.contains(normalizedQuestion)) {
          return false;
        }
        if (normalizedTitle.isNotEmpty && normalizedQuestion == normalizedTitle) {
          return false;
        }
        if (commandTagRegex.hasMatch(question.question.trim())) {
          return false;
        }
        if (seenQuestions.contains(normalizedQuestion)) {
          return false;
        }
        seenQuestions.add(normalizedQuestion);
        return true;
      }).toList();

      if (filteredQuestions.isEmpty) {
        continue;
      }

      final totalCount = filteredQuestions.fold<int>(0, (acc, question) => acc + question.count);
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
          child: Text(entry.title),
        ),
      ),
    ];

    final filteredTopQuestions = () {
      final seen = <String>{};
      return data.topQuestions.where((question) {
        final normalized = normalizeQuestion(question.question);
        if (normalized.isEmpty) {
          return false;
        }
        if (normalizedSectionTitles.contains(normalized)) {
          return false;
        }
        if (commandTagRegex.hasMatch(question.question.trim())) {
          return false;
        }
        if (seen.contains(normalized)) {
          return false;
        }
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
      if (_selectedQuestionSection == 'all') {
        return filteredTopQuestions;
      }
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
          if (normalized.isEmpty) {
            return false;
          }
          if (normalized.contains('bot') || normalized.contains('бот')) {
            return false;
          }
          if (normalized.contains('admin') || normalized.contains('administrator') || normalized.contains('администратор')) {
            return false;
          }
          if (normalized.contains('ai assistant')) {
            return false;
          }
          if (hasOperatorNames && !operatorNameSet.contains(normalized)) {
            return false;
          }
          return true;
        })
        .toList()
      ..sort((a, b) => b.messages.compareTo(a.messages));

    final headerCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 4),
              Text(
                'Обновлено: $updatedAtLabel',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<int?>(
                value: _selectedOperatorId,
                decoration: const InputDecoration(labelText: 'Сотрудник'),
                items: operatorItems,
                onChanged: _operatorsLoading ? null : _handleOperatorChanged,
              ),
              if (_operatorsLoading) ...[
                const SizedBox(height: 12),
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
                const SizedBox(height: 12),
                Text(
                  'Нет данных для отображения. Попробуйте выбрать другого сотрудника или обновить дэшборд.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
              if (_error != null && hasData) ...[
                const SizedBox(height: 12),
                Text(
                  'Ошибка при обновлении: $_error',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              LayoutBuilder(
                builder: (context, constraints) {
                  final maxWidth = constraints.maxWidth;
                  final columns = maxWidth >= 640
                      ? 3
                      : maxWidth >= 440
                          ? 2
                          : 1;
                  final tileWidth = (maxWidth - (columns - 1) * 12) / columns;
                  final statCards = <Widget>[
                    _DashboardStatCard(label: 'Всего обращений', value: numberFormatter.format(data.totalDialogs)),
                    _DashboardStatCard(label: 'Открытые диалоги', value: numberFormatter.format(data.openDialogs)),
                    _DashboardStatCard(label: 'Закрытые диалоги', value: numberFormatter.format(data.closedDialogs)),
                    _DashboardStatCard(label: 'Активных чатов', value: numberFormatter.format(data.totalChats)),
                    _DashboardStatCard(label: 'Входящих сообщений', value: numberFormatter.format(data.totalIncomingMessages)),
                    _DashboardStatCard(label: 'Исходящих сообщений', value: numberFormatter.format(data.totalOutgoingMessages)),
                    _DashboardStatCard(label: 'Среднее сообщений в диалоге', value: avgMessagesLabel),
                    _DashboardStatCard(label: 'Среднее время ответа', value: responseTimeLabel, hint: responseTimeMood),
                  ];

                  return Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment: WrapAlignment.start,
                    children: statCards
                        .map(
                          (card) => SizedBox(
                            width: columns == 1 ? maxWidth : tileWidth,
                            child: card,
                          ),
                        )
                        .toList(),
                  );
                },
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _logButtonPress(
                  'refresh dashboard',
                  _refreshing ? null : () => _loadSummary(initial: false),
                ),
                icon: Icon(_refreshing ? Icons.sync : Icons.refresh),
                label: Text(_refreshing ? 'Обновляем…' : 'Обновить дэшборд'),
              ),
            ],
          ),
        ),
      ),
    );

    final sectionCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
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
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(section.title, style: theme.textTheme.bodyMedium),
                              ),
                              const SizedBox(width: 12),
                              Text(
                                '${numberFormatter.format(section.dialogs)} · ${section.percentage.toStringAsFixed(1)}%',
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      'Частые вопросы',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 200,
                    child: DropdownButtonFormField<String>(
                      value: _selectedQuestionSection,
                      decoration: const InputDecoration(labelText: 'Раздел'),
                      items: questionSectionItems,
                      onChanged: (value) {
                        if (value == null) {
                          return;
                        }
                        setState(() {
                          _selectedQuestionSection = value;
                        });
                      },
                    ),
                  ),
                ],
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
                          Text('${index + 1}.', style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              question.question,
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            numberFormatter.format(question.count),
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
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
              else ...[
                LayoutBuilder(
                  builder: (context, constraints) {
                    final isCompact = constraints.maxWidth < 520;

                    if (isCompact) {
                      return Column(
                        children: agentStats.map((agent) {
                          final lastActivityLabel = agent.lastActivity != null
                              ? DateFormat('dd.MM.yyyy HH:mm').format(agent.lastActivity!.toLocal())
                              : '—';

                          return Container(
                            width: double.infinity,
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(agent.name, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 12,
                                  runSpacing: 6,
                                  children: [
                                    _AgentStatChip(label: 'Диалогов', value: numberFormatter.format(agent.dialogs)),
                                    _AgentStatChip(label: 'Сообщений', value: numberFormatter.format(agent.messages)),
                                    _AgentStatChip(label: 'Среднее', value: agent.avgMessagesPerDialog.toStringAsFixed(1)),
                                    _AgentStatChip(
                                      label: 'Активность',
                                      value: lastActivityLabel,
                                      muted: true,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      );
                    }

                    return Column(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(vertical: 6),
                          decoration: BoxDecoration(
                            border: Border(
                              bottom: BorderSide(color: theme.colorScheme.outlineVariant.withOpacity(0.4)),
                            ),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                flex: 2,
                                child: Text(
                                  'Сотрудник',
                                  style: theme.textTheme.labelMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  'Диалогов',
                                  textAlign: TextAlign.right,
                                  style: theme.textTheme.labelMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  'Сообщений',
                                  textAlign: TextAlign.right,
                                  style: theme.textTheme.labelMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  'Среднее',
                                  textAlign: TextAlign.right,
                                  style: theme.textTheme.labelMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Expanded(
                                flex: 2,
                                child: Text(
                                  'Последняя активность',
                                  textAlign: TextAlign.right,
                                  style: theme.textTheme.labelMedium,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 4),
                        ...agentStats.map((agent) {
                          final lastActivityLabel = agent.lastActivity != null
                              ? DateFormat('dd.MM.yyyy HH:mm').format(agent.lastActivity!.toLocal())
                              : '—';
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            child: Row(
                              children: [
                                Expanded(
                                  flex: 2,
                                  child: Text(
                                    agent.name,
                                    style: theme.textTheme.bodyMedium,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Expanded(
                                  child: Text(
                                    numberFormatter.format(agent.dialogs),
                                    textAlign: TextAlign.right,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Expanded(
                                  child: Text(
                                    numberFormatter.format(agent.messages),
                                    textAlign: TextAlign.right,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Expanded(
                                  child: Text(
                                    agent.avgMessagesPerDialog.toStringAsFixed(1),
                                    textAlign: TextAlign.right,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Expanded(
                                  flex: 2,
                                  child: Text(
                                    lastActivityLabel,
                                    textAlign: TextAlign.right,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
            ],
          ),
        ),
      ),
    );

    final activityCard = Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
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
              else
                Column(
                  children: data.recentActivity.map((activity) {
                    final dateLabel = DateFormat('dd.MM').format(activity.date.toLocal());
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Expanded(child: Text(dateLabel)),
                          Expanded(
                            child: Text(
                              numberFormatter.format(activity.dialogs),
                              textAlign: TextAlign.right,
                            ),
                          ),
                          Expanded(
                            child: Text(
                              numberFormatter.format(activity.incomingMessages),
                              textAlign: TextAlign.right,
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

    final listChildren = <Widget>[
      headerCard,
      sectionCard,
      questionsCard,
      agentsCard,
      activityCard,
      const SizedBox(height: 24),
    ];

    return RefreshIndicator(
      onRefresh: _handleRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: listChildren,
      ),
    );
  }
}

class _DashboardStatCard extends StatelessWidget {
  const _DashboardStatCard({required this.label, required this.value, this.hint});

  final String label;
  final String value;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      constraints: const BoxConstraints(minHeight: 110),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 2,
            softWrap: true,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            maxLines: 2,
            softWrap: true,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(
              hint!,
              maxLines: 2,
              softWrap: true,
              overflow: TextOverflow.fade,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}

class _AgentStatChip extends StatelessWidget {
  const _AgentStatChip({required this.label, required this.value, this.muted = false});

  final String label;
  final String value;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withOpacity(muted ? 0.25 : 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
