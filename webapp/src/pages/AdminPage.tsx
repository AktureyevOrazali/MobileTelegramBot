import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { UserProfile } from '../types';
import { extractErrorMessage } from '../utils/errors';
import { cloneAssignment, formatDateTimeLocalInput, parseDateTimeLocalInput } from '../utils/admin-helpers';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import AdminUserCard from '../components/AdminUserCard';
import { useAdminData } from '../hooks/useAdminData';

interface AdminPageProps {
  apiClient: ApiClient;
  currentUser: UserProfile;
}

const AdminPage: React.FC<AdminPageProps> = ({ apiClient, currentUser }) => {
  const admin = useAdminData(apiClient);

  // ── Local UI state (search, modals) ──
  const [search, setSearch] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [allBinsModalOpen, setAllBinsModalOpen] = useState(false);
  const [allBinsSearch, setAllBinsSearch] = useState('');

  // Without-contract modal
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgSearch, setOrgSearch] = useState('');

  // With-contract modal
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractSearch, setContractSearch] = useState('');

  // Unassigned BINs modal
  const [unassignedModalOpen, setUnassignedModalOpen] = useState(false);
  const [unassignedBinSearch, setUnassignedBinSearch] = useState('');

  // Assignment modal (separate from unassigned list)
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignBinValue, setAssignBinValue] = useState('');
  const [assignEmployeeSearch, setAssignEmployeeSearch] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignIndefinite, setAssignIndefinite] = useState(true);
  const [assignExpiresAt, setAssignExpiresAt] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);

  // ── Data loading (debounced search) ──
  useEffect(() => {
    const t = setTimeout(() => { admin.loadAdminData(search.trim() || undefined); }, 350);
    return () => clearTimeout(t);
  }, [search, admin.loadAdminData]);

  // ── Derived ──
  const filteredUsers = useMemo(() => {
    const approvedUsers = admin.users.filter((user) => user.isApproved);
    if (!search.trim()) return approvedUsers;
    const normalized = search.trim().toLowerCase();
    return approvedUsers.filter((user) =>
      [user.name, user.email, user.login].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [admin.users, search]);

  const filteredBinsDetailed = useMemo(() => {
    const query = allBinsSearch.trim().toLowerCase();
    if (!query) return admin.binsDetailed;
    return admin.binsDetailed.filter((item) => item.bin.toLowerCase().includes(query));
  }, [admin.binsDetailed, allBinsSearch]);

  const filteredPendingRegistrations = useMemo(() => {
    const query = pendingSearch.trim().toLowerCase();
    if (!query) return admin.pendingRegistrations;
    return admin.pendingRegistrations.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.email.toLowerCase().includes(query),
    );
  }, [admin.pendingRegistrations, pendingSearch]);

  const filteredOrganizations = useMemo(() => {
    const query = orgSearch.trim().toLowerCase();
    if (!query) return admin.organizationsWithoutContracts;
    return admin.organizationsWithoutContracts.filter((item) =>
      item.customerBin.toLowerCase().includes(query),
    );
  }, [admin.organizationsWithoutContracts, orgSearch]);

  const binsWithContract = useMemo(
    () => admin.binsDetailed.filter((b) => b.hasContract),
    [admin.binsDetailed],
  );

  const filteredBinsWithContract = useMemo(() => {
    const query = contractSearch.trim().toLowerCase();
    if (!query) return binsWithContract;
    return binsWithContract.filter((item) => item.bin.toLowerCase().includes(query));
  }, [binsWithContract, contractSearch]);

  const filteredUnassignedBins = useMemo(() => {
    const binQuery = unassignedBinSearch.trim().toLowerCase();
    if (!binQuery) return admin.unassignedBins;
    return admin.unassignedBins.filter((item) => item.bin.toLowerCase().includes(binQuery));
  }, [admin.unassignedBins, unassignedBinSearch]);

  // Filtered assignable users for assignment modal
  const filteredAssignableUsers = useMemo(() => {
    const query = assignEmployeeSearch.trim().toLowerCase();
    if (!query) return admin.assignableUsers;
    return admin.assignableUsers.filter((user) =>
      user.name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query),
    );
  }, [admin.assignableUsers, assignEmployeeSearch]);

  const selectedAssignUser = useMemo(
    () => admin.assignableUsers.find((user) => String(user.id) === assignUserId) ?? null,
    [admin.assignableUsers, assignUserId],
  );

  const binNameByBin = useMemo(() => {
    const map = new Map<string, string>();
    admin.binsDetailed.forEach((item) => {
      if (item.customerNameRu) {
        map.set(item.bin, item.customerNameRu);
      }
    });
    admin.organizationsWithoutContracts.forEach((item) => {
      if (item.customerNameRu && !map.has(item.customerBin)) {
        map.set(item.customerBin, item.customerNameRu);
      }
    });
    return map;
  }, [admin.binsDetailed, admin.organizationsWithoutContracts]);

  const getBinName = (bin: string, preferredName?: string | null) => preferredName ?? binNameByBin.get(bin) ?? null;

  const assignBinName = useMemo(
    () => (assignBinValue ? getBinName(assignBinValue) : null),
    [assignBinValue, binNameByBin],
  );

  // ── Open assignment modal for a specific BIN ──
  const openAssignModal = (bin: string) => {
    setAssignBinValue(bin);
    setAssignEmployeeSearch('');
    setAssignUserId('');
    setAssignIndefinite(true);
    setAssignExpiresAt('');
    setAssignError(null);
    setAssignModalOpen(true);
  };

  const closeAssignModal = () => {
    setAssignModalOpen(false);
    setAssignBinValue('');
    setAssignUserId('');
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
      await admin.handleBinsSave(selectedAssignUser.id, next);
      closeAssignModal();
    } catch (err) {
      setAssignError(extractErrorMessage(err, 'Не удалось назначить БИН'));
    } finally {
      setAssignLoading(false);
    }
  };

  return (
    <div className="admin-page admin-page--app-sidebar">
      {/* ── Gradient hero header ── */}
      <div className={`admin-hero ${admin.loading ? 'admin-hero--loading' : ''}`}>
        <div className="admin-hero__top">
          <div className="admin-hero__meta">
            <h2 className="admin-hero__title">Администрирование</h2>
            <p className="admin-hero__sub">
              {filteredUsers.length} пользовател{filteredUsers.length === 1 ? 'ь' : filteredUsers.length < 5 ? 'я' : 'ей'}
            </p>
          </div>
        </div>

        {/* ── Stat pills row ── */}
        <div className="admin-stats-row">
          <button
            type="button"
            className="admin-stat-pill"
            onClick={() => setAllBinsModalOpen(true)}
            disabled={admin.bins.length === 0}
          >
            <span className="admin-stat-pill__value">{admin.bins.length}</span>
            <span className="admin-stat-pill__label">Все БИНы</span>
          </button>

          <button
            type="button"
            className="admin-stat-pill"
            onClick={() => setOrgModalOpen(true)}
            disabled={admin.organizationsWithoutContracts.length === 0}
          >
            <span className="admin-stat-pill__value">{admin.organizationsWithoutContracts.length}</span>
            <span className="admin-stat-pill__label">Без договора</span>
          </button>

          <button
            type="button"
            className="admin-stat-pill"
            onClick={() => setContractModalOpen(true)}
            disabled={binsWithContract.length === 0}
          >
            <span className="admin-stat-pill__value">{binsWithContract.length}</span>
            <span className="admin-stat-pill__label">С договором</span>
          </button>

          <button
            type="button"
            className="admin-stat-pill"
            onClick={() => setUnassignedModalOpen(true)}
            disabled={admin.unassignedBins.length === 0}
          >
            <span className="admin-stat-pill__value">{admin.unassignedBins.length}</span>
            <span className="admin-stat-pill__label">Неназначенные</span>
          </button>

          <button
            type="button"
            className={`admin-stat-pill ${admin.pendingRegistrations.length > 0 ? 'admin-stat-pill--alert' : ''}`}
            onClick={() => setPendingModalOpen(true)}
            disabled={admin.pendingRegistrations.length === 0}
          >
            <span className="admin-stat-pill__value">{admin.pendingRegistrations.length}</span>
            <span className="admin-stat-pill__label">Регистрации</span>
          </button>
        </div>

        {/* ── Search ── */}
        <div className="admin-hero__search">
          <input
            className="admin-hero__search-input"
            placeholder="Поиск по имени, логину или e-mail..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {/* ── User grid ── */}
      <div className="admin-content-shell">
        <div className="admin-content">
          {admin.loading ? (
        <div className="admin-empty-state">
          <div className="admin-empty-state__icon">⏳</div>
          <p>Загружаем данные…</p>
        </div>
          ) : admin.error ? (
        <div className="admin-empty-state">
          <div className="admin-empty-state__icon">⚠️</div>
          <p>Ошибка: {admin.error}</p>
          <button className="button" type="button" onClick={() => admin.loadAdminData(search)}>
            Повторить попытку
          </button>
        </div>
          ) : filteredUsers.length === 0 ? (
        <div className="admin-empty-state">
          <div className="admin-empty-state__icon">👤</div>
          <p>Пользователи не найдены</p>
        </div>
          ) : (
        <div className="admin-user-grid">
          {filteredUsers.map((user, index) => (
            <AdminUserCard
              key={user.id}
              user={user}
              currentUserRole={currentUser.role}
              roles={admin.roles}
              sections={admin.sections}
              availableBins={admin.bins}
              binDetails={admin.binsDetailed}
              onRoleSave={admin.handleRoleSave}
              onSectionsSave={admin.handleSectionsSave}
              onBinsSave={admin.handleBinsSave}
              onPasswordReset={admin.handlePasswordReset}
              canDeleteUser={currentUser.id !== user.id}
              onDeleteRequest={(selectedUser) => {
                admin.setDeleteError(null);
                admin.setUserToDelete(selectedUser);
              }}
              style={{ animationDelay: `${index * 0.06}s` }}
            />
          ))}
        </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={Boolean(admin.userToDelete)}
        title="Удалить аккаунт?"
        description={
          admin.userToDelete && (
            <>
              Аккаунт <strong>{admin.userToDelete.name}</strong> будет удалён навсегда.
              {admin.deleteError && <p className="alert error" style={{ marginTop: 12 }}>{admin.deleteError}</p>}
            </>
          )
        }
        tone="danger"
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        loading={admin.deleteLoading}
        onCancel={() => {
          if (admin.deleteLoading) return;
          admin.setUserToDelete(null);
          admin.setDeleteError(null);
        }}
        onConfirm={admin.handleConfirmDelete}
      />

      {/* Pending Registrations Modal */}
      <Modal open={pendingModalOpen} onClose={() => { setPendingModalOpen(false); setPendingSearch(''); }} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Заявки ({admin.pendingRegistrations.length})</h3>
            <div className="admin-modal__header-actions">
              <button
                className="button secondary small"
                type="button"
                disabled={admin.pendingRegistrations.length === 0 || admin.pendingBulkAction !== null}
                onClick={() => admin.handlePendingBulkAction('reject')}
              >
                Отклонить все
              </button>
              <button
                className="button small"
                type="button"
                disabled={admin.pendingRegistrations.length === 0 || admin.pendingBulkAction !== null}
                onClick={() => admin.handlePendingBulkAction('approve')}
              >
                Принять все
              </button>
            </div>
          </div>

          {admin.pendingRegistrations.length > 0 && (
            <div className="admin-modal__search">
              <input
                className="input"
                placeholder="Поиск по имени или e-mail"
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
              />
            </div>
          )}

          <div className="admin-modal__list admin-modal__list--stack">
            {filteredPendingRegistrations.length === 0 ? (
              <span className="text-muted">{pendingSearch ? 'Заявки не найдены' : 'Нет новых заявок.'}</span>
            ) : (
              filteredPendingRegistrations.map((item) => (
                <div key={item.id} className="pending-registration-card">
                  <div>
                    <div className="pending-registration-card__name">{item.name}</div>
                    <div className="pending-registration-card__meta">{item.email}</div>
                  </div>
                  <div className="pending-registration-card__actions">
                    <button
                      className="button small"
                      type="button"
                      disabled={admin.pendingAction === item.id || admin.pendingBulkAction !== null}
                      onClick={() => admin.handlePendingApprove(item.id)}
                    >
                      ✓
                    </button>
                    <button
                      className="button secondary small"
                      type="button"
                      disabled={admin.pendingAction === item.id || admin.pendingBulkAction !== null}
                      onClick={() => admin.handlePendingReject(item.id)}
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

      {/* Organizations Without Contracts Modal (info only) */}
      <Modal
        open={orgModalOpen}
        onClose={() => { setOrgModalOpen(false); setOrgSearch(''); admin.setSelectedBinInfo(null); }}
        className="admin-modal__container"
      >
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Без договора ({admin.organizationsWithoutContracts.length})</h3>
          </div>

          <input
            className="input"
            placeholder="Поиск БИН..."
            value={orgSearch}
            onChange={(e) => setOrgSearch(e.target.value)}
          />

          {admin.binInfoLoading ? (
            <div className="bin-info-panel">
              <span className="text-muted">Загрузка...</span>
            </div>
          ) : admin.selectedBinInfo ? (
            <div className="bin-info-panel">
              <button type="button" className="admin-modal__back-btn" onClick={() => admin.setSelectedBinInfo(null)}>← Назад</button>
              <div className="bin-info-details">
                <h4>{admin.selectedBinInfo.bin}</h4>
                <p className="text-warning">⚠ Без договора</p>
                {admin.selectedBinInfo.customerNameRu && (
                  <p><strong>{"\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f:"}</strong> {admin.selectedBinInfo.customerNameRu}</p>
                )}
                {admin.selectedBinInfo.customerLegalAddress && (
                  <p><strong>Адрес:</strong> {admin.selectedBinInfo.customerLegalAddress}</p>
                )}
                {admin.selectedBinInfo.customerBankNameRu && (
                  <p><strong>Банк:</strong> {admin.selectedBinInfo.customerBankNameRu}</p>
                )}
                {!admin.selectedBinInfo.customerNameRu && !admin.selectedBinInfo.customerLegalAddress && !admin.selectedBinInfo.customerBankNameRu && (
                  <p className="text-muted">Дополнительная информация недоступна</p>
                )}
              </div>
            </div>
          ) : filteredOrganizations.length === 0 ? (
            <span className="text-muted">Нет организаций без договора.</span>
          ) : (
            <div className="admin-section__list admin-section__list--grid">
              {filteredOrganizations.map((item) => (
                <span
                  key={item.customerBin}
                  className="chip bin-chip bin-chip--compact bin-chip--clickable"
                  onClick={() => admin.handleBinClick(item.customerBin)}
                >
                  <span className="bin-chip__text">
                    <span className="bin-chip__title">{item.customerBin}</span>
                    {getBinName(item.customerBin, item.customerNameRu) && <span className="bin-chip__meta">{getBinName(item.customerBin, item.customerNameRu)}</span>}
                  </span>
                  <span className="bin-chip__status bin-chip__status--no-contract">без договора</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* BINs With Contract Modal (info only) */}
      <Modal
        open={contractModalOpen}
        onClose={() => { setContractModalOpen(false); setContractSearch(''); admin.setSelectedBinInfo(null); }}
        className="admin-modal__container"
      >
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>С договором ({binsWithContract.length})</h3>
          </div>

          <input
            className="input"
            placeholder="Поиск БИН..."
            value={contractSearch}
            onChange={(e) => setContractSearch(e.target.value)}
          />

          {admin.binInfoLoading ? (
            <div className="bin-info-panel">
              <span className="text-muted">Загрузка...</span>
            </div>
          ) : admin.selectedBinInfo ? (
            <div className="bin-info-panel">
              <button type="button" className="admin-modal__back-btn" onClick={() => admin.setSelectedBinInfo(null)}>← Назад</button>
              <div className="bin-info-details">
                <h4>{admin.selectedBinInfo.bin}</h4>
                <p className="text-success">✓ Есть договор</p>
                {admin.selectedBinInfo.customerNameRu && (
                  <p><strong>{"\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f:"}</strong> {admin.selectedBinInfo.customerNameRu}</p>
                )}
                {admin.selectedBinInfo.customerLegalAddress && (
                  <p><strong>Адрес:</strong> {admin.selectedBinInfo.customerLegalAddress}</p>
                )}
                {admin.selectedBinInfo.customerBankNameRu && (
                  <p><strong>Банк:</strong> {admin.selectedBinInfo.customerBankNameRu}</p>
                )}
                {!admin.selectedBinInfo.customerNameRu && !admin.selectedBinInfo.customerLegalAddress && !admin.selectedBinInfo.customerBankNameRu && (
                  <p className="text-muted">Дополнительная информация недоступна</p>
                )}
              </div>
            </div>
          ) : filteredBinsWithContract.length === 0 ? (
            <span className="text-muted">Нет БИНов с договором.</span>
          ) : (
            <div className="admin-section__list admin-section__list--grid">
              {filteredBinsWithContract.map((item) => (
                <span
                  key={item.bin}
                  className="chip bin-chip bin-chip--compact bin-chip--clickable"
                  onClick={() => admin.handleBinClick(item.bin)}
                >
                  <span className="bin-chip__text">
                    <span className="bin-chip__title">{item.bin}</span>
                    {getBinName(item.bin, item.customerNameRu) && <span className="bin-chip__meta">{getBinName(item.bin, item.customerNameRu)}</span>}
                  </span>
                  <span className="bin-chip__status bin-chip__status--contract">договор</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Unassigned BINs Modal (list only — assignment opens separate modal) */}
      <Modal
        open={unassignedModalOpen}
        onClose={() => { setUnassignedModalOpen(false); setUnassignedBinSearch(''); }}
        className="admin-modal__container"
      >
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Неназначенные БИНы ({admin.unassignedBins.length})</h3>
          </div>

          <input
            className="input"
            placeholder="Поиск по БИН..."
            value={unassignedBinSearch}
            onChange={(e) => setUnassignedBinSearch(e.target.value)}
          />

          {filteredUnassignedBins.length === 0 ? (
            <span className="text-muted">{unassignedBinSearch ? 'БИНы не найдены' : 'Нет неназначенных БИНов.'}</span>
          ) : (
            <div className="admin-section__list admin-section__list--grid">
              {filteredUnassignedBins.map((item) => (
                <span
                  key={item.bin}
                  className="chip bin-chip bin-chip--compact bin-chip--clickable"
                  onClick={() => openAssignModal(item.bin)}
                >
                  <span className="bin-chip__text">
                    <span className="bin-chip__title">{item.bin}</span>
                    {getBinName(item.bin) && <span className="bin-chip__meta">{getBinName(item.bin)}</span>}
                  </span>
                  <span className={`bin-chip__status ${item.hasContract ? 'bin-chip__status--contract' : 'bin-chip__status--no-contract'}`}>
                    {item.hasContract ? 'договор' : 'без договора'}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Assignment Modal (opened when clicking a BIN in unassigned list) */}
      <Modal
        open={assignModalOpen}
        onClose={closeAssignModal}
        className="admin-modal__container"
      >
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Назначить БИН</h3>
          </div>

          <div className="admin-assign-modal__bin-label">
            <span className="bin-chip__title">{assignBinValue}</span>
            {assignBinName && <span className="bin-chip__meta">{assignBinName}</span>}
          </div>

          <input
            className="input"
            placeholder="Поиск по сотруднику..."
            value={assignEmployeeSearch}
            onChange={(e) => setAssignEmployeeSearch(e.target.value)}
          />

          {filteredAssignableUsers.length === 0 ? (
            <span className="text-muted">Нет доступных сотрудников</span>
          ) : (
            <div className="admin-assign-modal__users">
              {filteredAssignableUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={`admin-assign-modal__user-btn ${assignUserId === String(user.id) ? 'admin-assign-modal__user-btn--selected' : ''}`}
                  onClick={() => setAssignUserId(String(user.id))}
                >
                  <span className="admin-assign-modal__user-name">{user.name}</span>
                  <span className="admin-assign-modal__user-email">{user.email}</span>
                </button>
              ))}
            </div>
          )}

          {assignUserId && (
            <div className="admin-assign-modal__duration">
              <div className="bin-modal__options">
                <label className={`bin-modal__option ${assignIndefinite ? 'bin-modal__option--active' : ''}`}>
                  <input
                    className="bin-modal__radio"
                    type="radio"
                    name="assign-modal-duration"
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
                    name="assign-modal-duration"
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
                  <label htmlFor="assign-modal-expires">Дата окончания</label>
                  <input
                    id="assign-modal-expires"
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
            </div>
          )}

          {assignError && <div className="alert error">{assignError}</div>}

          <div className="admin-assign-modal__actions">
            <button
              className="button secondary"
              type="button"
              onClick={closeAssignModal}
              disabled={assignLoading}
            >
              Отменить
            </button>
            <button
              className="button"
              type="button"
              onClick={handleAssignBin}
              disabled={assignLoading || !assignUserId}
            >
              {assignLoading ? '...' : 'Назначить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* All BINs Modal */}
      <Modal open={allBinsModalOpen} onClose={() => { setAllBinsModalOpen(false); setAllBinsSearch(''); admin.setSelectedBinInfo(null); }} className="admin-modal__container">
        <div className="admin-modal">
          <div className="admin-modal__header">
            <h3>Все БИНы ({admin.bins.length})</h3>
          </div>

          <input
            className="input"
            placeholder="Поиск БИН..."
            value={allBinsSearch}
            onChange={(e) => setAllBinsSearch(e.target.value)}
          />

          {admin.binInfoLoading ? (
            <div className="bin-info-panel">
              <span className="text-muted">Загрузка...</span>
            </div>
          ) : admin.selectedBinInfo ? (
            <div className="bin-info-panel">
              <button type="button" className="admin-modal__back-btn" onClick={() => admin.setSelectedBinInfo(null)}>← Назад</button>
              <div className="bin-info-details">
                <h4>{admin.selectedBinInfo.bin}</h4>
                <p className={admin.selectedBinInfo.hasContract ? 'text-success' : 'text-warning'}>
                  {admin.selectedBinInfo.hasContract ? '✓ Есть договор' : '⚠ Без договора'}
                </p>
                {admin.selectedBinInfo.customerNameRu && (
                  <p><strong>{"\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f:"}</strong> {admin.selectedBinInfo.customerNameRu}</p>
                )}
                {admin.selectedBinInfo.customerLegalAddress && (
                  <p><strong>Адрес:</strong> {admin.selectedBinInfo.customerLegalAddress}</p>
                )}
                {admin.selectedBinInfo.customerBankNameRu && (
                  <p><strong>Банк:</strong> {admin.selectedBinInfo.customerBankNameRu}</p>
                )}
                {!admin.selectedBinInfo.customerNameRu && !admin.selectedBinInfo.customerLegalAddress && !admin.selectedBinInfo.customerBankNameRu && (
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
                  onClick={() => admin.handleBinClick(item.bin)}
                >
                  <span className="bin-chip__text">
                    <span className="bin-chip__title">{item.bin}</span>
                    {getBinName(item.bin, item.customerNameRu) && <span className="bin-chip__meta">{getBinName(item.bin, item.customerNameRu)}</span>}
                  </span>
                  <span className={`bin-chip__status ${item.hasContract ? 'bin-chip__status--contract' : 'bin-chip__status--no-contract'}`}>
                    {item.hasContract ? 'договор' : 'без договора'}
                  </span>
                  <button
                    type="button"
                    className="chip-x"
                    title="Удалить БИН"
                    onClick={(e) => { e.stopPropagation(); admin.handleDeleteBin(item.bin); }}
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
