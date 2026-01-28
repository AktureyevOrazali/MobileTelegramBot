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

class _RoleDropdownPill extends StatelessWidget {
  const _RoleDropdownPill({
    required this.user,
    required this.roles,
    required this.disabled,
    required this.onChange,
  });

  final UserProfile user;
  final List<RoleInfo> roles;
  final bool disabled;
  final ValueChanged<String> onChange;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final Color badgeBg = disabled
        ? theme.colorScheme.surfaceVariant.withOpacity(0.55)
        : (user.isAdmin
            ? theme.colorScheme.error
            : (user.canReply ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceVariant.withOpacity(0.6)));

    final Color badgeFg = disabled
        ? theme.colorScheme.onSurfaceVariant.withOpacity(0.75)
        : (user.isAdmin
            ? theme.colorScheme.onError
            : (user.canReply ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant));

    return SizedBox(
      width: 150, // можешь сделать 140, если нужно ещё компактнее
      height: 36,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: badgeBg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.55)),
        ),
        alignment: Alignment.center,
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: user.role,
            isDense: true,
            isExpanded: true,
            dropdownColor: theme.colorScheme.surface,
            icon: Icon(Icons.expand_more, color: badgeFg),
            style: theme.textTheme.labelLarge?.copyWith(color: badgeFg, fontWeight: FontWeight.w700),
            items: roles.map((role) {
              return DropdownMenuItem<String>(
                value: role.id,
                child: Text(role.title, maxLines: 1, overflow: TextOverflow.ellipsis),
              );
            }).toList(),
            onChanged: disabled
                ? null
                : (value) {
                    if (value == null || value == user.role) return;
                    onChange(value);
                  },
          ),
        ),
      ),
    );
  }
}


class _AdminUserManagementViewState extends State<AdminUserManagementView> {
  bool _loading = true;
  String? _error;

  List<UserProfile> _users = [];
  List<RoleInfo> _roles = [];
  List<Section> _availableSections = [];
  List<String> _availableBins = [];
  List<UnassignedBin> _unassignedBins = [];
  List<PendingRegistration> _pendingRegistrations = [];

  final Set<int> _updatingUserIds = <int>{};
  final Set<int> _deletingUserIds = <int>{};
  final Set<int> _pendingActionIds = <int>{};

  int? _selectedPendingRegistrationId;
  String? _selectedUnassignedBin;
  int? _selectedUnassignedOperatorId;


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

  VoidCallback? _logButtonPress(String eventName, VoidCallback? callback) {
    if (callback == null) return null;
    return () {
      debugPrint('[Button] $eventName');
      callback();
    };
  }

  bool _canManageSectionsFor(UserProfile user) {
    // Логика такая же как для БИНов (по твоему правилу):
    // нельзя управлять админом и модератором
    if (user.isAdmin) return false;
    if (_isModerator(user)) return false;
    return true;
  }

