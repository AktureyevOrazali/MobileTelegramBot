import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession, BinDetailed, ChatSummary, MessageNotification, Section } from '../types';
import { extractErrorMessage } from '../utils/errors';
import { useDialogFilters } from './useDialogFilters';
import {
    GEOJSON_FEATURES,
    detectRegionFromAddress,
} from '../components/RegionActivityMap';

/* ------------------------------------------------------------------ */
/*  Return type                                                        */
/* ------------------------------------------------------------------ */
export interface UseDialogsDataReturn {
    /* data */
    sections: Section[];
    chats: ChatSummary[];
    bins: string[];
    filteredChats: ChatSummary[];
    binDetails: BinDetailed[];
    regionCounts: Record<string, number>;
    maxRegionCount: number;

    /* UI state */
    loading: boolean;
    error: string | null;
    banner: string | null;
    setBanner: (value: string | null) => void;
    activeChat: ChatSummary | null;
    setActiveChat: (chat: ChatSummary | null) => void;
    dialogToDelete: ChatSummary | null;
    setDialogToDelete: (chat: ChatSummary | null) => void;
    dialogDeleteLoading: boolean;
    aiToggleDialogId: number | null;
    dialogStatusTarget: { chat: ChatSummary; action: 'open' | 'close' } | null;
    setDialogStatusTarget: (value: { chat: ChatSummary; action: 'open' | 'close' } | null) => void;
    dialogStatusLoading: boolean;

    /* derived */
    canDeleteDialog: boolean;
    currentUser: AuthSession['user'];

    /* filters */
    selectedSection: string | null;
    setSelectedSection: (value: string | null) => void;
    selectedBin: string | null;
    setSelectedBin: (value: string | null) => void;
    showFavoritesOnly: boolean;
    setShowFavoritesOnly: (value: boolean) => void;
    sortOrder: 'desc' | 'asc';
    setSortOrder: (value: 'desc' | 'asc') => void;
    statusFilter: 'all' | 'open' | 'closed';
    setStatusFilter: (value: 'all' | 'open' | 'closed') => void;

    /* filter options for SelectPill */
    sectionOptions: { value: string; label: string }[];
    binOptions: { value: string; label: string }[];
    sortOptions: { value: string; label: string }[];
    statusOptions: { value: string; label: string }[];

