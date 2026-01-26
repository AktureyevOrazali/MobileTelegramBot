import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { DashboardSummary, UserProfile } from '../types';
import { formatDate, formatDateTime } from '../utils/date';
import SelectPill from '../components/SelectPill';

interface DashboardPageProps {
  apiClient: ApiClient;
}

type LoadMode = 'initial' | 'refresh';
type TimePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'custom';
type DashboardTab = 'overview' | 'operators' | 'sections' | 'activity';
type OperatorMetricKey = 'avgResponse' | 'messages' | 'dialogs';

type QuestionSection = DashboardSummary['questionsBySection'][number] & { totalCount: number };
type QuestionSectionEntry = { key: string; title: string; section: QuestionSection };

const FAQ_PREFIX_REGEX = /^\[(faq)\]\s*/i;
const COMMAND_TAG_REGEX = /^\[[^\]]*команда[^\]]*\]/i;
const RESPONSE_SPEED_THRESHOLDS = {
  fast: 2,
  medium: 7,
};

const EMPTY_SUMMARY: DashboardSummary = {
  totalDialogs: 0,
  openDialogs: 0,
  closedDialogs: 0,
  totalChats: 0,
  totalMessages: 0,
  totalIncomingMessages: 0,
  totalOutgoingMessages: 0,
  averageMessagesPerDialog: 0,
  avgDialogDurationMinutes: null,
  avgResponseTimeMinutes: null,
  sectionBreakdown: [],
  topQuestions: [],
  questionsBySection: [],
  agentBreakdown: [],
  recentActivity: [],
  updatedAt: new Date(0),
};

