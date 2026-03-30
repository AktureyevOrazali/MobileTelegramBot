import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { AuthSession, BinDetailed, ChatSummary, DashboardSummary, Section } from '../types';
import { extractErrorMessage } from '../utils/errors';
import { useDialogFilters } from './useDialogFilters';
import {
    GEOJSON_FEATURES,
    detectRegionFromAddress,
    detectRayonFromAddress,
    SVG_ID_TO_REGION_KEY,
} from '../components/RegionActivityMap';
import { OBLAST_RAYONS } from '../data/kzMapData';

/** Per-region/rayon aggregated statistics. */
export interface RegionStats {
    totalDialogs: number;
    openDialogs: number;
    closedDialogs: number;
    unreadCount: number;
    aiClosedDialogs: number;
    responseSpeedFast: number;
    responseSpeedMedium: number;
    responseSpeedSlow: number;
    csatSum: number;
    csatCount: number;
    aiCsatSum: number;
    aiCsatCount: number;
    csatDistribution: number[];
    aiCsatDistribution: number[];
}

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
    rayonCounts: Record<string, Record<number, number>>;
    regionStats: Record<string, RegionStats>;
    rayonStats: Record<string, Record<number, RegionStats>>;
    maxRegionCount: number;
    dashboardSummary: DashboardSummary | null;

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
    loadSectionsAndChats: (withLoading?: boolean) => Promise<void>;
    handleDialogDelete: () => Promise<void>;
    handleDialogStatusChange: () => Promise<void>;
    handleToggleAi: (chat: ChatSummary) => Promise<void>;
    handleToggleFavorite: (dialogId: number, currentIsFavorite: boolean) => Promise<void>;
    requestStatusChange: (chat: ChatSummary) => void;
    renderStatusBadge: (chat: ChatSummary) => { canClick: boolean; onClick: () => void };
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
    const [aiToggleDialogId, setAiToggleDialogId] = useState<number | null>(null);
    const [aiManuallyDisabled, setAiManuallyDisabled] = useState<Set<number>>(new Set());
    const [dialogStatusTarget, setDialogStatusTarget] = useState<{ chat: ChatSummary; action: 'open' | 'close' } | null>(null);
    const [dialogStatusLoading, setDialogStatusLoading] = useState(false);
    const [binDetails, setBinDetails] = useState<BinDetailed[]>([]);
    const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);

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
        async (withLoading = true) => {
            if (withLoading) {
                setLoading(true);
                setError(null);
            }
            try {
                const [loadedSections, loadedChats, summary] = await Promise.all([
                    apiClient.fetchSections(),
                    apiClient.fetchChats(),
                    apiClient.fetchDashboardSummary().catch(err => {
                        console.warn('Dashboard summary not available (operator role lacks access):', err);
                        return null;
                    })
                ]);

                const visibleSections = currentUser.isAdmin
                    ? loadedSections
                    : loadedSections.filter((section) => currentUser.sections.includes(section.id));

                setSections(visibleSections);
                setChats(applyAiOverrides(loadedChats));
                setDashboardSummary(summary as DashboardSummary | null);

                setLoading(false);
                setError(null);
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
            console.warn('Cannot load full bin details (operator role lacks access):', err);
            // Fallback for operators who can't access `/api/bins/detailed`
            // We can just construct a basic detailed list out of their assigned bins
            if (!currentUser.isAdmin) {
                const fallback = bins.map(b => ({
                    bin: b,
                    hasContract: true,
                    customerLegalAddress: null,
                    customerBankNameRu: null,
                    customerNameRu: null
                }));
                setBinDetails(fallback);
            }
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

    /* ---- Auto-refresh disabled: manual refresh only ---- */

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
        loadSectionsAndChats(true);
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

    /* ---- Derived: rayon counts (oblastSvgId → rayonIndex → binCount) ---- */
    const rayonCounts = useMemo(() => {
        const result: Record<string, Record<number, number>> = {};
        // Build reverse lookup: regionKey → oblastId
        const regionKeyToSvgId: Record<string, string> = {};
        for (const svgId of Object.keys(SVG_ID_TO_REGION_KEY)) {
            regionKeyToSvgId[SVG_ID_TO_REGION_KEY[svgId]] = svgId;
        }
        binDetails.forEach((detail) => {
            const regionKey = detectRegionFromAddress(detail.customerLegalAddress);
            if (!regionKey) return;
            const oblastId = regionKeyToSvgId[regionKey];
            if (oblastId && OBLAST_RAYONS[oblastId]) {
                const rayonIdx = detectRayonFromAddress(detail.customerLegalAddress, oblastId);
                if (rayonIdx !== null) {
                    if (!result[oblastId]) result[oblastId] = {};
                    result[oblastId][rayonIdx] = (result[oblastId][rayonIdx] ?? 0) + 1;
                }
            }
            // Шымкент dual-display: also count in Turkestan oblast
            if (regionKey === 'Shymkent (city)') {
                const turkestanOblastId = 'turkistanOblast';
                const rayonIdx = detectRayonFromAddress(detail.customerLegalAddress, turkestanOblastId);
                if (rayonIdx !== null) {
                    if (!result[turkestanOblastId]) result[turkestanOblastId] = {};
                    result[turkestanOblastId][rayonIdx] = (result[turkestanOblastId][rayonIdx] ?? 0) + 1;
                }
            }
        });
        return result;
    }, [binDetails]);

    /* ---- Derived: BIN → regionKey lookup ---- */
    const binToRegion = useMemo(() => {
        const map: Record<string, string> = {};
        binDetails.forEach((d) => {
            const rk = detectRegionFromAddress(d.customerLegalAddress);
            if (rk) map[d.bin] = rk;
        });
        return map;
    }, [binDetails]);

    /* ---- Derived: region stats (per oblast) ---- */
    const regionStats = useMemo(() => {
        const stats: Record<string, RegionStats> = {};
        const ensure = (key: string) => {
            if (!stats[key]) {
                stats[key] = {
                    totalDialogs: 0,
                    openDialogs: 0,
                    closedDialogs: 0,
                    unreadCount: 0,
                    aiClosedDialogs: 0,
                    responseSpeedFast: 0,
                    responseSpeedMedium: 0,
                    responseSpeedSlow: 0,
                    csatSum: 0,
                    csatCount: 0,
                    aiCsatSum: 0,
                    aiCsatCount: 0,
                    csatDistribution: [0, 0, 0, 0, 0],
                    aiCsatDistribution: [0, 0, 0, 0, 0],
                };
            }
        };
        chats.forEach((chat) => {
            if (!chat.bin) return;
            const rk = binToRegion[chat.bin];
            if (!rk) return;
            ensure(rk);
            stats[rk].totalDialogs++;
            if (chat.dialogClosedAt) stats[rk].closedDialogs++;
            else stats[rk].openDialogs++;
            stats[rk].unreadCount += chat.unreadCount;
        });

        if (dashboardSummary?.dialogMetrics) {
            dashboardSummary.dialogMetrics.forEach((metric) => {
                if (!metric.bin) return;
                const rk = binToRegion[metric.bin];
                if (!rk) return;
                ensure(rk);

                if (metric.isAiClosed) {
                    stats[rk].aiClosedDialogs++;
                }

                if (metric.responseTimeMinutes !== null) {
                    if (metric.responseTimeMinutes <= 5) stats[rk].responseSpeedFast++;
                    else if (metric.responseTimeMinutes <= 15) stats[rk].responseSpeedMedium++;
                    else stats[rk].responseSpeedSlow++;
                }

                if (metric.csatRating !== null) {
                    stats[rk].csatSum += metric.csatRating;
                    stats[rk].csatCount++;
                    if (metric.csatRating >= 1 && metric.csatRating <= 5) {
                        stats[rk].csatDistribution[metric.csatRating - 1]++;
                    }
                }
                if (metric.aiCsatRating !== null) {
                    stats[rk].aiCsatSum += metric.aiCsatRating;
                    stats[rk].aiCsatCount++;
                    if (metric.aiCsatRating >= 1 && metric.aiCsatRating <= 5) {
                        stats[rk].aiCsatDistribution[metric.aiCsatRating - 1]++;
                    }
                }
            });
        }

        return stats;
    }, [chats, binToRegion, dashboardSummary]);

    /* ---- Derived: rayon stats (oblastId → rayonIdx → stats) ---- */
    const rayonStats = useMemo(() => {
        const result: Record<string, Record<number, RegionStats>> = {};
        const regionKeyToSvgId: Record<string, string> = {};
        for (const svgId of Object.keys(SVG_ID_TO_REGION_KEY)) {
            regionKeyToSvgId[SVG_ID_TO_REGION_KEY[svgId]] = svgId;
        }
        // BIN → (oblastId, rayonIdx) lookup
        const binToRayon: Record<string, { oblastId: string; rayonIdx: number }[]> = {};
        binDetails.forEach((d) => {
            const rk = detectRegionFromAddress(d.customerLegalAddress);
            if (!rk) return;
            const oblastId = regionKeyToSvgId[rk];
            if (oblastId && OBLAST_RAYONS[oblastId]) {
                const idx = detectRayonFromAddress(d.customerLegalAddress, oblastId);
                if (idx !== null) {
                    if (!binToRayon[d.bin]) binToRayon[d.bin] = [];
                    binToRayon[d.bin].push({ oblastId, rayonIdx: idx });
                }
            }
            // Шымкент dual-display
            if (rk === 'Shymkent (city)') {
                const turkId = 'turkistanOblast';
                const idx = detectRayonFromAddress(d.customerLegalAddress, turkId);
                if (idx !== null) {
                    if (!binToRayon[d.bin]) binToRayon[d.bin] = [];
                    binToRayon[d.bin].push({ oblastId: turkId, rayonIdx: idx });
                }
            }
        });

        const ensureRayon = (oblastId: string, rayonIdx: number) => {
            if (!result[oblastId]) result[oblastId] = {};
            if (!result[oblastId][rayonIdx]) {
                result[oblastId][rayonIdx] = {
                    totalDialogs: 0,
                    openDialogs: 0,
                    closedDialogs: 0,
                    unreadCount: 0,
                    aiClosedDialogs: 0,
                    responseSpeedFast: 0,
                    responseSpeedMedium: 0,
                    responseSpeedSlow: 0,
                    csatSum: 0,
                    csatCount: 0,
                    aiCsatSum: 0,
                    aiCsatCount: 0,
                    csatDistribution: [0, 0, 0, 0, 0],
                    aiCsatDistribution: [0, 0, 0, 0, 0],
                };
            }
            return result[oblastId][rayonIdx];
        };

        chats.forEach((chat) => {
            if (!chat.bin) return;
            const entries = binToRayon[chat.bin];
            if (!entries) return;
            for (const { oblastId, rayonIdx } of entries) {
                const s = ensureRayon(oblastId, rayonIdx);
                s.totalDialogs++;
                if (chat.dialogClosedAt) s.closedDialogs++;
                else s.openDialogs++;
                s.unreadCount += chat.unreadCount;
            }
        });

        if (dashboardSummary?.dialogMetrics) {
            dashboardSummary.dialogMetrics.forEach((metric) => {
                if (!metric.bin) return;
                const entries = binToRayon[metric.bin];
                if (!entries) return;

                for (const { oblastId, rayonIdx } of entries) {
                    const s = ensureRayon(oblastId, rayonIdx);

                    if (metric.isAiClosed) {
                        s.aiClosedDialogs++;
                    }

                    if (metric.responseTimeMinutes !== null) {
                        if (metric.responseTimeMinutes <= 5) s.responseSpeedFast++;
                        else if (metric.responseTimeMinutes <= 15) s.responseSpeedMedium++;
                        else s.responseSpeedSlow++;
                    }

                    if (metric.csatRating !== null) {
                        s.csatSum += metric.csatRating;
                        s.csatCount++;
                        if (metric.csatRating >= 1 && metric.csatRating <= 5) {
                            s.csatDistribution[metric.csatRating - 1]++;
                        }
                    }
                    if (metric.aiCsatRating !== null) {
                        s.aiCsatSum += metric.aiCsatRating;
                        s.aiCsatCount++;
                        if (metric.aiCsatRating >= 1 && metric.aiCsatRating <= 5) {
                            s.aiCsatDistribution[metric.aiCsatRating - 1]++;
                        }
                    }
                }
            });
        }

        return result;
    }, [chats, binDetails, dashboardSummary]);

    /* ---- Derived: filtered & sorted chats ---- */
    const filteredChats = useMemo(() => {
        let list = chats;
        if (selectedSection) {
            list = list.filter((chat) => chat.section === selectedSection);
        }
        if (selectedBin) {
            list = list.filter((chat) => chat.bin === selectedBin);
        }
        if (showFavoritesOnly) {
            list = list.filter((chat) => Boolean(chat.isFavorite));
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
        chats,
        selectedBin,
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
        rayonCounts,
        regionStats,
        rayonStats,
        maxRegionCount,
        dashboardSummary,
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
