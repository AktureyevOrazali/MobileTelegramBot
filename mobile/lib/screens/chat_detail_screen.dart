part of '../main.dart';

class ChatDetailScreen extends StatefulWidget {
  const ChatDetailScreen({required this.apiClient, required this.chat, super.key});

  final ApiClient apiClient;
  final ChatSummary chat;

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  late ChatSummary _chat;
  late Timer _timer;
  StreamSubscription<Map<String, dynamic>>? _sseSub;
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  List<Message> _messages = [];
  bool _loading = true;
  String? _error;
  bool _isFavorite = false;
  bool _updatingFavorite = false;
  bool _deleting = false;
  bool _togglingAi = false;
  bool _updatingStatus = false;
  int? _lastMessageId;
  bool _showScrollFab = false;
  List<ReplyTemplate> _templates = [];

  void _dismissKeyboard() {
    FocusManager.instance.primaryFocus?.unfocus();
  }

  @override
  void initState() {
    super.initState();
    _chat = widget.chat;
    UiLogger.page('Chat detail', details: {
      'chat': _chat.title,
      'dialogId': _chat.dialogId,
    });
    _fetchMessages();
    // Fallback timer
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _fetchMessages());
    _isFavorite = _chat.isFavorite;
    _scrollController.addListener(_onScroll);
    _loadTemplates();

