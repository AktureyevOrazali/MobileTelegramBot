import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import { DashboardSummary, UserProfile } from '../types';
import { extractErrorMessage } from '../utils/errors';
import {
    classifyResponseSpeed,
    COMMAND_TAG_REGEX,
    EMPTY_SUMMARY,
    formatMinutes,
    normalizeQuestionText,
    parseInputDate,
    QuestionSection,
    QuestionSectionEntry,
    shiftDate,
    toInputDate,
} from '../utils/dashboard-helpers';

// ── Local types ──

export type LoadMode = 'initial' | 'refresh';
export type TimePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'custom';
export type DashboardTab = 'overview' | 'operators' | 'sections' | 'activity' | 'commercial';
export type OperatorMetricKey = 'avgResponse' | 'messages' | 'dialogs';

/**
 * Encapsulates all data state, API fetching, filters, and derived metrics
 * for the Dashboard page.
 */
export function useDashboardData(apiClient: ApiClient) {
    // ── Core state ──
    const [summary, setSummary] = useState<DashboardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');

    const [selectedQuestionSection, setSelectedQuestionSection] = useState<string>('all');
    const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);
    const activeOperatorId = dashboardTab === 'operators' ? null : selectedOperatorId;

    const [timePreset, setTimePreset] = useState<TimePreset>('last7');
    const [customRange, setCustomRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const effectiveTimePreset: TimePreset = timePreset;

    const [topMetric, setTopMetric] = useState<OperatorMetricKey>('avgResponse');

    const [operators, setOperators] = useState<UserProfile[]>([]);
    const [operatorsLoading, setOperatorsLoading] = useState(false);
    const [operatorsError, setOperatorsError] = useState<string | null>(null);

    const initialLoad = useRef(true);

    // ──────────────────── Time range ────────────────────

    const timeRange = useMemo(() => {
        const today = new Date();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        let start = end;

        if (effectiveTimePreset === 'today') {
            start = end;
        } else if (effectiveTimePreset === 'yesterday') {
            start = shiftDate(end, -1);
            return { startDate: toInputDate(start), endDate: toInputDate(start), label: 'Вчера' };
        } else if (effectiveTimePreset === 'last7') {
            start = shiftDate(end, -6);
        } else if (effectiveTimePreset === 'last30') {
            start = shiftDate(end, -29);
        } else if (effectiveTimePreset === 'last90') {
            start = shiftDate(end, -89);
        } else if (effectiveTimePreset === 'custom') {
            return {
                startDate: customRange.start || null,
                endDate: customRange.end || null,
                label: customRange.start && customRange.end ? `${customRange.start} — ${customRange.end}` : 'Свои даты',
            };
        }

        return {
            startDate: toInputDate(start),
            endDate: toInputDate(end),
            label:
                effectiveTimePreset === 'today'
                    ? 'Сегодня'
                    : effectiveTimePreset === 'last7'
                        ? '7 дней'
                        : effectiveTimePreset === 'last30'
                            ? '30 дней'
                            : '3 месяца',
        };
    }, [customRange.end, customRange.start, effectiveTimePreset]);

    const activeFilters = useMemo(
        () => ({
            operatorId: activeOperatorId,
            startDate: timeRange.startDate,
            endDate: timeRange.endDate,
        }),
        [activeOperatorId, timeRange.endDate, timeRange.startDate],
    );

    // ──────────────────── Data loading ────────────────────

    const loadData = useCallback(
        async (
            mode: LoadMode = 'initial',
            filters: { operatorId?: number | null; startDate?: string | null; endDate?: string | null },
        ) => {
            if (mode === 'initial') setLoading(true);
            else setRefreshing(true);
            try {
                const data = await apiClient.fetchDashboardSummary({
                    operatorId: filters.operatorId ?? undefined,
                    startDate: filters.startDate ?? undefined,
                    endDate: filters.endDate ?? undefined,
                });
                setSummary(data);
                setError(null);
            } catch (err) {
                setError(extractErrorMessage(err, 'Не удалось получить данные отчёта.'));
            } finally {
                if (mode === 'initial') setLoading(false);
                else setRefreshing(false);
            }
        },
        [apiClient],
    );

    useEffect(() => {
        const mode: LoadMode = initialLoad.current ? 'initial' : 'refresh';
        if (initialLoad.current) initialLoad.current = false;
        loadData(mode, activeFilters);
    }, [activeFilters, loadData]);

    // ── Operators list ──

    useEffect(() => {
        let cancelled = false;
        setOperatorsLoading(true);
        setOperatorsError(null);

        (async () => {
            try {
                const users = await apiClient.fetchUsers();
                if (cancelled) return;
                const filtered = users
                    .filter((user) => ['moderator', 'operator'].includes(user.role) && !user.isAdmin && user.isApproved)
                    .filter((user) => {
                        const normalized = `${user.name ?? ''} ${user.login ?? ''}`.toLowerCase();
                        return normalized ? !normalized.includes('bot') && !normalized.includes('бот') : true;
                    })
                    .sort((a, b) => {
                        const nameA = a.name || a.login || '';
                        const nameB = b.name || b.login || '';
                        return nameA.localeCompare(nameB, 'ru', { sensitivity: 'base' });
                    });
                setOperators(filtered);
            } catch (err) {
                if (cancelled) return;
                setOperatorsError(extractErrorMessage(err, 'Не удалось загрузить список сотрудников.'));
            } finally {
                if (!cancelled) setOperatorsLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [apiClient]);

    // Reset selected operator if no longer in the list
    useEffect(() => {
        if (selectedOperatorId === null) return;
        const exists = operators.some((operator) => operator.id === selectedOperatorId);
        if (!exists) setSelectedOperatorId(null);
    }, [operators, selectedOperatorId]);

    // ──────────────────── Derived data ────────────────────

    const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), []);
    const hasData = Boolean(summary);
    const data = summary ?? EMPTY_SUMMARY;

    const operatorOptions = useMemo(
        () => [
            { value: 'all', label: 'Все сотрудники' },
            ...operators.map((op) => ({
                value: String(op.id),
                label: op.name || op.login,
                meta: op.role === 'moderator' ? 'Модератор' : 'Оператор',
            })),
        ],
        [operators],
    );

    const operatorSelectValue = activeOperatorId === null ? 'all' : String(activeOperatorId);

    const selectedOperatorLabel = useMemo(() => {
        if (activeOperatorId === null) return 'Все сотрудники';
        const found = operators.find((op) => op.id === activeOperatorId);
        return found?.name || found?.login || `ID ${activeOperatorId}`;
    }, [activeOperatorId, operators]);

    const normalizeName = useCallback((value?: string | null) => value?.trim().toLowerCase() ?? '', []);

    const operatorNameSet = useMemo(() => {
        const names = new Set<string>();
        operators.forEach((op) => {
            const push = (v?: string | null) => { const n = normalizeName(v); if (n) names.add(n); };
            push(op.name);
            push(op.login);
        });
        return names;
    }, [normalizeName, operators]);

    const selectedOperatorNames = useMemo(() => {
        if (activeOperatorId === null) return null;
        const selected = operators.find((op) => op.id === activeOperatorId);
        if (!selected) return null;
        const names = new Set<string>();
        const push = (v?: string | null) => { const n = normalizeName(v); if (n) names.add(n); };
        push(selected.name);
        push(selected.login);
        return names;
    }, [activeOperatorId, normalizeName, operators]);

    // ── Agent stats ──

    const agentStats = useMemo(() => {
        const systemKeywords = ['admin', 'administrator', 'администратор', 'ai assistant'];
        const hasOperatorNames = operatorNameSet.size > 0;
        return data.agentBreakdown
            .filter((agent) => {
                const normalized = agent.name.trim().toLowerCase();
                if (!normalized) return false;
                if (systemKeywords.some((keyword) => normalized.includes(keyword))) return false;
                if (/\b(bot|бот)\b/.test(normalized)) return false;
                if (hasOperatorNames && !operatorNameSet.has(normalized)) return false;
                return true;
            })
            .map((agent) => ({
                ...agent,
                avgMessagesPerDialog: Number.isFinite(agent.avgMessagesPerDialog) ? agent.avgMessagesPerDialog : 0,
            }))
            .sort((a, b) => b.messages - a.messages);
    }, [data.agentBreakdown, operatorNameSet]);

    // ── Time range days ──

    const timeRangeDays = useMemo(() => {
        const startDate = parseInputDate(timeRange.startDate ?? '');
        const endDate = parseInputDate(timeRange.endDate ?? '');
        if (!startDate || !endDate) return data.recentActivity.length || 0;
        const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        return diff >= 0 ? diff + 1 : 0;
    }, [data.recentActivity.length, timeRange.endDate, timeRange.startDate]);

    const operatorCount = useMemo(() => {
        if (agentStats.length > 0) return agentStats.length;
        return operators.length;
    }, [agentStats.length, operators.length]);

    // ── Response speed ──

    const responseDialogs = useMemo(() => {
        const dialogs = data.responseTimeDialogs ?? [];
        if (activeOperatorId === null) return dialogs;
        if (!selectedOperatorNames || selectedOperatorNames.size === 0) return [];
        return dialogs.filter((dialog) => selectedOperatorNames.has(normalizeName(dialog.author)));
    }, [activeOperatorId, data.responseTimeDialogs, normalizeName, selectedOperatorNames]);

    const avgResponseTimeMinutes = useMemo(() => {
        if (activeOperatorId === null) {
            const allDialogs = data.responseTimeDialogs ?? [];
            if (!allDialogs.length) return null;
            const total = allDialogs.reduce((sum, d) => sum + d.responseTimeMinutes, 0);
            return total / allDialogs.length;
        }
        if (!responseDialogs.length) return null;
        const total = responseDialogs.reduce((sum, d) => sum + d.responseTimeMinutes, 0);
        return total / responseDialogs.length;
    }, [activeOperatorId, data.responseTimeDialogs, responseDialogs]);

    const responseSegments = useMemo(() => {
        const buckets = {
            fast: { count: 0, totalMinutes: 0 },
            medium: { count: 0, totalMinutes: 0 },
            slow: { count: 0, totalMinutes: 0 },
        };

        if (activeOperatorId === null) {
            const operatorAverages = new Map<string, number[]>();
            const allDialogs = data.responseTimeDialogs ?? [];
            allDialogs.forEach((d) => {
                const name = normalizeName(d.author);
                if (!operatorAverages.has(name)) operatorAverages.set(name, []);
                operatorAverages.get(name)!.push(d.responseTimeMinutes);
            });
            operatorAverages.forEach((times) => {
                const avgTime = times.reduce((s, t) => s + t, 0) / times.length;
                const bucket = classifyResponseSpeed(avgTime);
                if (!bucket) return;
                buckets[bucket].count += 1;
                buckets[bucket].totalMinutes += avgTime;
            });
        } else {
            responseDialogs.forEach((d) => {
                const bucket = classifyResponseSpeed(d.responseTimeMinutes);
                if (!bucket) return;
                buckets[bucket].count += 1;
                buckets[bucket].totalMinutes += d.responseTimeMinutes;
            });
        }

        const totalCount = buckets.fast.count + buckets.medium.count + buckets.slow.count;
        return (['fast', 'medium', 'slow'] as const).map((key) => {
            const count = buckets[key].count;
            const avgMinutes = count ? buckets[key].totalMinutes / count : null;
            const percentage = totalCount ? (count / totalCount) * 100 : 0;
            return { key, count, avgMinutes, percentage };
        });
    }, [activeOperatorId, data.responseTimeDialogs, responseDialogs, normalizeName]);

    // ── Operator meta ──

    const operatorMetaByName = useMemo(() => {
        const map = new Map<string, { roleLabel: string }>();
        operators.forEach((op) => {
            const name = op.name || op.login;
            if (!name) return;
            const key = name.trim().toLowerCase();
            if (!key) return;
            map.set(key, { roleLabel: op.role === 'moderator' ? 'Модератор' : 'Оператор' });
        });
        return map;
    }, [operators]);

    const operatorMetricConfigs = useMemo(
        () => ({
            avgResponse: {
                label: 'Среднее время ответа',
                getValue: (agent: DashboardSummary['agentBreakdown'][number]) => agent.avgResponseTimeMinutes,
                format: (value: number | null) => formatMinutes(value),
                sortDirection: 'asc' as const,
            },
            messages: {
                label: 'Всего сообщений',
                getValue: (agent: DashboardSummary['agentBreakdown'][number]) => agent.messages,
                format: (value: number | null) => numberFormatter.format(value ?? 0),
                sortDirection: 'desc' as const,
            },
            dialogs: {
                label: 'Всего диалогов',
                getValue: (agent: DashboardSummary['agentBreakdown'][number]) => agent.dialogs,
                format: (value: number | null) => numberFormatter.format(value ?? 0),
                sortDirection: 'desc' as const,
            },
        }),
        [numberFormatter],
    );

    const metricOptions = useMemo(
        () =>
            (Object.keys(operatorMetricConfigs) as OperatorMetricKey[]).map((key) => ({
                value: key,
                label: operatorMetricConfigs[key].label,
            })),
        [operatorMetricConfigs],
    );

    const activeMetricConfig = operatorMetricConfigs[topMetric];

    const topOperators = useMemo(() => {
        return [...agentStats]
            .map((agent) => ({ ...agent, metricValue: activeMetricConfig.getValue(agent) }))
            .sort((a, b) => {
                const aV = a.metricValue;
                const bV = b.metricValue;
                if (aV === null && bV === null) return 0;
                if (aV === null) return 1;
                if (bV === null) return -1;
                if (activeMetricConfig.sortDirection === 'asc') return aV - bV;
                return bV - aV;
            })
            .slice(0, 10);
    }, [activeMetricConfig, agentStats]);

    // ── Questions ──

    const normalizedSectionTitles = useMemo(() => {
        const titles = new Set<string>();
        const addTitle = (title: string) => { const n = title.trim().toLowerCase(); if (n) titles.add(n); };
        data.sectionBreakdown.forEach((item) => addTitle(item.title));
        data.questionsBySection.forEach((section) => addTitle(section.title));
        return titles;
    }, [data.questionsBySection, data.sectionBreakdown]);

    const topQuestions = useMemo(() => {
        const seen = new Set<string>();
        return data.topQuestions.filter((item) => {
            const normalized = normalizeQuestionText(item.question);
            if (!normalized) return false;
            if (normalizedSectionTitles.has(normalized)) return false;
            if (COMMAND_TAG_REGEX.test(item.question.trim())) return false;
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        }).slice(0, 5);
    }, [data.topQuestions, normalizedSectionTitles]);

    const questionsBySection = useMemo(
        () =>
            data.questionsBySection
                .map((section) => {
                    const normalizedTitle = section.title.trim().toLowerCase();
                    const seenQuestions = new Set<string>();
                    const filteredQuestions = section.questions.filter((q) => {
                        const nq = normalizeQuestionText(q.question);
                        if (!nq) return false;
                        if (normalizedSectionTitles.has(nq)) return false;
                        if (normalizedTitle && nq === normalizedTitle) return false;
                        if (COMMAND_TAG_REGEX.test(q.question.trim())) return false;
                        if (seenQuestions.has(nq)) return false;
                        seenQuestions.add(nq);
                        return true;
                    });
                    return { ...section, questions: filteredQuestions, totalCount: filteredQuestions.reduce((acc, q) => acc + q.count, 0) };
                })
                .filter((section) => section.questions.length > 0)
                .sort((a, b) => b.totalCount - a.totalCount),
        [data.questionsBySection, normalizedSectionTitles],
    ) as QuestionSection[];

    const questionSectionEntries = useMemo(() => {
        const seen = new Set<string>();
        const entries: QuestionSectionEntry[] = [];
        questionsBySection.forEach((section) => {
            const key = section.section ?? (section.title || 'no-section');
            if (seen.has(key)) return;
            seen.add(key);
            entries.push({ key, title: section.title || 'Без раздела', section });
        });
        return entries;
    }, [questionsBySection]) as QuestionSectionEntry[];

    const questionSectionOptions = useMemo(
        () => [
            { value: 'all', label: 'Все разделы' },
            ...questionSectionEntries.map((entry) => ({ value: entry.key, label: entry.title })),
        ],
        [questionSectionEntries],
    );

    useEffect(() => {
        if (selectedQuestionSection === 'all') return;
        const exists = questionSectionEntries.some((e) => e.key === selectedQuestionSection);
        if (!exists) setSelectedQuestionSection('all');
    }, [questionSectionEntries, selectedQuestionSection]);

    const selectedQuestions = useMemo(() => {
        if (selectedQuestionSection === 'all') return topQuestions;
        const entry = questionSectionEntries.find((e) => e.key === selectedQuestionSection);
        if (!entry) return [];
        return entry.section.questions.slice(0, 5);
    }, [questionSectionEntries, selectedQuestionSection, topQuestions]);

    // ── Donut chart data ──

    const donutMulti = useMemo(() => {
        const radius = 46;
        const circumference = 2 * Math.PI * radius;
        const ordered = (['fast', 'medium', 'slow'] as const).map((k) => {
            return responseSegments.find((s) => s.key === k) ?? { key: k, count: 0, avgMinutes: null, percentage: 0 };
        });
        let acc = 0;
        const arcs = ordered.map((seg) => {
            const dash = (seg.percentage / 100) * circumference;
            const dashArray = `${dash} ${circumference - dash}`;
            const dashOffset = -acc;
            acc += dash;
            return { ...seg, dashArray, dashOffset };
        });
        return { radius, circumference, arcs };
    }, [responseSegments]);

    const aiDonut = useMemo(() => {
        const radius = 46;
        const circumference = 2 * Math.PI * radius;
        const total = data.aiClosedDialogs + data.transferredToOperatorDialogs;
        if (total === 0) return { radius, circumference, arcs: [] };

        const ordered = [
            { key: 'ai', count: data.aiClosedDialogs, percentage: (data.aiClosedDialogs / total) * 100 },
            { key: 'transferred', count: data.transferredToOperatorDialogs, percentage: (data.transferredToOperatorDialogs / total) * 100 }
        ];

        let acc = 0;
        const arcs = ordered.map((seg) => {
            const dash = (seg.percentage / 100) * circumference;
            const dashArray = `${dash} ${circumference - dash}`;
            const dashOffset = -acc;
            acc += dash;
            return { ...seg, dashArray, dashOffset };
        });
        return { radius, circumference, arcs };
    }, [data.aiClosedDialogs, data.transferredToOperatorDialogs]);

    const contractDonut = useMemo(() => {
        const radius = 46;
        const circumference = 2 * Math.PI * radius;
        const total = data.requestsWithContract + data.requestsWithoutContract;
        if (total === 0) return { radius, circumference, arcs: [] };

        const ordered = [
            { key: 'with_contract', count: data.requestsWithContract, percentage: (data.requestsWithContract / total) * 100 },
            { key: 'without_contract', count: data.requestsWithoutContract, percentage: (data.requestsWithoutContract / total) * 100 }
        ];

        let acc = 0;
        const arcs = ordered.map((seg) => {
            const dash = (seg.percentage / 100) * circumference;
            const dashArray = `${dash} ${circumference - dash}`;
            const dashOffset = -acc;
            acc += dash;
            return { ...seg, dashArray, dashOffset };
        });
        return { radius, circumference, arcs };
    }, [data.requestsWithContract, data.requestsWithoutContract]);

    // ── Misc derived ──

    const avgResponseTimeLabel = useMemo(() => formatMinutes(avgResponseTimeMinutes), [avgResponseTimeMinutes]);

    const messagesPerDay = useMemo(() => {
        if (!timeRangeDays) return 0;
        return Math.round(data.totalOutgoingMessages / timeRangeDays);
    }, [data.totalOutgoingMessages, timeRangeDays]);

    const recentWeek = useMemo(() => {
        if (!data.recentActivity || data.recentActivity.length === 0) return [];
        return [...data.recentActivity].sort((a, b) => b.date.localeCompare(a.date));
    }, [data.recentActivity]);

    const totalOperators = agentStats.length;
    const isLoading = loading || refreshing;

    const periodOptions = useMemo(
        () => [
            { value: 'today', label: 'Сегодня' },
            { value: 'yesterday', label: 'Вчера' },
            { value: 'last7', label: '7 дней' },
            { value: 'last30', label: '30 дней' },
            { value: 'last90', label: '3 месяца' },
            { value: 'custom', label: 'Свои даты' },
        ],
        [],
    );

    return {
        // Core data
        data,
        hasData,
        loading,
        refreshing,
        isLoading,
        error,

        // Tabs
        dashboardTab,
        setDashboardTab,

        // Time
        timePreset,
        setTimePreset,
        effectiveTimePreset,
        customRange,
        setCustomRange,
        timeRange,
        activeFilters,
        periodOptions,

        // Operators
        operators,
        operatorsLoading,
        operatorsError,
        selectedOperatorId,
        setSelectedOperatorId,
        activeOperatorId,
        operatorOptions,
        operatorSelectValue,
        selectedOperatorLabel,
        operatorMetaByName,
        operatorCount,

        // Metrics
        topMetric,
        setTopMetric,
        metricOptions,
        activeMetricConfig,
        topOperators,
        agentStats,
        totalOperators,

        // Response speed
        responseSegments,
        avgResponseTimeLabel,
        donutMulti,
        aiDonut,
        contractDonut,

        // Questions
        selectedQuestionSection,
        setSelectedQuestionSection,
        questionSectionOptions,
        selectedQuestions,

        // Activity
        recentWeek,

        // Misc
        numberFormatter,
        messagesPerDay,

        // Actions
        loadData,
    };
}