    /* actions */
    loadSectionsAndChats: (withLoading?: boolean, overrides?: { bin?: string | null; favoritesOnly?: boolean }) => Promise<void>;
    handleDialogDelete: () => Promise<void>;
    handleDialogStatusChange: () => Promise<void>;
    handleToggleAi: (chat: ChatSummary) => Promise<void>;
    handleToggleFavorite: (dialogId: number, currentIsFavorite: boolean) => Promise<void>;
    requestStatusChange: (chat: ChatSummary) => void;
    renderStatusBadge: (chat: ChatSummary) => { className: string; label: string; canClick: boolean; onClick: () => void; title: string };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */
export function useDialogsData(apiClient: ApiClient, session: AuthSession): UseDialogsDataReturn {
    const [sections, setSections] = useState<Section[]>([]);
    const [chats, setChats] = useState<ChatSummary[]>([]);
    const [bins, setBins] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const {
        selectedSection, setSelectedSection,
        selectedBin, setSelectedBin,
        showFavoritesOnly, setShowFavoritesOnly,
        sortOrder, setSortOrder,
        statusFilter, setStatusFilter,
    } = useDialogFilters();

    const [banner, setBanner] = useState<string | null>(null);
    const [activeChat, setActiveChat] = useState<ChatSummary | null>(null);
    const [dialogToDelete, setDialogToDelete] = useState<ChatSummary | null>(null);
    const [dialogDeleteLoading, setDialogDeleteLoading] = useState(false);
    const [updatesCursor, setUpdatesCursor] = useState<Date | null>(null);
    const [aiToggleDialogId, setAiToggleDialogId] = useState<number | null>(null);
    const [aiManuallyDisabled, setAiManuallyDisabled] = useState<Set<number>>(new Set());
    const [dialogStatusTarget, setDialogStatusTarget] = useState<{ chat: ChatSummary; action: 'open' | 'close' } | null>(null);
    const [dialogStatusLoading, setDialogStatusLoading] = useState(false);
    const [binDetails, setBinDetails] = useState<BinDetailed[]>([]);

    const currentUser = session.user;
    const canDeleteDialog = currentUser.isAdmin;

    /* ---- AI override helper ---- */
    const applyAiOverrides = useCallback(
        (list: ChatSummary[]) =>
            list.map((chat) =>
                aiManuallyDisabled.has(chat.dialogId) ? { ...chat, aiEnabled: false } : chat,
            ),
        [aiManuallyDisabled],
    );

    /* ---- Data loaders ---- */
    const loadSectionsAndChats = useCallback(
        async (withLoading = true, overrides?: { bin?: string | null; favoritesOnly?: boolean }) => {
            if (withLoading) {
                setLoading(true);
                setError(null);
            }
            try {
                const binFilter = overrides && 'bin' in overrides ? overrides.bin : selectedBin;
                const favoritesOnly =
                    overrides && 'favoritesOnly' in overrides ? overrides.favoritesOnly ?? false : showFavoritesOnly;

                const [loadedSections, loadedChats] = await Promise.all([
                    apiClient.fetchSections(),
                    apiClient.fetchChats({ favoriteOnly: favoritesOnly, binQuery: binFilter ?? undefined }),
                ]);

                const visibleSections = currentUser.isAdmin
                    ? loadedSections
                    : loadedSections.filter((section) => currentUser.sections.includes(section.id));

                setSections(visibleSections);
                setChats(applyAiOverrides(loadedChats));

                setLoading(false);
                setError(null);
                if (!updatesCursor) setUpdatesCursor(new Date());
            } catch (err) {
                setError(extractErrorMessage(err, 'Не удалось загрузить данные.'));
                setLoading(false);
            }
        },
        [
            apiClient,
            applyAiOverrides,
            currentUser.isAdmin,
            currentUser.sections,
            selectedBin,
            showFavoritesOnly,
            updatesCursor,
        ],
    );

    const loadBins = useCallback(async () => {
        try {
            const data = await apiClient.fetchBins();
            if (currentUser.isAdmin) {
                setBins(data);
                return;
            }

            const assignedValues = (currentUser.bins ?? []).map((assignment) => assignment.bin);
            const allowed = new Set(assignedValues);
            const filtered = data.filter((bin) => allowed.has(bin));
            const merged = Array.from(new Set([...filtered, ...assignedValues]));
            setBins(merged);
        } catch (err) {
            console.warn('Не удалось загрузить БИНы', err);
        }
    }, [apiClient, currentUser.bins, currentUser.isAdmin]);

    const loadBinDetails = useCallback(async () => {
        if (!currentUser.isAdmin && bins.length === 0) return;
        try {
            const data = await apiClient.getBinsDetailed();
            const filtered = currentUser.isAdmin ? data : data.filter((item) => bins.includes(item.bin));
            setBinDetails(filtered);
        } catch (err) {
            console.warn('Не удалось загрузить детали БИНов', err);
        }
    }, [apiClient, bins, currentUser.isAdmin]);

    /* ---- Effects ---- */
    useEffect(() => { loadSectionsAndChats(true); loadBins(); }, [loadSectionsAndChats, loadBins]);

    useEffect(() => {
        if (!selectedBin) return;
        if (!bins.includes(selectedBin)) {
            setSelectedBin(null);
        }
    }, [bins, selectedBin, setSelectedBin]);

    useEffect(() => {
        loadBinDetails();
    }, [loadBinDetails]);

    useEffect(() => {
        if (!banner) return;
        const timer = setTimeout(() => setBanner(null), 6000);
        return () => clearTimeout(timer);
    }, [banner]);

    useEffect(() => {
        setChats((prev) => applyAiOverrides(prev));
        setActiveChat((prev) => (prev ? applyAiOverrides([prev])[0] : prev));
    }, [applyAiOverrides]);

    /* ---- Polling with visibility API ---- */
    const handleUpdates = useCallback(
        (updates: MessageNotification[]) => {
            const messages = updates
                .filter((update) => update.type === 'message' && update.chatTitle)
                .map((update) => `${update.chatTitle}: ${update.text}`);
            const assignments = updates
                .filter((update) => update.type === 'bin_assignment' && update.bin)
                .map((update) => `Вам назначен новый БИН ${update.bin}.`);
            const combined = [...assignments, ...messages];
            if (combined.length > 0) {
                setBanner(combined.join(' '));
                loadSectionsAndChats(false);
                if (assignments.length > 0) {
                    loadBins();
                }
            }
        },
        [loadBins, loadSectionsAndChats],
    );

    // Updates polling (5s) — pauses when tab is hidden
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setInterval> | null = null;

        const poll = async () => {
            try {
                if (!updatesCursor) {
                    setUpdatesCursor(new Date());
                    return;
                }
                const updates = await apiClient.fetchUpdates(updatesCursor);
                if (!cancelled && updates.length > 0) {
                    handleUpdates(updates);
                    const lastUpdate = updates[updates.length - 1].createdAt;
                    setUpdatesCursor(lastUpdate);
                }
            } catch (err) {
                console.warn('Не удалось получить обновления', err);
            }
        };

        const startPolling = () => {
            if (timer) return;
            timer = setInterval(poll, 5000);
        };

        const stopPolling = () => {
            if (timer) { clearInterval(timer); timer = null; }
        };

        const onVisibility = () => {
            if (document.hidden) {
                stopPolling();
            } else {
                poll(); // immediate refresh on tab focus
                startPolling();
            }
        };

        startPolling();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            stopPolling();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [apiClient, updatesCursor, handleUpdates]);

