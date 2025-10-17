import React, { FormEvent, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { AuthSession } from '../types';
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  cardClass,
  headingClass,
  inputClass,
  labelClass,
  mutedTextClass,
} from '../ui/primitives';
import { cn } from '../utils/cn';

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
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
      const session =
        mode === 'login'
          ? await apiClient.login(identifier.trim(), password)
          : await apiClient.register(name.trim(), identifier.trim(), password);
      onAuthenticated(session);
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-500/10 via-transparent to-transparent px-4 py-12 dark:from-slate-900/40 dark:via-slate-950">
      <div className={cn(cardClass, 'w-full max-w-md space-y-6')}>
        <div className="space-y-2 text-center">
          <h2 className={cn(headingClass, 'text-3xl')}>
            {mode === 'login' ? 'Добро пожаловать' : 'Создание аккаунта'}
          </h2>
          <p className={cn(mutedTextClass, 'text-sm')}> 
            {mode === 'login'
              ? 'Введите логин или e-mail и пароль, чтобы продолжить работу.'
              : 'Заполните форму, чтобы подключиться к системе. Пароль должен содержать минимум 5 символов.'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'register' && (
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Имя и фамилия</span>
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Иван Иванов"
              />
            </label>
          )}
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{mode === 'login' ? 'Логин или e-mail' : 'Рабочий e-mail'}</span>
            <input
              className={inputClass}
              type={mode === 'login' ? 'text' : 'email'}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={mode === 'login' ? 'login или email' : 'name@company.kz'}
              required
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelClass}>Пароль</span>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              required
            />
          </label>
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200">
              {error}
            </div>
          )}
          <button className={buttonPrimaryClass} type="submit" disabled={loading}>
            {loading ? 'Проверяем...' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
        <div className="text-center">
          <button
            className={buttonSecondaryClass}
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