import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';

const ChatLayout = () => {
  const { feedback, clearFeedback } = useFeedback();
  const { session, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => clearFeedback(), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [feedback, clearFeedback]);

  if (!session) {
    return null;
  }

  const isAdmin = session.user.role === 'admin';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          background: '#fff',
          borderBottom: '1px solid rgba(62, 90, 168, 0.12)',
          padding: '12px 24px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Telegram Companion</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: 14 }}>
              {session.user.name} · {session.user.email}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <NavLink
                to="/chats"
                className={({ isActive }) => (isActive || location.pathname === '/') ? 'nav-link active' : 'nav-link'}
              >
                Диалоги
              </NavLink>
              {isAdmin && (
                <NavLink to="/admin" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  Администрирование
                </NavLink>
              )}
              <NavLink to="/profile" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                Профиль
              </NavLink>
            </nav>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/auth', { replace: true });
              }}
              className="outline-button"
            >
              Выйти
            </button>
          </div>
        </div>
        {feedback && (
          <div
            role="status"
            style={{
              marginTop: 12,
              padding: '12px 16px',
              borderRadius: 12,
              background:
                feedback.variant === 'error'
                  ? 'rgba(198, 40, 40, 0.12)'
                  : feedback.variant === 'success'
                    ? 'rgba(46, 125, 50, 0.14)'
                    : 'rgba(62, 90, 168, 0.12)',
              color:
                feedback.variant === 'error'
                  ? 'var(--color-error)'
                  : feedback.variant === 'success'
                    ? '#2e7d32'
                    : 'var(--color-primary)',
              fontWeight: 500,
            }}
          >
            {feedback.message}
          </div>
        )}
      </header>
      <main style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  );
};

export default ChatLayout;
