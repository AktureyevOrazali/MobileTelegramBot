import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { RoleInfo, Section, UserProfile } from '../types';
import { formatDateTime } from '../utils/date';
import SelectPill from '../components/SelectPill';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import {
  buttonBaseClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
  cardClass,
  chipClass,
  headingClass,
  inputClass,
  labelClass,
  mutedTextClass,
  sectionTitleClass,
} from '../ui/primitives';
import { cn } from '../utils/cn';

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
    <div className={cn(cardClass, 'space-y-6')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{user.name}</h3>
          <p className={cn(mutedTextClass, 'text-sm')}>{user.email} · {user.login}</p>
          <p className={cn(mutedTextClass, 'text-xs')}>Аккаунт создан: {formatDateTime(user.createdAt)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>Роль: {roleLabels[user.role] ?? user.role}</span>
            <span className={chipClass}>Разделов: {sectionIds.size}</span>
            <span className={chipClass}>БИНов: {assignedBins.length}</span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Роль</span>
          <SelectPill
            label="Роль"
            options={roleOptions}
            value={selectedRole}
            onChange={(v) => setSelectedRole(v)}
            showLabelInside
          />
          {savingRole && <div className={cn(mutedTextClass, 'text-xs')}>Сохраняем…</div>}
        </div>
      </div>

        <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h4 className={sectionTitleClass}>Назначенные БИНы</h4>
            <div className="flex flex-wrap gap-2">
              {assignedBins.length === 0 && <span className={mutedTextClass}>Нет назначенных БИНов</span>}
              {assignedBins.map((b) => (
                <span key={b} className={cn(chipClass, 'flex items-center gap-2')}>
                  {b}
                  <button
                    className={cn(buttonBaseClass, 'h-7 rounded-full bg-rose-500/10 px-2 text-xs text-rose-600 hover:bg-rose-500/20 dark:bg-rose-500/20 dark:text-rose-200')}
                    type="button"
                    aria-label={`Удалить БИН ${b}`}
                    onClick={() => removeBin(b)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className={labelClass}>Добавить БИН</span>
            <SelectPill
              label="БИН"
              options={binOptions}
              value={binToAdd}
              onChange={(v) => {
                setBinToAdd(v);
                if (v) addBin(v);
              }}
              searchable
            />
          </div>
          {savingBins && <div className={cn(mutedTextClass, 'text-xs')}>Сохраняем…</div>}
        </div>

        <div className="space-y-4">
          <div>
            <h4 className={sectionTitleClass}>Назначенные разделы</h4>
            <div className="flex flex-wrap gap-2">
              {assignedSections.length === 0 && (
                <span className={mutedTextClass}>Нет назначенных разделов</span>
              )}
              {assignedSections.map((section) => {
                const label = section.title || section.id;
                return (
                  <span key={section.id} className={cn(chipClass, 'flex items-center gap-2')}>
                    {label}
                    <button
                      className={cn(buttonBaseClass, 'h-7 rounded-full bg-rose-500/10 px-2 text-xs text-rose-600 hover:bg-rose-500/20 dark:bg-rose-500/20 dark:text-rose-200')}
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
          <div className="space-y-2">
            <span className={labelClass}>Добавить раздел</span>
            <SelectPill
              label="Раздел"
              options={sectionOptions}
              value={sectionToAdd}
              onChange={(v) => {
                setSectionToAdd(v);
                if (v) addSection(v);
              }}
              searchable
            />
          </div>
          {savingSections && <div className={cn(mutedTextClass, 'text-xs')}>Сохраняем…</div>}
        </div>
      </div>

      {(error || successMessage) && (
        <div className="space-y-2">
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">
              {successMessage}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-4 dark:border-slate-700/60">
        <button
          className={buttonSecondaryClass}
          type="button"
          onClick={() => {
            setPwd1('');
            setPwd2('');
            setPwdErr(null);
            setPwdOpen(true);
          }}
        >
          Сбросить пароль
        </button>
        {canDeleteUser && (
          <button
            className={cn(buttonBaseClass, 'rounded-xl bg-rose-500 px-4 py-2 text-white hover:bg-rose-600 dark:hover:bg-rose-500')}
            type="button"
            onClick={() => onDeleteRequest(user)}
          >
            Удалить аккаунт
          </button>
        )}
      </div>

      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} className="max-w-md space-y-4">
        <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Сброс пароля</h3>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Новый пароль</span>
          <input className={inputClass} type="password" value={pwd1} onChange={(e) => setPwd1(e.target.value)} />
        </label>
        <label className="flex flex-col gap-2">
          <span className={labelClass}>Подтвердите пароль</span>
          <input className={inputClass} type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        </label>
        {pwdErr && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200">
            {pwdErr}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button className={buttonSecondaryClass} onClick={() => setPwdOpen(false)}>
            Отмена
          </button>
          <button className={buttonPrimaryClass} onClick={handlePasswordReset} disabled={savingPassword}>
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
  const [deleteUser, setDeleteUser] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [fetchedUsers, fetchedRoles, fetchedSections, fetchedBins] = await Promise.all([
        apiClient.fetchUsers(),
        apiClient.fetchRoles(),
        apiClient.fetchSections(),
        apiClient.fetchBins(),
      ]);
      setUsers(fetchedUsers);
      setRoles(fetchedRoles);
      setSections(fetchedSections);
      setBins(fetchedBins);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Не удалось загрузить данные.');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return users;
    }
    return users.filter((user) => {
      const haystack = `${user.name} ${user.email} ${user.login}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [search, users]);

  const handleRoleSave = useCallback(
    async (userId: number, role: string) => {
      const updated = await apiClient.updateUserRole(userId, role);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handleSectionsSave = useCallback(
    async (userId: number, nextSections: string[]) => {
      const updated = await apiClient.updateUserSections(userId, nextSections);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handleBinsSave = useCallback(
    async (userId: number, nextBins: string[]) => {
      const updated = await apiClient.updateUserBins(userId, nextBins);
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
    },
    [apiClient],
  );

  const handlePasswordReset = useCallback(
    async (userId: number, password: string) => {
      await apiClient.adminSetUserPassword(userId, password);
    },
    [apiClient],
  );

  const handleDeleteUser = useCallback(
    async (userId: number) => {
      try {
        setDeleting(true);
        await apiClient.deleteUser(userId);
        setUsers((prev) => prev.filter((user) => user.id !== userId));
        setDeleteUser(null);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Не удалось удалить пользователя';
        setError(message);
      } finally {
        setDeleting(false);
      }
    },
    [apiClient],
  );

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div className={cn(cardClass, 'space-y-4')}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className={cn(headingClass, 'text-2xl')}>Управление пользователями</h2>
          <input
            className={cn(inputClass, 'sm:w-72')}
            placeholder="Поиск по имени или e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className={mutedTextClass}>
          Всего пользователей: {users.length}. Выберите аккаунт для изменения роли, разделов или БИНов.
        </p>
      </div>

      {loading ? (
        <div className={cn(cardClass, 'text-center text-sm')}>Загружаем пользователей…</div>
      ) : error ? (
        <div className={cn(cardClass, 'space-y-4 text-center')}>
          <p>Ошибка: {error}</p>
          <button className={buttonPrimaryClass} type="button" onClick={loadData}>
            Повторить попытку
          </button>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className={cn(cardClass, 'text-center')}>
          <p className={mutedTextClass}>Пользователи не найдены. Попробуйте изменить запрос.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredUsers.map((user) => (
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
              onDeleteRequest={setDeleteUser}
            />
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteUser)}
        title="Удалить пользователя?"
        description={
          deleteUser ? (
            <span>
              Пользователь <span className="font-semibold">{deleteUser.name}</span> будет удалён без возможности восстановления.
            </span>
          ) : undefined
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        tone="danger"
        loading={deleting}
        onCancel={() => setDeleteUser(null)}
        onConfirm={() => deleteUser && handleDeleteUser(deleteUser.id)}
      />
    </div>
  );
};

export default AdminPage;