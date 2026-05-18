import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from './context/ApiContext';
import AuthPage from './pages/AuthPage';
import { getRoleLabel } from './utils/roles';
import { sanitizeUiText } from './utils/text';

const DialogsPage = React.lazy(() => import('./pages/DialogsPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const SurveysPage = React.lazy(() => import('./pages/SurveysPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));

type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'mobilebot-companion-theme';
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'mobilebot-app-sidebar-collapsed';

const PageLoader: React.FC = () => (
  <div className="page-loader">
    <p className="text-muted">Загрузка...</p>
  </div>
);

const App: React.FC = () => {
  const { session, apiClient, setSession, logout } = useApi();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const currentUser = session?.user ?? null;
  const isAdmin = currentUser?.isAdmin ?? false;
  const currentRoleLabel = getRoleLabel(currentUser?.role);
  const safeCurrentUserName = useMemo(
    () => sanitizeUiText(currentUser?.name) || sanitizeUiText(currentUser?.login) || 'Пользователь',
    [currentUser?.login, currentUser?.name],
  );

  const navigationTabs = useMemo(() => {
    if (!currentUser) return [] as { path: string; label: string; icon: React.ReactNode }[];
    const tabs: { path: string; label: string; icon: React.ReactNode }[] = [
      {
        path: '/dialogs',
        label: 'Диалоги',
        icon: (
          <svg className="app-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ];
    if (isAdmin) {
      tabs.push({
        path: '/dashboard',
        label: 'Дашборд',
        icon: (
          <svg className="app-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
        ),
      });
      tabs.push({
        path: '/admin',
        label: 'Сотрудники',
        icon: (
          <svg className="app-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        ),
      });
      tabs.push({
        path: '/surveys',
        label: '\u041E\u043F\u0440\u043E\u0441\u044B',
        icon: (
          <svg className="app-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11h6" />
            <path d="M9 15h6" />
            <path d="M17 3H7a2 2 0 0 0-2 2v14l4-2 4 2 4-2 4 2V5a2 2 0 0 0-2-2z" />
          </svg>
        ),
      });
    }
    return tabs;
  }, [currentUser, isAdmin]);

  const profileInitials = useMemo(() => {
    const source = safeCurrentUserName.trim() || 'MB';
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [safeCurrentUserName]);


  const isDashboardRoute = location.pathname.startsWith('/dashboard');
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isProfileRoute = location.pathname.startsWith('/profile');
  const isSurveysRoute = location.pathname.startsWith('/surveys');

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
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, isSidebarCollapsed ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  }, [isSidebarCollapsed]);

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
    <div className={`app-shell app-shell--sidebar ${isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''} ${isDashboardRoute ? 'app-shell--dashboard' : ''} ${isAdminRoute ? 'app-shell--admin' : ''} ${isProfileRoute ? 'app-shell--profile' : ''} ${isSurveysRoute ? 'app-shell--surveys' : ''}`}>
      <div className="app-shell__ambient app-shell__ambient--one" aria-hidden="true" />
      <div className="app-shell__ambient app-shell__ambient--two" aria-hidden="true" />

      <div className="shell-layout">
        <aside className="app-sidebar">
          <div className="app-sidebar__brand" aria-label="MobileBot">
            {!isSidebarCollapsed && (
              <>
                <span className="app-sidebar__brand-mark">MB</span>
                <div className="app-sidebar__brand-copy">
                  <span className="app-sidebar__logo">MobileBot</span>
                  <span className="app-sidebar__logo-sub">Operator Console</span>
                </div>
              </>
            )}
            <button
              type="button"
              className={`panel-collapse-toggle panel-collapse-toggle--sidebar ${isSidebarCollapsed ? 'is-collapsed' : ''}`}
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              aria-label={isSidebarCollapsed ? 'Развернуть левую панель' : 'Свернуть левую панель'}
              title={isSidebarCollapsed ? 'Развернуть левую панель' : 'Свернуть левую панель'}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12.5 4.5-5 5 5 5" />
              </svg>
            </button>
          </div>

          <nav className="app-sidebar__nav" role="navigation" aria-label="Основная навигация">
            {navigationTabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) => `app-sidebar__item ${isActive ? 'is-active' : ''}`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="app-sidebar__footer">
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="profile-button profile-button--sidebar"
              title="Открыть профиль"
            >
              <span className="profile-button__avatar profile-button__avatar--sidebar">{profileInitials}</span>
              <span className="profile-button__body">
                <span className="profile-button__name">{safeCurrentUserName}</span>
                <span className="profile-button__role">{currentRoleLabel}</span>
              </span>
            </button>

            <div className="app-sidebar__actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                aria-label={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
                title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {theme === 'dark' ? (
                    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2" />
                      <path d="M12 20v2" />
                      <path d="m4.93 4.93 1.41 1.41" />
                      <path d="m17.66 17.66 1.41 1.41" />
                      <path d="M2 12h2" />
                      <path d="M20 12h2" />
                      <path d="m6.34 17.66-1.41 1.41" />
                      <path d="m19.07 4.93-1.41 1.41" />
                    </>
                  )}
                </svg>
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
        </aside>

        <section className="app-content">

          <main className="app-main app-main--sidebar">
            <div key={location.pathname} className="app-page-transition">
              <Suspense fallback={<PageLoader />}>
                <Routes location={location}>
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
                    path="/surveys/*"
                    element={isAdmin ? <SurveysPage apiClient={apiClient} /> : <Navigate to="/dialogs" replace />}
                  />
                  <Route
                    path="/profile"
                    element={<ProfilePage apiClient={apiClient} session={session} onSessionUpdate={setSession} onLogout={logout} />}
                  />
                  <Route path="*" element={<Navigate to="/dialogs" replace />} />
                </Routes>
              </Suspense>
            </div>
          </main>
        </section>
      </div>
    </div>
  );
};

export default App;

