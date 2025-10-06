import { ChangeEvent, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ApiError } from '@/api/client';
import { RoleInfo, Section, UserProfile } from '@/api/types';
import { useFeedback } from '@/context/FeedbackContext';
import { useSession } from '@/context/SessionContext';

const AdminPage = () => {
  const { apiClient, session } = useSession();
  const { showFeedback } = useFeedback();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [bins, setBins] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingUserIds, setUpdatingUserIds] = useState<number[]>([]);

  const isAdmin = apiClient.isAdmin(session?.user ?? null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const [rolesResponse, usersResponse, sectionsResponse, binsResponse] = await Promise.all([
          apiClient.fetchRoles(),
          apiClient.fetchUsers(searchQuery.trim() ? { query: searchQuery.trim() } : undefined),
          apiClient.fetchSections(),
          apiClient.fetchBins(),
        ]);
        setRoles(rolesResponse);
        setUsers(usersResponse);
        setSections(sectionsResponse);
        setBins(binsResponse);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Не удалось загрузить данные';
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    const timer = window.setTimeout(load, 300);
    return () => window.clearTimeout(timer);
  }, [apiClient, isAdmin, searchQuery]);

  const onRoleChange = async (user: UserProfile, role: string) => {
    try {
      setUpdatingUserIds((prev) => [...prev, user.id]);
      const updated = await apiClient.updateUserRole(user.id, role);
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showFeedback(`Роль пользователя «${updated.name}» обновлена.`, { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить роль';
      showFeedback(message, { variant: 'error' });
    } finally {
      setUpdatingUserIds((prev) => prev.filter((id) => id !== user.id));
    }
  };

  const onSectionsChange = async (user: UserProfile, event: ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    try {
      setUpdatingUserIds((prev) => [...prev, user.id]);
      const updated = await apiClient.updateUserSections(user.id, selected);
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showFeedback(`Разделы пользователя «${updated.name}» обновлены.`, { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить разделы';
      showFeedback(message, { variant: 'error' });
    } finally {
      setUpdatingUserIds((prev) => prev.filter((id) => id !== user.id));
    }
  };

  const onBinsChange = async (user: UserProfile, event: ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    try {
      setUpdatingUserIds((prev) => [...prev, user.id]);
      const updated = await apiClient.updateUserBins(user.id, selected);
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      showFeedback(`БИНы пользователя «${updated.name}» обновлены.`, { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить БИНы';
      showFeedback(message, { variant: 'error' });
    } finally {
      setUpdatingUserIds((prev) => prev.filter((id) => id !== user.id));
    }
  };

  const onResetPassword = async (user: UserProfile) => {
    const newPassword = window.prompt(`Введите новый пароль для «${user.name}» (минимум 5 символов):`);
    if (!newPassword) {
      return;
    }
    if (newPassword.trim().length < 5) {
      showFeedback('Пароль должен содержать не менее 5 символов.', { variant: 'error' });
      return;
    }
    try {
      setUpdatingUserIds((prev) => [...prev, user.id]);
      await apiClient.adminSetUserPassword(user.id, newPassword.trim());
      showFeedback(`Пароль пользователя «${user.name}» обновлён.`, { variant: 'success' });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Не удалось обновить пароль';
      showFeedback(message, { variant: 'error' });
    } finally {
      setUpdatingUserIds((prev) => prev.filter((id) => id !== user.id));
    }
  };

  const busyUsers = useMemo(() => new Set(updatingUserIds), [updatingUserIds]);

  if (!isAdmin) {
    return <p>Недостаточно прав для просмотра раздела.</p>;
  }

  if (loading) {
    return <p>Загрузка данных…</p>;
  }

  if (error) {
    return <p style={{ color: 'var(--color-error)' }}>Ошибка: {error}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span>Поиск по имени, логину или e-mail</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Начните вводить для фильтрации"
            style={{ padding: '12px 16px', borderRadius: 14, border: '1px solid var(--color-outline)' }}
          />
        </label>
      </div>
      {users.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p>Пока нет зарегистрированных операторов.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {users.map((user) => {
            const isUpdating = busyUsers.has(user.id);
            const isSelf = user.id === session?.user.id;
            return (
              <article key={user.id} className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{user.name}</h3>
                    <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)' }}>
                      {user.login} · {user.email}
                    </p>
                  </div>
                  <span className="chip">{apiClient.getRoleLabel(user.role)}</span>
                </header>
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <label style={labelStyle}>
                    <span>Роль</span>
                    <select
                      value={user.role}
                      onChange={(event) => onRoleChange(user, event.target.value)}
                      disabled={isUpdating || isSelf}
                      style={inputStyle}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.title}
                        </option>
                      ))}
                    </select>
                    {isSelf && <small style={{ color: 'var(--color-on-surface-variant)' }}>Нельзя изменить собственную роль.</small>}
                  </label>
                  <label style={labelStyle}>
                    <span>Разделы</span>
                    <select
                      multiple
                      value={user.sections}
                      onChange={(event) => onSectionsChange(user, event)}
                      disabled={isUpdating}
                      style={{ ...inputStyle, minHeight: 120 }}
                    >
                      {sections.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    <span>БИНы</span>
                    <select
                      multiple
                      value={user.bins}
                      onChange={(event) => onBinsChange(user, event)}
                      disabled={isUpdating}
                      style={{ ...inputStyle, minHeight: 120 }}
                    >
                      {bins.map((bin) => (
                        <option key={bin} value={bin}>
                          {bin}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => onResetPassword(user)}
                    disabled={isUpdating}
                  >
                    Сменить пароль
                  </button>
                  <span style={{ color: 'var(--color-on-surface-variant)', fontSize: 13 }}>
                    Создан: {new Date(user.createdAt).toLocaleString('ru-RU')}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontWeight: 500,
};

const inputStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-outline)',
  background: '#fff',
};

export default AdminPage;
