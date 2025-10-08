import React, { useEffect, useMemo, useState } from 'react';
import AuthPage from './pages/AuthPage';
import DialogsPage from './pages/DialogsPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import { useApi } from './context/ApiContext';

const tabs = ['dialogs', 'admin', 'profile'] as const;
type TabKey = (typeof tabs)[number];

const App: React.FC = () => {
  const { session, apiClient, setSession, logout } = useApi();
  const [activeTab, setActiveTab] = useState<TabKey>('dialogs');

  const currentUser = session?.user ?? null;
  const availableTabs = useMemo(() => {
    if (!currentUser) return [] as TabKey[];
    return currentUser.isAdmin ? tabs.slice() : (['dialogs', 'profile'] as TabKey[]);
  }, [currentUser]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab) && availableTabs.length > 0) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs]);

  if (!session) {
    return <AuthPage onAuthenticated={setSession} apiClient={apiClient} />;
  }

  return (
    <div style={{ paddingBottom: 32 }}>
      <header style={{ padding: '24px 0 0 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="heading" style={{ fontSize: '1.8rem' }}>Telegram Companion Web</h1>
            <p className="text-muted" style={{ marginTop: 6 }}>
              Единый веб-интерфейс для операторов Telegram бота
            </p>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{currentUser?.name}</div>
              <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                {currentUser?.role === 'admin'
                  ? 'Администратор'
                  : currentUser?.role === 'moderator'
                  ? 'Модератор'
                  : 'Оператор'}
              </div>
            </div>
            <button className="button secondary" type="button" onClick={logout}>Выйти</button>
          </div>
        </div>

        <nav className="tab-bar">
          {availableTabs.map((tab) => (
            <button
              key={tab}
              className={`tab-button ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === 'dialogs' && 'Диалоги'}
              {tab === 'admin' && 'Администрирование'}
              {tab === 'profile' && 'Профиль'}
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
