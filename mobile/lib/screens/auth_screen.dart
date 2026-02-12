part of '../main.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    required this.apiClient,
    required this.onAuthenticated,
    required this.themeMode,
    required this.onThemeModeChanged,
    this.isLogin,
    super.key,
  });

  final bool? isLogin;
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
  String? _info;

  @override
  void initState() {
    super.initState();
    _isLogin = widget.isLogin ?? true;
    UiLogger.page('Auth', details: {'mode': _isLogin ? 'login' : 'register'});
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
    UiLogger.action('AUTH', 'form submitted',
        details: {'mode': _isLogin ? 'login' : 'register'});
    setState(() {
      _loading = true;
      _error = null;
      _info = null;
    });
    try {
      if (_isLogin) {
        final session = await widget.apiClient
            .login(_emailController.text.trim(), _passwordController.text);
        UiLogger.action('AUTH', 'success',
            details: {'mode': _isLogin ? 'login' : 'register'});
        widget.onAuthenticated(session);
        return;
      }

      final message = await widget.apiClient.register(
        _nameController.text.trim(),
        _emailController.text.trim(),
        _passwordController.text,
      );
      UiLogger.action('AUTH', 'success',
          details: {'mode': _isLogin ? 'login' : 'register'});
      setState(() {
        _info = message;
        _isLogin = true;
        _passwordController.clear();
      });
      return;
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
    final colorScheme = theme.colorScheme;

    final platformBrightness = MediaQuery.of(context).platformBrightness;
    final isDarkModeActive = widget.themeMode == ThemeMode.dark ||
        (widget.themeMode == ThemeMode.system &&
            platformBrightness == Brightness.dark);
    final themeToggleIcon =
        isDarkModeActive ? Icons.light_mode : Icons.dark_mode;
    final themeToggleTooltip =
        isDarkModeActive ? 'Светлая тема' : 'Тёмная тема';
    final nextThemeMode = isDarkModeActive ? ThemeMode.light : ThemeMode.dark;

    Widget buildMessageBox({
      required String text,
      required Color background,
      required Color foreground,
      required Key key,
    }) {
      return Container(
        key: key,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          text,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: foreground,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppGradients.authBackground(colorScheme),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final availableHeight =
                  constraints.maxHeight.isFinite ? constraints.maxHeight : 0.0;
              final effectiveMinHeight =
                  availableHeight > 24 ? availableHeight - 24 : 0.0;

              return SingleChildScrollView(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: effectiveMinHeight),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 460),
                      child: Stack(
                        children: [
                          Positioned(
                            top: 36,
                            right: 0,
                            child: Container(
                              width: 120,
                              height: 120,
                              decoration: BoxDecoration(
                                color: colorScheme.primary.withOpacity(0.16),
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          Positioned(
                            left: 8,
                            top: 140,
                            child: Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: colorScheme.secondary.withOpacity(0.16),
                                shape: BoxShape.circle,
                              ),
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Align(
                                alignment: Alignment.centerRight,
                                child: IconButton.filledTonal(
                                  onPressed: _logButtonPress(
                                    'toggle theme from auth screen',
                                    () => widget
                                        .onThemeModeChanged(nextThemeMode),
                                  ),
                                  tooltip: themeToggleTooltip,
                                  icon: Icon(themeToggleIcon),
                                ),
                              ),
                              const SizedBox(height: 8),
                              Column(
                                children: [
                                  Container(
                                    width: 74,
                                    height: 74,
                                    decoration: BoxDecoration(
                                      gradient: AppGradients.primaryAction(
                                          colorScheme),
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: colorScheme.primary
                                              .withOpacity(0.35),
                                          blurRadius: 24,
                                          spreadRadius: 2,
                                          offset: const Offset(0, 6),
                                        ),
                                        BoxShadow(
                                          color: colorScheme.primary
                                              .withOpacity(0.15),
                                          blurRadius: 40,
                                          spreadRadius: 8,
                                        ),
                                      ],
                                    ),
                                    child: Icon(
                                      _isLogin
                                          ? Icons.lock_person_rounded
                                          : Icons.person_add_alt_1,
                                      color: colorScheme.onPrimary,
                                      size: 34,
                                    ),
                                  ),
                                  const SizedBox(height: 14),
                                  Text(
                                    'MobileBot Companion',
                                    textAlign: TextAlign.center,
                                    style:
                                        theme.textTheme.headlineSmall?.copyWith(
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.2,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _isLogin
                                        ? 'Вход в рабочий кабинет'
                                        : 'Регистрация нового сотрудника',
                                    textAlign: TextAlign.center,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Container(
                                decoration: BoxDecoration(
                                  color: colorScheme.surface.withOpacity(0.85),
                                  borderRadius: BorderRadius.circular(24),
                                  border: Border.all(
                                      color: colorScheme.outlineVariant
                                          .withOpacity(0.4)),
                                  boxShadow: [
                                    BoxShadow(
                                      color: colorScheme.shadow.withOpacity(0.06),
                                      blurRadius: 20,
                                      offset: const Offset(0, 8),
                                    ),
                                  ],
                                ),
                                child: Padding(
                                  padding:
                                      const EdgeInsets.fromLTRB(14, 16, 14, 14),
                                  child: Form(
                                    key: _formKey,
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        if (!_isLogin)
                                          TextFormField(
                                            controller: _nameController,
                                            decoration: const InputDecoration(
                                              labelText: 'Имя и фамилия',
                                              prefixIcon:
                                                  Icon(Icons.badge_outlined),
                                            ),
                                            textCapitalization:
                                                TextCapitalization.words,
                                            textInputAction:
                                                TextInputAction.next,
                                            validator: (value) {
                                              final trimmed =
                                                  value?.trim() ?? '';
                                              if (trimmed.runes.length < 2) {
                                                return 'Имя должно содержать минимум 2 символа.';
                                              }
                                              return null;
                                            },
                                          ),
                                        if (!_isLogin)
                                          const SizedBox(height: 10),
                                        TextFormField(
                                          controller: _emailController,
                                          decoration: InputDecoration(
                                            labelText: _isLogin
                                                ? 'Логин или e-mail'
                                                : 'Рабочий e-mail',
                                            prefixIcon: const Icon(
                                                Icons.alternate_email_outlined),
                                          ),
                                          keyboardType: _isLogin
                                              ? TextInputType.text
                                              : TextInputType.emailAddress,
                                          textInputAction: TextInputAction.next,
                                          validator: (value) {
                                            final trimmed = value?.trim() ?? '';
                                            if (_isLogin) {
                                              if (trimmed.isEmpty) {
                                                return 'Введите логин или e-mail.';
                                              }
                                              return null;
                                            }
                                            if (trimmed.isEmpty ||
                                                !trimmed.contains('@')) {
                                              return 'Укажите корректный e-mail.';
                                            }
                                            return null;
                                          },
                                        ),
                                        const SizedBox(height: 10),
                                        TextFormField(
                                          controller: _passwordController,
                                          decoration: const InputDecoration(
                                            labelText: 'Пароль',
                                            prefixIcon: Icon(
                                                Icons.lock_outline_rounded),
                                          ),
                                          obscureText: true,
                                          textInputAction: TextInputAction.done,
                                          onFieldSubmitted: (_) =>
                                              _loading ? null : _submit(),
                                          validator: (value) {
                                            if (value == null ||
                                                value.trim().length < 5) {
                                              return 'Пароль должен содержать минимум 5 символов.';
                                            }
                                            return null;
                                          },
                                        ),
                                        const SizedBox(height: 12),
                                        AnimatedSwitcher(
                                          duration:
                                              const Duration(milliseconds: 250),
                                          child: _info == null
                                              ? const SizedBox.shrink()
                                              : buildMessageBox(
                                                  text: _info!,
                                                  background: colorScheme
                                                      .primaryContainer
                                                      .withOpacity(0.55),
                                                  foreground: colorScheme
                                                      .onPrimaryContainer,
                                                  key: ValueKey<String>(
                                                      'info_$_info'),
                                                ),
                                        ),
                                        if (_info != null)
                                          const SizedBox(height: 10),
                                        AnimatedSwitcher(
                                          duration:
                                              const Duration(milliseconds: 250),
                                          child: _error == null
                                              ? const SizedBox.shrink()
                                              : buildMessageBox(
                                                  text: _error!,
                                                  background: colorScheme
                                                      .errorContainer,
                                                  foreground: colorScheme
                                                      .onErrorContainer,
                                                  key: ValueKey<String>(
                                                      'error_$_error'),
                                                ),
                                        ),
                                        const SizedBox(height: 14),
                                        DecoratedBox(
                                          decoration: BoxDecoration(
                                            borderRadius:
                                                BorderRadius.circular(16),
                                            gradient:
                                                AppGradients.primaryAction(
                                                    colorScheme),
                                          ),
                                          child: ElevatedButton.icon(
                                            onPressed: _logButtonPress(
                                              'auth submit',
                                              _loading ? null : _submit,
                                            ),
                                            icon: _loading
                                                ? SizedBox(
                                                    width: 18,
                                                    height: 18,
                                                    child:
                                                        CircularProgressIndicator(
                                                      strokeWidth: 2,
                                                      valueColor:
                                                          AlwaysStoppedAnimation<
                                                              Color>(
                                                        colorScheme.onPrimary,
                                                      ),
                                                    ),
                                                  )
                                                : Icon(
                                                    _isLogin
                                                        ? Icons
                                                            .arrow_forward_rounded
                                                        : Icons
                                                            .check_circle_outline,
                                                  ),
                                            label: Text(_isLogin
                                                ? 'Войти'
                                                : 'Зарегистрироваться'),
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor:
                                                  Colors.transparent,
                                              shadowColor: Colors.transparent,
                                              foregroundColor:
                                                  colorScheme.onPrimary,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(height: 8),
                                        OutlinedButton(
                                          onPressed: _logButtonPress(
                                            'auth toggle mode',
                                            _loading
                                                ? null
                                                : () {
                                                    UiLogger.action(
                                                        'AUTH', 'toggle mode',
                                                        details: {
                                                          'target': _isLogin
                                                              ? 'register'
                                                              : 'login',
                                                        });
                                                    setState(() {
                                                      _isLogin = !_isLogin;
                                                      _error = null;
                                                      _info = null;
                                                    });
                                                  },
                                          ),
                                          child: Text(
                                            _isLogin
                                                ? 'Нет аккаунта? Регистрация'
                                                : 'Уже есть аккаунт? Войти',
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
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
            },
          ),
        ),
      ),
    );
  }
}
