import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import {
    BinDetailed,
    OrganizationWithoutContract,
    PendingRegistration,
    RoleInfo,
    Section,
    UnassignedBin,
    UserBinAssignment,
    UserProfile,
} from '../types';
import { extractErrorMessage } from '../utils/errors';
import { cloneAssignment, pluralizeDialogs } from '../utils/admin-helpers';

/**
 * Encapsulates all data state, fetching, and mutation handlers
 * for the Admin page.
 */
export function useAdminData(apiClient: ApiClient) {
    // ── Core data ──
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [roles, setRoles] = useState<RoleInfo[]>([]);
    const [sections, setSections] = useState<Section[]>([]);
    const [bins, setBins] = useState<string[]>([]);
    const [unassignedBins, setUnassignedBins] = useState<UnassignedBin[]>([]);
    const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
    const [organizationsWithoutContracts, setOrganizationsWithoutContracts] = useState<OrganizationWithoutContract[]>([]);
    const [binsDetailed, setBinsDetailed] = useState<BinDetailed[]>([]);

    // ── Loading / error ──
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ── Pending-registration action states ──
    const [pendingAction, setPendingAction] = useState<number | null>(null);
    const [pendingBulkAction, setPendingBulkAction] = useState<'approve' | 'reject' | null>(null);

    // ── BIN info ──
    const [selectedBinInfo, setSelectedBinInfo] = useState<BinDetailed | null>(null);
    const [binInfoLoading, setBinInfoLoading] = useState(false);

    // ── Delete user ──
    const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // ──────────────────── Data loading ────────────────────

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
                setError(extractErrorMessage(err, 'Не удалось загрузить данные администратора'));
            } finally {
                setLoading(false);
            }
        },
        [apiClient],
    );

    // ──────────────────── User mutations ────────────────────

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

    // ──────────────────── Pending registrations ────────────────────

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

    // ──────────────────── Delete user ────────────────────

    const handleConfirmDelete = useCallback(async () => {
        if (!userToDelete) return;
        setDeleteLoading(true);
        setDeleteError(null);
        try {
            await apiClient.deleteUser(userToDelete.id);
            setUsers((prev) => prev.filter((user) => user.id !== userToDelete.id));
            setUserToDelete(null);
        } catch (err) {
            setDeleteError(extractErrorMessage(err, 'Не удалось удалить пользователя'));
        } finally {
            setDeleteLoading(false);
        }
    }, [apiClient, userToDelete]);

    // ──────────────────── BIN operations ────────────────────

    const handleDeleteBin = useCallback(async (binValue: string) => {
        try {
            await apiClient.deleteBin(binValue);
            setBins((prev) => prev.filter((b) => b !== binValue));
            setBinsDetailed((prev) => prev.filter((b) => b.bin !== binValue));
        } catch (err) {
            console.error('Не удалось удалить БИН', err);
        }
    }, [apiClient]);

    const handleBinClick = useCallback(async (binValue: string) => {
        setBinInfoLoading(true);
        try {
            const info = await apiClient.getBinInfo(binValue);
            setSelectedBinInfo(info);
        } catch (err) {
            console.error('Не удалось загрузить информацию о БИН', err);
            const basicInfo = binsDetailed.find((b) => b.bin === binValue);
            if (basicInfo) setSelectedBinInfo(basicInfo);
        } finally {
            setBinInfoLoading(false);
        }
    }, [apiClient, binsDetailed]);

    // ──────────────────── Derived data ────────────────────

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

    return {
        // data
        users,
        roles,
        sections,
        bins,
        unassignedBins,
        pendingRegistrations,
        organizationsWithoutContracts,
        binsDetailed,
        loading,
        error,

        // pending registration
        pendingAction,
        pendingBulkAction,

        // BIN info
        selectedBinInfo,
        setSelectedBinInfo,
        binInfoLoading,

        // delete user
        userToDelete,
        setUserToDelete,
        deleteLoading,
        deleteError,
        setDeleteError,

        // derived
        assignableUsers,
        assignUserOptions,
        assignBinOptions,
        orgBinOptions,

        // actions
        loadAdminData,
        handleRoleSave,
        handleSectionsSave,
        handleBinsSave,
        handlePasswordReset,
        handlePendingApprove,
        handlePendingReject,
        handlePendingBulkAction,
        handleConfirmDelete,
        handleDeleteBin,
        handleBinClick,
    };
}
