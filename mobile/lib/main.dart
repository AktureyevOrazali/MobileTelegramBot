import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';

void main() {
  runApp(const TelegramCompanionApp());
}

class TelegramCompanionApp extends StatelessWidget {
  const TelegramCompanionApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Telegram Companion',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueAccent),
        useMaterial3: true,
      ),
      home: const ChatListScreen(),
    );
  }
}

class ApiClient {
  ApiClient(this.baseUrl, this.apiToken);

  final String baseUrl;
  final String apiToken;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (apiToken.isNotEmpty) 'X-Api-Token': apiToken,
      };

  Future<List<ChatSummary>> fetchChats() async {
    final uri = Uri.parse('$baseUrl/chats');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode != 200) {
      throw Exception('Не удалось загрузить чаты: ${response.body}');
    }
    final List<dynamic> decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded.map((item) => ChatSummary.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<List<Message>> fetchMessages(int chatId) async {
    final uri = Uri.parse('$baseUrl/chats/$chatId/messages?limit=100');
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode != 200) {
      throw Exception('Не удалось загрузить сообщения: ${response.body}');
    }
    final List<dynamic> decoded = jsonDecode(response.body) as List<dynamic>;
    return decoded.map((item) => Message.fromJson(item as Map<String, dynamic>)).toList();
  }

  Future<void> sendMessage(int chatId, String text) async {
    final uri = Uri.parse('$baseUrl/messages/send');
    final body = jsonEncode({'chat_id': chatId, 'text': text});
    final response = await http.post(uri, headers: _headers, body: body);
    if (response.statusCode != 200) {
      throw Exception('Не удалось отправить сообщение: ${response.body}');
    }
  }
}

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  late final ApiClient apiClient;
  late Future<List<ChatSummary>> _chatsFuture;

  @override
  void initState() {
    super.initState();
    const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:8000');
    const apiToken = String.fromEnvironment('API_TOKEN', defaultValue: '');
    apiClient = ApiClient(apiBaseUrl, apiToken);
    _loadChats();
  }

  void _loadChats() {
    setState(() {
      _chatsFuture = apiClient.fetchChats();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Диалоги Telegram'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadChats,
          )
        ],
      ),
      body: FutureBuilder<List<ChatSummary>>(
        future: _chatsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Text('Ошибка: ${snapshot.error}'),
            );
          }
          final chats = snapshot.data ?? [];
          if (chats.isEmpty) {
            return const Center(child: Text('Нет активных диалогов'));
          }
          return ListView.builder(
            itemCount: chats.length,
            itemBuilder: (context, index) {
              final chat = chats[index];
              return ListTile(
                title: Text(chat.title),
                subtitle: Text(chat.subtitle),
                trailing: Text(chat.updatedAtLabel),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ChatDetailScreen(
                      apiClient: apiClient,
                      chat: chat,
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class ChatDetailScreen extends StatefulWidget {
  const ChatDetailScreen({required this.apiClient, required this.chat, super.key});

  final ApiClient apiClient;
  final ChatSummary chat;

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  late Timer _timer;
  final TextEditingController _messageController = TextEditingController();
  List<Message> _messages = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchMessages();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _fetchMessages());
  }

  @override
  void dispose() {
    _timer.cancel();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _fetchMessages() async {
    try {
      final messages = await widget.apiClient.fetchMessages(widget.chat.chatId);
      setState(() {
        _messages = messages;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) {
      return;
    }
    setState(() {
      _loading = true;
    });
    try {
      await widget.apiClient.sendMessage(widget.chat.chatId, text);
      _messageController.clear();
      await _fetchMessages();
    } catch (error) {
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.chat.title),
      ),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text('Ошибка: $_error'))
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
                        itemCount: _messages.length,
                        itemBuilder: (context, index) {
                          final message = _messages[index];
                          final isOutgoing = message.direction == 'outgoing';
                          final alignment = isOutgoing ? CrossAxisAlignment.end : CrossAxisAlignment.start;
                          final bubbleColor = isOutgoing ? Colors.blueAccent.shade100 : Colors.grey.shade200;
                          final textColor = isOutgoing ? Colors.white : Colors.black87;
                          return Column(
                            crossAxisAlignment: alignment,
                            children: [
                              Container(
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: bubbleColor,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Column(
                                  crossAxisAlignment: alignment,
                                  children: [
                                    if (message.author != null)
                                      Text(
                                        message.author!,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: textColor.withOpacity(0.8),
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    Text(
                                      message.text,
                                      style: TextStyle(color: textColor, fontSize: 16),
                                    ),
                                    Align(
                                      alignment: Alignment.bottomRight,
                                      child: Text(
                                        message.createdAtLabel,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: textColor.withOpacity(0.7),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
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
                    decoration: const InputDecoration(
                      hintText: 'Ваш ответ...',
                    ),
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  onPressed: _sendMessage,
                  icon: const Icon(Icons.send),
                  label: const Text('Отправить'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ChatSummary {
  ChatSummary({
    required this.chatId,
    required this.title,
    required this.username,
    required this.type,
    required this.updatedAt,
  });

  final int chatId;
  final String title;
  final String? username;
  final String type;
  final DateTime updatedAt;

  String get subtitle => username != null ? '@$username' : type;

  String get updatedAtLabel => DateFormat('HH:mm').format(updatedAt.toLocal());

  factory ChatSummary.fromJson(Map<String, dynamic> json) {
    return ChatSummary(
      chatId: json['chat_id'] as int,
      title: json['title'] as String,
      username: json['username'] as String?,
      type: json['type'] as String,
      updatedAt: DateTime.parse(json['updated_at'] as String),
    );
  }
}

class Message {
  Message({
    required this.id,
    required this.chatId,
    required this.direction,
    required this.text,
    required this.author,
    required this.createdAt,
  });

  final int id;
  final int chatId;
  final String direction;
  final String text;
  final String? author;
  final DateTime createdAt;

  String get createdAtLabel => DateFormat('HH:mm').format(createdAt.toLocal());

  factory Message.fromJson(Map<String, dynamic> json) {
    return Message(
      id: json['id'] as int,
      chatId: json['chat_id'] as int,
      direction: json['direction'] as String,
      text: json['text'] as String,
      author: json['author'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}