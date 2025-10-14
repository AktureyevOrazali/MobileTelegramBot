import React, { useEffect, useMemo, useState } from 'react';
import AuthPage from './pages/AuthPage';
import DialogsPage from './pages/DialogsPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import { useApi } from './context/ApiContext';

type TabKey = 'dialogs' | 'admin' | 'profile';
type NavTabKey = Exclude<TabKey, 'profile'>;

const App: React.FC = () => {
  const { session, apiClient, setSession, logout } = useApi();
  const [activeTab, setActiveTab] = useState<TabKey>('dialogs');

  const currentUser = session?.user ?? null;
  const navigationTabs = useMemo<NavTabKey[]>(() => {
    if (!currentUser) return [];
    return currentUser.isAdmin ? ['dialogs', 'admin'] : ['dialogs'];
  }, [currentUser]);

  useEffect(() => {
    if (activeTab === 'profile') {
      return;
    }
    if (navigationTabs.length > 0 && !navigationTabs.includes(activeTab as NavTabKey)) {
      setActiveTab(navigationTabs[0]);
    }
  }, [activeTab, navigationTabs]);

  const tabLabels: Record<NavTabKey, string> = useMemo(
    () => ({ dialogs: 'Диалоги', admin: 'Администрирование' }),
    [],
  );

  if (!session) {
    return <AuthPage onAuthenticated={setSession} apiClient={apiClient} />;
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <header style={{ padding: '24px 0 0 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="heading" style={{ fontSize: '1.8rem' }}>Telegram Companion Web</h1>
            <p className="text-muted" style={{ marginTop: 6 }}>Единый веб-интерфейс для операторов Telegram бота</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className="profile-button"
              title="Открыть профиль"
            >
              <span className="profile-button__avatar">👤</span>
              <span className="profile-button__body">
                <span className="profile-button__name">{currentUser?.name}</span>
                <span className="profile-button__role">
                  {currentUser?.role === 'admin'
                    ? 'Администратор'
                    : currentUser?.role === 'moderator'
                    ? 'Модератор'
                    : 'Оператор'}
                </span>
              </span>
            </button>
            <button className="button secondary" type="button" onClick={logout}>Выйти</button>
          </div>
        </div>

        <nav className="tab-bar">
          {navigationTabs.map((tab) => (
            <button
              key={tab}
              className={`tab-button ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tabLabels[tab]}
            </button>
          ))}
        </nav>
      </header>

      <main className="container" style={{ marginTop: 16 }}>
        {activeTab === 'dialogs' && session && <DialogsPage apiClient={apiClient} session={session} />}
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
