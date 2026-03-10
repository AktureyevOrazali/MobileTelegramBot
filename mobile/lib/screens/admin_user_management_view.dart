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
            ? brandAccentIris.withOpacity(0.18)
            : (user.canReply ? theme.colorScheme.primaryContainer : theme.colorScheme.surfaceVariant.withOpacity(0.6)));

    final Color badgeFg = disabled
        ? theme.colorScheme.onSurfaceVariant.withOpacity(0.75)
        : (user.isAdmin
            ? theme.colorScheme.onSurface
            : (user.canReply ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant));

    return SizedBox(
      width: 150, // можешь сделать 140, если нужно ещё компактнее
      height: 34,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: badgeBg,
          borderRadius: BorderRadius.circular(AppRadii.control),
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
            style: theme.textTheme.labelMedium?.copyWith(color: badgeFg, fontWeight: FontWeight.w700),
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

class _AdminStatTile extends StatelessWidget {
  const _AdminStatTile({
    required this.label,
    required this.value,
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadii.field),
        onTap: enabled ? onTap : null,
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerHighest.withValues(alpha: enabled ? 0.18 : 0.08),
            borderRadius: BorderRadius.circular(AppRadii.field),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: colorScheme.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppRadii.control),
                ),
                child: Icon(icon, size: 16, color: colorScheme.primary),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
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
  List<OrganizationWithoutContract> _organizationsWithoutContracts = [];
  List<BinDetailed> _binsDetailed = [];
  List<PendingRegistration> _pendingRegistrations = [];

  final Set<int> _updatingUserIds = <int>{};
  final Set<int> _deletingUserIds = <int>{};
  final Set<int> _pendingActionIds = <int>{};

  int? _selectedPendingRegistrationId;


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
                            borderRadius: BorderRadius.circular(AppRadii.field),
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
                            borderRadius: BorderRadius.circular(AppRadii.field),
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
      final organizationsFuture = widget.apiClient.fetchOrganizationsWithoutContracts();
      final binsDetailedFuture = widget.apiClient.getBinsDetailed();

      final roles = await rolesFuture;
      final users = await usersFuture;
      final sections = await sectionsFuture;
      final bins = await binsFuture;
      final unassigned = await unassignedFuture;
      final pendingRegistrations = await pendingFuture;
      final organizationsWithoutContracts = await organizationsFuture;
      final binsDetailed = await binsDetailedFuture;

      final pendingIds = pendingRegistrations.map((entry) => entry.id).toSet();
      final filteredUsers = users.where((user) => !pendingIds.contains(user.id)).toList();

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
        _organizationsWithoutContracts = organizationsWithoutContracts;
        _binsDetailed = binsDetailed;
        _pendingRegistrations = pendingRegistrations;
        _selectedPendingRegistrationId = selectedPendingRegistrationId;

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

  BinDetailed? _findBinDetailed(String? bin) {
    if (bin == null || bin.isEmpty) return null;
    for (final item in _binsDetailed) {
      if (item.bin == bin) return item;
    }
    return null;
  }

  void _upsertBinDetailed(BinDetailed info) {
    final index = _binsDetailed.indexWhere((item) => item.bin == info.bin);
    if (index >= 0) {
      _binsDetailed[index] = info;
      return;
    }
    _binsDetailed.add(info);
  }



  Future<void> _deleteBinValue(String bin) async {
    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить БИН?'),
          content: Text('БИН $bin будет удален без возможности восстановления.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;

    try {
      await widget.apiClient.deleteBin(bin);
      if (!mounted) return;
      setState(() {
        _availableBins.removeWhere((item) => item == bin);
        _unassignedBins.removeWhere((item) => item.bin == bin);
        _organizationsWithoutContracts.removeWhere((item) => item.customerBin == bin);
        _binsDetailed.removeWhere((item) => item.bin == bin);
      });
      showTopMessage(context, 'БИН $bin удален.');
    } catch (error) {
      if (!mounted) return;
      showTopMessage(context, 'Не удалось удалить БИН: $error', isError: true);
    }
  }

  Future<void> _openAllBinsSheet(ThemeData theme) async {
    final searchController = TextEditingController();
    String searchQuery = '';
    BinDetailed? selectedInfo;
    bool loadingInfo = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final binsSource = _binsDetailed.isNotEmpty
                ? _binsDetailed
                : _availableBins
                    .map(
                      (bin) => BinDetailed(
                        bin: bin,
                        hasContract: false,
                        customerLegalAddress: null,
                        customerBankNameRu: null,
                      ),
                    )
                    .toList();
            final normalized = searchQuery.trim().toLowerCase();
            final filtered = binsSource
                .where((item) => normalized.isEmpty || item.bin.toLowerCase().contains(normalized))
                .toList()
              ..sort((a, b) => a.bin.compareTo(b.bin));

            Future<void> onBinTap(BinDetailed item) async {
              setModalState(() {
                loadingInfo = true;
                selectedInfo = item;
              });
              try {
                final fresh = await widget.apiClient.getBinInfo(item.bin);
                if (!mounted) return;
                setState(() {
                  _upsertBinDetailed(fresh);
                });
                if (!sheetContext.mounted) return;
                setModalState(() {
                  selectedInfo = fresh;
                });
              } catch (_) {
              } finally {
                if (sheetContext.mounted) {
                  setModalState(() {
                    loadingInfo = false;
                  });
                }
              }
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  MediaQuery.of(sheetContext).viewInsets.bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Все БИНы (${binsSource.length})', style: theme.textTheme.titleLarge),
                    const SizedBox(height: 10),
                    TextField(
                      controller: searchController,
                      decoration: const InputDecoration(
                        labelText: 'Поиск БИН',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (value) => setModalState(() => searchQuery = value),
                    ),
                    const SizedBox(height: 10),
                    if (selectedInfo != null)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceVariant.withOpacity(0.35),
                          borderRadius: BorderRadius.circular(AppRadii.field),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    selectedInfo!.bin,
                                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                                  ),
                                ),
                                if (loadingInfo)
                                  const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              selectedInfo!.hasContract ? '? Есть договор' : '? Без договора',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: selectedInfo!.hasContract ? brandPrimaryGreen : theme.colorScheme.error,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if ((selectedInfo!.customerLegalAddress ?? '').isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text('Адрес: ${selectedInfo!.customerLegalAddress}'),
                            ],
                            if ((selectedInfo!.customerBankNameRu ?? '').isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text('Банк: ${selectedInfo!.customerBankNameRu}'),
                            ],
                          ],
                        ),
                      ),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 420),
                      child: filtered.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'Нет БИНов.',
                                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                              ),
                            )
                          : ListView.separated(
                              shrinkWrap: true,
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, index) {
                                final item = filtered[index];
                                return ListTile(
                                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.field)),
                                  tileColor: theme.colorScheme.surfaceVariant.withOpacity(0.25),
                                  title: Text(item.bin),
                                  subtitle: Text(item.hasContract ? 'договор' : 'без договора'),
                                  trailing: IconButton(
                                    tooltip: 'Удалить БИН',
                                    icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
                                    onPressed: () async {
                                      await _deleteBinValue(item.bin);
                                      if (!sheetContext.mounted) return;
                                      setModalState(() {
                                        if (selectedInfo?.bin == item.bin) {
                                          selectedInfo = null;
                                        }
                                      });
                                    },
                                  ),
                                  onTap: () => onBinTap(item),
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
      },
    );

    searchController.dispose();
  }

  Future<void> _openOrganizationsWithoutContractsSheet(ThemeData theme) async {
    if (_organizationsWithoutContracts.isEmpty) {
      showTopMessage(context, 'Нет организаций без договора.');
      return;
    }

    final searchController = TextEditingController();
    String searchQuery = '';
    BinDetailed? selectedInfo;
    bool loadingInfo = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final normalized = searchQuery.trim().toLowerCase();
            final filtered = _organizationsWithoutContracts
                .where((item) =>
                    normalized.isEmpty ||
                    item.customerBin.toLowerCase().contains(normalized))
                .toList()
              ..sort((a, b) => a.customerBin.compareTo(b.customerBin));

            Future<void> onBinTap(OrganizationWithoutContract item) async {
              setModalState(() {
                loadingInfo = true;
                selectedInfo = BinDetailed(
                  bin: item.customerBin,
                  hasContract: false,
                  customerLegalAddress: item.customerLegalAddress,
                  customerBankNameRu: item.customerBankNameRu,
                );
              });
              try {
                final fresh = await widget.apiClient.getBinInfo(item.customerBin);
                if (!mounted) return;
                setState(() => _upsertBinDetailed(fresh));
                if (!sheetContext.mounted) return;
                setModalState(() => selectedInfo = fresh);
              } catch (_) {
              } finally {
                if (sheetContext.mounted) {
                  setModalState(() => loadingInfo = false);
                }
              }
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  MediaQuery.of(sheetContext).viewInsets.bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Без договора (${_organizationsWithoutContracts.length})',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: searchController,
                      decoration: const InputDecoration(
                        labelText: 'Поиск БИН',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (value) =>
                          setModalState(() => searchQuery = value),
                    ),
                    const SizedBox(height: 10),
                    if (selectedInfo != null)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceVariant
                              .withOpacity(0.35),
                          borderRadius: BorderRadius.circular(AppRadii.field),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    selectedInfo!.bin,
                                    style: theme.textTheme.titleMedium
                                        ?.copyWith(fontWeight: FontWeight.w700),
                                  ),
                                ),
                                if (loadingInfo)
                                  const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '? Без договора',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.error,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if ((selectedInfo!.customerLegalAddress ?? '')
                                .isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                  'Адрес: ${selectedInfo!.customerLegalAddress}'),
                            ],
                            if ((selectedInfo!.customerBankNameRu ?? '')
                                .isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                  'Банк: ${selectedInfo!.customerBankNameRu}'),
                            ],
                          ],
                        ),
                      ),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 420),
                      child: filtered.isEmpty
                          ? Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'Нет БИНов без договора.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color:
                                        theme.colorScheme.onSurfaceVariant),
                              ),
                            )
                          : ListView.separated(
                              shrinkWrap: true,
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (_, index) {
                                final item = filtered[index];
                                return ListTile(
                                  contentPadding:
                                      const EdgeInsets.symmetric(
                                          horizontal: 8),
                                  shape: RoundedRectangleBorder(
                                      borderRadius:
                                          BorderRadius.circular(AppRadii.field)),
                                  tileColor: theme
                                      .colorScheme.surfaceVariant
                                      .withOpacity(0.25),
                                  title: Text(item.customerBin),
                                  subtitle: Text(
                                    item.customerLegalAddress ??
                                        item.customerBankNameRu ??
                                        'Нет доп. данных',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  onTap: () => onBinTap(item),
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
      },
    );

    searchController.dispose();
  }

  /// Bottom sheet for BINs with active contract (read-only search + info).
  Future<void> _openWithContractBinsSheet(ThemeData theme) async {
    final withContract = _binsDetailed.where((b) => b.hasContract).toList()
      ..sort((a, b) => a.bin.compareTo(b.bin));

    if (withContract.isEmpty) {
      showTopMessage(context, 'Нет БИНов с договором.');
      return;
    }

    final searchController = TextEditingController();
    String searchQuery = '';
    BinDetailed? selectedInfo;
    bool loadingInfo = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final normalized = searchQuery.trim().toLowerCase();
            final filtered = withContract
                .where((item) =>
                    normalized.isEmpty ||
                    item.bin.toLowerCase().contains(normalized))
                .toList();

            Future<void> onBinTap(BinDetailed item) async {
              setModalState(() {
                loadingInfo = true;
                selectedInfo = item;
              });
              try {
                final fresh = await widget.apiClient.getBinInfo(item.bin);
                if (!mounted) return;
                setState(() => _upsertBinDetailed(fresh));
                if (!sheetContext.mounted) return;
                setModalState(() => selectedInfo = fresh);
              } catch (_) {
              } finally {
                if (sheetContext.mounted) {
                  setModalState(() => loadingInfo = false);
                }
              }
            }

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  MediaQuery.of(sheetContext).viewInsets.bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'С договором (${withContract.length})',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: searchController,
                      decoration: const InputDecoration(
                        labelText: 'Поиск БИН',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (value) =>
                          setModalState(() => searchQuery = value),
                    ),
                    const SizedBox(height: 10),
                    if (selectedInfo != null)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceVariant
                              .withOpacity(0.35),
                          borderRadius: BorderRadius.circular(AppRadii.field),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    selectedInfo!.bin,
                                    style: theme.textTheme.titleMedium
                                        ?.copyWith(
                                            fontWeight: FontWeight.w700),
                                  ),
                                ),
                                if (loadingInfo)
                                  const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '? Есть договор',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: brandPrimaryGreen,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if ((selectedInfo!.customerLegalAddress ?? '')
                                .isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                  'Адрес: ${selectedInfo!.customerLegalAddress}'),
                            ],
                            if ((selectedInfo!.customerBankNameRu ?? '')
                                .isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Text(
                                  'Банк: ${selectedInfo!.customerBankNameRu}'),
                            ],
                          ],
                        ),
                      ),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 420),
                      child: filtered.isEmpty
                          ? Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'Нет БИНов с договором.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color:
                                        theme.colorScheme.onSurfaceVariant),
                              ),
                            )
                          : ListView.separated(
                              shrinkWrap: true,
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (_, index) {
                                final item = filtered[index];
                                return ListTile(
                                  contentPadding:
                                      const EdgeInsets.symmetric(
                                          horizontal: 8),
                                  shape: RoundedRectangleBorder(
                                      borderRadius:
                                          BorderRadius.circular(AppRadii.field)),
                                  tileColor: theme
                                      .colorScheme.surfaceVariant
                                      .withOpacity(0.25),
                                  title: Text(item.bin),
                                  subtitle: Text(
                                    item.customerLegalAddress ??
                                        item.customerBankNameRu ??
                                        'договор',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  onTap: () => onBinTap(item),
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
      },
    );

    searchController.dispose();
  }

  /// Opens a bottom sheet listing all unassigned BINs with search.
  Future<void> _openUnassignedBinsSheet(ThemeData theme) async {
    if (_unassignedBins.isEmpty) {
      showTopMessage(context, 'Нет неразделённых БИНов.');
      return;
    }

    String searchQuery = '';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final normalized = searchQuery.trim().toLowerCase();
            final filtered = _unassignedBins
                .where((item) =>
                    normalized.isEmpty ||
                    item.bin.toLowerCase().contains(normalized))
                .toList();

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  MediaQuery.of(sheetContext).viewInsets.bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Неразделенные БИНы (${_unassignedBins.length})',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      decoration: const InputDecoration(
                        labelText: 'Поиск БИН',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (value) =>
                          setModalState(() => searchQuery = value),
                    ),
                    const SizedBox(height: 10),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 420),
                      child: filtered.isEmpty
                          ? Padding(
                              padding:
                                  const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'Нет БИНов по запросу.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color:
                                        theme.colorScheme.onSurfaceVariant),
                              ),
                            )
                          : ListView.separated(
                              shrinkWrap: true,
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 6),
                              itemBuilder: (_, index) {
                                final entry = filtered[index];
                                final contractLabel = entry.hasContract
                                    ? 'С договором'
                                    : 'Без договора';
                                final desc = entry.openDialogs > 0
                                    ? '${entry.openDialogs} ${_pluralizeDialogs(entry.openDialogs)}'
                                    : 'Нет активных диалогов';
                                return ListTile(
                                  contentPadding:
                                      const EdgeInsets.symmetric(
                                          horizontal: 8),
                                  shape: RoundedRectangleBorder(
                                      borderRadius:
                                          BorderRadius.circular(AppRadii.field)),
                                  tileColor: theme
                                      .colorScheme.surfaceVariant
                                      .withOpacity(0.25),
                                  title: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          entry.bin,
                                          style: theme
                                              .textTheme.bodyMedium
                                              ?.copyWith(
                                                  fontWeight:
                                                      FontWeight.w600),
                                        ),
                                      ),
                                      Container(
                                        padding: const EdgeInsets
                                            .symmetric(
                                            horizontal: 6,
                                            vertical: 2),
                                        decoration: BoxDecoration(
                                          color: entry.hasContract
                                              ? brandPrimaryGreen
                                                  .withOpacity(0.1)
                                              : theme.colorScheme.error
                                                  .withOpacity(0.1),
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          contractLabel,
                                          style: theme
                                              .textTheme.labelSmall
                                              ?.copyWith(
                                            color: entry.hasContract
                                                ? brandPrimaryGreen
                                                : theme.colorScheme.error,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  subtitle: Text(
                                    desc,
                                    style: theme.textTheme.bodySmall
                                        ?.copyWith(
                                            color: theme.colorScheme
                                                .onSurfaceVariant),
                                  ),
                                  trailing: Icon(
                                    Icons.person_add_alt_1_rounded,
                                    size: 20,
                                    color: theme.colorScheme.primary,
                                  ),
                                  onTap: () {
                                    Navigator.of(sheetContext).pop();
                                    _openAssignBinSheet(
                                      theme: theme,
                                      unassignedBin: entry,
                                    );
                                  },
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
      },
    );
  }

  /// Opens a bottom sheet to assign an unassigned BIN to an operator.
  Future<void> _openAssignBinSheet({
    required ThemeData theme,
    required UnassignedBin unassignedBin,
  }) async {
    final operators = _users
        .where((u) => u.canReply && !u.isAdmin)
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    if (operators.isEmpty) {
      showTopMessage(context, 'Нет доступных операторов для назначения.');
      return;
    }

    // Load BIN info
    BinDetailed? binInfo = _findBinDetailed(unassignedBin.bin);
    bool loadingInfo = binInfo == null;

    String operatorSearchQuery = '';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            // Kick off info load on first build if needed
            if (loadingInfo && binInfo == null) {
              widget.apiClient.getBinInfo(unassignedBin.bin).then((fresh) {
                if (!mounted) return;
                setState(() => _upsertBinDetailed(fresh));
                if (!sheetContext.mounted) return;
                setModalState(() {
                  binInfo = fresh;
                  loadingInfo = false;
                });
              }).catchError((_) {
                if (sheetContext.mounted) {
                  setModalState(() => loadingInfo = false);
                }
              });
              // Prevent re-triggering
              loadingInfo = false;
              binInfo = BinDetailed(
                bin: unassignedBin.bin,
                hasContract: false,
                customerLegalAddress: null,
                customerBankNameRu: null,
              );
            }

            final normalizedOp = operatorSearchQuery.trim().toLowerCase();
            final filteredOperators = operators
                .where((op) =>
                    normalizedOp.isEmpty ||
                    op.name.toLowerCase().contains(normalizedOp) ||
                    op.email.toLowerCase().contains(normalizedOp))
                .toList();

            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  16,
                  14,
                  16,
                  MediaQuery.of(sheetContext).viewInsets.bottom + 16,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Назначить БИН',
                      style: theme.textTheme.titleLarge,
                    ),
                    const SizedBox(height: 10),
                    // BIN info card
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceVariant
                            .withOpacity(0.35),
                        borderRadius: BorderRadius.circular(AppRadii.field),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  unassignedBin.bin,
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: unassignedBin.hasContract
                                      ? brandPrimaryGreen.withOpacity(0.1)
                                      : theme.colorScheme.error.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  unassignedBin.hasContract ? 'С договором' : 'Без договора',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: unassignedBin.hasContract ? brandPrimaryGreen : theme.colorScheme.error,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (unassignedBin.openDialogs > 0) ...[
                            const SizedBox(height: 4),
                            Text(
                              '${unassignedBin.openDialogs} ${_pluralizeDialogs(unassignedBin.openDialogs)}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                          if (binInfo != null &&
                              (binInfo!.customerLegalAddress ?? '')
                                  .isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              'Адрес: ${binInfo!.customerLegalAddress}',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Выберите сотрудника:',
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      decoration: const InputDecoration(
                        labelText: 'Поиск сотрудника',
                        prefixIcon: Icon(Icons.person_search_outlined),
                        isDense: true,
                      ),
                      onChanged: (value) =>
                          setModalState(() => operatorSearchQuery = value),
                    ),
                    const SizedBox(height: 8),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 300),
                      child: filteredOperators.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                'Нет сотрудников по запросу.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant),
                              ),
                            )
                          : ListView.separated(
                        shrinkWrap: true,
                        itemCount: filteredOperators.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: 6),
                        itemBuilder: (_, index) {
                          final op = filteredOperators[index];
                          return ListTile(
                            contentPadding:
                                const EdgeInsets.symmetric(horizontal: 12),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(AppRadii.field)),
                            tileColor: theme.colorScheme.surfaceVariant
                                .withOpacity(0.25),
                            leading: CircleAvatar(
                              radius: 16,
                              backgroundColor: theme.colorScheme.primary
                                  .withOpacity(0.15),
                              child: Text(
                                op.name.isNotEmpty
                                    ? op.name[0].toUpperCase()
                                    : '?',
                                style: TextStyle(
                                  color: theme.colorScheme.primary,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            title: Text(op.name),
                            subtitle: Text(
                              op.email ?? '',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall,
                            ),
                            onTap: () async {
                              Navigator.of(sheetContext).pop();
                              final assignment =
                                  await _showBinAssignmentSheet(
                                user: op,
                                bin: unassignedBin.bin,
                              );
                              if (assignment == null) return;
                              final next =
                                  List<UserBinAssignment>.from(
                                      op.binAssignments)
                                    ..add(assignment);
                              await _updateUserBins(op, next);
                              await refreshAdminData(showLoading: false);
                            },
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
      },
    );

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
                      borderRadius: BorderRadius.circular(AppRadii.field),
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
                        borderRadius: BorderRadius.circular(AppRadii.field),
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

    final baseTheme = Theme.of(context);
    final colorScheme = baseTheme.colorScheme;
    final theme = baseTheme.copyWith(
      cardTheme: baseTheme.cardTheme.copyWith(
        elevation: 1,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.card),
        ),
        shadowColor: colorScheme.shadow.withValues(alpha: 0.08),
        color: colorScheme.surface.withValues(alpha: 0.97),
      ),
    );

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

    final totalBinsCount = _binsDetailed.isNotEmpty ? _binsDetailed.length : allAvailableBins.length;
    final withoutContractCount = _organizationsWithoutContracts.length;
    final withContractCount = _binsDetailed.where((item) => item.hasContract).length;

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
      const SizedBox(height: 10),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
              childAspectRatio: 2.4,
              children: [
                _AdminStatTile(
                  label: 'Все БИНы',
                  value: totalBinsCount.toString(),
                  icon: Icons.apartment_outlined,
                  enabled: totalBinsCount > 0,
                  onTap: _logButtonPress('open all bins sheet', () => _openAllBinsSheet(theme)),
                ),
                _AdminStatTile(
                  label: 'Без договора',
                  value: withoutContractCount.toString(),
                  icon: Icons.warning_amber_rounded,
                  enabled: withoutContractCount > 0,
                  onTap: _logButtonPress(
                    'open organizations without contracts sheet',
                    () => _openOrganizationsWithoutContractsSheet(theme),
                  ),
                ),
                _AdminStatTile(
                  label: 'С договором',
                  value: withContractCount.toString(),
                  icon: Icons.verified_outlined,
                  enabled: withContractCount > 0,
                  onTap: _logButtonPress(
                    'open with contract bins sheet',
                    () => _openWithContractBinsSheet(theme),
                  ),
                ),
                _AdminStatTile(
                  label: 'Регистрации',
                  value: _pendingRegistrations.length.toString(),
                  icon: Icons.person_add_alt_1_outlined,
                  enabled: _pendingRegistrations.isNotEmpty,
                  onTap: _logButtonPress(
                    'open pending registrations menu from stat',
                    () => _openPendingRegistrationsMenu(theme),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      const SizedBox(height: 14),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Card(
          margin: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadii.card),
            onTap: _unassignedBins.isNotEmpty
                ? _logButtonPress('open unassigned bins sheet', () => _openUnassignedBinsSheet(theme))
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: colorScheme.primary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(AppRadii.control),
                    ),
                    child: Icon(Icons.link_off_rounded, size: 18, color: colorScheme.primary),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Неразделенные БИНы',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _unassignedBins.isEmpty
                              ? 'Все БИНы закреплены'
                              : '${_unassignedBins.length} ${_unassignedBins.length == 1 ? 'БИН' : 'БИНов'} без оператора',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_unassignedBins.isNotEmpty) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: colorScheme.error.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${_unassignedBins.length}',
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: colorScheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Icon(Icons.chevron_right_rounded, size: 22, color: colorScheme.onSurfaceVariant),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),

      const SizedBox(height: 14),
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

          Widget buildInfoChip(IconData icon, String label) {
            return SizedBox(
              height: 32,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(AppRadii.field),
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
                        CircleAvatar(
                          radius: 18,
                          backgroundColor: colorScheme.primary.withValues(alpha: 0.1),
                          child: Text(
                            user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: colorScheme.primary,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
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
                        IconButton(
                          tooltip: 'Reset password',
                          icon: const Icon(Icons.lock_reset),
                          onPressed: _logButtonPress(
                            'reset user password from header',
                            (isUpdating || isDeleting) ? null : () => _promptResetPassword(user),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // === ROW: email (left) + role (right) ===
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: buildInfoChip(Icons.email_outlined, user.email),
                        ),
                        const SizedBox(width: 8),
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
                      const SizedBox(height: 10),

                      Row(
                        children: [
                          Expanded(
                            child: SizedBox(
                              height: 36,
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.dashboard_customize_outlined),
                                label: Text('Разделы: ${user.sections.length}'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(horizontal: 10),
                                  visualDensity: VisualDensity.compact,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.control)),
                                ),
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
                              height: 36,
                              child: OutlinedButton.icon(
                                icon: const Icon(Icons.apartment_outlined),
                                label: Text('БИНы: ${user.binAssignments.length}'),
                                style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(horizontal: 10),
                                  visualDensity: VisualDensity.compact,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.control)),
                                ),
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

    return Theme(
      data: theme,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_error!, style: const TextStyle(color: brandAccentAlert)),
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
      ),
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
    final colorScheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: AppSurfaces.dashboardCard(colorScheme),
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: AppSurfaces.dashboardCardBorder(colorScheme)),
          boxShadow: [
            BoxShadow(
              color: AppSurfaces.dashboardCardShadow(colorScheme),
              blurRadius: 14,
              offset: const Offset(0, 4),
            ),
          ],
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              colorScheme.primary.withValues(alpha: 0.06),
              AppSurfaces.dashboardCard(colorScheme),
            ],
          ),
        ),
        padding: const EdgeInsets.only(top: 24, bottom: 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              onTap: _pickProfileImage,
              child: Stack(
                alignment: Alignment.bottomRight,
                children: [
                  Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: colorScheme.outlineVariant.withValues(alpha: 0.45),
                        width: 2,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: colorScheme.shadow.withValues(alpha: 0.12),
                          blurRadius: 16,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: CircleAvatar(
                      radius: 52,
                      backgroundColor: colorScheme.surfaceContainerHighest.withValues(alpha: 0.7),
                      backgroundImage: avatar,
                      child: avatar == null
                          ? const Icon(Icons.person, size: 48, color: brandPrimaryGreen)
                          : null,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: brandPrimaryGreen,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppSurfaces.dashboardCard(colorScheme), width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: brandPrimaryGreen.withValues(alpha: 0.3),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: const Icon(Icons.camera_alt_rounded, size: 16, color: Colors.white),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Text(
              _displayName.isEmpty ? 'Профиль' : _displayName,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(
                color: colorScheme.onSurface,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
              ),
            ),
            if (jobTitle.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  jobTitle,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
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

    return _FocusableFieldCard(
      readOnly: readOnly,
      child: (isFocused) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadii.field),
          color: isFocused
              ? brandPrimaryGreen.withValues(alpha: 0.08)
              : theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.24),
          border: Border.all(
            color: isFocused
                ? brandPrimaryGreen.withValues(alpha: 0.55)
                : theme.colorScheme.outlineVariant.withValues(alpha: 0.35),
            width: isFocused ? 1.2 : 1.0,
          ),
        ),
        child: TextFormField(
          controller: controller,
          readOnly: readOnly,
          minLines: minLines,
          maxLines: maxLines,
          keyboardType: keyboardType,
          textCapitalization: textCapitalization,
          validator: validator,
          style: theme.textTheme.bodyLarge,
          decoration: InputDecoration(
            labelText: label,
            hintText: hint,
            prefixIcon: Icon(
              icon,
              color: isFocused
                  ? brandPrimaryGreen
                  : (readOnly ? theme.colorScheme.onSurfaceVariant : brandPrimaryGreen),
              size: 22,
            ),
            suffixIcon: readOnly
                ? Icon(
                    Icons.lock_outline,
                    size: 16,
                    color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.4),
                  )
                : null,
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            contentPadding: const EdgeInsets.symmetric(vertical: 14),
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
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.35),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, size: 22, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: theme.textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        ],
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
    final colorScheme = theme.colorScheme;

    return RefreshIndicator(
      onRefresh: () => refreshProfile(showLoading: false),
      child: DecoratedBox(
        decoration: BoxDecoration(gradient: AppSurfaces.dashboardBg(colorScheme)),
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildProfileHeader(theme),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Container(
                  decoration: BoxDecoration(
                    color: AppSurfaces.dashboardCard(colorScheme),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: AppSurfaces.dashboardCardBorder(colorScheme)),
                    boxShadow: [
                      BoxShadow(
                        color: AppSurfaces.dashboardCardShadow(colorScheme),
                        blurRadius: 14,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
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
                          label: 'Логин',
                          icon: Icons.lock_person_outlined,
                          readOnly: true,
                        ),
                        _buildTextFieldCard(
                          controller: _jobTitleController,
                          label: 'Должность',
                          icon: Icons.assignment_ind_outlined,
                          textCapitalization: TextCapitalization.sentences,
                        ),
                        _buildTextFieldCard(
                          controller: _phoneController,
                          label: 'Телефон',
                          icon: Icons.phone_iphone,
                          keyboardType: TextInputType.phone,
                        ),
                        _buildTextFieldCard(
                          controller: _bioController,
                          label: 'О себе',
                          icon: Icons.description_outlined,
                          minLines: 1,
                          maxLines: 5,
                          keyboardType: TextInputType.multiline,
                          textCapitalization: TextCapitalization.sentences,
                        ),
                        if (profile != null) ...[
                          const SizedBox(height: 8),
                          _buildInfoTile(
                            icon: Icons.calendar_month_outlined,
                            label: 'Аккаунт создан',
                            value: DateFormat('dd.MM.yyyy HH:mm').format(profile.createdAt.toLocal()),
                          ),
                          _buildInfoTile(
                            icon: Icons.verified_user_outlined,
                            label: 'Роль',
                            value: profile.roleLabel,
                          ),
                          if (!isAdmin) ...[
                            const SizedBox(height: 8),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(AppRadii.card),
                                border: Border.all(
                                  color: theme.colorScheme.outlineVariant.withValues(alpha: 0.35),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Icon(Icons.dashboard_customize_outlined, size: 20, color: brandPrimaryGreen),
                                      const SizedBox(width: 8),
                                      Text(
                                        'Разделы',
                                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  if (profile.sections.isEmpty)
                                    Text(
                                      'Не назначены',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    )
                                  else
                                    Wrap(
                                      spacing: 6,
                                      runSpacing: 4,
                                      children: profile.sections.map((sectionId) {
                                        final match = _sections.firstWhere(
                                          (s) => s.id == sectionId,
                                          orElse: () => Section(id: sectionId, title: sectionId),
                                        );
                                        return Chip(
                                          label: Text(match.title, style: const TextStyle(fontSize: 12)),
                                          padding: EdgeInsets.zero,
                                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                          visualDensity: VisualDensity.compact,
                                        );
                                      }).toList(),
                                    ),
                                  const SizedBox(height: 14),
                                  Row(
                                    children: [
                                      Icon(Icons.business_center_outlined, size: 20, color: brandPrimaryGreen),
                                      const SizedBox(width: 8),
                                      Text(
                                        'БИНы',
                                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  if (profile.binAssignments.isEmpty)
                                    Text(
                                      'Не назначены',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    )
                                  else
                                    Wrap(
                                      spacing: 6,
                                      runSpacing: 4,
                                      children: profile.binAssignments.map((assignment) {
                                        final expiresLabel = assignment.expiresAt != null
                                            ? 'до ${DateFormat('dd.MM.yyyy HH:mm').format(assignment.expiresAt!.toLocal())}'
                                            : 'бессрочно';
                                        return Chip(
                                          label: Column(
                                            mainAxisSize: MainAxisSize.min,
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(assignment.bin, style: const TextStyle(fontSize: 12)),
                                              Text(
                                                expiresLabel,
                                                style: theme.textTheme.bodySmall?.copyWith(
                                                  fontSize: 10,
                                                  color: theme.colorScheme.onSurfaceVariant,
                                                ),
                                              ),
                                            ],
                                          ),
                                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                          visualDensity: VisualDensity.compact,
                                        );
                                      }).toList(),
                                    ),
                                ],
                              ),
                            ),
                          ],
                          _buildInfoTile(
                            icon: Icons.star_outline,
                            label: 'Избранные диалоги',
                            value: profile.favoriteDialogIds.length.toString(),
                          ),
                        ],
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: brandAccentAlert.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(AppRadii.control),
                              ),
                              child: Text(_error!, style: TextStyle(color: theme.colorScheme.error, fontSize: 13)),
                            ),
                          ),
                        if (_successMessage != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Container(
                              width: double.infinity,
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: brandPrimaryGreen.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(AppRadii.control),
                              ),
                              child: Text(
                                _successMessage!,
                                style: const TextStyle(color: brandPrimaryGreen, fontSize: 13),
                              ),
                            ),
                          ),
                        const SizedBox(height: 20),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: FilledButton(
                            onPressed: _logButtonPress('save profile changes', _saving ? null : _save),
                            style: FilledButton.styleFrom(
                              backgroundColor: brandPrimaryGreen,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.field)),
                            ),
                            child: _saving
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                  )
                                : const Text('Сохранить', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                          ),
                        ),
                        const SizedBox(height: 10),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: TextButton.icon(
                            onPressed: _logButtonPress('change own password', _saving ? null : _changeOwnPassword),
                            icon: const Icon(Icons.lock_outline, size: 18),
                            label: const Text('Сменить пароль'),
                            style: TextButton.styleFrom(
                              foregroundColor: theme.colorScheme.onSurfaceVariant,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(AppRadii.field),
                                side: BorderSide(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FocusableFieldCard extends StatefulWidget {
  const _FocusableFieldCard({
    required this.readOnly,
    required this.child,
  });

  final bool readOnly;
  final Widget Function(bool isFocused) child;

  @override
  State<_FocusableFieldCard> createState() => _FocusableFieldCardState();
}

class _FocusableFieldCardState extends State<_FocusableFieldCard> {
  bool _isFocused = false;

  @override
  Widget build(BuildContext context) {
    if (widget.readOnly) return widget.child(false);

    return Focus(
      onFocusChange: (focused) => setState(() => _isFocused = focused),
      child: widget.child(_isFocused),
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
            borderRadius: BorderRadius.circular(AppRadii.field),
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
            borderRadius: BorderRadius.circular(AppRadii.field),
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
















