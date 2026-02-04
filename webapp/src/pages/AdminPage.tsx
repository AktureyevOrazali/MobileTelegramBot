import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { BinDetailed, OrganizationWithoutContract, PendingRegistration, RoleInfo, Section, UnassignedBin, UserBinAssignment, UserProfile } from '../types';
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
  currentUserRole: string;
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
  operator: 'Оператор',
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
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return () => { };
    }
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

const AdminUserCard: React.FC<UserCardProps> = ({
  user,
  currentUserRole,
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
  const [operatorBinsOpen, setOperatorBinsOpen] = useState(false);
  const [operatorSectionsOpen, setOperatorSectionsOpen] = useState(false);

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
    setOperatorBinsOpen(false);
    setOperatorSectionsOpen(false);
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

  const isOperator = user.role === 'operator';
  const isRoleReadonly = currentUserRole === 'moderator' && user.role !== 'operator';
  const canManageThisUser = !isRoleReadonly;

  return (
    <div className="card admin-user-card">
      {/* HEADER: Name and Badge only */}
      <div className="admin-user-card__header-minimal">
        <h3 className="admin-user-card__name">{user.name}</h3>
        <span className="badge">{roleLabels[user.role] ?? user.role}</span>
      </div>

      {/* Visual Separator */}
      <div className="admin-user-card__separator" />

      {/* INFO ROW: Email and Role Select */}
      <div className="admin-user-card__info-row">
        <div className="admin-user-card__email">{user.email}</div>
        <div className="admin-user-card__role-select">
          <SelectPill
            label=""
            showLabelInside={false}
            options={roleOptions}
            value={selectedRole}
            onChange={(v) => setSelectedRole(v)}
            style={{ minWidth: 0, width: '100%' }}
            disabled={isRoleReadonly}
          />
        </div>
      </div>

      {/* Stats/Action Buttons: Full Width Grid */}
      {isOperator && (
        <div className="admin-user-card__actions-grid">
          <button
            className="button secondary admin-user-card__full-btn"
            type="button"
            onClick={() => setOperatorBinsOpen(true)}
          >
            БИНы · {assignedBins.length}
          </button>
          <button
            className="button secondary admin-user-card__full-btn"
            type="button"
            onClick={() => setOperatorSectionsOpen(true)}
          >
            Разделы · {assignedSections.length}
          </button>
        </div>
      )}

      {(error || successMessage) && (
        <div className="admin-user-card__status">
          {error && <div className="alert">{error}</div>}
          {successMessage && <div className="badge">{successMessage}</div>}
        </div>
      )}

      {/* Footer */}
      <div className="admin-user-card__footer">
        {canManageThisUser && (
          <button
            className="button secondary small"
            type="button"
            onClick={() => { setPwd1(''); setPwd2(''); setPwdErr(null); setPwdOpen(true); }}
          >
            Сбросить пароль
          </button>
        )}

        <div className="admin-user-card__footer-actions">
          {canManageThisUser && canDeleteUser && (
            <button className="button danger small" type="button" onClick={() => onDeleteRequest(user)}>
              Удалить
            </button>
          )}
        </div>
      </div>


      {/* Operator Bins Modal */}
      <Modal open={operatorBinsOpen} onClose={() => setOperatorBinsOpen(false)} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>БИНы оператора</h3>
            <span className="badge">{user.name}</span>
          </div>
          <div className="admin-modal__form">
            <div className="label">Добавить БИН</div>
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
                openBinModal(v); // Opens date selection but keeps this modal open
              }}
              searchable
              style={{ minWidth: 0, width: '100%' }}
            />
          </div>
          <div className="admin-modal__list">
            {assignedBins.length === 0 && <span className="text-muted">Нет назначенных БИНов</span>}
            {assignedBins.map((assignment) => (
              <span
                key={assignment.bin}
                className="chip bin-chip bin-chip--detailed"
                title={assignment.expiresAt ? `До ${formatDateTime(assignment.expiresAt)}` : 'Бессрочно'}
              >
                <span className="bin-chip__text">
                  <span className="bin-chip__title">{assignment.bin}</span>
                  <span className="bin-chip__meta">
                    {assignment.expiresAt ? `до ${formatDateTime(assignment.expiresAt)}` : 'бессрочно'}
                  </span>
                </span>
                <div className="bin-chip__actions">
                  <button
                    className="chip-action"
                    type="button"
                    onClick={() => openBinModal(assignment.bin, assignment)}
                  >
                    ✎
                  </button>
                  <button
                    className="chip-x"
                    type="button"
                    onClick={() => removeBin(assignment.bin)}
                  >
                    ×
                  </button>
                </div>
              </span>
            ))}
          </div>
        </div>
      </Modal>

      {/* Operator Sections Modal - Improved Design */}
      <Modal open={operatorSectionsOpen} onClose={() => setOperatorSectionsOpen(false)} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Разделы оператора</h3>
            <span className="badge">{user.name}</span>
          </div>

          <div className="admin-modal__form">
            <div className="label">Добавить раздел</div>
            <SelectPill
              label=""
              showLabelInside={false}
              options={sectionOptions}
              value={sectionToAdd}
              onChange={(v) => {
                setSectionToAdd(v);
                if (v) addSection(v);
                // Intentionally keeps modal open
              }}
              searchable
              style={{ minWidth: 0, width: '100%' }}
            />
          </div>

          <div className="admin-modal__list-container">
            <div className="label">Назначенные разделы</div>
            <div className="admin-modal__list">
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
        </div>
      </Modal>

      {/* Date Selection Modal for Bin */}
      <Modal open={binModalOpen} onClose={closeBinModal} className="bin-modal__container">
        <div className="bin-modal">
          <div className="bin-modal__header">
            <h3>Назначение БИНа</h3>
            {pendingBinValue && <span className="bin-modal__badge">{pendingBinValue}</span>}
          </div>
          {/* User Context removed as per "remove extra text" philosophy, kept simple */}

          <div className="bin-modal__options">
            <label className={`bin-modal__option ${pendingIndefinite ? 'bin-modal__option--active' : ''}`}>
              <input
                className="bin-modal__radio"
                type="radio"
                name="bin-duration"
                checked={pendingIndefinite}
                onChange={() => handleIndefiniteChange(true)}
              />
              <div className="bin-modal__option-body">
                <span className="bin-modal__option-title">Бессрочно</span>
              </div>
            </label>
            <label className={`bin-modal__option ${!pendingIndefinite ? 'bin-modal__option--active' : ''}`}>
              <input
                className="bin-modal__radio"
                type="radio"
                name="bin-duration"
                checked={!pendingIndefinite}
                onChange={() => handleIndefiniteChange(false)}
              />
              <div className="bin-modal__option-body">
                <span className="bin-modal__option-title">Временно</span>
              </div>
            </label>
          </div>
          {!pendingIndefinite && (
            <div className="bin-modal__field">
              <label htmlFor="bin-modal-expires">Дата окончания</label>
              <input
                id="bin-modal-expires"
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
          <div className="bin-modal__actions">
            <button className="button secondary" type="button" onClick={closeBinModal}>
              Отмена
            </button>
            <button className="button" type="button" onClick={handleConfirmBin}>
              {editingBin ? 'Сохранить' : 'Назначить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Password Reset Modal */}
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
        <div className="actions" style={{ justifyContent: 'space-between', display: 'flex', marginTop: 12 }}>
          <button className="button secondary" onClick={() => setPwdOpen(false)}>Отмена</button>
          <button className="button" onClick={handlePasswordReset} disabled={savingPassword}>
            {savingPassword ? '...' : 'Сбросить'}
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
  const [unassignedBins, setUnassignedBins] = useState<UnassignedBin[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
  const [pendingAction, setPendingAction] = useState<number | null>(null);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<'approve' | 'reject' | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assignBinValue, setAssignBinValue] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignIndefinite, setAssignIndefinite] = useState(true);
  const [assignExpiresAt, setAssignExpiresAt] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);
  const [unassignedBinsModalOpen, setUnassignedBinsModalOpen] = useState(false);
  const [organizationsWithoutContracts, setOrganizationsWithoutContracts] = useState<OrganizationWithoutContract[]>([]);
  const [organizationsModalOpen, setOrganizationsModalOpen] = useState(false);
  const [orgBinValue, setOrgBinValue] = useState('');
  const [orgUserId, setOrgUserId] = useState('');
  const [allBinsModalOpen, setAllBinsModalOpen] = useState(false);
  const [allBinsSearch, setAllBinsSearch] = useState('');
  const [binsDetailed, setBinsDetailed] = useState<BinDetailed[]>([]);
  const [selectedBinInfo, setSelectedBinInfo] = useState<BinDetailed | null>(null);



  const loadAdminData = useCallback(
    async (query?: string) => {
      setLoading(true);
      setError(null);
      try {
        const [loadedRoles, loadedUsers, loadedSections, loadedBins, loadedUnassignedBins, loadedPending, loadedOrganizations, loadedBinsDetailed] =
          await Promise.all([
            apiClient.fetchRoles(),
            apiClient.fetchUsers(query),
            apiClient.fetchSections(),
            apiClient.fetchBins(),
            apiClient.fetchUnassignedBins(),
            apiClient.fetchPendingRegistrations(),
            apiClient.fetchOrganizationsWithoutContracts(),
            apiClient.getBinsDetailed(),
          ]);
        setRoles(loadedRoles);
        setUsers(loadedUsers);
        setSections(loadedSections);
        setBins(loadedBins);
        setUnassignedBins(loadedUnassignedBins);
        setPendingRegistrations(loadedPending);
        setOrganizationsWithoutContracts(loadedOrganizations);
        setBinsDetailed(loadedBinsDetailed);
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
        const refreshed = await apiClient.fetchUnassignedBins();
        setUnassignedBins(refreshed);
      } catch (err) {
        console.warn('Не удалось обновить список неразделенных БИНов', err);
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
    const approvedUsers = users.filter((user) => user.isApproved);
    if (!search.trim()) return approvedUsers;
    const normalized = search.trim().toLowerCase();
    return approvedUsers.filter((user) =>
      [user.name, user.email, user.login].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [users, search]);

  const assignableUsers = useMemo(
    () => users.filter((user) => user.isApproved && user.role === 'operator'),
    [users],
  );

  const assignUserOptions = useMemo(
    () =>
      [{ value: '', label: 'Выберите сотрудника' }].concat(
        assignableUsers.map((user) => ({
          value: String(user.id),
          label: user.name,
          meta: user.email,
        })),
      ),
    [assignableUsers],
  );

  const assignBinOptions = useMemo(
    () =>
      [{ value: '', label: 'Выберите БИН' }].concat(
        unassignedBins.map((bin) => ({
          value: bin.bin,
          label: bin.bin,
          meta: bin.openDialogs > 0 ? `${bin.openDialogs} ${pluralizeDialogs(bin.openDialogs)}` : 'без диалогов',
        })),
      ),
    [unassignedBins],
  );

  const orgBinOptions = useMemo(
    () =>
      [{ value: '', label: 'Выберите БИН' }].concat(
        organizationsWithoutContracts.map((org) => ({
          value: org.customerBin,
          label: org.customerBin,
        })),
      ),
    [organizationsWithoutContracts],
  );

  const filteredBinsDetailed = useMemo(() => {
    const query = allBinsSearch.trim().toLowerCase();
    if (!query) return binsDetailed;
    return binsDetailed.filter((item) => item.bin.toLowerCase().includes(query));
  }, [binsDetailed, allBinsSearch]);

  const selectedAssignUser = useMemo(
    () => assignableUsers.find((user) => String(user.id) === assignUserId) ?? null,
    [assignableUsers, assignUserId],
  );

  const handlePendingApprove = useCallback(
    async (userId: number) => {
      setPendingAction(userId);
      try {
        const updated = await apiClient.approveRegistration(userId);
        setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
        setPendingRegistrations((prev) => prev.filter((item) => item.id !== userId));
      } catch (err) {
        console.error('Не удалось подтвердить регистрацию', err);
      } finally {
        setPendingAction(null);
      }
    },
    [apiClient],
  );

  const handlePendingReject = useCallback(
    async (userId: number) => {
      setPendingAction(userId);
      try {
        await apiClient.rejectRegistration(userId);
        setUsers((prev) => prev.filter((user) => user.id !== userId));
        setPendingRegistrations((prev) => prev.filter((item) => item.id !== userId));
      } catch (err) {
        console.error('Не удалось отклонить регистрацию', err);
      } finally {
        setPendingAction(null);
      }
    },
    [apiClient],
  );

  const handlePendingBulkAction = useCallback(
    async (action: 'approve' | 'reject') => {
      if (pendingRegistrations.length === 0) return;
      setPendingBulkAction(action);
      try {
        if (action === 'approve') {
          const approved = await Promise.all(
            pendingRegistrations.map((item) => apiClient.approveRegistration(item.id)),
          );
          setUsers((prev) => {
            const map = new Map(prev.map((user) => [user.id, user]));
            approved.forEach((user) => map.set(user.id, user));
            return Array.from(map.values());
          });
        } else {
          await Promise.all(pendingRegistrations.map((item) => apiClient.rejectRegistration(item.id)));
          const ids = new Set(pendingRegistrations.map((item) => item.id));
          setUsers((prev) => prev.filter((user) => !ids.has(user.id)));
        }
        setPendingRegistrations([]);
      } catch (err) {
        console.error('Не удалось выполнить массовое действие', err);
      } finally {
        setPendingBulkAction(null);
      }
    },
    [apiClient, pendingRegistrations],
  );

  const openAssignModal = () => {
    setAssignIndefinite(true);
    setAssignExpiresAt('');
    setAssignError(null);
    setAssignModalOpen(true);
  };

  const closeAssignModal = () => {
    if (assignLoading) return;
    setAssignModalOpen(false);
    setAssignIndefinite(true);
    setAssignExpiresAt('');
    setAssignError(null);
  };

  const handleAssignIndefiniteChange = (checked: boolean) => {
    setAssignIndefinite(checked);
    if (checked) {
      setAssignExpiresAt('');
      setAssignError(null);
    } else {
      setAssignExpiresAt(formatDateTimeLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
      setAssignError(null);
    }
  };

  const handleAssignBin = async () => {
    if (!assignBinValue || !selectedAssignUser) return;
    let expiresAt: Date | null = null;
    if (!assignIndefinite) {
      const parsed = parseDateTimeLocalInput(assignExpiresAt);
      if (!parsed) {
        setAssignError('Укажите корректные дату и время окончания.');
        return;
      }
      expiresAt = parsed;
    }
    setAssignLoading(true);
    setAssignError(null);
    try {
      const current = selectedAssignUser.bins.map(cloneAssignment);
      const next = [
        ...current.filter((assignment) => assignment.bin !== assignBinValue),
        {
          bin: assignBinValue,
          assignedAt: new Date(),
          expiresAt,
          assignedBy: currentUser.id,
        },
      ].sort((a, b) => a.bin.localeCompare(b.bin));
      await handleBinsSave(selectedAssignUser.id, next);
      setAssignBinValue('');
      setAssignUserId('');
      closeAssignModal();
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : (err as Error)?.message ?? 'Не удалось назначить БИН');
    } finally {
      setAssignLoading(false);
    }
  };

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

  const handleDeleteBin = useCallback(async (binValue: string) => {
    try {
      await apiClient.deleteBin(binValue);
      setBins((prev) => prev.filter((b) => b !== binValue));
      setBinsDetailed((prev) => prev.filter((b) => b.bin !== binValue));
    } catch (err) {
      console.error('Не удалось удалить БИН', err);
    }
  }, [apiClient]);

  const [binInfoLoading, setBinInfoLoading] = useState(false);

  const handleBinClick = useCallback(async (binValue: string) => {
    setBinInfoLoading(true);
    try {
      const info = await apiClient.getBinInfo(binValue);
      setSelectedBinInfo(info);
    } catch (err) {
      console.error('Не удалось загрузить информацию о БИН', err);
      // Show basic info from list if API fails
      const basicInfo = binsDetailed.find((b) => b.bin === binValue);
      if (basicInfo) setSelectedBinInfo(basicInfo);
    } finally {
      setBinInfoLoading(false);
    }
  }, [apiClient, binsDetailed]);

  return (
    <div className="admin-page">
      {/* Three cards in a row */}
      <div className="admin-cards-row">
        {/* All BINs */}
        <div className="card admin-section admin-section--compact">
          <div className="admin-section__header">
            <h3>Все БИНы</h3>
            <button
              className="admin-section__count admin-section__count--button"
              type="button"
              onClick={() => setAllBinsModalOpen(true)}
              disabled={bins.length === 0}
            >
              {bins.length}
            </button>
          </div>
        </div>

        {/* Organizations Without Contracts */}
        <div className="card admin-section admin-section--compact">
          <div className="admin-section__header">
            <h3>Без договора</h3>
            <button
              className="admin-section__count admin-section__count--button"
              type="button"
              onClick={() => setOrganizationsModalOpen(true)}
              disabled={organizationsWithoutContracts.length === 0}
            >
              {organizationsWithoutContracts.length}
            </button>
          </div>
        </div>

        {/* Unassigned Bins */}
        <div className="card admin-section admin-section--compact">
          <div className="admin-section__header">
            <h3>Неразделённые</h3>
            <button
              className="admin-section__count admin-section__count--button"
              type="button"
              onClick={() => setUnassignedBinsModalOpen(true)}
              disabled={unassignedBins.length === 0}
            >
              {unassignedBins.length}
            </button>
          </div>
        </div>
      </div>

      {/* Pending Registrations - Compact */}
      <div className="card admin-section">
        <div className="admin-section__header">
          <div>
            <h3>Регистрации</h3>
          </div>
          <button
            className="admin-section__count admin-section__count--button"
            type="button"
            onClick={() => setPendingModalOpen(true)}
            disabled={pendingRegistrations.length === 0}
          >
            {pendingRegistrations.length}
          </button>
        </div>
      </div>

      <div className="card admin-search">
        <div className="admin-search__row">
          <input
            className="input"
            placeholder="Поиск по имени, логину или e-mail"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
        </div>
      ) : (
        <div className="admin-user-grid">
          {filteredUsers.map((user) => (
            <AdminUserCard
              key={user.id}
              user={user}
              currentUserRole={currentUser.role}
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
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(userToDelete)}
        title="Удалить аккаунт?"
        description={
          userToDelete && (
            <>
              Аккаунт <strong>{userToDelete.name}</strong> будет удалён навсегда.
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

      {/* Pending Registrations Modal - Improved Header Actions */}
      <Modal open={pendingModalOpen} onClose={() => setPendingModalOpen(false)} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Заявки ({pendingRegistrations.length})</h3>
            <div className="admin-modal__header-actions">
              <button
                className="button secondary small"
                type="button"
                disabled={pendingRegistrations.length === 0 || pendingBulkAction !== null}
                onClick={() => handlePendingBulkAction('reject')}
              >
                Отклонить все
              </button>
              <button
                className="button small"
                type="button"
                disabled={pendingRegistrations.length === 0 || pendingBulkAction !== null}
                onClick={() => handlePendingBulkAction('approve')}
              >
                Принять все
              </button>
            </div>
          </div>

          <div className="admin-modal__list admin-modal__list--stack">
            {pendingRegistrations.length === 0 ? (
              <span className="text-muted">Нет новых заявок.</span>
            ) : (
              pendingRegistrations.map((item) => (
                <div key={item.id} className="pending-registration-card">
                  <div>
                    <div className="pending-registration-card__name">{item.name}</div>
                    <div className="pending-registration-card__meta">{item.email}</div>
                  </div>
                  <div className="pending-registration-card__actions">
                    <button
                      className="button small"
                      type="button"
                      disabled={pendingAction === item.id || pendingBulkAction !== null}
                      onClick={() => handlePendingApprove(item.id)}
                    >
                      ✓
                    </button>
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={pendingAction === item.id || pendingBulkAction !== null}
                      onClick={() => handlePendingReject(item.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Unassigned Bins Modal */}
      <Modal
        open={unassignedBinsModalOpen}
        onClose={() => setUnassignedBinsModalOpen(false)}
        className="admin-modal__container"
      >
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Неразделенные БИНы ({unassignedBins.length})</h3>
          </div>

          {unassignedBins.length === 0 ? (
            <span className="text-muted">Нет доступных БИНов.</span>
          ) : (
            <>
              <div className="admin-assign-grid">
                <div className="admin-assign-grid__item">
                  <SelectPill
                    label=""
                    showLabelInside={false}
                    options={assignBinOptions}
                    value={assignBinValue}
                    onChange={(value) => setAssignBinValue(value)}
                    searchable
                    style={{ minWidth: 0, width: '100%' }}
                  />
                </div>

                <div className="admin-assign-grid__item">
                  <SelectPill
                    label=""
                    showLabelInside={false}
                    options={assignUserOptions}
                    value={assignUserId}
                    onChange={(value) => setAssignUserId(value)}
                    searchable
                    style={{ minWidth: 0, width: '100%' }}
                  />
                </div>

                <button
                  className="button admin-assign-grid__btn"
                  type="button"
                  disabled={!assignBinValue || !assignUserId}
                  onClick={() => {
                    setUnassignedBinsModalOpen(false); // чтобы не было "модалка на модалке"
                    openAssignModal();
                  }}
                >
                  Назначить
                </button>
              </div>

              <div className="admin-section__list admin-section__list--grid">
                {unassignedBins.map((item) => (
                  <span key={item.bin} className="chip bin-chip bin-chip--compact">
                    <span className="bin-chip__title">{item.bin}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>


      <Modal open={assignModalOpen} onClose={closeAssignModal} className="bin-modal__container">
        <div className="bin-modal">
          <div className="bin-modal__header">
            <h3>Назначение БИНа</h3>
          </div>
          <div className="bin-modal__options">
            <label className={`bin-modal__option ${assignIndefinite ? 'bin-modal__option--active' : ''}`}>
              <input
                className="bin-modal__radio"
                type="radio"
                name="assign-bin-duration"
                checked={assignIndefinite}
                onChange={() => handleAssignIndefiniteChange(true)}
              />
              <div className="bin-modal__option-body">
                <span className="bin-modal__option-title">Бессрочно</span>
              </div>
            </label>
            <label className={`bin-modal__option ${!assignIndefinite ? 'bin-modal__option--active' : ''}`}>
              <input
                className="bin-modal__radio"
                type="radio"
                name="assign-bin-duration"
                checked={!assignIndefinite}
                onChange={() => handleAssignIndefiniteChange(false)}
              />
              <div className="bin-modal__option-body">
                <span className="bin-modal__option-title">Временно</span>
              </div>
            </label>
          </div>
          {!assignIndefinite && (
            <div className="bin-modal__field">
              <label htmlFor="assign-bin-expires">Дата окончания</label>
              <input
                id="assign-bin-expires"
                className="input"
                type="datetime-local"
                value={assignExpiresAt}
                min={formatDateTimeLocalInput(new Date())}
                onChange={(event) => {
                  setAssignExpiresAt(event.target.value);
                  if (assignError) setAssignError(null);
                }}
              />
            </div>
          )}
          {assignError && <div className="alert error" style={{ marginTop: 6 }}>{assignError}</div>}
          <div className="bin-modal__actions">
            <button className="button secondary" type="button" onClick={closeAssignModal} disabled={assignLoading}>
              Отмена
            </button>
            <button
              className="button"
              type="button"
              onClick={handleAssignBin}
              disabled={!assignBinValue || !assignUserId || assignLoading}
            >
              {assignLoading ? '...' : 'Назначить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Organizations Without Contracts Modal */}
      <Modal open={organizationsModalOpen} onClose={() => setOrganizationsModalOpen(false)} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Организации без договора ({organizationsWithoutContracts.length})</h3>
          </div>

          {organizationsWithoutContracts.length === 0 ? (
            <span className="text-muted">Нет организаций без договора.</span>
          ) : (
            <>
              <div className="admin-assign-grid">
                <div className="admin-assign-grid__item">
                  <SelectPill
                    label=""
                    showLabelInside={false}
                    options={orgBinOptions}
                    value={orgBinValue}
                    onChange={(value) => setOrgBinValue(value)}
                    searchable
                    style={{ minWidth: 0, width: '100%' }}
                  />
                </div>

                <div className="admin-assign-grid__item">
                  <SelectPill
                    label=""
                    showLabelInside={false}
                    options={assignUserOptions}
                    value={orgUserId}
                    onChange={(value) => setOrgUserId(value)}
                    searchable
                    style={{ minWidth: 0, width: '100%' }}
                  />
                </div>

                <button
                  className="button admin-assign-grid__btn"
                  type="button"
                  disabled={!orgBinValue || !orgUserId}
                  onClick={() => {
                    setAssignBinValue(orgBinValue);
                    setAssignUserId(orgUserId);
                    setOrganizationsModalOpen(false);
                    openAssignModal();
                  }}
                >
                  Назначить
                </button>
              </div>

              <div className="admin-section__list admin-section__list--grid">
                {organizationsWithoutContracts.map((item) => (
                  <span key={item.customerBin} className="chip bin-chip bin-chip--compact">
                    <span className="bin-chip__title">{item.customerBin}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* All BINs Modal */}
      <Modal open={allBinsModalOpen} onClose={() => { setAllBinsModalOpen(false); setAllBinsSearch(''); setSelectedBinInfo(null); }} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Все БИНы ({bins.length})</h3>
          </div>

          <input
            className="input"
            placeholder="Поиск БИН..."
            value={allBinsSearch}
            onChange={(e) => setAllBinsSearch(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          {binInfoLoading ? (
            <div className="bin-info-panel">
              <span className="text-muted">Загрузка...</span>
            </div>
          ) : selectedBinInfo ? (
            <div className="bin-info-panel">
              <button type="button" className="btn btn--ghost" onClick={() => setSelectedBinInfo(null)}>← Назад</button>
              <div className="bin-info-details">
                <h4>{selectedBinInfo.bin}</h4>
                <p className={selectedBinInfo.hasContract ? 'text-success' : 'text-warning'}>
                  {selectedBinInfo.hasContract ? '✓ Есть договор' : '⚠ Без договора'}
                </p>
                {selectedBinInfo.customerLegalAddress && (
                  <p><strong>Адрес:</strong> {selectedBinInfo.customerLegalAddress}</p>
                )}
                {selectedBinInfo.customerBankNameRu && (
                  <p><strong>Банк:</strong> {selectedBinInfo.customerBankNameRu}</p>
                )}
                {!selectedBinInfo.customerLegalAddress && !selectedBinInfo.customerBankNameRu && (
                  <p className="text-muted">Дополнительная информация недоступна</p>
                )}
              </div>
            </div>
          ) : filteredBinsDetailed.length === 0 ? (
            <span className="text-muted">Нет БИНов.</span>
          ) : (
            <div className="admin-section__list admin-section__list--grid">
              {filteredBinsDetailed.map((item) => (
                <span
                  key={item.bin}
                  className="chip bin-chip bin-chip--compact bin-chip--deletable bin-chip--clickable"
                  onClick={() => handleBinClick(item.bin)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="bin-chip__title">{item.bin}</span>
                  <span className={`bin-chip__status ${item.hasContract ? 'bin-chip__status--contract' : 'bin-chip__status--no-contract'}`}>
                    {item.hasContract ? 'договор' : 'без договора'}
                  </span>
                  <button
                    type="button"
                    className="chip-x"
                    title="Удалить БИН"
                    onClick={(e) => { e.stopPropagation(); handleDeleteBin(item.bin); }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default AdminPage;