  Future<void> _confirmRemoveSection(UserProfile user, String sectionId) async {
    final theme = Theme.of(context);

    final match = _availableSections.firstWhere(
      (s) => s.id == sectionId,
      orElse: () => Section(id: sectionId, title: sectionId),
    );

    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить раздел у сотрудника?'),
          content: Text('Раздел "${match.title}" будет снят с сотрудника.'),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel remove section',
                () => Navigator.of(dialogContext).pop(false),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'confirm remove section',
                () => Navigator.of(dialogContext).pop(true),
              ),
              style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    final next = Set<String>.from(user.sections)..remove(sectionId);
    await _updateUserSections(user, next);
  }

  Future<void> _openUserSectionsSheet({
    required ThemeData theme,
    required UserProfile user,
    required List<Section> allAvailableSections,
    required bool isUpdating,
    required bool isDeleting,
  }) async {
    if (!_canManageSectionsFor(user)) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        final bottom = MediaQuery.of(sheetContext).viewInsets.bottom;

        final availableToAdd = allAvailableSections
            .where((s) => !user.sections.contains(s.id))
            .toList()
          ..sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, bottom + 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Разделы сотрудника', style: theme.textTheme.titleLarge),
                const SizedBox(height: 6),
                Text(
                  user.name,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),

                // ADD SECTION (selector)
                _SectionSelectorField(
                  key: ValueKey(
                    'sections-sheet-add-${user.id}-${user.sections.length}-${availableToAdd.length}',
                  ),
                  availableSections: availableToAdd,
                  enabled: !(isUpdating || isDeleting) && availableToAdd.isNotEmpty,
                  onSectionSelected: (sectionId) async {
                    if (sectionId.isEmpty) return;

                    final next = Set<String>.from(user.sections)..add(sectionId);
                    await _updateUserSections(user, next);

                    if (!mounted) return;
                    Navigator.of(sheetContext).pop(); // закрываем, чтобы карточка обновилась
                  },
                ),

                const SizedBox(height: 12),

                // LIST
                if (user.sections.isEmpty)
                  Text(
                    'Разделы не назначены.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 420),
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: user.sections.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final sectionId = user.sections[index];
                        final section = allAvailableSections.firstWhere(
                          (s) => s.id == sectionId,
                          orElse: () => Section(id: sectionId, title: sectionId),
                        );

                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: theme.colorScheme.outlineVariant.withOpacity(0.55),
                            ),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      section.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      section.id,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 10),
                              IconButton(
                                tooltip: 'Удалить раздел',
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : () async {
                                        await _confirmRemoveSection(user, sectionId);
                                        if (!mounted) return;
                                        Navigator.of(sheetContext).pop();
                                      },
                                color: theme.colorScheme.error,
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _openUserBinsSheet({
    required ThemeData theme,
    required UserProfile user,
    required List<String> allAvailableBins,
    required bool isUpdating,
    required bool isDeleting,
  }) async {
    if (!_canManageBinsFor(user)) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        final bottom = MediaQuery.of(sheetContext).viewInsets.bottom;

        final availableToAdd = allAvailableBins
            .where((bin) => user.binAssignments.every((a) => a.bin != bin))
            .toList()
          ..sort();

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, bottom + 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('БИНы сотрудника', style: theme.textTheme.titleLarge),
                const SizedBox(height: 6),
                Text(
                  user.name,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),

                // ADD BIN (selector)
                _BinSelectorField(
                  key: ValueKey('bins-sheet-add-${user.id}-${user.binAssignments.length}-${availableToAdd.length}'),
                  availableBins: availableToAdd,
                  enabled: !(isUpdating || isDeleting) && availableToAdd.isNotEmpty,
                  onBinSelected: (value) async {
                    if (value.isEmpty) return;

                    final assignment = await _showBinAssignmentSheet(user: user, bin: value);
                    if (assignment == null) return;

                    final next = List<UserBinAssignment>.from(user.binAssignments)..add(assignment);
                    await _updateUserBins(user, next);

                    if (!mounted) return;
                    Navigator.of(sheetContext).pop(); // закрываем, чтобы карточка обновилась
                  },
                ),

                const SizedBox(height: 12),

                // LIST
                if (user.binAssignments.isEmpty)
                  Text(
                    'БИНы не назначены.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 420),
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: user.binAssignments.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final assignment = user.binAssignments[index];
                        final expiresLabel = assignment.expiresAt != null
                            ? 'до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                            : 'без срока';

                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: theme.colorScheme.outlineVariant.withOpacity(0.55),
                            ),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      assignment.bin,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      expiresLabel,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 10),
                              IconButton(
                                tooltip: 'Изменить срок',
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : () async {
                                        final updatedAssignment = await _showBinAssignmentSheet(
                                          user: user,
                                          bin: assignment.bin,
                                          current: assignment,
                                        );
                                        if (updatedAssignment == null) return;

                                        final updatedAssignments = user.binAssignments
                                            .map((item) => item.bin == assignment.bin ? updatedAssignment : item)
                                            .toList();
                                        await _updateUserBins(user, updatedAssignments);

                                        if (!mounted) return;
                                        Navigator.of(sheetContext).pop();
                                      },
                                icon: const Icon(Icons.edit_calendar_outlined),
                              ),
                              IconButton(
                                tooltip: 'Удалить БИН',
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : () async {
                                        await _confirmRemoveBin(user, assignment);
                                        if (!mounted) return;
                                        Navigator.of(sheetContext).pop();
                                      },
                                color: theme.colorScheme.error,
                                icon: const Icon(Icons.delete_outline),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
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
      final pendingFuture = widget.apiClient.fetchPendingRegistrations();

      final roles = await rolesFuture;
      final users = await usersFuture;
      final sections = await sectionsFuture;
      final bins = await binsFuture;
      final unassigned = await unassignedFuture;
      final pendingRegistrations = await pendingFuture;

      final pendingIds = pendingRegistrations.map((entry) => entry.id).toSet();
      final filteredUsers = users.where((user) => !pendingIds.contains(user.id)).toList();

      final operatorIds = filteredUsers
          .where((u) => u.canReply && !u.isAdmin)
          .map((u) => u.id)
          .toSet();

      final selectedOperatorId =
          _selectedUnassignedOperatorId != null && operatorIds.contains(_selectedUnassignedOperatorId)
              ? _selectedUnassignedOperatorId
              : null;


      final selectedPendingRegistrationId =
          _selectedPendingRegistrationId != null && pendingIds.contains(_selectedPendingRegistrationId)
              ? _selectedPendingRegistrationId
              : null;

      if (!mounted) return;

      setState(() {
        _roles = roles;
        _users = filteredUsers;
        _availableSections = sections;
        _availableBins = bins;
        _unassignedBins = unassigned;
        _pendingRegistrations = pendingRegistrations;
        _selectedPendingRegistrationId = selectedPendingRegistrationId;
        _selectedUnassignedOperatorId = selectedOperatorId;

        _loading = false;
        _updatingUserIds.clear();
        _deletingUserIds.clear();
        _pendingActionIds.clear();
      });
    } catch (error) {
      if (!mounted) return;

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
      if (!mounted) return;
      setState(() => _searchQuery = value);
      refreshAdminData(showLoading: false);
    });
  }

  String _pluralizeDialogs(int count) {
    final mod10 = count % 10;
    final mod100 = count % 100;
    if (mod10 == 1 && mod100 != 11) return 'диалог';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'диалога';
    return 'диалогов';
  }

  String _roleTitleById(UserProfile user) {
    for (final r in _roles) {
      if (r.id == user.role) return r.title;
    }
    return user.roleLabel; // fallback
  }

  bool _isModerator(UserProfile user) {
    final t = _roleTitleById(user).toLowerCase();
    return t.contains('модератор');
  }

  bool _isAdministrator(UserProfile user) {
    if (user.isAdmin) return true;
    final t = _roleTitleById(user).toLowerCase();
    return t.contains('администратор');
  }



  bool _canManageBinsFor(UserProfile user) {
    if (user.isAdmin) return false;
    if (_isModerator(user)) return false;
    return true; // например оператор
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
      if (candidate.isAfter(now)) return candidate;
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
              final fallback = (selected != null && selected!.isAfter(now)) ? selected! : _defaultExpirySeed();
              final firstDate = DateTime(now.year, now.month, now.day);

              final date = await showDatePicker(
                context: sheetContext,
                initialDate: fallback.isBefore(firstDate) ? firstDate : fallback,
                firstDate: firstDate,
                lastDate: now.add(const Duration(days: 365)),
              );
              if (date == null) return;

              final timeOfDay = await showTimePicker(
                context: sheetContext,
                initialTime: TimeOfDay.fromDateTime(fallback),
              );
              if (timeOfDay == null) return;

              setModalState(() {
                selected = DateTime(date.year, date.month, date.day, timeOfDay.hour, timeOfDay.minute);
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
    final confirmed = await showThemedDialog<bool>(
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
    if (confirmed != true) return;

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
      if (!mounted) return;

      setState(() {
        _users = _users.map((existing) => existing.id == updated.id ? updated : existing).toList();
        _updatingUserIds.remove(user.id);
      });

      if (!mounted) return;

      showTopMessage(
        context,
        'Роль пользователя "${updated.name}" обновлена на ${updated.roleLabel}',
      );
    } catch (error) {
      if (!mounted) return;
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

  Future<void> _approveRegistration(PendingRegistration registration) async {
    setState(() => _pendingActionIds.add(registration.id));
    try {
      final updated = await widget.apiClient.approveRegistration(registration.id);
      if (!mounted) return;

      setState(() {
        _pendingRegistrations.removeWhere((item) => item.id == registration.id);
        _users = _users.map((user) => user.id == updated.id ? updated : user).toList();
        if (_selectedPendingRegistrationId == registration.id) {
          _selectedPendingRegistrationId = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      showTopMessage(
        context,
        'Не удалось подтвердить регистрацию: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() => _pendingActionIds.remove(registration.id));
      }
    }
  }

  Future<void> _rejectRegistration(PendingRegistration registration) async {
    setState(() => _pendingActionIds.add(registration.id));
    try {
      await widget.apiClient.rejectRegistration(registration.id);
      if (!mounted) return;

      setState(() {
        _pendingRegistrations.removeWhere((item) => item.id == registration.id);
        _users.removeWhere((user) => user.id == registration.id);
        if (_selectedPendingRegistrationId == registration.id) {
          _selectedPendingRegistrationId = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      showTopMessage(
        context,
        'Не удалось отклонить регистрацию: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() => _pendingActionIds.remove(registration.id));
      }
    }
  }

  Future<void> _approveAllRegistrations() async {
    if (_pendingRegistrations.isEmpty) return;

    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Подтвердить все регистрации?'),
          content: Text('Будет подтверждено заявок: ${_pendingRegistrations.length}.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Подтвердить все'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;

    final entries = List<PendingRegistration>.from(_pendingRegistrations);
    for (final entry in entries) {
      if (!mounted) return;
      await _approveRegistration(entry);
    }

    if (mounted) {
      showTopMessage(context, 'Все заявки подтверждены.');
    }
  }

  Future<void> _rejectAllRegistrations() async {
    if (_pendingRegistrations.isEmpty) return;

    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final theme = Theme.of(dialogContext);
        return AlertDialog(
          title: const Text('Отклонить все регистрации?'),
          content: Text('Будет отклонено заявок: ${_pendingRegistrations.length}.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error),
              child: const Text('Отклонить все'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;

    final entries = List<PendingRegistration>.from(_pendingRegistrations);
    for (final entry in entries) {
      if (!mounted) return;
      await _rejectRegistration(entry);
    }

    if (mounted) {
      showTopMessage(context, 'Все заявки отклонены.');
    }
  }

  Future<void> _openPendingRegistrationsMenu(ThemeData theme) async {
  if (_pendingRegistrations.isEmpty) {
    showTopMessage(context, 'Нет заявок на регистрацию.');
    return;
  }

  final action = await showModalBottomSheet<_PendingAction>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) {
      final bottom = MediaQuery.of(sheetContext).viewInsets.bottom;
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Регистрации на подтверждение', style: theme.textTheme.titleLarge),
              const SizedBox(height: 12),

              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 44,
                      child: OutlinedButton.icon(
                        onPressed: () => Navigator.of(sheetContext).pop(_PendingAction.approveAll),
                        icon: const Icon(Icons.done_all),
                        label: const Text('Принять все'),
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(color: theme.colorScheme.primary, width: 1.5),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: SizedBox(
                      height: 44,
                      child: OutlinedButton.icon(
                        onPressed: () => Navigator.of(sheetContext).pop(_PendingAction.rejectAll),
                        icon: const Icon(Icons.clear_all),
                        label: const Text('Отклонить все'),
                        style: OutlinedButton.styleFrom(
                          side: BorderSide(color: theme.colorScheme.error, width: 1.5),
                          foregroundColor: theme.colorScheme.error,
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 12),

              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 420),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _pendingRegistrations.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    final entry = _pendingRegistrations[index];
                    final isPending = _pendingActionIds.contains(entry.id);

                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: theme.colorScheme.outlineVariant.withOpacity(0.55),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  entry.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  entry.email,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  DateFormat('dd.MM.yyyy HH:mm').format(entry.createdAt.toLocal()),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          IconButton(
                            tooltip: 'Подтвердить',
                            onPressed: isPending
                                ? null
                                : () => Navigator.of(sheetContext).pop(_PendingAction.approveOne(entry)),
                            icon: const Icon(Icons.check_circle_outline),
                          ),
                          IconButton(
                            tooltip: 'Отклонить',
                            onPressed: isPending
                                ? null
                                : () => Navigator.of(sheetContext).pop(_PendingAction.rejectOne(entry)),
                            color: theme.colorScheme.error,
                            icon: const Icon(Icons.cancel_outlined),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  if (!mounted || action == null) return;

  if (action.kind == _PendingActionKind.approveAll) {
    await _approveAllRegistrations();
    return;
  }
  if (action.kind == _PendingActionKind.rejectAll) {
    await _rejectAllRegistrations();
    return;
  }
  if (action.kind == _PendingActionKind.approveOne && action.registration != null) {
    await _approveRegistration(action.registration!);
    return;
  }
  if (action.kind == _PendingActionKind.rejectOne && action.registration != null) {
    await _rejectRegistration(action.registration!);
    return;
  }
}

  Future<void> _updateUserSections(UserProfile user, Set<String> sections) async {
    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });
    try {
      final updated = await widget.apiClient.updateUserSections(user.id, sections.toList());
      if (!mounted) return;

      setState(() {
        _users = _users.map((existing) => existing.id == updated.id ? updated : existing).toList();
        _updatingUserIds.remove(user.id);
      });

      if (!mounted) return;

      showTopMessage(context, 'Разделы пользователя "${updated.name}" обновлены.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(context, 'Не удалось обновить разделы: $error', isError: true);
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

      if (!mounted) return;

      setState(() {
        _users = _users.map((existing) => existing.id == updated.id ? updated : existing).toList();
        _updatingUserIds.remove(user.id);
        _unassignedBins = unassigned;
      });

      if (!mounted) return;

      showTopMessage(context, 'БИНы пользователя "${updated.name}" обновлены.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(context, 'Не удалось обновить БИНы: $error', isError: true);
    }
  }

  Future<void> _deleteUser(UserProfile user) async {
    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Удалить аккаунт ${user.name}?'),
          content: const Text('Пользователь потеряет доступ к системе. Действие нельзя отменить.'),
          actions: [
            TextButton(
              onPressed: _logButtonPress('cancel delete user', () => Navigator.of(dialogContext).pop(false)),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress('confirm delete user', () => Navigator.of(dialogContext).pop(true)),
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;

    setState(() {
      _deletingUserIds.add(user.id);
      _updatingUserIds.add(user.id);
      _error = null;
    });

    try {
      await widget.apiClient.deleteUser(user.id);
      if (!mounted) return;

      setState(() {
        _users = _users.where((existing) => existing.id != user.id).toList();
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
      });

      showTopMessage(context, 'Аккаунт "${user.name}" удалён.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _deletingUserIds.remove(user.id);
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(context, 'Не удалось удалить пользователя: $error', isError: true);
    }
  }

  Future<void> _promptResetPassword(UserProfile user) async {
    final formKey = GlobalKey<FormState>();
    final passwordController = TextEditingController();
    final confirmController = TextEditingController();

    final newPassword = await showThemedDialog<String>(
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
                    if (value == null || value.trim().length < 5) return 'Минимум 5 символов';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: confirmController,
                  decoration: const InputDecoration(labelText: 'Повторите пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value != passwordController.text) return 'Пароли не совпадают';
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: _logButtonPress('cancel change user password', () => Navigator.of(dialogContext).pop()),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress('save changed user password', () {
                if (formKey.currentState!.validate()) {
                  Navigator.of(dialogContext).pop(passwordController.text.trim());
                }
              }),
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );

    passwordController.dispose();
    confirmController.dispose();

    if (newPassword == null) return;

    setState(() {
      _updatingUserIds.add(user.id);
      _error = null;
    });

    try {
      final updated = await widget.apiClient.adminSetUserPassword(user.id, newPassword);
      if (!mounted) return;

      setState(() {
        _users = _users.map((existing) => existing.id == updated.id ? updated : existing).toList();
        _updatingUserIds.remove(user.id);
      });

      showTopMessage(context, 'Пароль для "${updated.name}" обновлён.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _updatingUserIds.remove(user.id);
        _error = error.toString();
      });
      showTopMessage(context, 'Не удалось изменить пароль: $error', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final theme = Theme.of(context);

    final allAvailableBins = <String>[];
    final seenBins = <String>{};
    void addBin(String bin) {
      if (seenBins.add(bin)) allAvailableBins.add(bin);
    }

    for (final bin in _availableBins) {
      addBin(bin);
    }
    for (final entry in _unassignedBins) {
      addBin(entry.bin);
    }

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
                  onPressed: _logButtonPress('clear user search', () {
                    _searchController.clear();
                    _onSearchChanged('');
                  }),
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
                else ...[
                  DropdownButtonFormField<String?>(
                    value: _selectedUnassignedBin,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Выберите БИН',
                      prefixIcon: Icon(Icons.search),
                    ),
                    items: [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text(
                          'Не выбран',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                      ..._unassignedBins.map((entry) {
                        final desc = entry.openDialogs > 0
                            ? '${entry.openDialogs} ${_pluralizeDialogs(entry.openDialogs)}'
                            : 'Нет активных диалогов';

                        return DropdownMenuItem<String?>(
                          value: entry.bin,
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  entry.bin,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyMedium, // без жирного
                                ),
                              ),
                              const SizedBox(width: 10),
                              Flexible(
                                child: Text(
                                  desc,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                    fontWeight: FontWeight.w400,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],
                    onChanged: (value) => setState(() => _selectedUnassignedBin = value),
                  ),

                  const SizedBox(height: 10),

                  // ВАЖНО: карточку-описание выбранного БИНа удалили полностью.

                  // Операторы
                  Builder(
                    builder: (_) {
                      final operators = _users
                          .where((u) => u.canReply && !u.isAdmin)
                          .toList()
                        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

                      return DropdownButtonFormField<int?>(
                        value: _selectedUnassignedOperatorId,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Выберите сотрудника (оператор)',
                          prefixIcon: Icon(Icons.person_search_outlined),
                        ),
                        items: [
                          DropdownMenuItem<int?>(
                            value: null,
                            child: Text('Не выбран', style: theme.textTheme.bodyMedium),
                          ),
                          ...operators.map((op) {
                            return DropdownMenuItem<int?>(
                              value: op.id,
                              child: Text(
                                op.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            );
                          }),
                        ],
                        onChanged: (value) => setState(() => _selectedUnassignedOperatorId = value),
                      );
                    },
                  ),

                  const SizedBox(height: 12),

                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      icon: const Icon(Icons.assignment_turned_in_outlined),
                      label: const Text('Назначить выбранный БИН'),
                      onPressed: (_selectedUnassignedBin == null || _selectedUnassignedOperatorId == null)
                          ? null
                          : _logButtonPress(
                              'assign unassigned bin to operator',
                              () async {
                                final bin = _selectedUnassignedBin!;
                                final operator = _users.firstWhere((u) => u.id == _selectedUnassignedOperatorId);

                                final assignment = await _showBinAssignmentSheet(user: operator, bin: bin);
                                if (assignment == null) return;

                                final next = List<UserBinAssignment>.from(operator.binAssignments)..add(assignment);
                                await _updateUserBins(operator, next);

                                if (!mounted) return;
                                setState(() {
                                  _selectedUnassignedBin = null;
                                  _selectedUnassignedOperatorId = null;
                                });

                                await refreshAdminData(showLoading: false);
                              },
                            ),
                    ),
                  ),
                ],

              ],
            ),
          ),
        ),
      ),
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
                  'Регистрации на подтверждение',
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                if (_pendingRegistrations.isEmpty)
                  Text(
                    'Нет заявок на регистрацию.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _logButtonPress(
                        'open pending registrations menu',
                        () => _openPendingRegistrationsMenu(theme),
                      ),
                      icon: const Icon(Icons.arrow_drop_down_circle_outlined),
                      label: Text(
                        'Открыть список (${_pendingRegistrations.length})',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
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
          child: Text('Пока нет зарегистрированных операторов.', style: theme.textTheme.bodyMedium),
        ),
      );
    } else {
      listChildren.addAll(
        _users.map((user) {
          final isSelf = user.id == widget.currentUser.id;
          final isUpdating = _updatingUserIds.contains(user.id);
          final isDeleting = _deletingUserIds.contains(user.id);
          final canDelete = !isSelf && !user.isAdmin;
          final createdAtLabel = DateFormat('dd.MM.yyyy HH:mm').format(user.createdAt.toLocal());

          Widget buildInfoChip(IconData icon, String label) {
            return SizedBox(
              height: 34,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 180, maxWidth: 180),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceVariant.withOpacity(0.4),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.45)),
                  ),
                  child: Row(
                    children: [
                      Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          label,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          softWrap: false,
                        ),
                      ),
                    ],
                  ),
                ),
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
                    // === HEADER: name + delete icon ===
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            user.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        if (canDelete)
                          IconButton(
                            tooltip: 'Удалить аккаунт',
                            icon: const Icon(Icons.delete_outline),
                            color: theme.colorScheme.error,
                            onPressed: _logButtonPress(
                              'delete user from header',
                              (isUpdating || isDeleting) ? null : () => _deleteUser(user),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Divider(height: 1, thickness: 1, color: theme.colorScheme.outlineVariant.withOpacity(0.6)),
                    const SizedBox(height: 12),

                    // === ROW: email (left) + role (right) ===
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: buildInfoChip(Icons.email_outlined, user.email),
                        ),
                        const SizedBox(width: 12),
                        _RoleDropdownPill(
                          user: user,
                          roles: _roles,
                          disabled: (() {
                            final isSelf = user.id == widget.currentUser.id;
                            if (isSelf) return true;

                            if (isUpdating || isDeleting) return true;

                            // Ключевая логика: если текущий пользователь НЕ админ,
                            // то роль администратора менять нельзя (и pill должен стать серым)
                            final currentIsAdmin = widget.currentUser.role == 'admin';
                            if (!currentIsAdmin && _isAdministrator(user)) return true;

                            return false;
                          })(),

                          onChange: (value) => _changeRole(user, value),
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
                    if (isUpdating && !isDeleting) ...[
                      const SizedBox(height: 12),
                      const LinearProgressIndicator(),
                    ],
                    const SizedBox(height: 16),
                    if (_canManageBinsFor(user)) ...[
                      const SizedBox(height: 14),

                      Row(
                        children: [
                          Expanded(
                            child: SizedBox(
                              height: 46,
                              child: FilledButton.icon(
                                icon: const Icon(Icons.dashboard_customize_outlined),
                                label: Text('Разделы: ${user.sections.length}'),
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : _logButtonPress(
                                        'open user sections sheet',
                                        () => _openUserSectionsSheet(
                                          theme: theme,
                                          user: user,
                                          allAvailableSections: _availableSections,
                                          isUpdating: isUpdating,
                                          isDeleting: isDeleting,
                                        ),
                                      ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: SizedBox(
                              height: 46,
                              child: FilledButton.icon(
                                icon: const Icon(Icons.apartment_outlined),
                                label: Text('БИНы: ${user.binAssignments.length}'),
                                onPressed: (isUpdating || isDeleting)
                                    ? null
                                    : _logButtonPress(
                                        'open user bins sheet',
                                        () => _openUserBinsSheet(
                                          theme: theme,
                                          user: user,
                                          allAvailableBins: allAvailableBins,
                                          isUpdating: isUpdating,
                                          isDeleting: isDeleting,
                                        ),
                                      ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        icon: const Icon(Icons.lock_reset),
                        label: const Text('Сменить пароль'),
                        onPressed: _logButtonPress(
                          'reset user password',
                          (isUpdating || isDeleting) ? null : () => _promptResetPassword(user),
                        ),
                      ),
                    ),

                    const SizedBox(height: 8),
                    Text(
                      (isUpdating) ? 'Сохраняем изменения…' : '',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (isSelf)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Нельзя изменять собственную роль',
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
                Text(_error!, style: const TextStyle(color: Colors.red)),
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

  bool _jobTitleEditedManually = false;
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

    _jobTitleController.addListener(() {
      _jobTitleEditedManually = true; // если человек начал править — больше не автозаполняем
      _handleProfileHeaderChange();
    });

    _loadSavedProfileImage();
    refreshProfile();
  }

  void _handleProfileHeaderChange() {
    if (mounted) setState(() {});
  }

  Future<void> _loadSavedProfileImage() async {
    final prefs = await SharedPreferences.getInstance();
    final storedPath = prefs.getString('profile_image_path');
    if (storedPath == null) return;

    final file = File(storedPath);
    if (await file.exists()) {
      if (!mounted) return;
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
      if (showLoading) _loading = true;
    });

    try {
      final profile = await widget.apiClient.fetchProfile();
      final sections = await widget.apiClient.fetchSections();
      widget.onProfileUpdated(profile);

      if (!mounted) return;

      _profile = profile;
      _nameController.text = profile.name;
      _emailController.text = profile.email;
      _loginController.text = profile.login;
      final serverJobTitle = profile.jobTitle.trim();
      final autoRoleTitle = profile.roleLabel.trim();

      // автозаполняем только если на сервере пусто И пользователь ещё не трогал поле
      final shouldAutoFill = serverJobTitle.isEmpty && !_jobTitleEditedManually;

      _jobTitleController.text = shouldAutoFill ? autoRoleTitle : profile.jobTitle;
      _jobTitleEditedManually = false;

      _phoneController.text = profile.phone;
      _bioController.text = profile.bio;

      _handleProfileHeaderChange();

      setState(() {
        _sections = sections;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _error = null;
      _successMessage = null;
    });

    try {
      final jobTitleText = _jobTitleController.text.trim();
      final effectiveJobTitle = jobTitleText.isNotEmpty ? jobTitleText : (_profile?.roleLabel.trim() ?? '');

      final updated = await widget.apiClient.updateProfile(
        name: _nameController.text.trim(),
        jobTitle: effectiveJobTitle,
        phone: _phoneController.text.trim(),
        bio: _bioController.text.trim(),
      );
      widget.onProfileUpdated(updated);

      if (!mounted) return;

      setState(() {
        _profile = updated;
        _saving = false;
        _successMessage = 'Профиль обновлён';
      });
    } catch (error) {
      if (!mounted) return;
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

    final result = await showThemedDialog<Map<String, String>>(
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
                    if (value == null || value.trim().length < 5) return 'Минимум 5 символов';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: newController,
                  decoration: const InputDecoration(labelText: 'Новый пароль'),
                  obscureText: true,
                  validator: (value) {
                    if (value == null || value.trim().length < 5) return 'Минимум 5 символов';
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
                    if (value != newController.text) return 'Пароли не совпадают';
                    return null;
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: _logButtonPress('cancel change own password', () => Navigator.of(dialogContext).pop()),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress('save changed own password', () {
                if (formKey.currentState!.validate()) {
                  Navigator.of(dialogContext).pop({
                    'current': currentController.text.trim(),
                    'new': newController.text.trim(),
                  });
                }
              }),
              child: const Text('Сохранить'),
            ),
          ],
        );
      },
    );

    currentController.dispose();
    newController.dispose();
    confirmController.dispose();

    if (result == null) return;

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

      if (!mounted) return;

      setState(() {
        _profile = session.user;
        _saving = false;
        _successMessage = 'Пароль обновлён';
      });

      showTopMessage(context, 'Пароль обновлён.');
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _saving = false;
        _error = error.toString();
      });

      showTopMessage(context, 'Не удалось обновить пароль: $error', isError: true);
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
    if (file != null && file.existsSync()) return FileImage(file);
    return null;
  }

  Future<void> _pickProfileImage() async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(source: ImageSource.gallery, imageQuality: 90);
      if (picked == null) return;

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
            statusBarColor: brandPrimaryGreen,
          ),
          IOSUiSettings(
            title: 'Обрезать фото',
            aspectRatioLockEnabled: true,
          ),
        ],
      );

      final resultingPath = cropped?.path ?? picked.path;
      final file = File(resultingPath);

      if (!mounted) return;

      setState(() {
        _profileImagePath = resultingPath;
        _profileImageFile = file;
        _successMessage = 'Фото профиля обновлено';
      });

      await _saveProfileImagePath(resultingPath);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = 'Не удалось обновить фото: $error';
      });
    }
  }

  String get _displayName {
    final edited = _nameController.text.trim();
    if (edited.isNotEmpty) return edited;
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
                radius: 55,
                backgroundColor: Colors.white,
                backgroundImage: avatar,
                child: avatar == null ? const Icon(Icons.person, size: 52, color: brandPrimaryGreen) : null,
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
    int? minLines,
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
          minLines: minLines,
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
              child: readOnly ? const Icon(Icons.lock_outline, size: 18) : const Icon(Icons.edit_outlined),
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
                        if (trimmed.runes.length < 2) return 'Введите имя длиной не менее 2 символов';
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
                      minLines: 1,
                      maxLines: 5,
                      keyboardType: TextInputType.multiline,
                      textCapitalization: TextCapitalization.sentences,
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
                                    Icon(Icons.dashboard_customize_outlined, color: theme.colorScheme.onSurfaceVariant),
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
                                        (s) => s.id == sectionId,
                                        orElse: () => Section(id: sectionId, title: sectionId),
                                      );
                                      return Chip(label: Text(match.title));
                                    }).toList(),
                                  ),
                                const SizedBox(height: 12),
                                Row(
                                  children: [
                                    Icon(Icons.business_center_outlined, color: theme.colorScheme.onSurfaceVariant),
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
                        child: Text(_error!, style: const TextStyle(color: Colors.red)),
                      ),
                    if (_successMessage != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(_successMessage!, style: const TextStyle(color: Colors.green)),
                      ),
                    const SizedBox(height: 12),
                      Column(
                        children: [
                          SizedBox(
                            width: double.infinity,
                            height: 46,
                            child: ElevatedButton.icon(
                              onPressed: _logButtonPress('save profile changes', _saving ? null : _save),
                              icon: _saving
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    )
                                  : const Icon(Icons.save),
                              label: Text(_saving ? 'Сохраняем…' : 'Сохранить'),
                            ),
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            height: 46,
                            child: OutlinedButton.icon(
                              onPressed: _logButtonPress('change own password', _saving ? null : _changeOwnPassword),
                              icon: const Icon(Icons.lock_outline),
                              label: const Text('Сменить пароль'),
                            ),
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
    if (!widget.enabled) return const Iterable<Section>.empty();

    final query = value.text.trim();
    if (query.isEmpty) return widget.availableSections;

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
        if (!widget.enabled) return;
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
            if (!widget.enabled) return;
            final trimmed = value.trim();
            if (trimmed.isEmpty) return;

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
    if (!widget.enabled) return const Iterable<String>.empty();

    final query = value.text.trim();
    if (query.isEmpty) return widget.availableBins;

    final lowerQuery = query.toLowerCase();
    return widget.availableBins.where((bin) => bin.toLowerCase().contains(lowerQuery));
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
        if (!widget.enabled) return;
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
            if (!widget.enabled) return;
            final trimmed = value.trim();
            if (trimmed.isEmpty) return;

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

enum _PendingActionKind { approveAll, rejectAll, approveOne, rejectOne }

class _PendingAction {
  final _PendingActionKind kind;
  final PendingRegistration? registration;

  const _PendingAction._(this.kind, this.registration);

  static const approveAll = _PendingAction._(_PendingActionKind.approveAll, null);
  static const rejectAll = _PendingAction._(_PendingActionKind.rejectAll, null);

  factory _PendingAction.approveOne(PendingRegistration reg) =>
      _PendingAction._(_PendingActionKind.approveOne, reg);

  factory _PendingAction.rejectOne(PendingRegistration reg) =>
      _PendingAction._(_PendingActionKind.rejectOne, reg);
}

int? _parseIntValue(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return int.tryParse(value.toString());
}

double? _parseDoubleValue(dynamic value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is int) return value.toDouble();
  if (value is num) return value.toDouble();
  if (value is String) {
    final normalized = value.replaceAll(',', '.').trim();
    if (normalized.isEmpty) return null;
    return double.tryParse(normalized);
  }
  return double.tryParse(value.toString());
}

DateTime? _parseDateTime(dynamic value) {
  if (value == null) return null;
  if (value is DateTime) return value.toLocal();
  if (value is String) return DateTime.tryParse(value)?.toLocal();
  return null;
}


