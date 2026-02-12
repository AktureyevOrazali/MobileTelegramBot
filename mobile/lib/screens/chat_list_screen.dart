part of '../main.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({
    required this.apiClient,
    required this.session,
    required this.onLogout,
    required this.onProfileUpdated,
    required this.onSessionRefreshed,
    required this.themeMode,
    required this.onThemeModeChanged,
    super.key,
  });

  final ApiClient apiClient;
  final AuthSession session;
  final VoidCallback onLogout;
  final ValueChanged<UserProfile> onProfileUpdated;
  final ValueChanged<AuthSession> onSessionRefreshed;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

enum ChatSortOrder { newest, oldest }

enum DialogStatusFilter { all, open, closed }

class _ChatFiltersResult {
  _ChatFiltersResult({
    required this.section,
    required this.bin,
    required this.favoritesOnly,
    required this.sortOrder,
    required this.statusFilter,
  });

  final String? section;
  final String? bin;
  final bool favoritesOnly;
  final ChatSortOrder sortOrder;
  final DialogStatusFilter statusFilter;
}

class _ChatListScreenState extends State<ChatListScreen> {
  List<ChatSummary> _allChats = [];
  List<Section> _sections = [];
  List<String> _availableBins = [];
  String? _selectedSection;
  String? _selectedBin;
  bool _loading = true;
  String? _error;
  String _activeTabKey = 'dialogs';
  bool _showFavoritesOnly = false;
  ChatSortOrder _sortOrder = ChatSortOrder.newest;
  DialogStatusFilter _statusFilter = DialogStatusFilter.all;
  int? _aiTogglingDialogId;
  int? _statusUpdatingDialogId;
  Timer? _updatesTimer;
  DateTime? _lastUpdateCursor;
  final GlobalKey<_OperatorProfileViewState> _profileKey =
      GlobalKey<_OperatorProfileViewState>();
  final GlobalKey<_AdminUserManagementViewState> _adminKey =
      GlobalKey<_AdminUserManagementViewState>();
  final GlobalKey<_DashboardViewState> _dashboardKey =
      GlobalKey<_DashboardViewState>();

  void _dismissKeyboard() {
    FocusManager.instance.primaryFocus?.unfocus();
  }

