import React, { FormEvent, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { AuthSession } from '../types';

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === 'register' && name.trim().length < 2) {
      setError('Имя должно содержать минимум 2 символа.');
      return;
    }
    if (password.trim().length < 5) {
      setError('Пароль должен содержать минимум 5 символов.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'login') {
        const session = await apiClient.login(identifier.trim(), password);
        onAuthenticated(session);
        return;
      }

      await apiClient.register(name.trim(), identifier.trim(), password);
      setMode('login');
      setPassword('');
      setInfo('Аккаунт создан. Войдите, используя свои учетные данные.');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Не удалось выполнить запрос.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(460px, 100%)' }}>
        <h2 className="heading" style={{ marginBottom: 12 }}>
          {mode === 'login' ? 'Добро пожаловать' : 'Создание аккаунта'}
        </h2>
        <p className="text-muted" style={{ marginBottom: 24 }}>
          {mode === 'login'
            ? 'Введите логин или e-mail и пароль, чтобы продолжить работу.'
            : 'Заполните форму, чтобы подключиться к системе. Пароль должен содержать минимум 5 символов.'}
        </p>
        <form onSubmit={handleSubmit} className="flex-gap" style={{ flexDirection: 'column', display: 'flex' }}>
          {mode === 'register' && (
            <label className="label" style={{ width: '100%' }}>
              Имя и фамилия
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Иван Иванов"
              />
            </label>
          )}
          <label className="label">
            {mode === 'login' ? 'Логин или e-mail' : 'Рабочий e-mail'}
            <input
              className="input"
              type={mode === 'login' ? 'text' : 'email'}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={mode === 'login' ? 'login или email' : 'name@company.kz'}
              required
            />
          </label>
          <label className="label">
            Пароль
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              required
            />
          </label>
          {info && <div className="alert alert--success">{info}</div>}
          {error && <div className="alert">{error}</div>}
          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Проверяем...' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Создать новый аккаунт' : 'У меня уже есть аккаунт'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;