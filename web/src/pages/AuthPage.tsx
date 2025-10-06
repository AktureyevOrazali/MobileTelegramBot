import { FormEvent, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';

const MIN_PASSWORD_LENGTH = 5;

const AuthPage = () => {
  const { login, register, session, initializing } = useSession();
  const navigate = useNavigate();
  const { showFeedback, clearFeedback } = useFeedback();
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string | null>(null);

  useEffect(() => {
    if (!initializing && session) {
      navigate('/', { replace: true });
    }
  }, [initializing, navigate, session]);

  useEffect(() => clearFeedback(), [isLogin, clearFeedback]);

  const validate = () => {
    if (!isLogin && name.trim().length < 2) {
      setErrors('Имя должно содержать минимум 2 символа.');
      return false;
    }
    if (!isLogin) {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        setErrors('Укажите корректный e-mail.');
        return false;
      }
    } else if (email.trim().length === 0) {
      setErrors('Введите логин или e-mail.');
      return false;
    }
    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      setErrors('Пароль должен содержать минимум 5 символов.');
      return false;
    }
    setErrors(null);
    return true;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        await login(email.trim(), password);
        showFeedback('Добро пожаловать обратно!', { variant: 'success' });
      } else {
        await register({ name: name.trim(), email: email.trim(), password });
        showFeedback('Регистрация завершена. Добро пожаловать!', { variant: 'success' });
      }
      navigate('/', { replace: true });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Что-то пошло не так.';
      setErrors(message);
      showFeedback(message, { variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const description = isLogin
    ? 'Введите логин или e-mail и пароль, чтобы продолжить работу.'
    : 'Заполните форму, чтобы подключиться. Пароль должен содержать минимум 5 символов.';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, rgba(62,90,168,0.18) 0%, var(--color-surface) 100%)',
        padding: '32px 16px',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
                {isLogin ? 'Добро пожаловать' : 'Создание аккаунта'}
              </h1>
              <p style={{ marginTop: 8, color: 'var(--color-on-surface-variant)' }}>{description}</p>
            </div>
            {!isLogin && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>Имя и фамилия</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Введите имя"
                  required={!isLogin}
                  minLength={2}
                  style={inputStyle}
                />
              </label>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>{isLogin ? 'Логин или e-mail' : 'Рабочий e-mail'}</span>
              <input
                type={isLogin ? 'text' : 'email'}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={isLogin ? 'login или email' : 'example@company.com'}
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Введите пароль"
                minLength={MIN_PASSWORD_LENGTH}
                style={inputStyle}
              />
            </label>
            {errors && (
              <div
                role="alert"
                style={{
                  background: 'rgba(198, 40, 40, 0.12)',
                  color: 'var(--color-error)',
                  padding: '12px 16px',
                  borderRadius: 12,
                }}
              >
                {errors}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                padding: '14px 18px',
                borderRadius: 14,
                background: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                fontSize: 16,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer',
                opacity: loading ? 0.8 : 1,
              }}
            >
              {loading ? 'Загрузка…' : isLogin ? 'Войти' : 'Зарегистрироваться'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsLogin((prev) => !prev);
                setErrors(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-primary)',
                cursor: 'pointer',
                fontWeight: 600,
                padding: '8px 0',
              }}
            >
              {isLogin ? 'Создать новый аккаунт' : 'У меня уже есть аккаунт'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const inputStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-outline)',
  background: 'rgba(255,255,255,0.9)',
};

export default AuthPage;
