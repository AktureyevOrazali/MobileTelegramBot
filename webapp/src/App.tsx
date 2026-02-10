import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import DialogsPage from './pages/DialogsPage';
import { useApi } from './context/ApiContext';
import AuthPage from './pages/AuthPage';

// Lazy-loaded pages (code-split into separate chunks)
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));

type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'mobilebot-companion-theme';

const PageLoader: React.FC = () => (
  <div style={{ padding: 48, textAlign: 'center' }}>
    <p className="text-muted">Загрузка…</p>
  </div>
);

const App: React.FC = () => {
  const { session, apiClient, setSession, logout } = useApi();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const currentUser = session?.user ?? null;
  const isAdmin = currentUser?.isAdmin ?? false;

  const navigationTabs = useMemo(() => {
    if (!currentUser) return [] as { path: string; label: string }[];
    const tabs: { path: string; label: string }[] = [{ path: '/dialogs', label: 'Диалоги' }];
    if (isAdmin) {
      tabs.push({ path: '/dashboard', label: 'Дэшборд' });
      tabs.push({ path: '/admin', label: 'Администрирование' });
    }
    return tabs;
  }, [currentUser, isAdmin]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => {
      try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
        if (stored === 'light' || stored === 'dark') return;
      } catch {
        // ignore
      }
      setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage onAuthenticated={setSession} apiClient={apiClient} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="container app-header__inner">
          <div className="app-header__left">
            <span className="app-header__logo">MobileBot</span>
            <nav className="app-header__nav">
              {navigationTabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  className={({ isActive }) => `app-header__tab ${isActive ? 'is-active' : ''}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="app-header__right">
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="profile-button"
              title="Открыть профиль"
            >
              <span className="profile-button__avatar">👤</span>
              <span className="profile-button__body">
                <span className="profile-button__name">{currentUser?.name}</span>
                <span className="profile-button__role">
                  {currentUser?.role === 'admin'
                    ? 'Админ'
                    : currentUser?.role === 'moderator'
                      ? 'Модератор'
                      : 'Оператор'}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? '🌙' : '☀️'}
            </button>
            <button className="app-header__logout" type="button" onClick={logout} title="Выйти">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{ marginTop: 12 }}>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dialogs" replace />} />
            <Route path="/dialogs" element={<DialogsPage apiClient={apiClient} session={session} />} />
            <Route
              path="/dashboard"
              element={isAdmin ? <DashboardPage apiClient={apiClient} /> : <Navigate to="/dialogs" replace />}
            />
            <Route
              path="/admin"
              element={isAdmin ? <AdminPage apiClient={apiClient} currentUser={currentUser!} /> : <Navigate to="/dialogs" replace />}
            />
            <Route
              path="/profile"
              element={<ProfilePage apiClient={apiClient} session={session} onSessionUpdate={setSession} onLogout={logout} />}
            />
            <Route path="*" element={<Navigate to="/dialogs" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

export default App;