    widget.apiClient.connectToStream();
    _sseSub = widget.apiClient.sseStream.listen((data) {
      if (data['chat_id'] == _chat.chatId) {
        if (mounted) _fetchMessages();
      }
    });
  }

  @override
  void dispose() {
    _sseSub?.cancel();
    _dismissKeyboard();
    UiLogger.page('Chat detail', state: 'closed', details: {
      'chat': _chat.title,
      'dialogId': _chat.dialogId,
    });
    _timer.cancel();
    _messageController.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _fetchMessages() async {
    UiLogger.action('MESSAGES', 'fetch', details: {
      'chat': _chat.title,
      'dialogId': _chat.dialogId,
    });
    try {
      final messages = await widget.apiClient.fetchMessages(
        _chat.chatId,
        dialogId: _chat.dialogId,
      );

      if (!mounted) return;

      final previousLastId = _lastMessageId;
      final newLastId = messages.isNotEmpty ? messages.last.id : null;

      setState(() {
        _messages = messages;
        _loading = false;
        _error = null;
        _lastMessageId = newLastId;
      });

      UiLogger.action('MESSAGES', 'fetched', details: {'count': messages.length});

      // Автоскроллим только если пришли новые сообщения
      // и пользователь не читает историю (не отскроллил вверх).
      if (previousLastId != null && newLastId != null && newLastId != previousLastId) {
        _scrollToBottom(animated: true);
      }
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error.toString();
        _loading = false;
      });
      UiLogger.action('MESSAGES', 'fetch failed', details: {'reason': error.toString()});
    }
  }

  Future<void> _loadTemplates() async {
    try {
      final templates = await widget.apiClient.fetchReplyTemplates(
        section: _chat.section,
      );
      if (!mounted) return;
      setState(() {
        _templates = templates;
      });
    } catch (_) {
      // шаблоны не критичны — тихо игнорируем ошибку
    }
  }

  void _showTemplatesPicker() {
    if (_templates.isEmpty) return;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Row(
                  children: [
                    Icon(Icons.flash_on_rounded, color: colorScheme.primary, size: 20),
                    const SizedBox(width: 8),
                    Text(
                      'Быстрые ответы',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _templates.length,
                  itemBuilder: (context, index) {
                    final template = _templates[index];
                    return ListTile(
                      title: Text(template.title),
                      subtitle: Text(
                        template.text,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: () {
                        Navigator.of(context).pop();
                        _messageController.text = template.text;
                        _messageController.selection = TextSelection.fromPosition(
                          TextPosition(offset: template.text.length),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  bool _shouldAutoScroll() {
    if (!_scrollController.hasClients) return true;

    // При reverse=true "низ" = offset 0.0.
    // Если пользователь ушёл вверх, offset становится больше.
    const threshold = 120.0;
    final offset = _scrollController.offset;
    return offset <= threshold;
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final showFab = _scrollController.offset > 200;
    if (showFab != _showScrollFab) {
      setState(() => _showScrollFab = showFab);
    }
  }

  Future<void> _refreshChatFromServer() async {
    try {
      final refreshed = await widget.apiClient.fetchChatByDialogId(_chat.dialogId);
      if (!mounted || refreshed == null) {
        return;
      }
      setState(() {
        _chat = refreshed;
        _isFavorite = refreshed.isFavorite;
      });
      UiLogger.action('CHAT', 'refreshed from server', details: {'dialogId': _chat.dialogId});
    } catch (_) {
      // ignore
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) {
      return;
    }
    UiLogger.action('MESSAGES', 'send', details: {'length': text.length});

    setState(() {
      _error = null;
    });

    try {
      await widget.apiClient.sendMessage(
        _chat.chatId,
        text,
        dialogId: _chat.dialogId,
      );

      if (!mounted) return;

      UiLogger.action('MESSAGES', 'sent', details: {'chat': _chat.title});
      _messageController.clear();

      await _fetchMessages();
      _scrollToBottom(animated: true);
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _error = error.toString();
        _loading = false;
      });
      UiLogger.action('MESSAGES', 'send failed', details: {'reason': error.toString()});
    }
  }

  /// Для reverse=true "нижняя точка (последнее сообщение)" = offset 0.0
  void _scrollToBottom({bool animated = false}) {
    if (!mounted) return;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!_scrollController.hasClients) return;

      void jump() => _scrollController.jumpTo(0.0);

      Future<void> animate() async {
        await _scrollController.animateTo(
          0.0,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }

      if (animated) {
        await animate();
      } else {
        jump();
      }

      await Future<void>.delayed(const Duration(milliseconds: 40));
      if (!mounted || !_scrollController.hasClients) return;
      jump();
    });
  }

  Future<void> _toggleFavorite() async {
    if (_updatingFavorite) {
      return;
    }
    UiLogger.action('CHAT', 'toggle favorite', details: {
      'dialogId': _chat.dialogId,
      'target': !_isFavorite,
    });
    setState(() {
      _updatingFavorite = true;
      _isFavorite = !_isFavorite;
    });
    try {
      await widget.apiClient.setFavoriteDialog(_chat.dialogId, _isFavorite);

      if (!mounted) return;

      setState(() {
        _chat = _chat.copyWith(isFavorite: _isFavorite);
      });

      showTopMessage(
        context,
        _isFavorite ? 'Диалог добавлен в избранное' : 'Диалог удалён из избранного',
      );
      UiLogger.action('CHAT', 'favorite updated', details: {'value': _isFavorite});
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _isFavorite = !_isFavorite;
      });
      showTopMessage(
        context,
        'Не удалось обновить избранное: $error',
        isError: true,
      );
      UiLogger.action('CHAT', 'favorite update failed', details: {'reason': error.toString()});
    } finally {
      if (mounted) {
        setState(() {
          _updatingFavorite = false;
        });
      }
    }
  }

  Future<void> _toggleDialogStatus() async {
    if (_updatingStatus) {
      return;
    }
    UiLogger.action('CHAT', 'toggle status', details: {
      'dialogId': _chat.dialogId,
      'target': _chat.isClosed ? 'open' : 'close',
    });
    setState(() {
      _updatingStatus = true;
    });
    try {
      final wasClosed = _chat.isClosed;
      final result = wasClosed
          ? await widget.apiClient.openDialog(_chat.dialogId)
          : await widget.apiClient.closeDialog(_chat.dialogId);

      if (!mounted) return;

      setState(() {
        _chat = _chat.copyWith(
          dialogClosedAt: result.dialogClosedAt,
          aiEnabled: result.aiEnabled,
        );
      });
      await _refreshChatFromServer();

      if (!mounted) return;

      showTopMessage(
        context,
        wasClosed
            ? 'Диалог открыт снова и готов к сообщениям.'
            : 'Диалог закрыт. Клиент уведомлён и AI снова включён.',
      );
      UiLogger.action('CHAT', 'status updated', details: {'closed': !wasClosed});
    } catch (error) {
      if (!mounted) return;

      showTopMessage(
        context,
        'Не удалось обновить статус диалога: $error',
        isError: true,
      );
      UiLogger.action('CHAT', 'status update failed', details: {'reason': error.toString()});
    } finally {
      if (mounted) {
        setState(() {
          _updatingStatus = false;
        });
      }
    }
  }

  Future<void> _toggleAiAssistant() async {
    if (_togglingAi) {
      return;
    }
    UiLogger.action('CHAT', 'toggle ai', details: {
      'dialogId': _chat.dialogId,
      'target': !_chat.aiEnabled,
    });
    setState(() {
      _togglingAi = true;
    });
    try {
      if (_chat.aiEnabled) {
        await widget.apiClient.disableDialogAI(_chat.dialogId);
      } else {
        await widget.apiClient.enableDialogAI(_chat.dialogId);
      }

      if (!mounted) return;

      setState(() {
        _chat = _chat.copyWith(aiEnabled: !_chat.aiEnabled);
      });
      await _refreshChatFromServer();

      if (!mounted) return;

      showTopMessage(
        context,
        _chat.aiEnabled
            ? 'AI помощник включён для этого диалога.'
            : 'AI помощник отключён. Клиенту отправлено уведомление.',
      );
      UiLogger.action('CHAT', 'ai toggled', details: {'enabled': _chat.aiEnabled});
    } catch (error) {
      if (!mounted) return;

      showTopMessage(
        context,
        'Не удалось обновить режим AI: $error',
        isError: true,
      );
      UiLogger.action('CHAT', 'ai toggle failed', details: {'reason': error.toString()});
    } finally {
      if (mounted) {
        setState(() {
          _togglingAi = false;
        });
      }
    }
  }

  Future<void> _deleteChat() async {
    final confirmed = await showThemedDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Удалить диалог?'),
          content: Text('Переписка с "${_chat.title}" будет удалена без возможности восстановления.'),
          actions: [
            TextButton(
              onPressed: _logButtonPress(
                'cancel delete chat from details',
                () => Navigator.of(dialogContext).pop(false),
              ),
              child: const Text('Отмена'),
            ),
            FilledButton(
              onPressed: _logButtonPress(
                'confirm delete chat from details',
                () => Navigator.of(dialogContext).pop(true),
              ),
              child: const Text('Удалить'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) {
      UiLogger.action('CHAT', 'delete cancelled', details: {'dialogId': _chat.dialogId});
      return;
    }
    UiLogger.action('CHAT', 'delete confirmed', details: {'dialogId': _chat.dialogId});
    setState(() {
      _deleting = true;
    });
    try {
      await widget.apiClient.deleteChat(_chat.chatId);

      if (!mounted) return;

      UiLogger.navigation('chat_detail', 'chat_list', reason: 'chat deleted');
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _deleting = false;
      });
      showTopMessage(
        context,
        'Не удалось удалить диалог: $error',
        isError: true,
      );
      UiLogger.action('CHAT', 'delete failed', details: {'reason': error.toString()});
    }
  }

  @override
  Widget build(BuildContext context) {
    final latestSectionTitle = _messages.isNotEmpty
        ? (_messages.last.sectionTitle ?? _chat.sectionTitle)
        : _chat.sectionTitle;
    final sectionTitle = latestSectionTitle ?? 'Раздел не выбран';
    final user = widget.apiClient.currentUser;
    final canSend = user?.canReply ?? false;
    final operatorSuffix = user != null
        ? ' (${user.name}${user.jobTitle.isNotEmpty ? ', ${user.jobTitle}' : ''})'
        : '';
    final canDelete = (user?.isAdmin ?? false) || (user?.canReply ?? false);

    final theme = _ensureAppColorsTheme(Theme.of(context));
    final colorScheme = theme.colorScheme;
    final appColors = theme.extension<AppColors>()!;

    final isClosed = _chat.isClosed;
    final statusLabel = isClosed ? 'Закрыт' : 'Открыт';
    final statusColors = _statusBadgeColors(theme, isClosed: isClosed);
    final aiColors = _aiBadgeColors(theme, enabled: _chat.aiEnabled);
    final messageMaxWidth =
        (MediaQuery.sizeOf(context).width * 0.78).clamp(250.0, 420.0).toDouble();

    final startedAtLabel = _chat.dialogStartedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogStartedAt!.toLocal())
        : null;
    final closedAtLabel = _chat.dialogClosedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogClosedAt!.toLocal())
        : null;
    // ignore: unused_local_variable
    (startedAtLabel, closedAtLabel, sectionTitle, operatorSuffix);

    return Theme(
      data: theme,
      child: PopScope(
        onPopInvokedWithResult: (didPop, result) {
          _dismissKeyboard();
        },
        child: Scaffold(
          // ВАЖНО: оставляем true, чтобы Scaffold сам корректно поднимал body при клавиатуре.
          // И одновременно НЕ добавляем viewInsets.bottom в список (иначе будет "двойной" отступ).
          resizeToAvoidBottomInset: true,

          appBar: AppBar(
            titleSpacing: 10,
            flexibleSpace: Container(
              decoration: BoxDecoration(
                gradient: AppGradients.heroBanner(colorScheme),
              ),
            ),
            title: Row(
              children: [
                CircleAvatar(
                  radius: 17,
                  backgroundColor: Colors.white.withValues(alpha: 0.2),
                  foregroundColor: Colors.white,
                  child: Text(
                    _chat.title.isNotEmpty ? _chat.title[0].toUpperCase() : '?',
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _chat.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        '@${_chat.username ?? 'без username'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: Colors.white.withValues(alpha: 0.8),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                tooltip: _isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
                icon: Icon(
                  _isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                ),
                color: _isFavorite
                    ? const Color(0xFFFFD54F)
                    : Colors.white.withValues(alpha: 0.8),
                onPressed: _logButtonPress(
                  'toggle favorite in chat details',
                  (_updatingFavorite || _deleting) ? null : _toggleFavorite,
                ),
              ),
              PopupMenuButton<String>(
                enabled: !_deleting,
                icon: Icon(
                  Icons.more_horiz_rounded,
                  color: Colors.white.withValues(alpha: 0.8),
                ),
                onSelected: (value) {
                  switch (value) {
                    case 'toggle_status':
                      _toggleDialogStatus();
                      break;
                    case 'toggle_ai':
                      _toggleAiAssistant();
                      break;
                    case 'delete':
                      if (canDelete) {
                        _deleteChat();
                      }
                      break;
                  }
                },
                itemBuilder: (context) {
                  return [
                    PopupMenuItem(
                      value: 'toggle_status',
                      enabled: canSend && !_updatingStatus,
                      child: Row(
                        children: [
                          Icon(
                            _chat.isClosed ? Icons.lock_open : Icons.lock_outline,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Text(_chat.isClosed ? 'Открыть диалог' : 'Закрыть диалог'),
                        ],
                      ),
                    ),
                    PopupMenuItem(
                      value: 'toggle_ai',
                      enabled: canSend && !_togglingAi,
                      child: Row(
                        children: [
                          Icon(
                            _chat.aiEnabled ? Icons.smart_toy : Icons.smart_toy_outlined,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 8),
                          Text(_chat.aiEnabled ? 'Отключить AI' : 'Включить AI'),
                        ],
                      ),
                    ),
                    if (canDelete)
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete_outline),
                            SizedBox(width: 8),
                            Text('Удалить диалог'),
                          ],
                        ),
                      ),
                  ];
                },
              ),
            ],
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(44),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_updatingStatus)
                              SizedBox(
                                width: 13,
                                height: 13,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: Colors.white.withValues(alpha: 0.9),
                                ),
                              )
                            else
                              Icon(
                                isClosed ? Icons.lock_rounded : Icons.lock_open_rounded,
                                size: 13,
                                color: Colors.white.withValues(alpha: 0.9),
                              ),
                            const SizedBox(width: 5),
                            Text(
                              statusLabel,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: Colors.white.withValues(alpha: 0.9),
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_togglingAi)
                              SizedBox(
                                width: 13,
                                height: 13,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  color: Colors.white.withValues(alpha: 0.9),
                                ),
                              )
                            else
                              Icon(
                                _chat.aiEnabled ? Icons.smart_toy_rounded : Icons.smart_toy_outlined,
                                size: 13,
                                color: Colors.white.withValues(alpha: 0.9),
                              ),
                            const SizedBox(width: 5),
                            Text(
                              _chat.aiEnabled ? 'AI вкл' : 'AI выкл',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: Colors.white.withValues(alpha: 0.9),
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          body: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: _dismissKeyboard,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    colorScheme.primary.withValues(alpha: 0.07),
                    colorScheme.surface,
                    colorScheme.surface,
                  ],
                ),
              ),
              child: Column(
                children: [
                  if (_deleting) const LinearProgressIndicator(),
                  Expanded(
                    child: Stack(
                      children: [
                        _loading
                            ? const Center(child: CircularProgressIndicator())
                            : _error != null
                                ? Center(
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 24),
                                      child: Container(
                                        padding: const EdgeInsets.all(16),
                                        decoration: BoxDecoration(
                                          color: colorScheme.surface,
                                          borderRadius: BorderRadius.circular(16),
                                          border: Border.all(color: colorScheme.outlineVariant),
                                        ),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(
                                              Icons.error_outline_rounded,
                                              color: colorScheme.error,
                                            ),
                                            const SizedBox(height: 10),
                                            Text(
                                              'Ошибка загрузки: $_error',
                                              textAlign: TextAlign.center,
                                            ),
                                            const SizedBox(height: 12),
                                            FilledButton.icon(
                                              onPressed:
                                                  _logButtonPress('retry load messages', _fetchMessages),
                                              icon: const Icon(Icons.refresh_rounded),
                                              label: const Text('Повторить'),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  )
                                : _messages.isEmpty
                                    ? Center(
                                        child: Padding(
                                          padding: const EdgeInsets.symmetric(horizontal: 28),
                                          child: Text(
                                            'Пока нет сообщений. Первое сообщение появится здесь.',
                                            textAlign: TextAlign.center,
                                            style: theme.textTheme.bodyMedium?.copyWith(
                                              color: colorScheme.onSurfaceVariant,
                                            ),
                                          ),
                                        ),
                                      )
                                    : ListView.builder(
                                        controller: _scrollController,
                                        reverse: true,
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 12,
                                          vertical: 12,
                                        ),
                                        keyboardDismissBehavior:
                                            ScrollViewKeyboardDismissBehavior.onDrag,
                                        itemCount: _messages.length,
                                        itemBuilder: (context, index) {
                                          final message = _messages[_messages.length - 1 - index];
                                          final isOutgoing = message.direction == 'outgoing';
                                          final bubbleColor = isOutgoing
                                              ? appColors.outgoingMessageBackground
                                              : appColors.incomingMessageBackground;
                                          final textColor = isOutgoing
                                              ? appColors.outgoingMessageText
                                              : appColors.incomingMessageText;
                                          final alignment = isOutgoing
                                              ? Alignment.centerRight
                                              : Alignment.centerLeft;

                                          return Align(
                                            alignment: alignment,
                                            child: Container(
                                              margin: const EdgeInsets.symmetric(vertical: 3),
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 12,
                                                vertical: 9,
                                              ),
                                              constraints: BoxConstraints(maxWidth: messageMaxWidth),
                                              decoration: BoxDecoration(
                                                gradient: isOutgoing
                                                    ? AppGradients.outgoingBubble(colorScheme)
                                                    : null,
                                                color: isOutgoing ? null : bubbleColor,
                                                borderRadius: BorderRadius.only(
                                                  topLeft: const Radius.circular(18),
                                                  topRight: const Radius.circular(18),
                                                  bottomLeft: Radius.circular(isOutgoing ? 18 : 4),
                                                  bottomRight: Radius.circular(isOutgoing ? 4 : 18),
                                                ),
                                                boxShadow: [
                                                  BoxShadow(
                                                    color: colorScheme.shadow.withValues(alpha: 0.03),
                                                    blurRadius: 4,
                                                    offset: const Offset(0, 1),
                                                  ),
                                                ],
                                              ),
                                              child: Column(
                                                crossAxisAlignment: isOutgoing
                                                    ? CrossAxisAlignment.end
                                                    : CrossAxisAlignment.start,
                                                children: [
                                                  if (!isOutgoing && message.author != null) ...[
                                                    Text(
                                                      message.author!,
                                                      style: theme.textTheme.labelSmall?.copyWith(
                                                        color: textColor.withValues(alpha: 0.82),
                                                        fontWeight: FontWeight.w700,
                                                      ),
                                                    ),
                                                    const SizedBox(height: 2),
                                                  ],
                                                  Text(
                                                    message.text,
                                                    style: theme.textTheme.bodyMedium?.copyWith(
                                                      color: textColor,
                                                      height: 1.3,
                                                    ),
                                                  ),
                                                  const SizedBox(height: 4),
                                                  Wrap(
                                                    spacing: 6,
                                                    runSpacing: 2,
                                                    crossAxisAlignment: WrapCrossAlignment.center,
                                                    children: [
                                                      if (message.sectionTitle != null &&
                                                          message.sectionTitle!.isNotEmpty) ...[
                                                        Icon(
                                                          Icons.category_outlined,
                                                          size: 11,
                                                          color: textColor.withValues(alpha: 0.68),
                                                        ),
                                                        Text(
                                                          message.sectionTitle!,
                                                          maxLines: 1,
                                                          overflow: TextOverflow.ellipsis,
                                                          style: theme.textTheme.labelSmall?.copyWith(
                                                            color: textColor.withValues(alpha: 0.72),
                                                          ),
                                                        ),
                                                      ],
                                                      Text(
                                                        message.createdAtLabel,
                                                        style: theme.textTheme.labelSmall?.copyWith(
                                                          color: textColor.withValues(alpha: 0.72),
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ],
                                              ),
                                            ),
                                          );
                                        },
                                      ),
                        // Scroll-to-bottom FAB
                        Positioned(
                          right: 12,
                          bottom: 8,
                          child: AnimatedScale(
                            scale: _showScrollFab ? 1.0 : 0.0,
                            duration: const Duration(milliseconds: 200),
                            curve: Curves.easeOut,
                            child: FloatingActionButton.small(
                              heroTag: 'scroll_to_bottom',
                              onPressed: () => _scrollToBottom(animated: true),
                              backgroundColor: colorScheme.surface,
                              foregroundColor: colorScheme.primary,
                              elevation: 3,
                              child: const Icon(Icons.keyboard_arrow_down_rounded),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                SafeArea(
                  top: false,
                  bottom: true,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 8),
                    child: Column(
                      children: [
                        if (!canSend)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Text(
                              'У вашей роли нет прав на отправку ответов. Обратитесь к администратору.',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: colorScheme.error,
                              ),
                            ),
                          ),
                        Container(
                          padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
                          decoration: BoxDecoration(
                            color: colorScheme.surface,
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(
                              color: colorScheme.outlineVariant.withValues(alpha: 0.5),
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: colorScheme.shadow.withValues(alpha: 0.04),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _messageController,
                                  decoration: InputDecoration(
                                    hintText: canSend ? 'Напишите сообщение...' : 'Только просмотр',
                                    border: InputBorder.none,
                                    isDense: true,
                                    contentPadding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                      vertical: 10,
                                    ),
                                  ),
                                  enabled: canSend && !_deleting,
                                  keyboardType: TextInputType.multiline,
                                  textCapitalization: TextCapitalization.sentences,
                                  minLines: 1,
                                  maxLines: 5,
                                  onSubmitted: canSend && !_deleting ? (_) => _sendMessage() : null,
                                  onTap: () => _scrollToBottom(animated: true),
                                ),
                              ),
                              if (_templates.isNotEmpty)
                                IconButton(
                                  onPressed: canSend && !_deleting ? _showTemplatesPicker : null,
                                  icon: const Icon(Icons.flash_on_rounded),
                                  color: colorScheme.primary,
                                  tooltip: 'Быстрые ответы',
                                  iconSize: 20,
                                ),
                              const SizedBox(width: 4),
                              DecoratedBox(
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(18),
                                  gradient: AppGradients.primaryAction(colorScheme),
                                ),
                                child: IconButton(
                                  onPressed: _logButtonPress(
                                    'send chat message',
                                    canSend && !_deleting ? _sendMessage : null,
                                  ),
                                  icon: const Icon(Icons.send_rounded),
                                  color: colorScheme.onPrimary,
                                  tooltip: 'Отправить',
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
    );
  }
}

