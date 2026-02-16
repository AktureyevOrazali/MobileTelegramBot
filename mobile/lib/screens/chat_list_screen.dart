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
                      Row(
                        children: [
                          Icon(
                            Icons.tune_rounded,
                            size: 20,
                            color: theme.colorScheme.primary,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            'Фильтры диалогов',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Divider(
                        height: 1,
                        color: theme.colorScheme.outlineVariant.withValues(alpha: 0.3),
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
                      const SizedBox(height: 16),
                      // Status filter — segmented
                      Text('Статус',
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      SegmentedButton<DialogStatusFilter>(
                        segments: const [
                          ButtonSegment(
                            value: DialogStatusFilter.all,
                            label: Text('Все'),
                          ),
                          ButtonSegment(
                            value: DialogStatusFilter.open,
                            label: Text('Открытые'),
                          ),
                          ButtonSegment(
                            value: DialogStatusFilter.closed,
                            label: Text('Закрытые'),
                          ),
                        ],
                        selected: {status},
                        onSelectionChanged: (value) {
                          setModalState(() => status = value.first);
                        },
                      ),
                      const SizedBox(height: 16),
                      // Sort order — segmented
                      Text('Сортировка',
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      SegmentedButton<ChatSortOrder>(
                        segments: const [
                          ButtonSegment(
                            value: ChatSortOrder.newest,
                            label: Text('Новые'),
                            icon: Icon(Icons.arrow_upward_rounded, size: 16),
                          ),
                          ButtonSegment(
                            value: ChatSortOrder.oldest,
                            label: Text('Старые'),
                            icon: Icon(Icons.arrow_downward_rounded, size: 16),
                          ),
                        ],
                        selected: {sort},
                        onSelectionChanged: (value) {
                          setModalState(() => sort = value.first);
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
                          OutlinedButton(
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

  Widget _buildShimmerSkeleton() {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final shimmerBase = colorScheme.onSurface.withValues(alpha: 0.08);
    final shimmerHighlight = colorScheme.onSurface.withValues(alpha: 0.14);
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      itemCount: 6,
      itemBuilder: (context, index) {
        return TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.0, end: 1.0),
          duration: Duration(milliseconds: 800 + index * 100),
          curve: Curves.easeInOut,
          builder: (context, value, child) {
            return Opacity(
              opacity: 0.5 + 0.5 * (0.5 + 0.5 * (1 - value)),
              child: child,
            );
          },
          child: Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: colorScheme.outlineVariant.withValues(alpha: 0.3),
              ),
            ),
            child: Row(
              children: [
                // Avatar circle
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: shimmerBase,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 12),
                // Text lines
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 120 + (index % 3) * 30,
                        height: 14,
                        decoration: BoxDecoration(
                          color: shimmerHighlight,
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        width: 80 + (index % 2) * 40,
                        height: 10,
                        decoration: BoxDecoration(
                          color: shimmerBase,
                          borderRadius: BorderRadius.circular(5),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                // Timestamp placeholder
                Container(
                  width: 36,
                  height: 10,
                  decoration: BoxDecoration(
                    color: shimmerBase,
                    borderRadius: BorderRadius.circular(5),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildChatTab() {
    if (_loading) {
      return _buildShimmerSkeleton();
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
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Фильтры',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
              const Spacer(),
              SizedBox(
                height: 34,
                child: OutlinedButton.icon(
                  onPressed: _logButtonPress(
                    'open chat filters',
                    _showFiltersSheet,
                  ),
                  icon: const Icon(Icons.tune_rounded, size: 16),
                  label: const Text('Настроить'),
                  style: OutlinedButton.styleFrom(
                    textStyle: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(999),
                    ),
                    side: BorderSide(
                      color: colorScheme.primary.withValues(alpha: 0.4),
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (chips.isNotEmpty) ...[
            const SizedBox(height: 8),
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
        ],
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
          final hasUnread = chat.unreadCount > 0;

          // Subtitle: section + BIN info
          final subtitleParts = <String>[];
          if (chat.sectionTitle != null && chat.sectionTitle!.isNotEmpty) {
            subtitleParts.add(chat.sectionTitle!);
          }
          if (chat.bin != null && chat.bin!.isNotEmpty) {
            subtitleParts.add('BIN ${chat.bin}');
          }
          if (subtitleParts.isEmpty) {
            subtitleParts.add(
              chat.username != null ? '@${chat.username}' : chat.type,
            );
          }
          final subtitle = subtitleParts.join(' · ');

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Card(
              clipBehavior: Clip.antiAlias,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: colorScheme.outlineVariant.withOpacity(0.5),
                ),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () async {
                  UiLogger.navigation(
                    'chat_list',
                    'chat_detail',
                    details: {'chat': chat.title, 'dialogId': chat.dialogId},
                  );

                  // ВАЖНО: фиксируем "правильную" тему модуля ДО пуша
                  final moduleTheme = _ensureAppColorsTheme(Theme.of(context));

                  final chatToOpen = hasUnread
                      ? chat.copyWith(unreadCount: 0)
                      : chat;

                  if (hasUnread) {
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
                child: Container(
                  decoration: hasUnread
                      ? BoxDecoration(
                          border: Border(
                            left: BorderSide(
                              color: colorScheme.primary,
                              width: 3,
                            ),
                          ),
                        )
                      : null,
                  padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Avatar
                      CircleAvatar(
                        radius: 22,
                        backgroundColor: colorScheme.primaryContainer,
                        foregroundColor: colorScheme.onPrimaryContainer,
                        child: Text(
                          chat.title.isNotEmpty
                              ? chat.title[0].toUpperCase()
                              : '?',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Content
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Row 1: Name + status icons + timestamp
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    chat.title,
                                    style: theme.textTheme.titleSmall?.copyWith(
                                      fontWeight: hasUnread
                                          ? FontWeight.w700
                                          : FontWeight.w600,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                // Status icon (lock)
                                if (isStatusUpdating)
                                  SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 1.5,
                                      color: statusColors.foreground,
                                    ),
                                  )
                                else
                                  Icon(
                                    chat.isClosed
                                        ? Icons.lock_rounded
                                        : Icons.lock_open_rounded,
                                    size: 14,
                                    color: statusColors.foreground,
                                  ),
                                const SizedBox(width: 4),
                                // AI icon (robot)
                                if (isAiUpdating)
                                  SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 1.5,
                                      color: aiColors.foreground,
                                    ),
                                  )
                                else
                                  Icon(
                                    chat.aiEnabled
                                        ? Icons.smart_toy_rounded
                                        : Icons.smart_toy_outlined,
                                    size: 14,
                                    color: aiColors.foreground,
                                  ),
                                const SizedBox(width: 8),
                                // Timestamp
                                Text(
                                  chat.updatedAtLabel,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: hasUnread
                                        ? colorScheme.primary
                                        : colorScheme.onSurfaceVariant,
                                    fontWeight: hasUnread
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            // Row 2: Subtitle + unread + star + menu
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    subtitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                                // Unread counter
                                if (hasUnread)
                                  Container(
                                    margin: const EdgeInsets.only(left: 6),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 7,
                                      vertical: 3,
                                    ),
                                    decoration: BoxDecoration(
                                      color: colorScheme.primary,
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                    child: Text(
                                      '${chat.unreadCount}',
                                      style: theme.textTheme.labelSmall
                                          ?.copyWith(
                                        color: colorScheme.onPrimary,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ),
                                // Favorite star
                                SizedBox(
                                  width: 30,
                                  height: 30,
                                  child: IconButton(
                                    padding: EdgeInsets.zero,
                                    iconSize: 18,
                                    icon: Icon(
                                      chat.isFavorite
                                          ? Icons.star_rounded
                                          : Icons.star_outline_rounded,
                                    ),
                                    color: chat.isFavorite
                                        ? colorScheme.tertiary
                                        : colorScheme.onSurfaceVariant
                                            .withOpacity(0.4),
                                    tooltip: chat.isFavorite
                                        ? 'Убрать из избранного'
                                        : 'Добавить в избранное',
                                    onPressed: _logButtonPress(
                                      'toggle favorite for ${chat.title}',
                                      () => _toggleFavorite(chat),
                                    ),
                                  ),
                                ),
                                // Menu
                                SizedBox(
                                  width: 32,
                                  height: 32,
                                  child: PopupMenuButton<String>(
                                    padding: EdgeInsets.zero,
                                    iconSize: 20,
                                    enabled: canManageDialogs &&
                                        !isStatusUpdating &&
                                        !isAiUpdating,
                                    icon: Icon(
                                      Icons.more_horiz_rounded,
                                      color: colorScheme.onSurfaceVariant
                                          .withOpacity(0.6),
                                    ),
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
                                                color: theme.colorScheme
                                                    .onSurfaceVariant,
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
                                                color: theme.colorScheme
                                                    .onSurfaceVariant,
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
                                          const PopupMenuItem(
                                            value: 'delete',
                                            child: Row(
                                              children: [
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
                                ),
                              ],
                            ),
                          ],
                        ),
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

        child: Container(
          decoration: BoxDecoration(
            gradient: AppGradients.appBar(colorScheme),
          ),
          child: Scaffold(
            backgroundColor: Colors.transparent,
            appBar: _buildAppBar(currentIndex, isAdmin),
            body: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: _dismissKeyboard,
              child: IndexedStack(index: currentIndex, children: tabs),
            ),
          bottomNavigationBar: DecoratedBox(
            decoration: BoxDecoration(
              color: navigationBarBackgroundColor,
              border: Border(
                top: BorderSide(
                  color: colorScheme.outlineVariant.withOpacity(0.3),
                  width: 0.5,
                ),
              ),
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
                fontSize: 11,
              ),
              styleDivider: StyleDivider.top,
              enableShadow: false,
              top: 10,
              bottom: 4,
              pad: 3,
            ),
          ),
        ),
        ),
      ),
    );
  }
}