  @override
  void initState() {
    super.initState();
    UiLogger.page('Chat list');
    _loadData();
    _loadAvailableBins();
    _updatesTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _pollUpdates(),
    );
  }

  @override
  void dispose() {
    _updatesTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData({bool showLoading = true}) async {
    UiLogger.action(
      'CHATS',
      'loading list',
      details: {
        'favoritesOnly': _showFavoritesOnly,
        'section': _selectedSection ?? 'all',
        'bin': _selectedBin ?? 'all',
      },
    );

    if (showLoading) {
      if (!mounted) return;
      setState(() {
        _loading = true;
        _error = null;
      });
    } else {
      if (!mounted) return;
      setState(() {
        _error = null;
      });
    }

    try {
      final sections = await widget.apiClient.fetchSections();
      final chats = await widget.apiClient.fetchChats(
        favoritesOnly: _showFavoritesOnly,
        binQuery: _selectedBin,
      );

      if (!mounted) return;

      final currentUser = widget.apiClient.currentUser ?? widget.session.user;
      final visibleSections = currentUser.isAdmin
          ? sections
          : sections
              .where((section) => currentUser.sections.contains(section.id))
              .toList();

      setState(() {
        _sections = visibleSections;
        _allChats = chats;
        _loading = false;
        if (_selectedSection != null &&
            !_sections.any((section) => section.id == _selectedSection)) {
          _selectedSection = null;
        }
      });

      UiLogger.action('CHATS', 'loaded', details: {'count': chats.length});
      _lastUpdateCursor ??= DateTime.now().toUtc();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
      UiLogger.action(
        'CHATS',
        'load failed',
        details: {'reason': error.toString()},
      );
    }
  }

  Future<void> _loadAvailableBins() async {
    try {
      final bins = await widget.apiClient.fetchBins();
      if (!mounted) return;
      setState(() {
        _availableBins = bins;
      });
      UiLogger.action(
        'FILTERS',
        'bins loaded',
        details: {'count': bins.length},
      );
    } catch (error) {
      debugPrint('Не удалось загрузить БИНы: $error');
    }
  }

  void _showUpdateBanner(String message) {
    showTopMessage(context, message, icon: Icons.notifications_active_outlined);
  }

  Future<void> _pollUpdates() async {
    try {
      if (_lastUpdateCursor == null) {
        _lastUpdateCursor = DateTime.now().toUtc();
        return;
      }
      final updates = await widget.apiClient.fetchUpdates(_lastUpdateCursor);
      if (updates.isEmpty) {
        return;
      }
      _lastUpdateCursor = updates.last.createdAt.toUtc();
      if (!mounted) {
        return;
      }
      await _loadData(showLoading: false);
      if (!mounted) {
        return;
      }
      UiLogger.action(
        'CHATS',
        'new updates',
        details: {'count': updates.length},
      );
      final message = updates.length == 1
          ? 'Новое сообщение: ${updates.first.chatTitle}'
          : 'Новых сообщений: ${updates.length}';
      _showUpdateBanner(message);
    } catch (error) {
      debugPrint('Не удалось получить обновления: $error');
    }
  }

  Future<void> _toggleFavorite(ChatSummary chat) async {
    final newValue = !chat.isFavorite;
    if (!mounted) return;
    setState(() {
      _allChats = _allChats
          .map(
            (item) => item.dialogId == chat.dialogId
                ? item.copyWith(isFavorite: newValue)
                : item,
          )
          .toList();
    });
    try {
      await widget.apiClient.setFavoriteDialog(chat.dialogId, newValue);
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        newValue
            ? 'Диалог добавлен в избранное'
            : 'Диалог удалён из избранного',
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _allChats = _allChats
            .map(
              (item) => item.dialogId == chat.dialogId
                  ? item.copyWith(isFavorite: !newValue)
                  : item,
            )
            .toList();
      });
      showTopMessage(
        context,
        'Не удалось обновить избранное: $error',
        isError: true,
      );
    }
  }

  void _applyDialogStatusUpdate(DialogStatusUpdate update) {
    if (!mounted) return;
    setState(() {
      _allChats = _allChats
          .map(
            (item) => item.dialogId == update.dialogId
                ? item.copyWith(
                    dialogClosedAt: update.dialogClosedAt,
                    aiEnabled: update.aiEnabled,
                  )
                : item,
          )
          .toList();
    });
  }

  void _updateChatAiStatus(int dialogId, bool aiEnabled) {
    if (!mounted) return;
    setState(() {
      _allChats = _allChats
          .map(
            (item) => item.dialogId == dialogId
                ? item.copyWith(aiEnabled: aiEnabled)
                : item,
          )
          .toList();
    });
  }

  Future<void> _refreshChatFromServer(int dialogId) async {
    try {
      final refreshed = await widget.apiClient.fetchChatByDialogId(dialogId);
      if (!mounted || refreshed == null) {
        return;
      }
      setState(() {
        _allChats = _allChats
            .map(
              (item) => item.dialogId == refreshed.dialogId ? refreshed : item,
            )
            .toList();
      });
    } catch (_) {
      // тихо игнорируем
    }
  }

  Future<void> _toggleAi(ChatSummary chat) async {
    if (!mounted) return;
    setState(() {
      _aiTogglingDialogId = chat.dialogId;
    });
    try {
      if (chat.aiEnabled) {
        await widget.apiClient.disableDialogAI(chat.dialogId);
        _updateChatAiStatus(chat.dialogId, false);
        showTopMessage(
          context,
          'AI помощник отключён. Клиенту отправлено уведомление.',
        );
      } else {
        await widget.apiClient.enableDialogAI(chat.dialogId);
        _updateChatAiStatus(chat.dialogId, true);
        showTopMessage(context, 'AI помощник включён для этого диалога.');
      }
      await _refreshChatFromServer(chat.dialogId);
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить режим AI: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _aiTogglingDialogId = null;
        });
      }
    }
  }

  Future<void> _toggleDialogStatus(ChatSummary chat) async {
    if (!mounted) return;
    setState(() {
      _statusUpdatingDialogId = chat.dialogId;
    });
    try {
      final wasClosed = chat.isClosed;
      final result = wasClosed
          ? await widget.apiClient.openDialog(chat.dialogId)
          : await widget.apiClient.closeDialog(chat.dialogId);
      _applyDialogStatusUpdate(result);
      if (!mounted) {
        return;
      }
      await _refreshChatFromServer(chat.dialogId);
      showTopMessage(
        context,
        wasClosed
            ? 'Диалог открыт снова и готов к сообщениям.'
            : 'Диалог закрыт. Клиент уведомлён и AI снова включён.',
      );
    } catch (error) {
      showTopMessage(
        context,
        'Не удалось обновить статус диалога: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          _statusUpdatingDialogId = null;
        });
      }
    }
  }

  Future<void> _confirmDeleteChat(ChatSummary chat) async {
    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить диалог?'),
          content: Text(
            'Переписка с "${chat.title}" будет удалена без возможности восстановления.',
          ),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel delete dialog',
                () => Navigator.of(dialogContext).pop(false),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'confirm delete dialog',
                () => Navigator.of(dialogContext).pop(true),
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
    try {
      await widget.apiClient.deleteChat(chat.chatId);
      if (!mounted) {
        return;
      }
      setState(() {
        _allChats =
            _allChats.where((item) => item.chatId != chat.chatId).toList();
      });
      showTopMessage(context, 'Диалог "${chat.title}" удалён.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        'Не удалось удалить диалог: $error',
        isError: true,
      );
    }
  }

  List<ChatSummary> get _filteredChats {
    Iterable<ChatSummary> result = _allChats;
    if (_selectedSection != null && _selectedSection!.isNotEmpty) {
      result = result.where((chat) => chat.section == _selectedSection);
    }
    if (_showFavoritesOnly) {
      result = result.where((chat) => chat.isFavorite);
    }
    if (_statusFilter == DialogStatusFilter.open) {
      result = result.where((chat) => !chat.isClosed);
    } else if (_statusFilter == DialogStatusFilter.closed) {
      result = result.where((chat) => chat.isClosed);
    }
    final sorted = result.toList()
      ..sort((a, b) {
        final diff = a.updatedAt.compareTo(b.updatedAt);
        return _sortOrder == ChatSortOrder.newest ? -diff : diff;
      });
    return sorted;
  }

  Future<void> _showFiltersSheet() async {
    final result = await showThemedBottomSheet<_ChatFiltersResult>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) {
        String? section = _selectedSection;
        String? bin = _selectedBin;
        bool favorites = _showFavoritesOnly;
        ChatSortOrder sort = _sortOrder;
        DialogStatusFilter status = _statusFilter;
        return StatefulBuilder(
          builder: (context, setModalState) {
            final bottomInset = MediaQuery.of(context).viewInsets.bottom;
            final theme = Theme.of(context);
            return Padding(
              padding: EdgeInsets.only(bottom: bottomInset),
              child: SafeArea(
                top: false,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 36,
                          height: 4,
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.outlineVariant,
                            borderRadius: BorderRadius.circular(100),
                          ),
                        ),
                      ),
                      Text(
                        'Фильтры диалогов',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String?>(
                        value: section,
                        decoration: const InputDecoration(labelText: 'Раздел'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Все разделы'),
                          ),
                          ..._sections.map(
                            (item) => DropdownMenuItem<String?>(
                              value: item.id,
                              child: Text(item.title),
                            ),
                          ),
                        ],
                        onChanged: (value) =>
                            setModalState(() => section = value),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        value: bin,
                        decoration: const InputDecoration(labelText: 'БИН'),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('Все БИНы'),
                          ),
                          ..._availableBins.map(
                            (item) => DropdownMenuItem<String?>(
                              value: item,
                              child: Text(item),
                            ),
                          ),
                        ],
                        onChanged: (value) => setModalState(() => bin = value),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<DialogStatusFilter>(
                        value: status,
                        decoration: const InputDecoration(
                          labelText: 'Статус диалога',
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: DialogStatusFilter.all,
                            child: Text('Все диалоги'),
                          ),
                          DropdownMenuItem(
                            value: DialogStatusFilter.open,
                            child: Text('Только открытые'),
                          ),
                          DropdownMenuItem(
                            value: DialogStatusFilter.closed,
                            child: Text('Только закрытые'),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          setModalState(() => status = value);
                        },
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<ChatSortOrder>(
                        value: sort,
                        decoration: const InputDecoration(
                          labelText: 'Сортировка по времени',
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: ChatSortOrder.newest,
                            child: Text('Сначала новые'),
                          ),
                          DropdownMenuItem(
                            value: ChatSortOrder.oldest,
                            child: Text('Сначала старые'),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          setModalState(() => sort = value);
                        },
                      ),
                      const SizedBox(height: 12),
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Только избранные'),
                        value: favorites,
                        onChanged: (value) =>
                            setModalState(() => favorites = value),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          TextButton(
                            onPressed: _logButtonPress(
                              'reset chat filters',
                              () {
                                setModalState(() {
                                  section = null;
                                  bin = null;
                                  favorites = false;
                                  sort = ChatSortOrder.newest;
                                  status = DialogStatusFilter.all;
                                });
                              },
                            ),
                            child: const Text('Сбросить'),
                          ),
                          const Spacer(),
                          FilledButton(
                            onPressed: _logButtonPress(
                              'apply chat filters',
                              () {
                                Navigator.of(sheetContext).pop(
                                  _ChatFiltersResult(
                                    section: section,
                                    bin: bin,
                                    favoritesOnly: favorites,
                                    sortOrder: sort,
                                    statusFilter: status,
                                  ),
                                );
                              },
                            ),
                            child: const Text('Применить'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );

    if (result == null) return;

    final shouldReload = result.bin != _selectedBin ||
        result.favoritesOnly != _showFavoritesOnly;
    if (!mounted) return;
    setState(() {
      _selectedSection = result.section;
      _selectedBin = result.bin;
      _showFavoritesOnly = result.favoritesOnly;
      _sortOrder = result.sortOrder;
      _statusFilter = result.statusFilter;
    });
    if (shouldReload) {
      await _loadData(showLoading: true);
    }
  }

  PreferredSizeWidget _buildAppBar(int index, bool isAdmin) {
    final platformBrightness = MediaQuery.of(context).platformBrightness;
    final isDarkModeActive = widget.themeMode == ThemeMode.dark ||
        (widget.themeMode == ThemeMode.system &&
            platformBrightness == Brightness.dark);
    final themeToggleIcon =
        isDarkModeActive ? Icons.light_mode : Icons.dark_mode;
    final themeToggleTooltip =
        isDarkModeActive ? 'Светлый режим' : 'Тёмный режим';
    final nextMode = isDarkModeActive ? ThemeMode.light : ThemeMode.dark;

    final themeButton = IconButton(
      tooltip: themeToggleTooltip,
      icon: Icon(themeToggleIcon),
      onPressed: _logButtonPress(
        'toggle theme from app bar',
        () => widget.onThemeModeChanged(nextMode),
      ),
    );
    final logoutButton = IconButton(
      tooltip: 'Выход',
      icon: const Icon(Icons.logout),
      onPressed: _logButtonPress('logout', widget.onLogout),
    );

    Widget buildChatAppBar() {
      return AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Диалоги'),
        actions: [themeButton, logoutButton],
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: AppGradients.appBar(Theme.of(context).colorScheme),
          ),
        ),
      );
    }

    Widget buildProfileAppBar() {
      return AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Профиль'),
        actions: [themeButton, logoutButton],
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: AppGradients.appBar(Theme.of(context).colorScheme),
          ),
        ),
      );
    }

    if (!isAdmin) {
      return (index == 0 ? buildChatAppBar() : buildProfileAppBar())
          as PreferredSizeWidget;
    }

    if (index == 0) {
      return buildChatAppBar() as PreferredSizeWidget;
    }
    if (index == 1) {
      return AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Дэшборд обращений'),
        actions: [themeButton, logoutButton],
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: AppGradients.appBar(Theme.of(context).colorScheme),
          ),
        ),
      );
    }
    if (index == 2) {
      return AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Администрирование'),
        actions: [themeButton, logoutButton],
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient: AppGradients.appBar(Theme.of(context).colorScheme),
          ),
        ),
      );
    }
    return buildProfileAppBar() as PreferredSizeWidget;
  }

  Widget _buildChatTab() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Ошибка: $_error'),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () =>
                  _logButtonPress('retry load chats', () => _loadData()),
              child: const Text('Повторить попытку'),
            ),
          ],
        ),
      );
    }

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final String? sectionTitle = _selectedSection == null
        ? null
        : _sections
            .firstWhere(
              (section) => section.id == _selectedSection,
              orElse: () => Section(
                id: _selectedSection!,
                title: _selectedSection!,
              ),
            )
            .title;

    final statusLabel = () {
      switch (_statusFilter) {
        case DialogStatusFilter.open:
          return 'Только открытые';
        case DialogStatusFilter.closed:
          return 'Только закрытые';
        case DialogStatusFilter.all:
          return null;
      }
    }();

    final chips = <Widget>[];
    if (sectionTitle != null && sectionTitle.isNotEmpty) {
      chips.add(
        InputChip(
          label: Text('Раздел: $sectionTitle'),
          onDeleted: () {
            setState(() {
              _selectedSection = null;
            });
          },
        ),
      );
    }
    if (_selectedBin != null && _selectedBin!.isNotEmpty) {
      chips.add(
        InputChip(
          label: Text('БИН: ${_selectedBin!}'),
          onDeleted: () {
            setState(() {
              _selectedBin = null;
            });
            unawaited(_loadData(showLoading: false));
          },
        ),
      );
    }
    if (statusLabel != null) {
      chips.add(
        InputChip(
          label: Text(statusLabel),
          onDeleted: () {
            setState(() {
              _statusFilter = DialogStatusFilter.all;
            });
          },
        ),
      );
    }
    if (_sortOrder == ChatSortOrder.oldest) {
      chips.add(
        InputChip(
          label: const Text('Сначала старые'),
          onDeleted: () {
            setState(() {
              _sortOrder = ChatSortOrder.newest;
            });
          },
        ),
      );
    }
    if (_showFavoritesOnly) {
      chips.add(
        InputChip(
          label: const Text('Только избранные'),
          onDeleted: () {
            setState(() {
              _showFavoritesOnly = false;
            });
            unawaited(_loadData(showLoading: false));
          },
        ),
      );
    }

    final filtersCard = Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppGradients.surfaceOverlay(colorScheme),
          borderRadius: BorderRadius.circular(18),
          border:
              Border.all(color: colorScheme.outlineVariant.withOpacity(0.35)),
          boxShadow: [
            BoxShadow(
              color: colorScheme.shadow.withOpacity(0.04),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Фильтры',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _logButtonPress(
                      'open chat filters',
                      _showFiltersSheet,
                    ),
                    icon: const Icon(Icons.tune_rounded, size: 16),
                    label: const Text('Настроить'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (chips.isEmpty)
                Text(
                  'Активные фильтры отсутствуют',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                )
              else
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: chips
                        .map(
                          (chip) => Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: chip,
                          ),
                        )
                        .toList(),
                  ),
                ),
            ],
          ),
        ),
      ),
    );

    final chats = _filteredChats;
    final currentUser = widget.apiClient.currentUser ?? widget.session.user;
    final canDeleteChats = currentUser.isAdmin || currentUser.canReply;
    final canManageDialogs = currentUser.canReply;

    final listChildren = <Widget>[
      filtersCard,
      if (chats.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 48),
          child: Column(
            children: [
              Icon(
                Icons.forum_outlined,
                size: 48,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 12),
              Text('Нет активных диалогов', style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(
                'Сообщения из MobileBot появятся здесь автоматически.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        )
      else
        ...chats.map((chat) {
          final statusLabel = chat.isClosed ? 'Закрыт' : 'Открыт';
          final statusColors = _statusBadgeColors(
            theme,
            isClosed: chat.isClosed,
          );
          final aiColors = _aiBadgeColors(theme, enabled: chat.aiEnabled);
          final isStatusUpdating = _statusUpdatingDialogId == chat.dialogId;
          final isAiUpdating = _aiTogglingDialogId == chat.dialogId;

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            child: Card(
              clipBehavior: Clip.antiAlias,
              elevation: 1,
              shadowColor: theme.extension<AppColors>()?.accentGlow ?? Colors.transparent,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: colorScheme.outlineVariant.withOpacity(0.3),
                ),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () async {
                  UiLogger.navigation(
                    'chat_list',
                    'chat_detail',
                    details: {'chat': chat.title, 'dialogId': chat.dialogId},
                  );

                  // ВАЖНО: фиксируем "правильную" тему модуля ДО пуша
                  final moduleTheme = _ensureAppColorsTheme(Theme.of(context));

                  final chatToOpen = chat.unreadCount > 0
                      ? chat.copyWith(unreadCount: 0)
                      : chat;

                  if (chat.unreadCount > 0) {
                    setState(() {
                      _allChats = _allChats
                          .map(
                            (item) => item.dialogId == chat.dialogId
                                ? item.copyWith(unreadCount: 0)
                                : item,
                          )
                          .toList();
                    });
                  }

                  final deleted = await Navigator.of(context).push<bool>(
                    MaterialPageRoute(
                      builder: (_) => Theme(
                        data: moduleTheme,
                        child: ChatDetailScreen(
                          apiClient: widget.apiClient,
                          chat: chatToOpen,
                        ),
                      ),
                    ),
                  );

                  if (!mounted) return;

                  if (deleted == true) {
                    setState(() {
                      _allChats = _allChats
                          .where((item) => item.chatId != chat.chatId)
                          .toList();
                    });
                  } else {
                    await _loadData(showLoading: false);
                  }
                },
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
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
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.center,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        chat.title,
                                        style: theme.textTheme.titleMedium
                                            ?.copyWith(
                                          fontWeight: FontWeight.w600,
                                        ),
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    if (chat.unreadCount > 0)
                                      Container(
                                        margin: const EdgeInsets.only(left: 8),
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 4,
                                        ),
                                        decoration: BoxDecoration(
                                          color:
                                              theme.colorScheme.errorContainer,
                                          borderRadius: BorderRadius.circular(
                                            999,
                                          ),
                                          border: Border.all(
                                            color: theme.colorScheme.error
                                                .withOpacity(0.35),
                                          ),
                                        ),
                                        child: Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(
                                              Icons.mark_chat_unread,
                                              size: 16,
                                              color: theme
                                                  .colorScheme.onErrorContainer,
                                            ),
                                            const SizedBox(width: 6),
                                            Text(
                                              '${chat.unreadCount}',
                                              style: theme.textTheme.labelMedium
                                                  ?.copyWith(
                                                color: theme.colorScheme
                                                    .onErrorContainer,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 6,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 6,
                                      ),
                                      decoration: BoxDecoration(
                                        color: statusColors.background,
                                        borderRadius: BorderRadius.circular(
                                          999,
                                        ),
                                        border: Border.all(
                                          color: statusColors.border,
                                          width: 1,
                                        ),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (isStatusUpdating)
                                            SizedBox(
                                              width: 14,
                                              height: 14,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: statusColors.foreground,
                                              ),
                                            )
                                          else
                                            Icon(
                                              chat.isClosed
                                                  ? Icons.lock
                                                  : Icons.lock_open,
                                              size: 14,
                                              color: statusColors.foreground,
                                            ),
                                          const SizedBox(width: 6),
                                          Text(
                                            statusLabel,
                                            style: theme.textTheme.labelSmall
                                                ?.copyWith(
                                              color: statusColors.foreground,
                                              fontWeight: FontWeight.w700,
                                              letterSpacing: 0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 10,
                                        vertical: 6,
                                      ),
                                      decoration: BoxDecoration(
                                        color: aiColors.background,
                                        borderRadius: BorderRadius.circular(
                                          999,
                                        ),
                                        border: Border.all(
                                          color: aiColors.border,
                                          width: 1,
                                        ),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (isAiUpdating)
                                            SizedBox(
                                              width: 14,
                                              height: 14,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: aiColors.foreground,
                                              ),
                                            )
                                          else
                                            Icon(
                                              chat.aiEnabled
                                                  ? Icons.smart_toy
                                                  : Icons.smart_toy_outlined,
                                              size: 14,
                                              color: aiColors.foreground,
                                            ),
                                          const SizedBox(width: 6),
                                          Text(
                                            chat.aiEnabled ? 'AI' : 'AI выкл',
                                            style: theme.textTheme.labelSmall
                                                ?.copyWith(
                                              color: aiColors.foreground,
                                              fontWeight: FontWeight.w700,
                                              letterSpacing: 0.2,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Align(
                            alignment: Alignment.topRight,
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton.filledTonal(
                                  icon: Icon(
                                    chat.isFavorite
                                        ? Icons.star
                                        : Icons.star_border,
                                  ),
                                  color: chat.isFavorite
                                      ? theme.colorScheme.tertiary
                                      : theme.colorScheme.onSurfaceVariant,
                                  tooltip: chat.isFavorite
                                      ? 'Убрать из избранного'
                                      : 'Добавить в избранное',
                                  onPressed: _logButtonPress(
                                    'toggle favorite for ${chat.title}',
                                    () => _toggleFavorite(chat),
                                  ),
                                ),
                                const SizedBox(width: 4),
                                PopupMenuButton<String>(
                                  enabled: canManageDialogs &&
                                      !isStatusUpdating &&
                                      !isAiUpdating,
                                  icon: const Icon(Icons.more_horiz_rounded),
                                  onSelected: (value) {
                                    switch (value) {
                                      case 'toggle_status':
                                        _toggleDialogStatus(chat);
                                        break;
                                      case 'toggle_ai':
                                        _toggleAi(chat);
                                        break;
                                      case 'delete':
                                        _confirmDeleteChat(chat);
                                        break;
                                    }
                                  },
                                  itemBuilder: (context) {
                                    return [
                                      PopupMenuItem(
                                        value: 'toggle_status',
                                        child: Row(
                                          children: [
                                            Icon(
                                              chat.isClosed
                                                  ? Icons.lock_open
                                                  : Icons.lock_outline,
                                              size: 18,
                                              color: theme
                                                  .colorScheme.onSurfaceVariant,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              chat.isClosed
                                                  ? 'Открыть диалог'
                                                  : 'Закрыть диалог',
                                            ),
                                          ],
                                        ),
                                      ),
                                      PopupMenuItem(
                                        value: 'toggle_ai',
                                        child: Row(
                                          children: [
                                            Icon(
                                              chat.aiEnabled
                                                  ? Icons.smart_toy
                                                  : Icons.smart_toy_outlined,
                                              size: 18,
                                              color: theme
                                                  .colorScheme.onSurfaceVariant,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              chat.aiEnabled
                                                  ? 'Отключить AI'
                                                  : 'Включить AI',
                                            ),
                                          ],
                                        ),
                                      ),
                                      if (canDeleteChats)
                                        PopupMenuItem(
                                          value: 'delete',
                                          child: Row(
                                            children: const [
                                              Icon(
                                                Icons.delete_outline,
                                                size: 18,
                                              ),
                                              SizedBox(width: 8),
                                              Text('Удалить диалог'),
                                            ],
                                          ),
                                        ),
                                    ];
                                  },
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          if (chat.sectionTitle != null) ...[
                            Icon(
                              Icons.category_outlined,
                              size: 14,
                              color: colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                chat.sectionTitle!,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ],
                          if (chat.bin != null && chat.bin!.isNotEmpty) ...[
                            if (chat.sectionTitle != null)
                              const SizedBox(width: 10),
                            Icon(
                              Icons.badge_outlined,
                              size: 14,
                              color: colorScheme.onSurfaceVariant,
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                'BIN ${chat.bin}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                          ],
                          if (chat.sectionTitle == null &&
                              (chat.bin == null || chat.bin!.isEmpty))
                            Text(
                              chat.username != null
                                  ? '@${chat.username}'
                                  : 'Тип: ${chat.type}',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: colorScheme.onSurfaceVariant,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      const SizedBox(height: 14),
    ];

    return RefreshIndicator(
      onRefresh: () => _loadData(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: listChildren,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final currentUser = widget.apiClient.currentUser ?? widget.session.user;
    final isAdmin = currentUser.isAdmin;

    // КЛЮЧЕВОЕ: применяем тему модуля ко всему экрану списка
    final moduleTheme = _ensureAppColorsTheme(Theme.of(context));

    final tabs = <Widget>[_buildChatTab()];
    final barItems = <TabItem>[
      const TabItem(
        icon: Icons.chat_bubble_outline,
        title: 'Диалоги',
        key: 'dialogs',
      ),
    ];
    final callbacks = <VoidCallback?>[() => _loadData()];

    if (isAdmin) {
      tabs.add(DashboardView(key: _dashboardKey, apiClient: widget.apiClient));
      barItems.add(
        const TabItem(
          icon: Icons.analytics_outlined,
          title: 'Дэшборд',
          key: 'dashboard',
        ),
      );
      callbacks.add(() => _dashboardKey.currentState?.reloadSummary());

      tabs.add(
        AdminUserManagementView(
          key: _adminKey,
          apiClient: widget.apiClient,
          currentUser: currentUser,
        ),
      );
      barItems.add(
        const TabItem(
          icon: Icons.admin_panel_settings_outlined,
          title: 'Администрация',
          key: 'admin',
        ),
      );
      callbacks.add(() => _adminKey.currentState?.refreshAdminData());
    }

    tabs.add(
      OperatorProfileView(
        key: _profileKey,
        apiClient: widget.apiClient,
        onProfileUpdated: widget.onProfileUpdated,
        onSessionRefreshed: widget.onSessionRefreshed,
      ),
    );
    barItems.add(
      const TabItem(
        icon: Icons.person_outline,
        title: 'Профиль',
        key: 'profile',
      ),
    );
    callbacks.add(
      () => _profileKey.currentState?.refreshProfile(showLoading: false),
    );

    String resolvedTabKey() {
      final exists = barItems.any((item) => item.key == _activeTabKey);
      return exists ? _activeTabKey : 'dialogs';
    }

    final currentTabKey = resolvedTabKey();
    final currentIndex = barItems
        .indexWhere((item) => item.key == currentTabKey)
        .clamp(0, tabs.length - 1);

    final theme = moduleTheme;
    final colorScheme = theme.colorScheme;

    final navigationBarBackgroundColor =
        colorScheme.brightness == Brightness.light
            ? colorScheme.surface.withOpacity(0.95)
            : colorScheme.surface;

    return Theme(
      data: theme,
      child: PopScope(
        canPop: false, // мы сами решаем, что делать при Back
        onPopInvoked: (didPop) async {
          if (didPop) return;
          _dismissKeyboard();

          switch (currentTabKey) {
            case 'dialogs':
              // Диалоги -> Логин
              widget.onLogout();
              break;
            case 'dashboard':
              // Дэшборд -> Диалоги
              setState(() {
                _activeTabKey = 'dialogs';
              });
              break;
            case 'admin':
              // Администрация -> Диалоги
              setState(() {
                _activeTabKey = 'dialogs';
              });
              break;
            case 'profile':
              // Профиль -> Диалоги
              setState(() {
                _activeTabKey = 'dialogs';
              });
              break;
            default:
              // Любой неизвестный экран -> Диалоги
              setState(() {
                _activeTabKey = 'dialogs';
              });
          }
        },

        child: Scaffold(
          appBar: _buildAppBar(currentIndex, isAdmin),
          body: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: _dismissKeyboard,
            child: IndexedStack(index: currentIndex, children: tabs),
          ),
          bottomNavigationBar: Padding(
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 8),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: navigationBarBackgroundColor,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: colorScheme.outlineVariant.withOpacity(0.45),
                ),
                boxShadow: [
                  BoxShadow(
                    color: colorScheme.shadow.withOpacity(0.07),
                    blurRadius: 14,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: BottomBarDivider(
                items: barItems,
                indexSelected: currentIndex,
                onTap: (index) {
                  _dismissKeyboard();
                  final callback = callbacks[index];
                  final from = barItems[currentIndex].key ?? '$currentIndex';
                  final to = barItems[index].key ?? '$index';
                  if (currentIndex == index) {
                    UiLogger.action(
                      'NAV',
                      'reselected tab',
                      details: {'tab': to},
                    );
                    callback?.call();
                    return;
                  }
                  UiLogger.navigation(from, to, reason: 'tab tap');
                  setState(() {
                    _activeTabKey = barItems[index].key ?? 'dialogs';
                  });
                  callback?.call();
                },
                backgroundColor: Colors.transparent,
                color: colorScheme.onSurfaceVariant,
                colorSelected: colorScheme.primary,
                iconSize: 24,
                titleStyle: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 11.5,
                ),
                styleDivider: StyleDivider.top,
                enableShadow: false,
                top: 10,
                bottom: 2,
                pad: 3,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
