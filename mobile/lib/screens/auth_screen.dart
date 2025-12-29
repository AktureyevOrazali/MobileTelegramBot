part of '../main.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    required this.apiClient,
    required this.onAuthenticated,
    required this.themeMode,
    required this.onThemeModeChanged,
    super.key,
  });

  final ApiClient apiClient;
  final void Function(AuthSession session) onAuthenticated;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeModeChanged;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isLogin = true;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    UiLogger.page('Auth', details: {'mode': 'login'});
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    UiLogger.action('AUTH', 'form submitted', details: {'mode': _isLogin ? 'login' : 'register'});
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      AuthSession session;
      if (_isLogin) {
        session = await widget.apiClient.login(_emailController.text.trim(), _passwordController.text);
      } else {
        session = await widget.apiClient.register(
          _nameController.text.trim(),
          _emailController.text.trim(),
          _passwordController.text,
        );
      }
      UiLogger.action('AUTH', 'success', details: {'mode': _isLogin ? 'login' : 'register'});
      widget.onAuthenticated(session);
    } catch (error) {
      UiLogger.action('AUTH', 'failed', details: {'reason': error.toString()});
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final platformBrightness = MediaQuery.of(context).platformBrightness;
    final isDarkModeActive = widget.themeMode == ThemeMode.dark ||
        (widget.themeMode == ThemeMode.system && platformBrightness == Brightness.dark);
    final themeToggleIcon = isDarkModeActive ? Icons.light_mode : Icons.dark_mode;
    final themeToggleTooltip = isDarkModeActive ? 'Светлый режим' : 'Тёмный режим';
    final nextThemeMode = isDarkModeActive ? ThemeMode.light : ThemeMode.dark;

    return Scaffold(
      floatingActionButton: FloatingActionButton.small(
        heroTag: 'auth-theme-toggle',
        onPressed: _logButtonPress(
          'toggle theme from auth screen',
          () => widget.onThemeModeChanged(nextThemeMode),
        ),
        tooltip: themeToggleTooltip,
        child: Icon(themeToggleIcon),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final availableHeight = constraints.maxHeight.isFinite ? constraints.maxHeight : 0.0;
            final effectiveMinHeight = availableHeight > 48 ? availableHeight - 48 : 0.0;
            return SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: effectiveMinHeight),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 12),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(18),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary.withOpacity(0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isLogin ? Icons.work_outline_rounded : Icons.person_add_alt_1,
                            color: theme.colorScheme.primary,
                            size: 64,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'MobileBot Companion',
                          style: theme.textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: theme.colorScheme.onSurface,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _isLogin ? 'Вход' : 'Регистрация',
                          style: theme.textTheme.titleMedium?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 12),
                      ],
                    ),
                    const SizedBox(height: 28),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Form(
                          key: _formKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (!_isLogin)
                                TextFormField(
                                  controller: _nameController,
                                  decoration: const InputDecoration(
                                    labelText: 'Имя и фамилия',
                                    prefixIcon: Icon(Icons.badge_outlined),
                                  ),
                                  textCapitalization: TextCapitalization.words,
                                  textInputAction: TextInputAction.next,
                                  validator: (value) {
                                    final trimmed = value?.trim() ?? '';
                                    if (trimmed.runes.length < 2) {
                                      return 'Имя должно содержать минимум 2 символа.';
                                    }
                                    return null;
                                  },
                                ),
                              if (!_isLogin) const SizedBox(height: 16),
                              TextFormField(
                                controller: _emailController,
                                decoration: InputDecoration(
                                  labelText: _isLogin ? 'Логин или e-mail' : 'Рабочий e-mail',
                                  prefixIcon: const Icon(Icons.alternate_email_outlined),
                                ),
                                keyboardType: _isLogin ? TextInputType.text : TextInputType.emailAddress,
                                textInputAction: TextInputAction.next,
                                validator: (value) {
                                  final trimmed = value?.trim() ?? '';
                                  if (_isLogin) {
                                    if (trimmed.isEmpty) {
                                      return 'Введите логин или e-mail.';
                                    }
                                    return null;
                                  }
                                  if (trimmed.isEmpty || !trimmed.contains('@')) {
                                    return 'Укажите корректный e-mail.';
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              TextFormField(
                                controller: _passwordController,
                                decoration: const InputDecoration(
                                  labelText: 'Пароль',
                                  prefixIcon: Icon(Icons.lock_outline_rounded),
                                ),
                                obscureText: true,
                                textInputAction: TextInputAction.done,
                                onFieldSubmitted: (_) => _loading ? null : _submit(),
                                validator: (value) {
                                  if (value == null || value.trim().length < 5) {
                                    return 'Пароль должен содержать минимум 5 символов.';
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              AnimatedSwitcher(
                                duration: const Duration(milliseconds: 250),
                                child: _error == null
                                    ? const SizedBox.shrink()
                                    : Container(
                                        key: ValueKey<String?>(_error),
                                        padding: const EdgeInsets.all(12),
                                        decoration: BoxDecoration(
                                          color: theme.colorScheme.errorContainer,
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        child: Text(
                                          _error!,
                                          style: TextStyle(
                                            color: theme.colorScheme.onErrorContainer,
                                          ),
                                        ),
                                      ),
                              ),
                              const SizedBox(height: 18),
                              ElevatedButton.icon(
                                onPressed: _logButtonPress(
                                  'auth submit',
                                  _loading ? null : _submit,
                                ),
                                icon: _loading
                                    ? SizedBox(
                                        width: 20,
                                        height: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          valueColor: AlwaysStoppedAnimation<Color>(
                                            theme.colorScheme.onPrimary,
                                          ),
                                        ),
                                      )
                                    : Icon(_isLogin ? Icons.login_rounded : Icons.check_circle_outline),
                                label: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 2),
                                  child: Text(_isLogin ? 'Войти' : 'Зарегистрироваться'),
                                ),
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 14),
                                ),
                              ),
                              const SizedBox(height: 10),
                              OutlinedButton(
                                onPressed: _logButtonPress(
                                  'auth toggle mode',
                                  _loading
                                      ? null
                                      : () {
                                          UiLogger.action('AUTH', 'toggle mode', details: {
                                            'target': _isLogin ? 'register' : 'login',
                                          });
                                          setState(() {
                                            _isLogin = !_isLogin;
                                            _error = null;
                                          });
                                        },
                                ),
                                child: Text(
                                  _isLogin ? 'Регистрация' : 'У меня уже есть аккаунт',
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
            );
          },
        ),
      ),
    );
  }
}

