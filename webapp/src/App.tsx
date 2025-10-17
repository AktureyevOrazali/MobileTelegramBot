import React, { useEffect, useMemo, useState } from 'react';
import AuthPage from './pages/AuthPage';
import DialogsPage from './pages/DialogsPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import { useApi } from './context/ApiContext';
import { buttonSecondaryClass, cardClass, containerClass, headingClass, mutedTextClass } from './ui/primitives';
import { cn } from './utils/cn';

const tabs = ['dialogs', 'dashboard', 'admin', 'profile'] as const;
type TabKey = (typeof tabs)[number];

type ThemeMode = 'light' | 'dark';

const navButtonBase =
  'rounded-full px-5 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
const navButtonActive = 'bg-brand-500 text-white shadow-lg shadow-brand-500/20';
const navButtonInactive =
  'bg-white/80 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-700';

const profileButtonClass =
  'inline-flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-brand-400/60 dark:hover:bg-brand-500/10';

const themeToggleClass =
  'inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-brand-400 dark:hover:text-brand-200';

const App: React.FC = () => {
  const { session, apiClient, setSession, logout } = useApi();
  const [activeTab, setActiveTab] = useState<TabKey>('dialogs');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }
    const saved = window.localStorage.getItem('theme-mode') as ThemeMode | null;
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const currentUser = session?.user ?? null;
  const navigationTabs = useMemo(() => {
    if (!currentUser) {
      return [] as TabKey[];
    }
    if (currentUser.isAdmin) {
      return ['dialogs', 'dashboard', 'admin'] as TabKey[];
    }
    return ['dialogs'] as TabKey[];
  }, [currentUser]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.className = cn(
      'min-h-screen bg-surface-light font-sans text-slate-900 transition-colors',
      theme === 'dark' && 'bg-slate-950 text-slate-100',
    );
    window.localStorage.setItem('theme-mode', theme);
  }, [theme]);

  useEffect(() => {
    if (activeTab === 'profile') {
      return;
    }
    if (!navigationTabs.includes(activeTab) && navigationTabs.length > 0) {
      setActiveTab(navigationTabs[0]);
    }
  }, [activeTab, navigationTabs]);

  if (!session) {
    return <AuthPage onAuthenticated={setSession} apiClient={apiClient} />;
  }

  return (
    <div
      className={cn(
        'min-h-screen bg-gradient-to-b from-brand-500/10 via-transparent to-transparent text-slate-900 transition-colors dark:from-slate-900/40 dark:via-slate-950 dark:to-slate-950 dark:text-slate-100',
      )}
    >
      <header className="pt-6">
        <div className={cn(containerClass, 'flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between')}>
          <div className={cn(cardClass, 'w-full bg-white/90 dark:bg-slate-900/70 lg:w-auto')}>
            <h1 className={cn(headingClass, 'text-3xl')}>Telegram Companion Web</h1>
            <p className={cn(mutedTextClass, 'mt-2 text-base')}>
              Единый веб-интерфейс для операторов Telegram бота
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => setTheme((mode) => (mode === 'dark' ? 'light' : 'dark'))}
              className={themeToggleClass}
            >
              <span>{theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'}</span>
              <span aria-hidden>·</span>
              <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                переключить
              </span>
            </button>
            <button type="button" onClick={() => setActiveTab('profile')} className={profileButtonClass} title="Профиль">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-xl text-brand-600 dark:bg-brand-500/20 dark:text-brand-200">
                👤
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {currentUser?.name}
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {currentUser?.role === 'admin'
                    ? 'Администратор'
                    : currentUser?.role === 'moderator'
                    ? 'Модератор'
                    : 'Оператор'}
                </span>
              </div>
            </button>
            <button className={buttonSecondaryClass} type="button" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>

        <nav className="mt-6">
          <div className={cn(containerClass, 'flex flex-wrap justify-center gap-3')}>
            {navigationTabs.map((tab) => (
              <button
                key={tab}
                className={cn(navButtonBase, activeTab === tab ? navButtonActive : navButtonInactive)}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {tab === 'dialogs' && 'Диалоги'}
                {tab === 'dashboard' && 'Дэшборд'}
                {tab === 'admin' && 'Администрирование'}
              </button>
            ))}
            <button
              className={cn(navButtonBase, activeTab === 'profile' ? navButtonActive : navButtonInactive)}
              onClick={() => setActiveTab('profile')}
              type="button"
            >
              Профиль
            </button>
          </div>
        </nav>
      </header>

      <main className={cn(containerClass, 'mt-8 pb-16')}>
        {activeTab === 'dialogs' && session && <DialogsPage apiClient={apiClient} session={session} />}
        {activeTab === 'dashboard' && session && currentUser?.isAdmin && (
          <DashboardPage apiClient={apiClient} />
        )}
        {activeTab === 'admin' && session && currentUser?.isAdmin && (
          <AdminPage apiClient={apiClient} currentUser={currentUser} />
        )}
        {activeTab === 'profile' && session && (
          <ProfilePage apiClient={apiClient} session={session} onSessionUpdate={setSession} onLogout={logout} />
        )}
      </main>
    </div>
  );
};

export default App;