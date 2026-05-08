import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BinDetailed, RoleInfo, Section, UserBinAssignment, UserProfile } from '../types';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';
import { validatePassword, validatePasswordMatch } from '../utils/validation';
import { useDebouncedEffect } from '../hooks/useDebouncedEffect';
import { cloneAssignment, formatDateTimeLocalInput, parseDateTimeLocalInput, roleLabels } from '../utils/admin-helpers';
import { sanitizeUiText } from '../utils/text';
import SelectPill from '../components/SelectPill';
import Modal from '../components/Modal';

export interface AdminUserCardProps {
    user: UserProfile;
    currentUserRole: string;
    roles: RoleInfo[];
    sections: Section[];
    availableBins: string[];
    binDetails: BinDetailed[];
    onRoleSave: (userId: number, role: string) => Promise<void>;
    onSectionsSave: (userId: number, sections: string[]) => Promise<void>;
    onBinsSave: (userId: number, bins: UserBinAssignment[]) => Promise<void>;
    onPasswordReset: (userId: number, password: string) => Promise<void>;
    canDeleteUser: boolean;
    onDeleteRequest: (user: UserProfile) => void;
    onOpenProfile?: (user: UserProfile) => void;
    style?: React.CSSProperties;
}

const AdminUserCard: React.FC<AdminUserCardProps> = ({
    user,
    currentUserRole,
    roles,
    sections,
    availableBins,
    binDetails,
    onRoleSave,
    onSectionsSave,
    onBinsSave,
    onPasswordReset,
    canDeleteUser,
    onDeleteRequest,
    onOpenProfile,
    style,
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
        // Не сбрасываем operatorBinsOpen и operatorSectionsOpen, чтобы модалки не закрывались
    }, [user]);

    const roleOptions = useMemo(
        () => roles.map((r) => ({ value: r.id, label: roleLabels[r.id] ?? r.title })),
        [roles],
    );

    const sectionOptions = useMemo(() => {
        return [{ value: '', label: 'Выберите раздел' }].concat(
            sections
                .filter((section) => !sectionIds.has(section.id))
                .map((section) => ({ value: section.id, label: section.title, meta: section.id })),
        );
    }, [sections, sectionIds]);

    const binNameByBin = useMemo(() => {
        const map = new Map<string, string>();
        binDetails.forEach((item) => {
            if (item.customerNameRu) {
                map.set(item.bin, item.customerNameRu);
            }
        });
        return map;
    }, [binDetails]);

    const getBinMeta = (assignment: UserBinAssignment) => {
        const parts: string[] = [];
        const customerName = binNameByBin.get(assignment.bin);
        if (customerName) {
            parts.push(customerName);
        }
        parts.push(assignment.expiresAt ? `\u0434\u043e ${formatDateTime(assignment.expiresAt)}` : '\u0431\u0435\u0441\u0441\u0440\u043e\u0447\u043d\u043e');
        return parts.join(' | ');
    };

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
            availableBins.filter((b) => !current.has(b)).map((b) => ({
                value: b,
                label: b,
                meta: binNameByBin.get(b),
            })),
        );
    }, [availableBins, assignedBins, binNameByBin]);

    const lastSavedRole = useRef(selectedRole);
    useEffect(() => {
        if (lastSavedRole.current === selectedRole) return;
        (async () => {
            try {
                setError(null);
                await onRoleSave(user.id, selectedRole);
                setSuccessMessage('Роль обновлена');
                lastSavedRole.current = selectedRole;
            } catch (e) {
                setError(extractErrorMessage(e, 'Ошибка при сохранении роли'));
            }
        })();
    }, [selectedRole]);

    const sectionKey = useMemo(() => Array.from(sectionIds).sort().join(','), [sectionIds]);
    useDebouncedEffect(() => {
        (async () => {
            try {
                setError(null);
                await onSectionsSave(user.id, Array.from(sectionIds));
                setSuccessMessage('Разделы обновлены');
            } catch (e) {
                setError(extractErrorMessage(e, 'Ошибка при сохранении разделов'));
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
                setError(null);
                await onBinsSave(
                    user.id,
                    assignedBins.map(cloneAssignment),
                );
                setSuccessMessage('БИНы обновлены');
            } catch (e) {
                setError(extractErrorMessage(e, 'Ошибка при сохранении БИНов'));
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
        const pwdError = validatePassword(pwd1) ?? validatePasswordMatch(pwd1, pwd2);
        if (pwdError) { setPwdErr(pwdError); return; }
        setSavingPassword(true);
        setPwdErr(null);
        try {
            await onPasswordReset(user.id, pwd1.trim());
            setPwd1('');
            setPwd2('');
            setPwdOpen(false);
            setSuccessMessage('Пароль сброшен');
        } catch (e) {
            setPwdErr(extractErrorMessage(e, 'Не удалось обновить пароль'));
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
    const displayName = sanitizeUiText(user.name) ?? user.name;
    const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        const interactiveTarget = target.closest('button, input, select, textarea, a, .menu, .select-pill');
        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }
        onOpenProfile?.(user);
    };

    const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        const interactiveTarget = target.closest('button, input, select, textarea, a, .menu, .select-pill');
        if (interactiveTarget && interactiveTarget !== event.currentTarget) {
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenProfile?.(user);
        }
    };

    return (
        <div className="card admin-user-card" style={style} onClick={handleCardClick} onKeyDown={handleCardKeyDown} role="button" tabIndex={0}>
            {/* HEADER: Name and Badge only */}
            <div className="admin-user-card__header-minimal">
                <h3 className="admin-user-card__name">{displayName}</h3>
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
                        <span className="badge">{displayName}</span>
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
                                title={getBinMeta(assignment)}
                            >
                                <span className="bin-chip__text">
                                    <span className="bin-chip__title">{assignment.bin}</span>
                                    <span className="bin-chip__meta">{getBinMeta(assignment)}</span>
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

            {/* Operator Sections Modal */}
            <Modal open={operatorSectionsOpen} onClose={() => setOperatorSectionsOpen(false)} className="admin-modal__container">
                <div className="admin-modal">
                    <div className="admin-modal__header">
                        <h3>Разделы оператора</h3>
                        <span className="badge">{displayName}</span>
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
                                    <span key={section.id} className="chip section-chip section-chip--detailed">
                                        <span className="section-chip__text">
                                            <span className="section-chip__title">{label}</span>
                                            <span className="section-chip__meta">{section.id}</span>
                                        </span>
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

export default AdminUserCard;