const DashboardPage: React.FC<DashboardPageProps> = ({ apiClient }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dashboardTab, setDashboardTab] = useState<DashboardTab>('overview');

  const [selectedQuestionSection, setSelectedQuestionSection] = useState<string>('all');
  const [selectedOperatorId, setSelectedOperatorId] = useState<number | null>(null);

  const [timePreset, setTimePreset] = useState<TimePreset>('last7');
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  const [topMetric, setTopMetric] = useState<OperatorMetricKey>('avgResponse');

  const [operators, setOperators] = useState<UserProfile[]>([]);
  const [operatorsLoading, setOperatorsLoading] = useState(false);
  const [operatorsError, setOperatorsError] = useState<string | null>(null);

  const initialLoad = useRef(true);

  const toInputDate = useCallback((date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }, []);

  const parseInputDate = useCallback((value: string) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }, []);

  const shiftDate = useCallback((date: Date, days: number) => {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }, []);

  const timeRange = useMemo(() => {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let start = end;

    if (timePreset === 'today') {
      start = end;
    } else if (timePreset === 'yesterday') {
      start = shiftDate(end, -1);
      return {
        startDate: toInputDate(start),
        endDate: toInputDate(start),
        label: 'Вчера',
      };
    } else if (timePreset === 'last7') {
      start = shiftDate(end, -6);
    } else if (timePreset === 'last30') {
      start = shiftDate(end, -29);
    } else if (timePreset === 'last90') {
      start = shiftDate(end, -89);
    } else if (timePreset === 'custom') {
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
        timePreset === 'today'
          ? 'Сегодня'
          : timePreset === 'last7'
          ? '7 дней'
          : timePreset === 'last30'
          ? '30 дней'
          : '3 месяца',
    };
  }, [customRange.end, customRange.start, shiftDate, timePreset, toInputDate]);

  const activeFilters = useMemo(
    () => ({
      operatorId: selectedOperatorId,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate,
    }),
    [selectedOperatorId, timeRange.endDate, timeRange.startDate],
  );

  const loadData = useCallback(
    async (
      mode: LoadMode = 'initial',
      filters: {
        operatorId?: number | null;
        startDate?: string | null;
        endDate?: string | null;
      },
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
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Не удалось получить данные отчёта.';
        setError(message);
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

  useEffect(() => {
    let cancelled = false;
    setOperatorsLoading(true);
    setOperatorsError(null);

    (async () => {
      try {
        const users = await apiClient.fetchUsers();
        if (cancelled) return;

        const filtered = users
          .filter((user) => ['moderator', 'operator'].includes(user.role) && !user.isAdmin)
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
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Не удалось загрузить список сотрудников.';
        setOperatorsError(message);
      } finally {
        if (!cancelled) setOperatorsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  useEffect(() => {
    if (selectedOperatorId === null) return;
    const exists = operators.some((operator) => operator.id === selectedOperatorId);
    if (!exists) setSelectedOperatorId(null);
  }, [operators, selectedOperatorId]);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), []);
  const hasData = Boolean(summary);
  const data = summary ?? EMPTY_SUMMARY;

  const operatorOptions = useMemo(
    () => [
      { value: 'all', label: 'Все сотрудники' },
      ...operators.map((operator) => ({
        value: String(operator.id),
        label: operator.name || operator.login,
        meta: operator.role === 'moderator' ? 'Модератор' : 'Оператор',
      })),
    ],
    [operators],
  );

  const operatorSelectValue = selectedOperatorId === null ? 'all' : String(selectedOperatorId);

  const selectedOperatorLabel = useMemo(() => {
    if (selectedOperatorId === null) return 'Все сотрудники';
    const found = operators.find((operator) => operator.id === selectedOperatorId);
    return found?.name || found?.login || `ID ${selectedOperatorId}`;
  }, [operators, selectedOperatorId]);

  const operatorNameSet = useMemo(() => {
    const names = new Set<string>();
    operators.forEach((operator) => {
      const push = (value?: string | null) => {
        const normalized = value?.trim().toLowerCase();
        if (normalized) names.add(normalized);
      };
      push(operator.name);
      push(operator.login);
    });
    return names;
  }, [operators]);

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

  const timeRangeDays = useMemo(() => {
    const startDate = parseInputDate(timeRange.startDate ?? '');
    const endDate = parseInputDate(timeRange.endDate ?? '');
    if (!startDate || !endDate) {
      return data.recentActivity.length || 0;
    }
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  }, [data.recentActivity.length, parseInputDate, timeRange.endDate, timeRange.startDate]);

  const operatorCount = useMemo(() => {
    if (agentStats.length > 0) return agentStats.length;
    return operators.length;
  }, [agentStats.length, operators.length]);

  const formatMinutes = useCallback((value: number | null) => {
    if (value === null || !Number.isFinite(value)) return '—';
    const totalSeconds = Math.round(value * 60);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}м${seconds > 0 ? ` ${seconds}с` : ''}`;
    return `${seconds}с`;
  }, []);

  const classifyResponseSpeed = useCallback((minutes: number | null) => {
    if (minutes === null) return null;
    if (minutes < RESPONSE_SPEED_THRESHOLDS.fast) return 'fast';
    if (minutes <= RESPONSE_SPEED_THRESHOLDS.medium) return 'medium';
    return 'slow';
  }, []);

  const responseSegments = useMemo(() => {
    const buckets = {
      fast: { count: 0, totalMinutes: 0 },
      medium: { count: 0, totalMinutes: 0 },
      slow: { count: 0, totalMinutes: 0 },
    };

    agentStats.forEach((agent) => {
      const effectiveMinutes = agent.avgResponseTimeMinutes ?? data.avgResponseTimeMinutes;
      const bucket = classifyResponseSpeed(effectiveMinutes);
      if (!bucket) return;
      buckets[bucket].count += 1;
      buckets[bucket].totalMinutes += effectiveMinutes ?? 0;
    });

    const totalOperators = agentStats.length;

    return (['fast', 'medium', 'slow'] as const).map((key) => {
      const count = buckets[key].count;
      const avgMinutes = count ? buckets[key].totalMinutes / count : null;
      const percentage = totalOperators ? (count / totalOperators) * 100 : 0;
      return { key, count, avgMinutes, percentage };
    });
  }, [agentStats, classifyResponseSpeed, data.avgResponseTimeMinutes]);

  const operatorMetaByName = useMemo(() => {
    const map = new Map<string, { roleLabel: string }>();
    operators.forEach((operator) => {
      const name = operator.name || operator.login;
      if (!name) return;
      const key = name.trim().toLowerCase();
      if (!key) return;
      map.set(key, { roleLabel: operator.role === 'moderator' ? 'Модератор' : 'Оператор' });
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
    [formatMinutes, numberFormatter],
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
        const aValue = a.metricValue;
        const bValue = b.metricValue;
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;
        if (activeMetricConfig.sortDirection === 'asc') return aValue - bValue;
        return bValue - aValue;
      })
      .slice(0, 10);
  }, [activeMetricConfig, agentStats]);

  const normalizeQuestionText = useCallback((raw: string) => {
    const trimmed = raw.trim();
    const withoutFaq = trimmed.replace(FAQ_PREFIX_REGEX, '');
    return withoutFaq.trim().toLowerCase();
  }, []);

  const normalizedSectionTitles = useMemo(() => {
    const titles = new Set<string>();
    const addTitle = (title: string) => {
      const normalized = title.trim().toLowerCase();
      if (normalized) titles.add(normalized);
    };
    data.sectionBreakdown.forEach((item) => addTitle(item.title));
    data.questionsBySection.forEach((section) => addTitle(section.title));
    return titles;
  }, [data.questionsBySection, data.sectionBreakdown]);

  const topQuestions = useMemo(() => {
    const seen = new Set<string>();
    const filtered = data.topQuestions.filter((item) => {
      const normalized = normalizeQuestionText(item.question);
      if (!normalized) return false;
      if (normalizedSectionTitles.has(normalized)) return false;
      if (COMMAND_TAG_REGEX.test(item.question.trim())) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    return filtered.slice(0, 5);
  }, [data.topQuestions, normalizeQuestionText, normalizedSectionTitles]);

  const questionsBySection = useMemo(
    () =>
      data.questionsBySection
        .map((section) => {
          const normalizedTitle = section.title.trim().toLowerCase();
          const seenQuestions = new Set<string>();
          const filteredQuestions = section.questions.filter((question) => {
            const normalizedQuestion = normalizeQuestionText(question.question);
            if (!normalizedQuestion) return false;
            if (normalizedSectionTitles.has(normalizedQuestion)) return false;
            if (normalizedTitle && normalizedQuestion === normalizedTitle) return false;
            if (COMMAND_TAG_REGEX.test(question.question.trim())) return false;
            if (seenQuestions.has(normalizedQuestion)) return false;
            seenQuestions.add(normalizedQuestion);
            return true;
          });

          return {
            ...section,
            questions: filteredQuestions,
            totalCount: filteredQuestions.reduce((acc, question) => acc + question.count, 0),
          };
        })
        .filter((section) => section.questions.length > 0)
        .sort((a, b) => b.totalCount - a.totalCount),
    [data.questionsBySection, normalizeQuestionText, normalizedSectionTitles],
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
    const exists = questionSectionEntries.some((entry) => entry.key === selectedQuestionSection);
    if (!exists) setSelectedQuestionSection('all');
  }, [questionSectionEntries, selectedQuestionSection]);

  const selectedQuestions = useMemo(() => {
    if (selectedQuestionSection === 'all') return topQuestions;
    const entry = questionSectionEntries.find((item) => item.key === selectedQuestionSection);
    if (!entry) return [];
    return entry.section.questions.slice(0, 5);
  }, [questionSectionEntries, selectedQuestionSection, topQuestions]);

  const parseQuestion = useCallback((raw: string) => {
    const trimmed = raw.trim();
    const match = trimmed.match(FAQ_PREFIX_REGEX);
    return { text: match ? trimmed.slice(match[0].length) : trimmed, badge: match ? match[1].toUpperCase() : null };
  }, []);

  const getInitials = useCallback((name: string) => {
    const tokens = name.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 'NA';
    return tokens
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase())
      .join('');
  }, []);

  const avgResponseTimeLabel = useMemo(() => {
    if (data.avgResponseTimeMinutes === null) return '—';
    const totalSeconds = Math.round(data.avgResponseTimeMinutes * 60);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}м${seconds > 0 ? ` ${seconds}с` : ''}`;
    return `${seconds}с`;
  }, [data.avgResponseTimeMinutes]);

  const lastUpdated = hasData ? formatDateTime(data.updatedAt) : '';
  const isLoading = loading || refreshing;

  const statCards = useMemo(() => {
    const avgMessagesValue = data.averageMessagesPerDialog ? data.averageMessagesPerDialog.toFixed(1) : '0.0';
    return [
      { label: 'Диалоги', value: numberFormatter.format(data.totalDialogs) },
      { label: 'Активные', value: numberFormatter.format(data.openDialogs) },
      { label: 'Закрытые', value: numberFormatter.format(data.closedDialogs) },
      { label: 'Ответ', value: avgResponseTimeLabel },
      {
        label: 'Сообщений/день',
        value: numberFormatter.format(timeRangeDays ? Math.round(data.totalMessages / timeRangeDays) : 0),
      },
      {
        label: 'Сообщений/диалог',
        value: avgMessagesValue,
      },
    ];
  }, [
    avgResponseTimeLabel,
    data.averageMessagesPerDialog,
    data.closedDialogs,
    data.openDialogs,
    data.totalDialogs,
    data.totalMessages,
    numberFormatter,
    timeRangeDays,
  ]);

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

  const totalOperators = agentStats.length;

  const recentWeek = useMemo(() => {
    if (!data.recentActivity || data.recentActivity.length === 0) return [];
    return data.recentActivity.slice(-7);
  }, [data.recentActivity]);

  // ====== NEW: единый donut с 3 сегментами + легенда ======
  const donutMulti = useMemo(() => {
    const radius = 46;
    const circumference = 2 * Math.PI * radius;

    const ordered = (['fast', 'medium', 'slow'] as const).map((k) => {
      const seg = responseSegments.find((s) => s.key === k) ?? { key: k, count: 0, avgMinutes: null, percentage: 0 };
      return seg;
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

  const speedLabel = useCallback((key: 'fast' | 'medium' | 'slow') => {
    if (key === 'fast') return 'Быстрые';
    if (key === 'medium') return 'Средние';
    return 'Медленные';
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 48 }}>
      <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="dashboard-header" style={{ gap: 12 }}>
          <div>
            <h2 className="heading" style={{ marginBottom: 6 }}>Статистика</h2>
            <p className="text-muted" style={{ margin: 0 }}>
              {selectedOperatorLabel} · {timeRange.label}{lastUpdated ? ` · ${lastUpdated}` : ''}
            </p>
          </div>

          <div className="dashboard-header__controls" style={{ gap: 12 }}>
            <div className="dashboard-operator-controls" style={{ gap: 10 }}>
              <SelectPill
                label=""
                options={periodOptions}
                value={timePreset}
                onChange={(value) => {
                  const next = (value as TimePreset) || 'last7';
                  if (next === 'custom') {
                    setCustomRange((prev) => ({
                      start: prev.start || timeRange.startDate || '',
                      end: prev.end || timeRange.endDate || '',
                    }));
                    setTimePreset('custom');
                    return;
                  }
                  setTimePreset(next);
                }}
                showLabelInside={false}
                style={{ minWidth: 160 }}
              />

              <SelectPill
                label={operatorsLoading ? 'Загрузка…' : ''}
                options={operatorOptions}
                value={operatorSelectValue}
                onChange={(value) => {
                  const nextValue = value === 'all' ? null : Number(value);
                  setSelectedOperatorId((prev) => (prev === nextValue ? prev : nextValue));
                }}
                searchable
                showLabelInside={false}
                style={{ minWidth: 220 }}
              />

              <button
                className="button secondary"
                type="button"
                onClick={() => loadData('refresh', activeFilters)}
                disabled={refreshing}
              >
                {refreshing ? 'Обновляем…' : 'Пересчитать'}
              </button>
            </div>

            {(operatorsError || error) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {operatorsError && <span className="badge badge--error">{operatorsError}</span>}
                {error && <span className="badge badge--error">{error}</span>}
              </div>
            )}
          </div>
        </div>

        {timePreset === 'custom' && (
          <div className="dashboard-date-inputs" style={{ justifyContent: 'flex-end' }}>
            <input
              type="date"
              value={customRange.start}
              onChange={(event) => {
                const value = event.target.value;
                setCustomRange((prev) => ({ ...prev, start: value }));
                setTimePreset('custom');
              }}
            />
            <span className="text-muted">—</span>
            <input
              type="date"
              value={customRange.end}
              onChange={(event) => {
                const value = event.target.value;
                setCustomRange((prev) => ({ ...prev, end: value }));
                setTimePreset('custom');
              }}
            />
          </div>
        )}

        <div className="dashboard-pill-group" style={{ gap: 8 }}>
          {[
            { key: 'overview', label: 'Обзор' },
            { key: 'operators', label: 'Сотрудники' },
            { key: 'sections', label: 'Разделы' },
            { key: 'activity', label: 'Активность' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`dashboard-pill ${dashboardTab === tab.key ? 'is-active' : ''}`}
              onClick={() => setDashboardTab(tab.key as DashboardTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {dashboardTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="dashboard-stat-grid">
              {statCards.map((stat) => (
                <div key={stat.label} className={`stat-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ minHeight: 96 }}>
                  <span className="stat-card__label">{stat.label}</span>
                  <span className="stat-card__value">{stat.value}</span>
                </div>
              ))}
            </div>

            {/* ====== NEW: один чарт + рядом данные о диалогах ====== */}
            <div className="dashboard-overview-row">
              <div className="card dashboard-card dashboard-speed-card">
                <div className="dashboard-speed-card__title">
                  <div className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Скорость ответа</div>
                  <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                    {numberFormatter.format(totalOperators)} оператор{totalOperators === 1 ? '' : totalOperators < 5 ? 'а' : 'ов'}
                  </div>
                </div>

                <div className="dashboard-speed-card__body">
                  <div className="dashboard-speed-card__chart">
                    <svg viewBox="0 0 120 120" className="dashboard-donut" role="img" aria-label="Скорость ответа операторов">
                      <circle className="dashboard-donut__track" cx="60" cy="60" r={donutMulti.radius} />
                      {donutMulti.arcs.map((seg) => (
                        <circle
                          key={seg.key}
                          className={`dashboard-donut__segment dashboard-donut__segment--${seg.key}`}
                          cx="60"
                          cy="60"
                          r={donutMulti.radius}
                          strokeDasharray={seg.dashArray}
                          strokeDashoffset={seg.dashOffset}
                        >
                          <title>
                            {speedLabel(seg.key)}: {seg.count} ({seg.percentage.toFixed(1)}%), ср. {formatMinutes(seg.avgMinutes)}
                          </title>
                        </circle>
                      ))}
                      <text x="60" y="58" textAnchor="middle" className="dashboard-donut__center-value">
                        {numberFormatter.format(totalOperators)}
                      </text>
                      <text x="60" y="75" textAnchor="middle" className="dashboard-donut__center-sub">
                        операторов
                      </text>
                    </svg>
                  </div>

                  <div className="dashboard-speed-card__legend">
                    {(['fast', 'medium', 'slow'] as const).map((k) => {
                      const seg = responseSegments.find((s) => s.key === k) ?? { key: k, count: 0, avgMinutes: null, percentage: 0 };
                      return (
                        <div key={k} className="dashboard-legend-row">
                          <div className="dashboard-legend-left">
                            <span className={`dashboard-dot dashboard-dot--${k}`} />
                            <span className="dashboard-legend-label">{speedLabel(k)}</span>
                          </div>
                          <div className="dashboard-legend-right">
                            <span className="dashboard-legend-meta">
                              {seg.count} · {seg.percentage.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    <div className="dashboard-legend-divider" />

                    <div className="dashboard-legend-row">
                      <div className="dashboard-legend-left">
                        <span className="dashboard-legend-label">Среднее время ответа</span>
                      </div>
                      <div className="dashboard-legend-right">
                        <span className="dashboard-legend-meta">{avgResponseTimeLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card dashboard-card dashboard-dialogs-card">
                <div className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Диалоги</div>

                <div className="dashboard-kv">
                  <div className="dashboard-kv__row">
                    <span className="dashboard-kv__key">Всего</span>
                    <span className="dashboard-kv__val">{numberFormatter.format(data.totalDialogs)}</span>
                  </div>
                  <div className="dashboard-kv__row">
                    <span className="dashboard-kv__key">Активные</span>
                    <span className="dashboard-kv__val">{numberFormatter.format(data.openDialogs)}</span>
                  </div>
                  <div className="dashboard-kv__row">
                    <span className="dashboard-kv__key">Закрытые</span>
                    <span className="dashboard-kv__val">{numberFormatter.format(data.closedDialogs)}</span>
                  </div>

                  <div className="dashboard-kv__divider" />

                  <div className="dashboard-kv__row">
                    <span className="dashboard-kv__key">Сообщений</span>
                    <span className="dashboard-kv__val">{numberFormatter.format(data.totalMessages)}</span>
                  </div>
                  <div className="dashboard-kv__row">
                    <span className="dashboard-kv__key">Сообщений/день</span>
                    <span className="dashboard-kv__val">
                      {numberFormatter.format(timeRangeDays ? Math.round(data.totalMessages / timeRangeDays) : 0)}
                    </span>
                  </div>
                </div>

                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                  Период: {timeRange.label}
                </div>
              </div>
            </div>
          </div>
        )}

        {dashboardTab === 'operators' && (
          <div className="dashboard-columns">
            <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h3 className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>TOP-10</h3>
                <SelectPill
                  label=""
                  options={metricOptions}
                  value={topMetric}
                  onChange={(value) => setTopMetric((value as OperatorMetricKey) || 'avgResponse')}
                  showLabelInside={false}
                  style={{ minWidth: 220 }}
                />
              </div>

              {topOperators.length === 0 ? (
                <p className="text-muted" style={{ margin: 0 }}>Нет данных по сотрудникам.</p>
              ) : (
                <ul className="dashboard-top-list">
                  {topOperators.map((agent) => {
                    const normalizedName = agent.name.trim().toLowerCase();
                    const meta = operatorMetaByName.get(normalizedName);
                    const metricValue = activeMetricConfig.getValue(agent);

                    return (
                      <li key={agent.name} className="dashboard-top-item">
                        <div className="dashboard-top-item__identity">
                          <div className="dashboard-avatar">{getInitials(agent.name || 'NA')}</div>
                          <div>
                            <div className="dashboard-top-item__name">{agent.name || 'Без имени'}</div>
                            <div className="dashboard-top-item__role">{meta?.roleLabel ?? 'Сотрудник'}</div>
                          </div>
                        </div>
                        <div className="dashboard-top-item__metric">
                          <div className="dashboard-top-item__value">
                            {metricValue === null ? '—' : activeMetricConfig.format(metricValue)}
                          </div>
                          <div className="dashboard-top-item__label">{activeMetricConfig.label}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Дэшборд сотрудников</h3>
              {agentStats.length === 0 ? (
                <p className="text-muted" style={{ margin: 0 }}>Пока нет активности сотрудников.</p>
              ) : (
                <div className="table-scroll">
                  <table className="table table--compact dashboard-table">
                    <thead>
                      <tr>
                        <th>Сотрудник</th>
                        <th>Диалогов</th>
                        <th>Сообщений</th>
                        <th>Сообщ./диалог</th>
                        <th>Ответ</th>
                        <th>Активность</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentStats.map((agent) => (
                        <tr key={agent.name}>
                          <td>{agent.name}</td>
                          <td>{numberFormatter.format(agent.dialogs)}</td>
                          <td>{numberFormatter.format(agent.messages)}</td>
                          <td>{agent.avgMessagesPerDialog.toFixed(1)}</td>
                          <td>{formatMinutes(agent.avgResponseTimeMinutes)}</td>
                          <td>{agent.lastActivity ? formatDateTime(agent.lastActivity) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {dashboardTab === 'sections' && (
          <div className="dashboard-columns">
            <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h3 className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Обращения по разделам</h3>
              {data.sectionBreakdown.length === 0 ? (
                <p className="text-muted" style={{ margin: 0 }}>Данных пока нет.</p>
              ) : (
                <ul className="section-progress-list">
                  {data.sectionBreakdown.map((section) => (
                    <li key={section.section ?? section.title} className="section-progress-item">
                      <div className="section-progress-item__header">
                        <span>{section.title}</span>
                        <span className="text-muted">
                          {numberFormatter.format(section.dialogs)} · {section.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="progress-bar" aria-hidden="true">
                        <span
                          className="progress-bar__fill"
                          style={{ width: `${Math.min(Math.max(section.percentage, 0), 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h3 className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Частые вопросы</h3>
                <SelectPill
                  label=""
                  options={questionSectionOptions}
                  value={selectedQuestionSection}
                  onChange={(value) => setSelectedQuestionSection(value || 'all')}
                  showLabelInside={false}
                  style={{ minWidth: 220 }}
                />
              </div>

              {selectedQuestions.length === 0 ? (
                <p className="text-muted" style={{ margin: 0 }}>Нет популярных вопросов.</p>
              ) : (
                <ol className="question-list">
                  {selectedQuestions.map((item, index) => {
                    const { text, badge } = parseQuestion(item.question);
                    return (
                      <li key={`${item.question}-${index}`} className="question-list__item">
                        <span>
                          {badge && <span className="question-badge">{badge}</span>}
                          {text}
                        </span>
                        <span className="question-list__count">{numberFormatter.format(item.count)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}

        {dashboardTab === 'activity' && (
          <div className={`card dashboard-card ${isLoading ? 'dashboard-card--loading' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 className="heading" style={{ fontSize: '1.05rem', margin: 0 }}>Активность · последняя неделя</h3>
            {recentWeek.length === 0 ? (
              <p className="text-muted" style={{ margin: 0 }}>Нет данных о новых диалогах.</p>
            ) : (
              <div className="table-scroll">
                <table className="table table--compact dashboard-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Новых диалогов</th>
                      <th>Входящих</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentWeek.map((item) => (
                      <tr key={item.date}>
                        <td>{formatDate(item.date)}</td>
                        <td>{numberFormatter.format(item.dialogs)}</td>
                        <td>{numberFormatter.format(item.incomingMessages)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!hasData && (
          <div style={{ borderTop: '1px solid rgba(37, 50, 99, 0.1)', paddingTop: 16 }}>
            <p className="text-muted" style={{ margin: '0 0 12px 0' }}>
              {loading ? 'Загружаем…' : error ?? 'Нет данных.'}
            </p>
            {!loading && (
              <button className="button" type="button" onClick={() => loadData('initial', activeFilters)}>
                Попробовать снова
              </button>
            )}
          </div>
        )}
      </div>

      <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: -6 }}>
        {operatorCount ? `${numberFormatter.format(operatorCount)} сотрудников` : ''}
      </div>
    </div>
  );
};

export default DashboardPage;