    // Full refresh polling (15s) — pauses when tab is hidden
    useEffect(() => {
        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | null = null;

        const startRefresh = () => {
            if (interval) return;
            interval = setInterval(() => {
                if (!cancelled) loadSectionsAndChats(false);
            }, 30000);
        };

        const stopRefresh = () => {
            if (interval) { clearInterval(interval); interval = null; }
        };

        const onVisibility = () => {
            if (document.hidden) {
                stopRefresh();
            } else {
                if (!cancelled) loadSectionsAndChats(false);
                startRefresh();
            }
        };

        startRefresh();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            stopRefresh();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [loadSectionsAndChats]);

    /* ---- Filter options ---- */
    const sectionOptions = useMemo(
        () => [{ value: "", label: "Все разделы" }, ...sections.map(s => ({ value: String(s.id), label: s.title }))],
        [sections]
    );
    const binOptions = useMemo(
        () => [{ value: "", label: "Все БИНы" }, ...bins.map(b => ({ value: b, label: b }))],
        [bins]
    );
    const sortOptions = useMemo(
        () => [
            { value: 'desc', label: 'Сначала новые' },
            { value: 'asc', label: 'Сначала старые' },
        ],
        [],
    );
    const statusOptions = useMemo(
        () => [
            { value: 'all', label: 'Все диалоги' },
            { value: 'open', label: 'Только открытые' },
            { value: 'closed', label: 'Только закрытые' },
        ],
        [],
    );

    // Re-load on filter change
    useEffect(() => {
        loadSectionsAndChats(true, { bin: selectedBin, favoritesOnly: showFavoritesOnly });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedSection, selectedBin, showFavoritesOnly]);

    /* ---- Derived: region counts ---- */
    const regionCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        GEOJSON_FEATURES.features.forEach((feature) => {
            if (feature.properties?.name) {
                counts[feature.properties.name] = 0;
            }
        });
        binDetails.forEach((detail) => {
            const regionKey = detectRegionFromAddress(detail.customerLegalAddress);
            if (regionKey && regionKey in counts) {
                counts[regionKey] += 1;
            }
        });
        return counts;
    }, [binDetails]);

    const maxRegionCount = useMemo(
        () => Math.max(1, ...Object.values(regionCounts)),
        [regionCounts],
    );

    /* ---- Derived: filtered & sorted chats ---- */
    const filteredChats = useMemo(() => {
        let list = chats;
        if (selectedSection) {
            list = list.filter((chat) => chat.section === selectedSection);
        }
        if (showFavoritesOnly) {
            const favorites = new Set(apiClient.currentUser?.favoriteDialogIds ?? []);
            list = list.filter((chat) => favorites.has(chat.dialogId));
        }
        if (statusFilter === 'open') {
            list = list.filter((chat) => !chat.dialogClosedAt);
        } else if (statusFilter === 'closed') {
            list = list.filter((chat) => Boolean(chat.dialogClosedAt));
        }
        const sorted = [...list].sort((a, b) => {
            const diff = a.updatedAt.getTime() - b.updatedAt.getTime();
            return sortOrder === 'asc' ? diff : -diff;
        });
        return sorted;
    }, [
        apiClient.currentUser?.favoriteDialogIds,
        chats,
        selectedSection,
        showFavoritesOnly,
        sortOrder,
        statusFilter,
    ]);

    // Sync activeChat with chats list
    useEffect(() => {
        if (!activeChat) return;
        const updated = chats.find((item) => item.dialogId === activeChat.dialogId);
        if (!updated) {
            setActiveChat(null);
            return;
        }
        if (updated !== activeChat) {
            setActiveChat(updated);
        }
    }, [activeChat, chats]);

    /* ---- Actions ---- */
    const handleDialogDelete = useCallback(async () => {
        if (!dialogToDelete) return;
        setDialogDeleteLoading(true);
        try {
            await apiClient.deleteDialog(dialogToDelete.dialogId);
            setChats((prev) => prev.filter((item) => item.dialogId !== dialogToDelete.dialogId));
            if (activeChat?.dialogId === dialogToDelete.dialogId) {
                setActiveChat(null);
            }
            setBanner('Диалог удалён');
        } catch (err) {
            setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось удалить диалог.')}`);
        } finally {
            setDialogDeleteLoading(false);
            setDialogToDelete(null);
        }
    }, [activeChat, apiClient, dialogToDelete]);

    const requestStatusChange = useCallback((chat: ChatSummary) => {
        setDialogStatusTarget({ chat, action: chat.dialogClosedAt ? 'open' : 'close' });
    }, []);

    const handleDialogStatusChange = useCallback(async () => {
        if (!dialogStatusTarget) return;
        setDialogStatusLoading(true);
        try {
            const { chat, action } = dialogStatusTarget;
            const response =
                action === 'close'
                    ? await apiClient.closeDialog(chat.dialogId)
                    : await apiClient.openDialog(chat.dialogId);
            const closedAt = response.dialogClosedAt ?? null;
            const aiEnabled = response.aiEnabled;

            setChats((prev) =>
                prev.map((item) =>
                    item.dialogId === chat.dialogId
                        ? { ...item, dialogClosedAt: closedAt, aiEnabled }
                        : item,
                ),
            );
            setActiveChat((prev) =>
                prev && prev.dialogId === chat.dialogId
                    ? { ...prev, dialogClosedAt: closedAt, aiEnabled }
                    : prev,
            );
            setAiManuallyDisabled((prev) => {
                if (!aiEnabled && prev.has(chat.dialogId)) return prev;
                const next = new Set(prev);
                if (aiEnabled) next.delete(chat.dialogId);
                return next;
            });

            setBanner(
                action === 'close'
                    ? 'Диалог закрыт. Клиент уведомлён и AI снова включён.'
                    : 'Диалог открыт снова и готов к сообщениям.',
            );
        } catch (err) {
            setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить статус диалога.')}`);
        } finally {
            setDialogStatusLoading(false);
            setDialogStatusTarget(null);
        }
    }, [apiClient, dialogStatusTarget]);

    const updateChatAiStatus = useCallback((dialogId: number, aiEnabled: boolean) => {
        setChats((prev) => prev.map((item) => (item.dialogId === dialogId ? { ...item, aiEnabled } : item)));
        setActiveChat((prev) => (prev && prev.dialogId === dialogId ? { ...prev, aiEnabled } : prev));
    }, []);

    const handleToggleAi = useCallback(
        async (chat: ChatSummary) => {
            setAiToggleDialogId(chat.dialogId);
            try {
                if (chat.aiEnabled) {
                    await apiClient.disableDialogAI(chat.dialogId);
                    setAiManuallyDisabled((prev) => {
                        const next = new Set(prev);
                        next.add(chat.dialogId);
                        return next;
                    });
                    updateChatAiStatus(chat.dialogId, false);
                    setBanner('AI помощник отключён. Клиенту отправлено уведомление.');
                } else {
                    await apiClient.enableDialogAI(chat.dialogId);
                    setAiManuallyDisabled((prev) => {
                        if (!prev.has(chat.dialogId)) return prev;
                        const next = new Set(prev);
                        next.delete(chat.dialogId);
                        return next;
                    });
                    updateChatAiStatus(chat.dialogId, true);
                    setBanner('AI помощник включён для этого диалога.');
                }
            } catch (err) {
                setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить режим AI.')}`);
            } finally {
                setAiToggleDialogId(null);
            }
        },
        [apiClient, updateChatAiStatus],
    );

    const handleToggleFavorite = useCallback(
        async (dialogId: number, currentIsFavorite: boolean) => {
            const next = !currentIsFavorite;
            try {
                await apiClient.setFavorite(dialogId, next);
                setChats((prev) =>
                    prev.map((item) =>
                        item.dialogId === dialogId ? { ...item, isFavorite: next } : item,
                    ),
                );
                setActiveChat((prev) =>
                    prev && prev.dialogId === dialogId ? { ...prev, isFavorite: next } : prev,
                );
            } catch (err) {
                setBanner(`Ошибка: ${extractErrorMessage(err, 'Не удалось обновить избранное.')}`);
            }
        },
        [apiClient],
    );

    const renderStatusBadge = useCallback(
        (chat: ChatSummary) => {
            const className = `status-badge ${chat.dialogClosedAt ? 'status-badge--closed' : 'status-badge--open'}`;
            const label = chat.dialogClosedAt ? 'Закрыт' : 'Открыт';
            return {
                className,
                label,
                canClick: currentUser.canReply,
                onClick: () => requestStatusChange(chat),
                title: chat.dialogClosedAt ? 'Открыть диалог' : 'Закрыть диалог',
            };
        },
        [currentUser.canReply, requestStatusChange],
    );

    return {
        sections,
        chats,
        bins,
        filteredChats,
        binDetails,
        regionCounts,
        maxRegionCount,
        loading,
        error,
        banner,
        setBanner,
        activeChat,
        setActiveChat,
        dialogToDelete,
        setDialogToDelete,
        dialogDeleteLoading,
        aiToggleDialogId,
        dialogStatusTarget,
        setDialogStatusTarget,
        dialogStatusLoading,
        canDeleteDialog,
        currentUser,
        selectedSection,
        setSelectedSection,
        selectedBin,
        setSelectedBin,
        showFavoritesOnly,
        setShowFavoritesOnly,
        sortOrder,
        setSortOrder,
        statusFilter,
        setStatusFilter,
        sectionOptions,
        binOptions,
        sortOptions,
        statusOptions,
        loadSectionsAndChats,
        handleDialogDelete,
        handleDialogStatusChange,
        handleToggleAi,
        handleToggleFavorite,
        requestStatusChange,
        renderStatusBadge,
    };
}
