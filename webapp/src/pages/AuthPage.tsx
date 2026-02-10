import React, { FormEvent, useCallback, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession } from '../types';
import { extractErrorMessage } from '../utils/errors';
import { validateName, validatePassword } from '../utils/validation';

interface AuthPageProps {
  apiClient: ApiClient;
  onAuthenticated: (session: AuthSession) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ apiClient, onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setInfo(null);

      if (mode === 'register') {
        const nameErr = validateName(name);
        if (nameErr) { setError(nameErr); return; }
      }
      const pwdErr = validatePassword(password);
      if (pwdErr) { setError(pwdErr); return; }

      setLoading(true);
      try {
        if (mode === 'login') {
          const session = await apiClient.login(identifier.trim(), password);
          onAuthenticated(session);
          return;
        }
        const result = await apiClient.register(name.trim(), identifier.trim(), password);
        setMode('login');
        setPassword('');
        setInfo(result.message || 'Заявка на регистрацию отправлена. Ожидайте подтверждения модератора.');
      } catch (err) {
        setError(extractErrorMessage(err, 'Не удалось выполнить запрос.'));
      } finally {
        setLoading(false);
      }
    },
    [apiClient, identifier, mode, name, onAuthenticated, password],
  );

  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    setError(null);
    setInfo(null);
  }, []);

  const isLogin = mode === 'login';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-card__title">
          {isLogin ? 'Вход' : 'Регистрация'}
        </h2>

        <form onSubmit={handleSubmit} className="auth-form">
          {!isLogin && (
            <div className="auth-field">
              <label className="auth-field__label" htmlFor="auth-name">
                Имя и фамилия
              </label>
              <input
                id="auth-name"
                className="auth-field__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иван Иванов"
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-id">
              {isLogin ? 'Логин или e-mail' : 'Рабочий e-mail'}
            </label>
            <input
              id="auth-id"
              className="auth-field__input"
              type={isLogin ? 'text' : 'email'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={isLogin ? 'login или email' : 'name@company.kz'}
              required
              autoComplete={isLogin ? 'username' : 'email'}
            />
          </div>

          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-pw">
              Пароль
            </label>
            <input
              id="auth-pw"
              className="auth-field__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
              required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {info && <div className="auth-alert auth-alert--success">{info}</div>}
          {error && <div className="auth-alert auth-alert--error">{error}</div>}

          <button
            className={`auth-submit ${loading ? 'auth-submit--loading' : ''}`}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Проверяем…' : isLogin ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        <div className="auth-toggle">
          <button
            className="auth-toggle__btn"
            type="button"
            onClick={handleToggleMode}
          >
            {isLogin ? 'Создать новый аккаунт' : 'У меня уже есть аккаунт'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;