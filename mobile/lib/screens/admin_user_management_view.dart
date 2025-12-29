part of '../main.dart';

class AdminUserManagementView extends StatefulWidget {
  const AdminUserManagementView({
    required this.apiClient,
    required this.currentUser,
    super.key,
  });

  final ApiClient apiClient;
  final UserProfile currentUser;

  @override
  State<AdminUserManagementView> createState() => _AdminUserManagementViewState();
}

class _AdminUserManagementViewState extends State<AdminUserManagementView> {
  bool _loading = true;
  String? _error;
  List<UserProfile> _users = [];
  List<RoleInfo> _roles = [];
  List<Section> _availableSections = [];
  List<String> _availableBins = [];
  List<UnassignedBin> _unassignedBins = [];
  final Set<int> _updatingUserIds = <int>{};
  final Set<int> _deletingUserIds = <int>{};
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    refreshAdminData();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> refreshAdminData({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      setState(() {
        _error = null;
      });
    }
    try {
      final query = _searchQuery.trim().isEmpty ? null : _searchQuery.trim();
      final rolesFuture = widget.apiClient.fetchRoles();
      final usersFuture = widget.apiClient.fetchUsers(query: query);
      final sectionsFuture = widget.apiClient.fetchSections();
      final binsFuture = widget.apiClient.fetchBins();
      final unassignedFuture = widget.apiClient.fetchUnassignedBins();

      final roles = await rolesFuture;
      final users = await usersFuture;
      final sections = await sectionsFuture;
      final bins = await binsFuture;
      final unassigned = await unassignedFuture;
      if (!mounted) {
        return;
      }
      setState(() {
        _roles = roles;
        _users = users;
        _availableSections = sections;
        _availableBins = bins;
        _unassignedBins = unassigned;
        _loading = false;
        _updatingUserIds.clear();
        _deletingUserIds.clear();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        _loading = false;
      });
      final message = error is ApiException ? error.message : error.toString();
      showTopMessage(
        context,
        'Не удалось загрузить данные администратора: $message',
        isError: true,
      );
    }
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted) {
        return;
      }
      setState(() {
        _searchQuery = value;
      });
      refreshAdminData(showLoading: false);
    });
  }

  String _pluralizeDialogs(int count) {
    final mod10 = count % 10;
    final mod100 = count % 100;
    if (mod10 == 1 && mod100 != 11) {
      return 'диалог';
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return 'диалога';
    }
    return 'диалогов';
  }

  Future<UserBinAssignment?> _showBinAssignmentSheet({
    required UserProfile user,
    required String bin,
    UserBinAssignment? current,
  }) async {
    DateTime? selected = current?.expiresAt?.toLocal();
    bool indefinite = selected == null;

    DateTime _defaultExpirySeed() {
      final now = DateTime.now();
      final truncatedHour = DateTime(now.year, now.month, now.day, now.hour);
      final candidate = truncatedHour.add(const Duration(hours: 1));
      if (candidate.isAfter(now)) {
        return candidate;
      }
      return now.add(const Duration(hours: 2));
    }

    void _ensureSelectionValidity() {
      if (indefinite) {
        selected = null;
        return;
      }
      final minAllowed = DateTime.now().add(const Duration(minutes: 5));
      if (selected == null || !selected!.isAfter(minAllowed)) {
        selected = _defaultExpirySeed();
      }
    }

    if (!indefinite) {
      _ensureSelectionValidity();
    }

    return showModalBottomSheet<UserBinAssignment>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            void updateSelection(bool makeIndefinite) {
              setModalState(() {
                indefinite = makeIndefinite;
                if (makeIndefinite) {
                  selected = null;
                } else {
                  _ensureSelectionValidity();
                }
              });
            }

            Future<void> handlePick() async {
              final now = DateTime.now();
              final fallback =
                  selected != null && selected!.isAfter(now) ? selected! : _defaultExpirySeed();
              final firstDate = DateTime(now.year, now.month, now.day);
              final date = await showDatePicker(
                context: sheetContext,
                initialDate: fallback.isBefore(firstDate) ? firstDate : fallback,
                firstDate: firstDate,
                lastDate: now.add(const Duration(days: 365)),
              );
              if (date == null) {
                return;
              }
              final timeOfDay = await showTimePicker(
                context: sheetContext,
                initialTime: TimeOfDay.fromDateTime(fallback),
              );
              if (timeOfDay == null) {
                return;
              }
              setModalState(() {
                selected = DateTime(
                  date.year,
                  date.month,
                  date.day,
                  timeOfDay.hour,
                  timeOfDay.minute,
                );
                indefinite = false;
                _ensureSelectionValidity();
              });
            }

            final theme = Theme.of(context);
            final expiresLabel = (!indefinite && selected != null)
                ? DateFormat('dd.MM.yyyy HH:mm').format(selected!)
                : 'Срок не выбран';

            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 16,
                bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 16,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Назначение БИНа', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text(
                    user.name,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      bin,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 16),
                  RadioListTile<bool>(
                    value: true,
                    groupValue: indefinite,
                    onChanged: (_) => updateSelection(true),
                    title: const Text('Без ограничения по времени'),
                    subtitle: const Text('БИН останется за сотрудником, пока вы не снимете назначение вручную.'),
                  ),
                  RadioListTile<bool>(
                    value: false,
                    groupValue: indefinite,
                    onChanged: (_) => updateSelection(false),
                    title: const Text('До указанной даты и времени'),
                    subtitle: const Text('После истечения срока БИН появится среди неразделенных.'),
                    secondary: IconButton(
                      icon: const Icon(Icons.event_outlined),
                      tooltip: 'Выбрать дату и время',
                      onPressed: _logButtonPress(
                        'open bin expiration picker',
                        () {
                          updateSelection(false);
                          handlePick();
                        },
                      ),
                    ),
                  ),
                  if (!indefinite)
                    Padding(
                      padding: const EdgeInsets.only(left: 24, right: 16, bottom: 8),
                      child: Text(
                        expiresLabel,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: _logButtonPress(
                          'cancel bin assignment',
                          () => Navigator.of(sheetContext).pop(),
                        ),
                        child: const Text('Отмена'),
                      ),
                      const SizedBox(width: 12),
                      FilledButton(
                        onPressed: _logButtonPress(
                          'save bin assignment',
                          () {
                            if (!indefinite && selected == null) {
                              ScaffoldMessenger.of(sheetContext).showSnackBar(
                                const SnackBar(content: Text('Укажите срок действия БИНа.')),
                              );
                              return;
                            }
                            final expiresUtc = indefinite ? null : selected!.toUtc();
                            Navigator.of(sheetContext).pop(
                              UserBinAssignment(
                                bin: bin,
                                assignedAt: current?.assignedAt ?? DateTime.now().toUtc(),
                                expiresAt: expiresUtc,
                                assignedBy: current?.assignedBy,
                              ),
                            );
                          },
                        ),
                        child: Text(current == null ? 'Назначить' : 'Сохранить'),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _confirmRemoveBin(UserProfile user, UserBinAssignment assignment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить назначение БИНа?'),
          content: Text('БИН ${assignment.bin} станет неразделенным.'),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel remove bin assignment',
                () => Navigator.of(dialogContext).pop(false),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'confirm remove bin assignment',
                () => Navigator.of(dialogContext).pop(true),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
              ),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      return;
    }
    final updated = List<UserBinAssignment>.from(user.binAssignments)
      ..removeWhere((item) => item.bin == assignment.bin);
    await _updateUserBins(user, updated);
  }

  Future<void> _changeRole(UserProfile user, String role) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserRole(user.id, role);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Роль пользователя "${updated.name}" обновлена на ${updated.roleLabel}',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить роль: $error',
        isError: true,
      );
    }
  }

  Future<void> _updateUserSections(UserProfile user, Set<String> sections) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserSections(user.id, sections.toList());
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Разделы пользователя "${updated.name}" обновлены.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить разделы: $error',
        isError: true,
      );
    }
  }

  Future<void> _updateUserBins(UserProfile user, List<UserBinAssignment> assignments) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final sortedAssignments = List<UserBinAssignment>.from(assignments)
        ..sort((a, b) => a.bin.compareTo(b.bin));
      final updated = await widget.apiClient.updateUserBins(user.id, sortedAssignments);
      final unassigned = await widget.apiClient.fetchUnassignedBins();
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
        _unassignedBins = unassigned;
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'БИНы пользователя "${updated.name}" обновлены.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить БИНы: $error',
        isError: true,
      );
    }
  }

  Future<void> _deleteUser(UserProfile user) async {
    final confirmed = await showDialog<bool>(
      context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: Text('Удалить аккаунт ${user.name}?'),
              content: const Text('Пользователь потеряет доступ к системе. Действие нельзя отменить.'),
              actions: [
                TextButton(
                  onPressed: _logButtonPress(
                    'cancel delete user',
                    () => Navigator.of(dialogContext).pop(false),
                  ),
                  child: const Text('Отмена'),
                ),
                FilledButton(
                  onPressed: _logButtonPress(
                    'confirm delete user',
                    () => Navigator.of(dialogContext).pop(true),
                  ),
                  style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
                  child: const Text('Удалить'),
                ),
              ],
            );
      },
    );
    if (confirmed != true) {
      return;
    }
    setState(() {
      _deletingUserIds.add(user.id);
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      await widget.apiClient.deleteUser(user.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users.where((existing) => existing.id != user.id).toList();
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
      });
      showTopMessage(
        context,
        'Аккаунт "${user.name}" удалён.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось удалить пользователя: $error',
        isError: true,
      );
    }
  }

  Future<void> _promptResetPassword(UserProfile user) async {
    final formKey = GlobalKey<FormState>();
    final passwordController = TextEditingController();
    final confirmController = TextEditingController();
    final newPassword = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Смена пароля: ${user.name}'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: passwordController,
                  decoration: const InputDecoration(labelText: 'Новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: confirmController,
                  decoration: const InputDecoration(labelText: 'Повторите пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value != passwordController.text) {
                      return 'Пароли не совпадают';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel change user password',
                () => Navigator.of(dialogContext).pop(),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'save changed user password',
                () {
                  if (formKey.currentState!.validate()) {
                    Navigator.of(dialogContext).pop(passwordController.text.trim());
                  }
                },
              ),
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );
    passwordController.dispose();
    confirmController.dispose();
    if (newPassword == null) {
      return;
    }
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.adminSetUserPassword(user.id, newPassword);
      if (!mounted) {
        return;
      }
      setState(() {
        _users = _users
            .map((existing) => existing.id == updated.id ? updated : existing)
            .toList();
        _updatingUserIds.remove(user.id);
      });
      showTopMessage(
        context,
        'Пароль для "${updated.name}" обновлён.',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось изменить пароль: $error',
        isError: true,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final roleItems = _roles
        .map(
          (role) => DropdownMenuItem<String>(
            value: role.id,
            child: Text(role.title),
          ),
        )
        .toList();

    final theme = Theme.of(context);
    final searchField = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: TextField(
        controller: _searchController,
        decoration: InputDecoration(
          labelText: 'Поиск по имени, логину или e-mail',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: _searchQuery.isEmpty
              ? null
              : IconButton(
                  onPressed: _logButtonPress(
                    'clear user search',
                    () {
                      _searchController.clear();
                      _onSearchChanged('');
                    },
                  ),
                  icon: const Icon(Icons.close),
                ),
        ),
        onChanged: _onSearchChanged,
      ),
    );

    final listChildren = <Widget>[
      searchField,
      const SizedBox(height: 12),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Неразделенные БИНы',
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                if (_unassignedBins.isEmpty)
                  Text(
                    'Все активные БИНы закреплены за сотрудниками.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  LayoutBuilder(
                    builder: (context, constraints) {
                      final isNarrow = constraints.maxWidth < 420;
                      final targetWidth = isNarrow
                          ? constraints.maxWidth
                          : math.min(260.0, constraints.maxWidth);
                      return Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: _unassignedBins.map((entry) {
                          final description = entry.openDialogs > 0
                              ? '${entry.openDialogs} ${_pluralizeDialogs(entry.openDialogs)} без закрепленного сотрудника'
                              : 'Нет активных диалогов';
                          return ConstrainedBox(
                            constraints: BoxConstraints(
                              minWidth: targetWidth,
                              maxWidth: targetWidth,
                            ),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    entry.bin,
                                    style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    description,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      );
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
      const SizedBox(height: 12),
    ];

    if (_users.isEmpty) {
      listChildren.add(
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 32),
          child: Text(
            'Пока нет зарегистрированных операторов.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
      );
    } else {
      listChildren.addAll(
        _users.map((user) {
          final isSelf = user.id == widget.currentUser.id;
          final isUpdating = _updatingUserIds.contains(user.id);
          final isDeleting = _deletingUserIds.contains(user.id);
          final canDelete = !isSelf && !user.isAdmin;
          final badgeColor = user.isAdmin
              ? theme.colorScheme.errorContainer
              : (user.canReply
                  ? theme.colorScheme.primaryContainer
                  : theme.colorScheme.surfaceVariant.withOpacity(0.6));
          final badgeTextColor = user.isAdmin
              ? theme.colorScheme.onErrorContainer
              : (user.canReply
                  ? theme.colorScheme.onPrimaryContainer
                  : theme.colorScheme.onSurfaceVariant);
          final createdAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(user.createdAt.toLocal());

          Widget buildInfoChip(IconData icon, String label) {
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceVariant.withOpacity(0.4),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            );
          }

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
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
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                user.name,
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 6),
                              Wrap(
                                spacing: 8,
                                runSpacing: 6,
                                children: [
                                  buildInfoChip(Icons.email_outlined, user.email),
                                  buildInfoChip(Icons.person_outline, user.login),
                                  buildInfoChip(Icons.calendar_month_outlined, createdAtLabel),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Chip(
                              label: Text(user.roleLabel),
                              backgroundColor: badgeColor,
                              labelStyle: TextStyle(color: badgeTextColor, fontWeight: FontWeight.w600),
                            ),
                            if (canDelete)
                              IconButton(
                                tooltip: 'Удалить аккаунт',
                                icon: const Icon(Icons.delete_outline),
                                color: theme.colorScheme.error,
                                onPressed: _logButtonPress(
                                  'delete user from list',
                                  (isUpdating || isDeleting)
                                      ? null
                                      : () => _deleteUser(user),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                    if (isDeleting) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: const [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          SizedBox(width: 8),
                          Text('Удаляем аккаунт…'),
                        ],
                      ),
                    ],
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: user.role,
                      decoration: const InputDecoration(labelText: 'Роль пользователя'),
                      items: roleItems,
                      onChanged: (!isSelf && !isUpdating && !isDeleting)
                          ? (value) {
                              if (value == null || value == user.role) {
                                return;
                              }
                              _changeRole(user, value);
                            }
                          : null,
                    ),
                    if (isUpdating && !isDeleting) ...[
                      const SizedBox(height: 12),
                      const LinearProgressIndicator(),
                    ],
                    const SizedBox(height: 16),
                    Text('Разделы', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 8),
                    if (user.sections.isEmpty)
                      Text(
                        'Нет назначенных разделов',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: user.sections.map((sectionId) {
                          final match = _availableSections.firstWhere(
                            (section) => section.id == sectionId,
                            orElse: () => Section(id: sectionId, title: sectionId),
                          );
                          return Chip(
                            label: Text(match.title),
                            onDeleted: (!isUpdating && !isDeleting)
                                ? () {
                                    final updatedSections =
                                        Set<String>.from(user.sections)..remove(sectionId);
                                    _updateUserSections(user, updatedSections);
                                  }
                                : null,
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 8),
                    _SectionSelectorField(
                      key: ValueKey('section-selector-${user.id}-${user.sections.length}'),
                      availableSections: _availableSections
                          .where((section) => !user.sections.contains(section.id))
                          .toList(),
                      enabled: !isUpdating && !isDeleting && _availableSections.isNotEmpty,
                      onSectionSelected: (value) {
                        if (value.isEmpty || user.sections.contains(value)) {
                          return;
                        }
                        final updatedSections = Set<String>.from(user.sections)..add(value);
                        _updateUserSections(user, updatedSections);
                      },
                    ),
                    const SizedBox(height: 16),
                    Text('БИНы', style: theme.textTheme.labelLarge),
                    const SizedBox(height: 8),
                    if (user.binAssignments.isEmpty)
                      Text(
                        'Нет назначенных БИНов',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      Column(
                        children: user.binAssignments.map((assignment) {
                          final expiresLabel = assignment.expiresAt != null
                              ? 'Действует до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                              : 'Бессрочное назначение';
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: theme.colorScheme.outlineVariant.withOpacity(0.6),
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        assignment.bin,
                                        style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        expiresLabel,
                                        style: theme.textTheme.bodySmall?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (!isUpdating && !isDeleting)
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        tooltip: 'Изменить срок',
                                        icon: const Icon(Icons.edit_calendar_outlined),
                                        onPressed: _logButtonPress(
                                          'edit bin assignment',
                                          () async {
                                            final updatedAssignment = await _showBinAssignmentSheet(
                                              user: user,
                                              bin: assignment.bin,
                                              current: assignment,
                                            );
                                            if (updatedAssignment == null) {
                                              return;
                                            }
                                            final updatedAssignments = user.binAssignments
                                                .map((item) => item.bin == assignment.bin ? updatedAssignment : item)
                                                .toList();
                                            await _updateUserBins(user, updatedAssignments);
                                          },
                                        ),
                                      ),
                                      IconButton(
                                        tooltip: 'Убрать БИН',
                                        icon: const Icon(Icons.delete_outline),
                                        onPressed: _logButtonPress(
                                          'remove bin assignment',
                                          () => _confirmRemoveBin(user, assignment),
                                        ),
                                      ),
                                    ],
                                  ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
                    const SizedBox(height: 8),
                    _BinSelectorField(
                      key: ValueKey('bin-selector-${user.id}-${user.binAssignments.length}'),
                      availableBins: _availableBins
                          .where((bin) => user.binAssignments.every((assignment) => assignment.bin != bin))
                          .toList(),
                      enabled: !isUpdating && !isDeleting && _availableBins.isNotEmpty,
                      onBinSelected: (value) async {
                        if (value.isEmpty ||
                            user.binAssignments.any((assignment) => assignment.bin == value)) {
                          return;
                        }
                        final assignment = await _showBinAssignmentSheet(user: user, bin: value);
                        if (assignment == null) {
                          return;
                        }
                        final updatedAssignments = List<UserBinAssignment>.from(user.binAssignments)
                          ..add(assignment);
                        await _updateUserBins(user, updatedAssignments);
                      },
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        OutlinedButton.icon(
                          icon: const Icon(Icons.lock_reset),
                          label: const Text('Сменить пароль'),
                          onPressed: _logButtonPress(
                            'reset user password',
                            (isUpdating || isDeleting) ? null : () => _promptResetPassword(user),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      (isUpdating || isDeleting)
                          ? 'Сохраняем изменения…'
                          : 'Изменения сохраняются автоматически',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (isSelf)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Нельзя изменять собственную роль администратора.',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        }),
      );
    }

    final content = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 24),
      children: listChildren,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _error!,
                  style: const TextStyle(color: Colors.red),
                ),
                TextButton(
                  onPressed: _logButtonPress('retry load admin data', () => refreshAdminData()),
                  child: const Text('Повторить загрузку'),
                ),
              ],
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => refreshAdminData(showLoading: false),
            child: content,
          ),
        ),
      ],
    );
  }
}

class _OperatorProfileViewState extends State<OperatorProfileView> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _loginController = TextEditingController();
  final TextEditingController _jobTitleController = TextEditingController();
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _bioController = TextEditingController();

  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _successMessage;
  UserProfile? _profile;
  List<Section> _sections = [];
  File? _profileImageFile;
  String? _profileImagePath;

  @override
  void initState() {
    super.initState();
    _nameController.addListener(_handleProfileHeaderChange);
    _jobTitleController.addListener(_handleProfileHeaderChange);
    _loadSavedProfileImage();
    refreshProfile();
  }

  void _handleProfileHeaderChange() {
    if (mounted) {
      setState(() {});
    }
  }

  Future<void> _loadSavedProfileImage() async {
    final prefs = await SharedPreferences.getInstance();
    final storedPath = prefs.getString('profile_image_path');
    if (storedPath == null) {
      return;
    }
    final file = File(storedPath);
    if (await file.exists()) {
      if (!mounted) {
        return;
      }
      setState(() {
        _profileImagePath = storedPath;
        _profileImageFile = file;
      });
    } else {
      await prefs.remove('profile_image_path');
    }
  }

  Future<void> _saveProfileImagePath(String? path) async {
    final prefs = await SharedPreferences.getInstance();
    if (path == null || path.isEmpty) {
      await prefs.remove('profile_image_path');
    } else {
      await prefs.setString('profile_image_path', path);
    }
  }

  Future<void> refreshProfile({bool showLoading = true}) async {
    setState(() {
      _error = null;
      _successMessage = null;
      if (showLoading) {
        _loading = true;
      }
    });
    try {
      final profile = await widget.apiClient.fetchProfile();
      final sections = await widget.apiClient.fetchSections();
      widget.onProfileUpdated(profile);
      if (!mounted) {
        return;
      }
      _profile = profile;
      _nameController.text = profile.name;
      _emailController.text = profile.email;
      _loginController.text = profile.login;
      _jobTitleController.text = profile.jobTitle;
      _phoneController.text = profile.phone;
      _bioController.text = profile.bio;
      _handleProfileHeaderChange();
      setState(() {
        _sections = sections;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _successMessage = null;
    });
    try {
      final updated = await widget.apiClient.updateProfile(
        name: _nameController.text.trim(),
        jobTitle: _jobTitleController.text.trim(),
        phone: _phoneController.text.trim(),
        bio: _bioController.text.trim(),
      );
      widget.onProfileUpdated(updated);
      if (!mounted) {
        return;
      }
      setState(() {
        _profile = updated;
        _saving = false;
        _successMessage = 'Профиль обновлён';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _changeOwnPassword() async {
    final formKey = GlobalKey<FormState>();
    final currentController = TextEditingController();
    final newController = TextEditingController();
    final confirmController = TextEditingController();

    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Смена пароля'),
          content: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: currentController,
                  decoration: const InputDecoration(labelText: 'Текущий пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: newController,
                  decoration: const InputDecoration(labelText: 'Новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) {
                      return 'Минимум 5 символов';
                    }
                    if (value.trim() == currentController.text.trim()) {
                      return 'Новый пароль должен отличаться от текущего';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: confirmController,
                  decoration: const InputDecoration(labelText: 'Повторите новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value != newController.text) {
                      return 'Пароли не совпадают';
                    }
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel change own password',
                () => Navigator.of(dialogContext).pop(),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'save changed own password',
                () {
                  if (formKey.currentState!.validate()) {
                    Navigator.of(dialogContext).pop({
                      'current': currentController.text.trim(),
                      'new': newController.text.trim(),
                    });
                  }
                },
              ),
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );

    currentController.dispose();
    newController.dispose();
    confirmController.dispose();

    if (result == null) {
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
      _successMessage = null;
    });

    try {
      final session = await widget.apiClient.changePassword(
        currentPassword: result['current']!,
        newPassword: result['new']!,
      );
      widget.onProfileUpdated(session.user);
      if (!mounted) {
        return;
      }
      setState(() {
        _profile = session.user;
        _saving = false;
        _successMessage = 'Пароль обновлён';
      });
      showTopMessage(context, 'Пароль обновлён.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _saving = false;
        _error = error.toString();
      });
      showTopMessage(
        context,
        'Не удалось обновить пароль: $error',
        isError: true,
      );
    }
  }

  @override
  void dispose() {
    _nameController.removeListener(_handleProfileHeaderChange);
    _jobTitleController.removeListener(_handleProfileHeaderChange);
    _nameController.dispose();
    _emailController.dispose();
    _loginController.dispose();
    _jobTitleController.dispose();
    _phoneController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  ImageProvider<Object>? _buildProfileImageProvider() {
    final file = _profileImageFile;
    if (file != null && file.existsSync()) {
      return FileImage(file);
    }
    return null;
  }

  Future<void> _pickProfileImage() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 90);
      if (picked == null) {
        return;
      }

      final cropped = await ImageCropper().cropImage(
        sourcePath: picked.path,
        aspectRatio: const CropAspectRatio(ratioX: 1, ratioY: 1),
        compressFormat: ImageCompressFormat.jpg,
        uiSettings: [
          AndroidUiSettings(
            toolbarTitle: 'Обрезать фото',
            toolbarColor: brandPrimaryGreen,
            toolbarWidgetColor: Colors.white,
            activeControlsWidgetColor: brandPrimaryGreen,
            initAspectRatio: CropAspectRatioPreset.square,
            lockAspectRatio: true,
          ),
          IOSUiSettings(
            title: 'Обрезать фото',
            aspectRatioLockEnabled: true,
          ),
        ],
      );

      final resultingPath = cropped?.path ?? picked.path;
      final file = File(resultingPath);
      if (!mounted) {
        return;
      }
      setState(() {
        _profileImagePath = resultingPath;
        _profileImageFile = file;
        _successMessage = 'Фото профиля обновлено';
      });
      await _saveProfileImagePath(resultingPath);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = 'Не удалось обновить фото: $error';
      });
    }
  }

  String get _displayName {
    final edited = _nameController.text.trim();
    if (edited.isNotEmpty) {
      return edited;
    }
    return _profile?.name ?? '';
  }

  Widget _buildProfileHeader(ThemeData theme) {
    final jobTitle = _jobTitleController.text.trim();
    final avatar = _buildProfileImageProvider();
    final headerColor = theme.brightness == Brightness.dark
        ? theme.colorScheme.background
        : theme.extension<AppColors>()!.appBarColor;


    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: headerColor,
        borderRadius: const BorderRadius.only(
          bottomLeft: Radius.circular(24),
          bottomRight: Radius.circular(24),
        ),
      ),
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Stack(
            alignment: Alignment.bottomRight,
            children: [
              CircleAvatar(
                radius: 44,
                backgroundColor: Colors.white,
                backgroundImage: avatar,
                child: avatar == null
                    ? const Icon(Icons.person, size: 52, color: brandPrimaryGreen)
                    : null,
              ),
              Material(
                color: Colors.white,
                shape: const CircleBorder(),
                child: IconButton(
                  tooltip: 'Изменить фото профиля',
                  icon: const Icon(Icons.camera_alt, color: brandPrimaryGreen),
                  onPressed: _logButtonPress('pick profile image', _pickProfileImage),
                  constraints: const BoxConstraints.tightFor(width: 38, height: 38),
                  padding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            _displayName.isEmpty ? 'Профиль' : _displayName,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (jobTitle.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                jobTitle,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: Colors.white.withOpacity(0.9),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTextFieldCard({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    String? hint,
    TextInputType keyboardType = TextInputType.text,
    bool readOnly = false,
    int maxLines = 1,
    TextCapitalization textCapitalization = TextCapitalization.none,
    String? Function(String?)? validator,
  }) {
    final theme = Theme.of(context);
    final onSurfaceVariant = theme.colorScheme.onSurfaceVariant;
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: theme.colorScheme.surfaceVariant,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: TextFormField(
          controller: controller,
          readOnly: readOnly,
          maxLines: maxLines,
          keyboardType: keyboardType,
          textCapitalization: textCapitalization,
          validator: validator,
          decoration: InputDecoration(
            labelText: label,
            hintText: hint,
            prefixIcon: Icon(icon, color: onSurfaceVariant),
            suffixIcon: IconTheme(
              data: IconThemeData(color: onSurfaceVariant),
              child: readOnly
                  ? const Icon(Icons.lock_outline, size: 18)
                  : const Icon(Icons.edit_outlined),
            ),
            border: InputBorder.none,
          ),
        ),
      ),
    );
  }

  Widget _buildInfoTile({
    required IconData icon,
    required String label,
    required String value,
  }) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: theme.colorScheme.surfaceVariant,
      child: ListTile(
        leading: Icon(icon, color: theme.colorScheme.onSurfaceVariant),
        title: Text(label),
        subtitle: Text(value),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final profile = _profile;
    final isAdmin = profile?.isAdmin ?? false;

    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: () => refreshProfile(showLoading: false),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildProfileHeader(theme),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        icon: const Icon(Icons.photo_camera_back_outlined),
                        label: const Text('Изменить фото профиля'),
                        onPressed: _logButtonPress('change profile image from settings', _pickProfileImage),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const SizedBox(height: 8),
                    _buildTextFieldCard(
                      controller: _nameController,
                      label: 'ФИО',
                      icon: Icons.badge,
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.runes.length < 2) {
                          return 'Введите имя длиной не менее 2 символов';
                        }
                        return null;
                      },
                    ),
                    _buildTextFieldCard(
                      controller: _emailController,
                      label: 'E-mail',
                      icon: Icons.alternate_email,
                      readOnly: true,
                    ),
                    _buildTextFieldCard(
                      controller: _loginController,
                      label: 'Логин для входа',
                      icon: Icons.lock_person_outlined,
                      readOnly: true,
                    ),
                    _buildTextFieldCard(
                      controller: _jobTitleController,
                      label: 'Должность/роль',
                      icon: Icons.assignment_ind_outlined,
                      textCapitalization: TextCapitalization.sentences,
                    ),
                    _buildTextFieldCard(
                      controller: _phoneController,
                      label: 'Номер телефона',
                      icon: Icons.phone_iphone,
                      keyboardType: TextInputType.phone,
                    ),
                    _buildTextFieldCard(
                      controller: _bioController,
                      label: 'О себе и компетенции',
                      icon: Icons.description_outlined,
                      maxLines: 3,
                    ),
                    if (profile != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        'Данные профиля',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 8),
                      _buildInfoTile(
                        icon: Icons.calendar_month_outlined,
                        label: 'Аккаунт создан',
                        value: DateFormat('dd.MM.yyyy HH:mm').format(profile.createdAt.toLocal()),
                      ),
                      _buildInfoTile(
                        icon: Icons.verified_user_outlined,
                        label: 'Текущая роль',
                        value: profile.roleLabel,
                      ),
                      if (!isAdmin)
                        Card(
                          elevation: 0,
                          margin: const EdgeInsets.only(bottom: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          color: theme.colorScheme.surfaceVariant,
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(
                                      Icons.dashboard_customize_outlined,
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Назначенные разделы',
                                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                if (profile.sections.isEmpty)
                                  const Text('Разделы ещё не назначены. Обратитесь к администратору.')
                                else
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 4,
                                    children: profile.sections.map((sectionId) {
                                      final match = _sections.firstWhere(
                                        (section) => section.id == sectionId,
                                        orElse: () => Section(id: sectionId, title: sectionId),
                                      );
                                      return Chip(label: Text(match.title));
                                    }).toList(),
                                  ),
                                const SizedBox(height: 12),
                                Row(
                                  children: [
                                    Icon(
                                      Icons.business_center_outlined,
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Назначенные БИНы',
                                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                if (profile.binAssignments.isEmpty)
                                  const Text('БИНы ещё не назначены. Обратитесь к администратору.')
                                else
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 4,
                                    children: profile.binAssignments.map((assignment) {
                                      final expiresLabel = assignment.expiresAt != null
                                          ? 'до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                                          : 'без срока';
                                      return Chip(
                                        label: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(assignment.bin),
                                            Text(
                                              expiresLabel,
                                              style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
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
                      _buildInfoTile(
                        icon: Icons.star_outline,
                        label: 'Избранные диалоги',
                        value: profile.favoriteDialogIds.length.toString(),
                      ),
                    ],
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          _error!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ),
                    if (_successMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          _successMessage!,
                          style: const TextStyle(color: Colors.green),
                        ),
                      ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: [
                        ElevatedButton.icon(
                          onPressed: _logButtonPress(
                            'save profile changes',
                            _saving ? null : _save,
                          ),
                          icon: const Icon(Icons.save),
                          label: _saving
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Text('Сохранить'),
                        ),
                        OutlinedButton.icon(
                          onPressed: _logButtonPress(
                            'change own password',
                            _saving ? null : _changeOwnPassword,
                          ),
                          icon: const Icon(Icons.lock_outline),
                          label: const Text('Сменить пароль'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionSelectorField extends StatefulWidget {
  const _SectionSelectorField({
    required this.availableSections,
    required this.onSectionSelected,
    required this.enabled,
    super.key,
  });

  final List<Section> availableSections;
  final ValueChanged<String> onSectionSelected;
  final bool enabled;

  @override
  State<_SectionSelectorField> createState() => _SectionSelectorFieldState();
}

class _SectionSelectorFieldState extends State<_SectionSelectorField> {
  TextEditingController? _fieldController;
  FocusNode? _focusNode;

  Iterable<Section> _buildOptions(TextEditingValue value) {
    if (!widget.enabled) {
      return const Iterable<Section>.empty();
    }
    final query = value.text.trim();
    if (query.isEmpty) {
      return widget.availableSections;
    }
    final lowerQuery = query.toLowerCase();
    return widget.availableSections.where(
      (section) =>
          section.title.toLowerCase().contains(lowerQuery) ||
          section.id.toLowerCase().contains(lowerQuery),
    );
  }

  @override
  void didUpdateWidget(covariant _SectionSelectorField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled && oldWidget.enabled) {
      _fieldController?.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Autocomplete<Section>(
      optionsBuilder: _buildOptions,
      displayStringForOption: (option) => option.title,
      onSelected: (value) {
        _fieldController?.clear();
        if (!widget.enabled) {
          return;
        }
        widget.onSectionSelected(value.id);
        _focusNode?.unfocus();
      },
      fieldViewBuilder: (context, textEditingController, focusNode, onFieldSubmitted) {
        _fieldController = textEditingController;
        _focusNode = focusNode;
        return TextField(
          controller: textEditingController,
          focusNode: focusNode,
          enabled: widget.enabled,
          decoration: const InputDecoration(
            labelText: 'Выберите раздел',
            hintText: 'Поиск…',
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) {
            if (!widget.enabled) {
              return;
            }
            final trimmed = value.trim();
            if (trimmed.isEmpty) {
              return;
            }
            final normalized = trimmed.toLowerCase();
            Section? match;
            for (final section in widget.availableSections) {
              final titleMatch = section.title.toLowerCase() == normalized;
              final idMatch = section.id.toLowerCase() == normalized;
              if (titleMatch || idMatch) {
                match = section;
                break;
              }
            }
            if (match != null) {
              widget.onSectionSelected(match.id);
              _fieldController?.clear();
              focusNode.unfocus();
            }
          },
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, minWidth: 240),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                itemCount: optionList.length,
                itemBuilder: (context, index) {
                  final option = optionList[index];
                  return ListTile(
                    title: Text(option.title),
                    subtitle: Text(option.id),
                    onTap: () => onSelected(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

class _BinSelectorField extends StatefulWidget {
  const _BinSelectorField({
    required this.availableBins,
    required this.onBinSelected,
    required this.enabled,
    super.key,
  });

  final List<String> availableBins;
  final Future<void> Function(String) onBinSelected;
  final bool enabled;

  @override
  State<_BinSelectorField> createState() => _BinSelectorFieldState();
}

class _BinSelectorFieldState extends State<_BinSelectorField> {
  TextEditingController? _fieldController;
  FocusNode? _focusNode;

  Iterable<String> _buildOptions(TextEditingValue value) {
    if (!widget.enabled) {
      return const Iterable<String>.empty();
    }
    final query = value.text.trim();
    if (query.isEmpty) {
      return widget.availableBins;
    }
    final lowerQuery = query.toLowerCase();
    return widget.availableBins.where(
      (bin) => bin.toLowerCase().contains(lowerQuery),
    );
  }

  @override
  void didUpdateWidget(covariant _BinSelectorField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled && oldWidget.enabled) {
      _fieldController?.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Autocomplete<String>(
      optionsBuilder: _buildOptions,
      displayStringForOption: (option) => option,
      onSelected: (value) {
        _fieldController?.clear();
        if (!widget.enabled) {
          return;
        }
        unawaited(widget.onBinSelected(value));
        _focusNode?.unfocus();
      },
      fieldViewBuilder: (context, textEditingController, focusNode, onFieldSubmitted) {
        _fieldController = textEditingController;
        _focusNode = focusNode;
        return TextField(
          controller: textEditingController,
          focusNode: focusNode,
          enabled: widget.enabled,
          decoration: const InputDecoration(
            labelText: 'Выберите БИН',
            hintText: 'Поиск…',
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) {
            if (!widget.enabled) {
              return;
            }
            final trimmed = value.trim();
            if (trimmed.isEmpty) {
              return;
            }
            if (widget.availableBins.contains(trimmed)) {
              unawaited(widget.onBinSelected(trimmed));
              _fieldController?.clear();
              focusNode.unfocus();
            }
          },
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        final optionList = options.toList();
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 240, minWidth: 240),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                itemCount: optionList.length,
                itemBuilder: (context, index) {
                  final option = optionList[index];
                  return ListTile(
                    title: Text(option),
                    onTap: () => onSelected(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }
}

int? _parseIntValue(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value);
  }
  return int.tryParse(value.toString());
}

double? _parseDoubleValue(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is double) {
    return value;
  }
  if (value is int) {
    return value.toDouble();
  }
  if (value is num) {
    return value.toDouble();
  }
  if (value is String) {
    final normalized = value.replaceAll(',', '.').trim();
    if (normalized.isEmpty) {
      return null;
    }
    return double.tryParse(normalized);
  }
  return double.tryParse(value.toString());
}

DateTime? _parseDateTime(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is DateTime) {
    return value.toLocal();
  }
  if (value is String) {
    return DateTime.tryParse(value)?.toLocal();
  }
  return null;
}

