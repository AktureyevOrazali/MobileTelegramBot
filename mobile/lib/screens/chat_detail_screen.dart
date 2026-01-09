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

  @override
  void initState() {
    super.initState();
    _chat = widget.chat;
    UiLogger.page('Chat detail', details: {
      'chat': _chat.title,
      'dialogId': _chat.dialogId,
    });
    _fetchMessages();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _fetchMessages());
    _isFavorite = _chat.isFavorite;
  }

  @override
  void dispose() {
    UiLogger.page('Chat detail', state: 'closed', details: {
      'chat': _chat.title,
      'dialogId': _chat.dialogId,
    });
    _timer.cancel();
    _messageController.dispose();
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
      final previousLastId = _lastMessageId;
      final newLastId = messages.isNotEmpty ? messages.last.id : null;
      setState(() {
        _messages = messages;
        _loading = false;
        _error = null;
        _lastMessageId = newLastId;
      });
      UiLogger.action('MESSAGES', 'fetched', details: {'count': messages.length});
      if (newLastId != null && newLastId != previousLastId) {
        _scrollToBottom();
      }
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
      UiLogger.action('MESSAGES', 'fetch failed', details: {'reason': error.toString()});
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
      // если не удалось обновить, оставляем локальное состояние
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) {
      return;
    }
    UiLogger.action('MESSAGES', 'send', details: {'length': text.length});
    setState(() {
      _loading = true;
    });
    try {
      await widget.apiClient.sendMessage(
        _chat.chatId,
        text,
        dialogId: _chat.dialogId,
      );
      UiLogger.action('MESSAGES', 'sent', details: {'chat': _chat.title});
      _messageController.clear();
      await _fetchMessages();
      _scrollToBottom();
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
      UiLogger.action('MESSAGES', 'send failed', details: {'reason': error.toString()});
    }
  }

  void _scrollToBottom() {
    if (!mounted) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) {
        return;
      }
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
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
      setState(() {
        _chat = _chat.copyWith(isFavorite: _isFavorite);
      });
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        _isFavorite
            ? 'Диалог добавлен в избранное'
            : 'Диалог удалён из избранного',
      );
      UiLogger.action('CHAT', 'favorite updated', details: {'value': _isFavorite});
    } catch (error) {
      if (!mounted) {
        return;
      }
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
      setState(() {
        _chat = _chat.copyWith(
          dialogClosedAt: result.dialogClosedAt,
          aiEnabled: result.aiEnabled,
        );
      });
      await _refreshChatFromServer();
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        wasClosed
            ? 'Диалог открыт снова и готов к сообщениям.'
            : 'Диалог закрыт. Клиент уведомлён и AI снова включён.',
      );
      UiLogger.action('CHAT', 'status updated', details: {'closed': !wasClosed});
    } catch (error) {
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
      setState(() {
        _chat = _chat.copyWith(aiEnabled: !_chat.aiEnabled);
      });
      await _refreshChatFromServer();
      if (!mounted) {
        return;
      }
      showTopMessage(
        context,
        _chat.aiEnabled
            ? 'AI помощник включён для этого диалога.'
            : 'AI помощник отключён. Клиенту отправлено уведомление.',
      );
      UiLogger.action('CHAT', 'ai toggled', details: {'enabled': _chat.aiEnabled});
    } catch (error) {
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
    final confirmed = await showDialog<bool>(
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
      if (!mounted) {
        return;
      }
      UiLogger.navigation('chat_detail', 'chat_list', reason: 'chat deleted');
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) {
        return;
      }
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
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final appColors = theme.extension<AppColors>()!;
    final isClosed = _chat.isClosed;
    final statusLabel = isClosed ? 'Закрыт' : 'Открыт';
    final statusColors = _statusBadgeColors(theme, isClosed: isClosed);
    final aiColors = _aiBadgeColors(theme, enabled: _chat.aiEnabled);
    final startedAtLabel = _chat.dialogStartedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogStartedAt!.toLocal())
        : null;
    final closedAtLabel = _chat.dialogClosedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(_chat.dialogClosedAt!.toLocal())
        : null;
    return Scaffold(
      appBar: AppBar(
        title: Text(_chat.title),
        actions: [
          IconButton(
            tooltip: _isFavorite ? 'Убрать из избранного' : 'Добавить в избранное',
            icon: Icon(_isFavorite ? Icons.star : Icons.star_border),
            color: _isFavorite ? colorScheme.tertiary : null,
            onPressed: _logButtonPress(
              'toggle favorite in chat details',
              (_updatingFavorite || _deleting) ? null : _toggleFavorite,
            ),
          ),
          PopupMenuButton<String>(
            enabled: !_deleting,
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
          preferredSize: const Size.fromHeight(55),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: statusColors.background,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: statusColors.border, width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_updatingStatus)
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: statusColors.foreground,
                              ),
                            )
                          else
                            Icon(
                              isClosed ? Icons.lock : Icons.lock_open,
                              size: 16,
                              color: statusColors.foreground,
                            ),
                          const SizedBox(width: 8),
                          Text(
                            statusLabel,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: statusColors.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: aiColors.background,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: aiColors.border, width: 1),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_togglingAi)
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: aiColors.foreground,
                              ),
                            )
                          else
                            Icon(
                              _chat.aiEnabled ? Icons.smart_toy : Icons.smart_toy_outlined,
                              size: 16,
                              color: aiColors.foreground,
                            ),
                          const SizedBox(width: 8),
                          Text(
                            _chat.aiEnabled ? 'AI' : 'AI выключен',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: aiColors.foreground,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          if (_deleting) const LinearProgressIndicator(),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('Ошибка: $_error'),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: _logButtonPress('retry load messages', _fetchMessages),
                              child: const Text('Обновить'),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        controller: _scrollController,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                        itemCount: _messages.length,
                        itemBuilder: (context, index) {
                          final message = _messages[index];
                          final isOutgoing = message.direction == 'outgoing';
                          final bubbleColor = isOutgoing
                              ? appColors.outgoingMessageBackground
                              : appColors.incomingMessageBackground;
                          final textColor = isOutgoing
                              ? appColors.outgoingMessageText
                              : appColors.incomingMessageText;
                          final alignment = isOutgoing ? Alignment.centerRight : Alignment.centerLeft;
                          return Align(
                            alignment: alignment,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              constraints: const BoxConstraints(maxWidth: 340),
                              decoration: BoxDecoration(
                                color: bubbleColor,
                                borderRadius: BorderRadius.only(
                                  topLeft: const Radius.circular(16),
                                  topRight: const Radius.circular(16),
                                  bottomLeft: Radius.circular(isOutgoing ? 16 : 4),
                                  bottomRight: Radius.circular(isOutgoing ? 4 : 16),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment:
                                    isOutgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                                children: [
                                  if (message.author != null)
                                    Text(
                                      message.author!,
                                      style: theme.textTheme.labelSmall?.copyWith(
                                        color: textColor.withOpacity(0.8),
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  Text(
                                    message.text,
                                    style: theme.textTheme.bodyMedium?.copyWith(color: textColor),
                                  ),
                                  if (message.sectionTitle != null)

                                  const SizedBox(height: 4),
                                  Text(
                                    message.createdAtLabel,
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: textColor.withOpacity(0.7),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: InputDecoration(
                      hintText: canSend
                          ? 'Напишите сообщение...'
                          : 'Только просмотр. Свяжитесь с администратором для прав ответа.',
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    ),
                    enabled: canSend && !_deleting,
                    keyboardType: TextInputType.multiline,
                    textCapitalization: TextCapitalization.sentences,
                    minLines: 1,
                    maxLines: 5,
                    onSubmitted: canSend && !_deleting ? (_) => _sendMessage() : null,
                  ),
                ),
                const SizedBox(width: 12),
                IconButton.filled(
                  onPressed: _logButtonPress(
                    'send chat message',
                    canSend && !_deleting ? _sendMessage : null,
                  ),
                  icon: const Icon(Icons.send),
                  tooltip: 'Отправить',
                ),
              ],
            ),
          ),
          if (!canSend)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'У вашей роли нет прав на отправку ответов. Обратитесь к администратору.',
                style: theme.textTheme.bodySmall?.copyWith(color: colorScheme.error),
              ),
            ),
        ],
      ),
    );
  }
}
