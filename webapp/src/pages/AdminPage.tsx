import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { PendingBin, RoleInfo, Section, UserBinAssignment, UserProfile } from '../types';
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
  onBinsSave: (userId: number, bins: UserBinAssignment[]) => Promise<void>;
  onPasswordReset: (userId: number, password: string) => Promise<void>;
  canDeleteUser: boolean;
  onDeleteRequest: (user: UserProfile) => void;
}

const roleLabels: Record<string, string> = {
  admin: 'Администратор',
  moderator: 'Модератор',
  viewer: 'Оператор',
};

const formatDateTimeLocalInput = (date: Date): string => {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const parseDateTimeLocalInput = (value: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const pluralizeDialogs = (count: number): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'диалог';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'диалога';
  return 'диалогов';
};

const cloneAssignment = (assignment: UserBinAssignment): UserBinAssignment => ({
  bin: assignment.bin,
  assignedAt: new Date(assignment.assignedAt),
  expiresAt: assignment.expiresAt ? new Date(assignment.expiresAt) : null,
  assignedBy: assignment.assignedBy,
});

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
  const [assignedBins, setAssignedBins] = useState<UserBinAssignment[]>(() =>
    user.bins.map(cloneAssignment),
  );
  const [binToAdd, setBinToAdd] = useState<string>('');
  const [binModalOpen, setBinModalOpen] = useState(false);
  const [pendingBinValue, setPendingBinValue] = useState<string | null>(null);
  const [pendingIndefinite, setPendingIndefinite] = useState(true);
  const [pendingExpiresAt, setPendingExpiresAt] = useState<string>('');
  const [binModalError, setBinModalError] = useState<string | null>(null);
  const [editingBin, setEditingBin] = useState<UserBinAssignment | null>(null);

  const [savingRole, setSavingRole] = useState(false);
  const [savingSections, setSavingSections] = useState(false);
  const [savingBins, setSavingBins] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setSelectedRole(user.role);
    setSectionIds(new Set(user.sections));
    setSectionToAdd('');
    setAssignedBins(user.bins.map(cloneAssignment));
    setBinToAdd('');
    setBinModalOpen(false);
    setPendingBinValue(null);
    setPendingIndefinite(true);
    setPendingExpiresAt('');
    setBinModalError(null);
    setEditingBin(null);
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
    const current = new Set(assignedBins.map((assignment) => assignment.bin));
    return [{ value: '', label: 'Выберите БИН' }].concat(
      availableBins.filter((b) => !current.has(b)).map((b) => ({ value: b, label: b })),
    );
  }, [availableBins, assignedBins]);

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

  const binsKey = useMemo(
    () =>
      assignedBins
        .map((assignment) => `${assignment.bin}:${assignment.expiresAt ? assignment.expiresAt.toISOString() : ''}`)
        .join('|'),
    [assignedBins],
  );

  useDebouncedEffect(() => {
    (async () => {
      try {
        setSavingBins(true);
        setError(null);
        await onBinsSave(
          user.id,
          assignedBins.map(cloneAssignment),
        );
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

  const openBinModal = (binValue: string, existing?: UserBinAssignment) => {
    setPendingBinValue(binValue);
    if (existing?.expiresAt) {
      setPendingIndefinite(false);
      setPendingExpiresAt(formatDateTimeLocalInput(existing.expiresAt));
    } else {
      setPendingIndefinite(true);
      setPendingExpiresAt('');
    }
    setEditingBin(existing ?? null);
    setBinModalError(null);
    setBinModalOpen(true);
  };

  const handleIndefiniteChange = (checked: boolean) => {
    setPendingIndefinite(checked);
    if (checked) {
      setPendingExpiresAt('');
      setBinModalError(null);
    } else {
      const base = editingBin?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000);
      setPendingExpiresAt(formatDateTimeLocalInput(base));
      setBinModalError(null);
    }
  };

  const closeBinModal = () => {
    setBinModalOpen(false);
    setPendingBinValue(null);
    setPendingIndefinite(true);
    setPendingExpiresAt('');
    setBinModalError(null);
    setEditingBin(null);
  };

  const handleConfirmBin = () => {
    if (!pendingBinValue) {
      closeBinModal();
      return;
    }
    let expiresAt: Date | null = null;
    if (!pendingIndefinite) {
      const parsed = parseDateTimeLocalInput(pendingExpiresAt);
      if (!parsed) {
        setBinModalError('Укажите корректные дату и время окончания.');
        return;
      }
      expiresAt = parsed;
    }
    const assignment: UserBinAssignment = {
      bin: pendingBinValue,
      assignedAt: editingBin ? new Date(editingBin.assignedAt) : new Date(),
      expiresAt,
      assignedBy: editingBin?.assignedBy,
    };
    setAssignedBins((prev) => {
      const filtered = prev.filter((item) => item.bin !== pendingBinValue);
      const next = [...filtered, assignment].sort((a, b) => a.bin.localeCompare(b.bin));
      return next;
    });
    setBinToAdd('');
    closeBinModal();
  };
  
  const removeBin = (binValue: string) => {
    setAssignedBins((prev) => prev.filter((assignment) => assignment.bin !== binValue));
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
    <div className="card admin-user-card">
      <div className="admin-user-card__grid">
        <div className="admin-user-card__cell">
          <div>
            <h3>{user.name}</h3>
            <p className="text-muted" style={{ margin: '4px 0' }}>
              {user.email} · {user.login}
            </p>
            <p className="text-muted" style={{ margin: '4px 0', fontSize: '0.85rem' }}>
              Аккаунт создан: {formatDateTime(user.createdAt)}
            </p>
          </div>
          <div className="flex-gap" style={{ marginTop: 8 }}>
            <span className="chip">Роль: {roleLabels[user.role] ?? user.role}</span>
            <span className="chip">Разделов: {sectionIds.size}</span>
            <span className="chip">БИНов: {assignedBins.length}</span>
          </div>
        </div>

        <div className="admin-user-card__cell">
          <div>
            <h4>Роль</h4>
            <SelectPill
              label=""
              showLabelInside={false}
              options={roleOptions}
              value={selectedRole}
              onChange={(v) => setSelectedRole(v)}
              style={{ minWidth: 0 }}
            />
          </div>
          {savingRole && <div className="text-muted" style={{ fontSize: 12 }}>Сохраняем…</div>}
        </div>

        <div className="admin-user-card__cell">
          <div>
            <h4>Назначенные БИНы</h4>
            <div className="flex-gap" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
              {assignedBins.length === 0 && <span className="text-muted">Нет назначенных БИНов</span>}
              {assignedBins.map((assignment) => (
                <span
                  key={assignment.bin}
                  className="chip bin-chip bin-chip--detailed"
                  title={
                    assignment.expiresAt
                      ? `Действует до ${formatDateTime(assignment.expiresAt)}`
                      : 'Без ограничения по времени'
                  }
                >
                  <span className="bin-chip__text">
                    <span className="bin-chip__title">{assignment.bin}</span>
                    <span className="bin-chip__meta">
                      {assignment.expiresAt ? `до ${formatDateTime(assignment.expiresAt)}` : 'без срока'}
                    </span>
                  </span>
                  <div className="bin-chip__actions">
                    <button
                      className="chip-action"
                      type="button"
                      aria-label={`Изменить срок для БИНа ${assignment.bin}`}
                      onClick={() => openBinModal(assignment.bin, assignment)}
                    >
                      ✎
                    </button>
                    <button
                      className="chip-x"
                      type="button"
                      aria-label={`Удалить БИН ${assignment.bin}`}
                      onClick={() => removeBin(assignment.bin)}
                    >
                      ×
                    </button>
                  </div>
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="label" style={{ fontWeight: 700 }}>Добавить БИН</div>
            <SelectPill
              label=""
              showLabelInside={false}
              options={binOptions}
              value={binToAdd}
              onChange={(v) => {
                if (!v) {
                  setBinToAdd('');
                  return;
                }
                setBinToAdd('');
                openBinModal(v);
              }}
              searchable
              style={{ minWidth: 0 }}
            />
          </div>
          {savingBins && <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>Сохраняем…</div>}
        </div>

        <div className="admin-user-card__cell">
          <div>
            <h4>Назначенные разделы</h4>
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
              style={{ minWidth: 0 }}
            />
          </div>
          {savingSections && <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>Сохраняем…</div>}
        </div>
      </div>

       {(error || successMessage) && (
        <div className="admin-user-card__status">
          {error && <div className="alert">{error}</div>}
          {successMessage && <div className="badge">{successMessage}</div>}
        </div>
      )}

      <div className="admin-user-card__footer">
        <button
          className="button secondary"
          type="button"
          onClick={() => { setPwd1(''); setPwd2(''); setPwdErr(null); setPwdOpen(true); }}
        >
          Сбросить пароль
        </button>
        <div className="admin-user-card__footer-actions">
          {canDeleteUser && (
            <button className="button danger" type="button" onClick={() => onDeleteRequest(user)}>
              Удалить аккаунт
            </button>
          )}
        </div>
      </div>
      
      <Modal open={binModalOpen} onClose={closeBinModal}>
        <h3>Назначение БИНа</h3>
        {pendingBinValue && (
          <p style={{ marginBottom: 12 }}>
            <strong>{pendingBinValue}</strong>
          </p>
        )}
        <p className="text-muted" style={{ marginTop: -8 }}>
          Укажите срок, до которого БИН закреплён за сотрудником. Без срока — назначение бессрочное.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={pendingIndefinite}
            onChange={(event) => handleIndefiniteChange(event.target.checked)}
          />
          <span>Без ограничения по времени</span>
        </label>
        {!pendingIndefinite && (
          <div className="row">
            <label>Действует до</label>
            <input
              className="input"
              type="datetime-local"
              value={pendingExpiresAt}
              min={formatDateTimeLocalInput(new Date())}
              onChange={(event) => {
                setPendingExpiresAt(event.target.value);
                if (binModalError) setBinModalError(null);
              }}
            />
          </div>
        )}
        {binModalError && <div className="alert error" style={{ marginTop: 6 }}>{binModalError}</div>}
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <button className="button secondary" type="button" onClick={closeBinModal}>
            Отмена
          </button>
          <button className="button" type="button" onClick={handleConfirmBin}>
            {editingBin ? 'Сохранить' : 'Назначить'}
          </button>
        </div>
      </Modal>

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
  const [pendingBins, setPendingBins] = useState<PendingBin[]>([]);
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
        const [loadedRoles, loadedUsers, loadedSections, loadedBins, loadedPendingBins] = await Promise.all([
          apiClient.fetchRoles(),
          apiClient.fetchUsers(query),
          apiClient.fetchSections(),
          apiClient.fetchBins(),
          apiClient.fetchPendingBins(),
        ]);
        setRoles(loadedRoles);
        setUsers(loadedUsers);
        setSections(loadedSections);
        setBins(loadedBins);
        setPendingBins(loadedPendingBins);
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
    async (userId: number, binsList: UserBinAssignment[]) => {
      const updated = await apiClient.updateUserBins(userId, binsList);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
      try {
        const refreshed = await apiClient.fetchPendingBins();
        setPendingBins(refreshed);
      } catch (err) {
        console.warn('Не удалось обновить список неотвеченных БИНов', err);
      }
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
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Неотвеченные БИНы</h3>
        {pendingBins.length === 0 ? (
          <span className="text-muted">Все текущие диалоги получили ответ.</span>
        ) : (
          <div className="flex-gap pending-bins-list" style={{ flexWrap: 'wrap' }}>
            {pendingBins.map((item) => (
              <span key={item.bin} className="chip bin-chip pending-bin-chip">
                <span className="bin-chip__title">{item.bin}</span>
                <span className="bin-chip__meta">
                  {item.pendingDialogs} {pluralizeDialogs(item.pendingDialogs)} без ответа
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

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