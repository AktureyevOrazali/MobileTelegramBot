import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { RoleInfo, Section, UserProfile } from '../types';
import { formatDateTime } from '../utils/date';
import SelectPill from '../components/SelectPill';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';

interface AdminPageProps {
  apiClient: ApiClient;
  currentUser: UserProfile;
}

interface UserCardProps {
  user: UserProfile;
  roles: RoleInfo[];
  sections: Section[];
  availableBins: string[];
  onRoleSave: (userId: number, role: string) => Promise<void>;
  onSectionsSave: (userId: number, sections: string[]) => Promise<void>;
  onBinsSave: (userId: number, bins: string[]) => Promise<void>;
  onPasswordReset: (userId: number, password: string) => Promise<void>;
  canDeleteUser: boolean;
  onDeleteRequest: (user: UserProfile) => void;
}

const roleLabels: Record<string, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  viewer: 'Оператор',
};

const useDebouncedEffect = (fn: () => void, deps: React.DependencyList, delay = 300) => {
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

const AdminUserCard: React.FC<UserCardProps> = ({
  user,
  roles,
  sections,
  availableBins,
  onRoleSave,
  onSectionsSave,
  onBinsSave,
  onPasswordReset,
  canDeleteUser,
  onDeleteRequest,
}) => {
  const [selectedRole, setSelectedRole] = useState(user.role);
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set(user.sections));
  const [sectionToAdd, setSectionToAdd] = useState<string>('');
  const [assignedBins, setAssignedBins] = useState<string[]>(user.bins);
  const [binToAdd, setBinToAdd] = useState<string>('');

  // состояния автосохранений
  const [savingRole, setSavingRole] = useState(false);
  const [savingSections, setSavingSections] = useState(false);
  const [savingBins, setSavingBins] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // password modal
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setSelectedRole(user.role);
    setSectionIds(new Set(user.sections));
    setSectionToAdd('');
    setAssignedBins(user.bins);
    setBinToAdd('');
  }, [user]);

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.title })),
    [roles],
  );

  const sectionOptions = useMemo(() => {
    return [{ value: '', label: 'Выберите раздел' }].concat(
      sections
        .filter((section) => !sectionIds.has(section.id))
        .map((section) => ({ value: section.id, label: section.title, meta: section.id })),
    );
  }, [sections, sectionIds]);

  const assignedSections = useMemo<Section[]>(() => {
    const mapped = sections.filter((section) => sectionIds.has(section.id));
    const knownIds = new Set(mapped.map((section) => section.id));
    Array.from(sectionIds).forEach((id) => {
      if (!knownIds.has(id)) {
        mapped.push({ id, title: id });
      }
    });
    return mapped;
  }, [sections, sectionIds]);



  const binOptions = useMemo(() => {
    const current = new Set(assignedBins);
    return [{ value: '', label: 'Выберите БИН' }].concat(
      availableBins.filter((b) => !current.has(b)).map((b) => ({ value: b, label: b })),
    );
  }, [availableBins, assignedBins]);

  // ---- Автосохранение роли (мгновенно) ----
  const lastSavedRole = useRef(selectedRole);
  useEffect(() => {
    if (lastSavedRole.current === selectedRole) return;
    (async () => {
      try {
        setSavingRole(true);
        setError(null);
        await onRoleSave(user.id, selectedRole);
        setSuccessMessage('Роль обновлена');
        lastSavedRole.current = selectedRole;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Ошибка при сохранении роли');
      } finally {
        setSavingRole(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole]);

  // ---- Автосохранение разделов (debounce) ----
  const sectionKey = useMemo(() => Array.from(sectionIds).sort().join(','), [sectionIds]);
  useDebouncedEffect(() => {
    (async () => {
      try {
        setSavingSections(true);
        setError(null);
        await onSectionsSave(user.id, Array.from(sectionIds));
        setSuccessMessage('Разделы обновлены');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Ошибка при сохранении разделов');
      } finally {
        setSavingSections(false);
      }
    })();
  }, [sectionKey]);

  // ---- Автосохранение БИНов (debounce) ----
  const binsKey = useMemo(() => assignedBins.slice().sort().join(','), [assignedBins]);
  useDebouncedEffect(() => {
    (async () => {
      try {
        setSavingBins(true);
        setError(null);
        await onBinsSave(user.id, assignedBins);
        setSuccessMessage('БИНы обновлены');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Ошибка при сохранении БИНов');
      } finally {
        setSavingBins(false);
      }
    })();
  }, [binsKey]);

  const addSection = (id: string) => {
    if (!id) return;
    setSectionIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSectionToAdd('');
  };

  const removeSection = (id: string) => {
    setSectionIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };



  const addBin = (b: string) => {
    if (!b || assignedBins.includes(b)) return;
    setAssignedBins((prev) => prev.concat(b));
    setBinToAdd('');
  };
  const removeBin = (b: string) => {
    setAssignedBins((prev) => prev.filter((x) => x !== b));
  };

  // Сброс пароля
  const handlePasswordReset = async () => {
    if (pwd1.trim().length < 6) {
      setPwdErr('Пароль должен быть не короче 6 символов');
      return;
    }
    if (pwd1 !== pwd2) {
      setPwdErr('Пароли не совпадают');
      return;
    }
    setSavingPassword(true);
    setPwdErr(null);
    try {
      await onPasswordReset(user.id, pwd1.trim());
      setPwd1('');
      setPwd2('');
      setPwdOpen(false);
      setSuccessMessage('Пароль сброшен');
    } catch (e) {
      setPwdErr(e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Не удалось обновить пароль');
    } finally {
      setSavingPassword(false);
    }
  };

  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => setSuccessMessage(null), 3000);
    return () => clearTimeout(t);
  }, [successMessage]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(220px, 260px)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>{user.name}</h3>
          <p className="text-muted" style={{ margin: '4px 0' }}>
            {user.email} · {user.login}
          </p>
          <p className="text-muted" style={{ margin: '4px 0', fontSize: '0.85rem' }}>
            Аккаунт создан: {formatDateTime(user.createdAt)}
          </p>
          <div className="flex-gap" style={{ marginTop: 8 }}>
            <span className="chip">Текущая роль: {roleLabels[user.role] ?? user.role}</span>
            <span className="chip">Назначено разделов: {sectionIds.size}</span>
            <span className="chip">Назначено БИНов: {assignedBins.length}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="label" style={{ fontWeight: 700 }}>Роль</div>
            <SelectPill
              label=""
              showLabelInside={false}
              options={roleOptions}
              value={selectedRole}
              onChange={(v) => setSelectedRole(v)}
              style={{ minWidth: 220 }}
            />
          </div>
          {savingRole && <div className="text-muted" style={{ fontSize: 12 }}>Сохраняем…</div>}
          {canDeleteUser && (
            <button className="button danger" type="button" onClick={() => onDeleteRequest(user)}>
              Удалить аккаунт
            </button>
          )}
        </div>
      </div>

      <div className="assignment-grid">
        <div>
          <h4 style={{ marginBottom: 8 }}>Назначенные БИНы</h4>
          <div className="flex-gap" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            {assignedBins.length === 0 && <span className="text-muted">Нет назначенных БИНов</span>}
            {assignedBins.map((b) => (
              <span key={b} className="chip bin-chip">
                {b}
                <button
                  className="chip-x"
                  type="button"
                  aria-label={`Удалить БИН ${b}`}
                  onClick={() => removeBin(b)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="label" style={{ fontWeight: 700 }}>Добавить БИН</div>
            <SelectPill
              label=""
              showLabelInside={false}
              options={binOptions}
              value={binToAdd}
              onChange={(v) => {
                setBinToAdd(v);
                if (v) addBin(v);
              }}
              searchable
              style={{ minWidth: 240 }}
            />
          </div>
          {savingBins && (
            <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>Сохраняем…</div>
          )}
        </div>

        <div>
          <h4 style={{ marginBottom: 8 }}>Назначенные разделы</h4>
          <div className="flex-gap" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            {assignedSections.length === 0 && (
              <span className="text-muted">Нет назначенных разделов</span>
            )}
            {assignedSections.map((section) => {
              const label = section.title || section.id;
              return (
                <span key={section.id} className="chip bin-chip">
                  {label}
                  <button
                    className="chip-x"
                    type="button"
                    aria-label={`Удалить раздел ${label}`}
                    onClick={() => removeSection(section.id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="label" style={{ fontWeight: 700 }}>Добавить раздел</div>
            <SelectPill
              label=""
              showLabelInside={false}
              options={sectionOptions}
              value={sectionToAdd}
              onChange={(v) => {
                setSectionToAdd(v);
                if (v) addSection(v);
              }}
              searchable
              style={{ minWidth: 240 }}
            />
          </div>
          {savingSections && (
            <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>Сохраняем…</div>
          )}
        </div>
      </div>

      {/* Сброс пароля */}
      <div>
        <h4 style={{ marginBottom: 8 }}>Сброс пароля</h4>
        <button
          className="button secondary"
          type="button"
          onClick={() => { setPwd1(''); setPwd2(''); setPwdErr(null); setPwdOpen(true); }}
        >
          Сбросить
        </button>
      </div>

      {error && <div className="alert">{error}</div>}
      {successMessage && <div className="badge">{successMessage}</div>}

      {/* Модалка пароля */}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)}>
        <h3>Сброс пароля</h3>
        <div className="row">
          <label>Новый пароль</label>
          <input className="input" type="password" value={pwd1} onChange={(e) => setPwd1(e.target.value)} />
        </div>
        <div className="row">
          <label>Подтвердите пароль</label>
          <input className="input" type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        </div>
        {pwdErr && <div className="alert error" style={{ marginTop: 6 }}>{pwdErr}</div>}
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="button secondary" onClick={() => setPwdOpen(false)}>Отмена</button>
          <button className="button" onClick={handlePasswordReset} disabled={savingPassword}>
            {savingPassword ? 'Сохраняем…' : 'Сбросить пароль'}
          </button>
        </div>
      </Modal>
    </div>
  );
};

const AdminPage: React.FC<AdminPageProps> = ({ apiClient, currentUser }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [bins, setBins] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAdminData = useCallback(
    async (query?: string) => {
      setLoading(true);
      setError(null);
      try {
        const [loadedRoles, loadedUsers, loadedSections, loadedBins] = await Promise.all([
          apiClient.fetchRoles(),
          apiClient.fetchUsers(query),
          apiClient.fetchSections(),
          apiClient.fetchBins(),
        ]);
        setRoles(loadedRoles);
        setUsers(loadedUsers);
        setSections(loadedSections);
        setBins(loadedBins);
      } catch (err) {
        if (err instanceof ApiError) setError(err.message);
        else if (err instanceof Error) setError(err.message);
        else setError('Не удалось загрузить данные администратора');
      } finally {
        setLoading(false);
      }
    },
    [apiClient],
  );

  // первая загрузка
  useEffect(() => { loadAdminData(); }, [loadAdminData]);

  // автопоиск (debounce)
  useEffect(() => {
    const t = setTimeout(() => { loadAdminData(search.trim() || undefined); }, 350);
    return () => clearTimeout(t);
  }, [search, loadAdminData]);

  const handleRoleSave = useCallback(
    async (userId: number, role: string) => {
      const updated = await apiClient.updateUserRole(userId, role);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handleSectionsSave = useCallback(
    async (userId: number, sectionList: string[]) => {
      const updated = await apiClient.updateUserSections(userId, sectionList);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handleBinsSave = useCallback(
    async (userId: number, binsList: string[]) => {
      const updated = await apiClient.updateUserBins(userId, binsList);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handlePasswordReset = useCallback(
    async (userId: number, newPassword: string) => {
      await apiClient.adminSetUserPassword(userId, newPassword);
    },
    [apiClient],
  );

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const normalized = search.trim().toLowerCase();
    return users.filter((user) =>
      [user.name, user.email, user.login].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [users, search]);

  const handleConfirmDelete = useCallback(async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiClient.deleteUser(userToDelete.id);
      setUsers((prev) => prev.filter((user) => user.id !== userToDelete.id));
      setUserToDelete(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error)?.message ?? 'Не удалось удалить пользователя';
      setDeleteError(message);
    } finally {
      setDeleteLoading(false);
    }
  }, [apiClient, userToDelete]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 48 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            placeholder="Поиск по имени, логину или e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ flex: '1 1 420px' }}
          />
        </div>
        <div className="text-muted" style={{ fontSize: '0.9rem' }}>
          Вы вошли как {currentUser.name} ({roleLabels[currentUser.role] ?? currentUser.role}). Всего пользователей: {filteredUsers.length} · Доступные БИНы: {bins.length}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center' }}>
          Загружаем данные администратора...
        </div>
      ) : error ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 16 }}>Ошибка: {error}</p>
          <button className="button" type="button" onClick={() => loadAdminData(search)}>
            Повторить попытку
          </button>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>Пользователи не найдены</h3>
          <p className="text-muted">Измените параметры поиска или создайте нового пользователя в мобильном приложении.</p>
        </div>
      ) : (
        filteredUsers.map((user) => (
          <AdminUserCard
            key={user.id}
            user={user}
            roles={roles}
            sections={sections}
            availableBins={bins}
            onRoleSave={handleRoleSave}
            onSectionsSave={handleSectionsSave}
            onBinsSave={handleBinsSave}
            onPasswordReset={handlePasswordReset}
            canDeleteUser={currentUser.id !== user.id}
            onDeleteRequest={(selectedUser) => {
              setDeleteError(null);
              setUserToDelete(selectedUser);
            }}
          />
        ))
      )}

      <ConfirmModal
        open={Boolean(userToDelete)}
        title="Удалить аккаунт сотрудника?"
        description={
          userToDelete && (
            <>
              Аккаунт <strong>{userToDelete.name}</strong> ({userToDelete.email}) будет удалён навсегда.
              {deleteError && <p className="alert error" style={{ marginTop: 12 }}>{deleteError}</p>}
            </>
          )
        }
        tone="danger"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        loading={deleteLoading}
        onCancel={() => {
          if (deleteLoading) return;
          setUserToDelete(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};

export default AdminPage;