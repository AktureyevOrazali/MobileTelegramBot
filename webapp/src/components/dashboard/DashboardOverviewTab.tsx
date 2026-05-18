import React, { useCallback, useMemo, useState } from 'react';

import Modal from '../Modal';
import EChartsWrapper from '../EChartsWrapper';
import LoadingEstimate from '../LoadingEstimate';
import RegionActivityMap from '../RegionActivityMap';
import { useDashboardData } from '../../hooks/useDashboardData';
import type { BinDetailed, ChatSummary, DashboardDialogMetric } from '../../types';

interface DashboardOverviewTabProps {
  dashboard: ReturnType<typeof useDashboardData>;
  dashboardMapMaxCount: number;
  dashboardRayonCounts: Record<string, Record<number, number>>;
  dashboardRegionCounts: Record<string, number>;
  isDark: boolean;
  mapBins: BinDetailed[];
  mapChats: ChatSummary[];
  mapLoading: boolean;
}

type RatingKind = 'csat' | 'ai';

interface RatingModalState {
  kind: RatingKind;
  rating: number;
  items: DashboardDialogMetric[];
}

const DASH = '\u2014';
const STAR = '\u2605';
const CLOSE_ICON = '\u00d7';
const ALL_EMPLOYEES_LABEL = '\u0412\u0441\u0435 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0438';
const AVERAGE_RATING_LABEL = '\u0421\u0440\u0435\u0434\u043d\u044f\u044f \u043e\u0446\u0435\u043d\u043a\u0430';
const REVIEWS_LABEL = '\u043e\u0442\u0437\u044b\u0432\u043e\u0432';
const MAP_EYEBROW_LABEL = '\u041a\u0430\u0440\u0442\u0430 BIN';
const MAP_TITLE = '\u0410\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u043f\u043e \u0440\u0435\u0433\u0438\u043e\u043d\u0430\u043c \u041a\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043d\u0430';
const MAP_LOADING_LABEL = '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043a\u0430\u0440\u0442\u044b...';
const SPEED_TITLE = '\u0421\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u043e\u0442\u0432\u0435\u0442\u0430';
const OPERATORS_LABEL = '\u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u043e\u0432';
const DIALOGS_TITLE = '\u041e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f';
const TOTAL_LABEL = '\u0412\u0441\u0435\u0433\u043e';
const OPEN_LABEL = '\u0410\u043a\u0442\u0438\u0432\u043d\u044b\u0435';
const CLOSED_LABEL = '\u0417\u0430\u043a\u0440\u044b\u0442\u044b\u0435';
const MESSAGES_LABEL = '\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439';
const AVERAGE_PER_DAY_LABEL = '\u0421\u0440. \u0437\u0430 \u0434\u0435\u043d\u044c';
const PERIOD_LABEL = '\u041f\u0435\u0440\u0438\u043e\u0434';
const AI_TITLE = '\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044f (AI)';
const RESOLVED_BY_BOT_LABEL = '\u0440\u0435\u0448\u0435\u043d\u043e \u0431\u043e\u0442\u043e\u043c';
const NO_DATA_LABEL = '\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445';
const AI_RESOLVED_LABEL = '\u0420\u0435\u0448\u0435\u043d\u043e \u0431\u043e\u0442\u043e\u043c';
const TRANSFERRED_TO_OPERATOR_LABEL = '\u041f\u0435\u0440\u0435\u0432\u0435\u0434\u0435\u043d\u043e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443';
const BOT_MESSAGES_LABEL = '\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 \u043e\u0442 \u0431\u043e\u0442\u0430';
const BEFORE_TRANSFER_LABEL = '\u0421\u0440. \u0434\u043e \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u0430';
const SERVICE_QUALITY_TITLE = '\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e \u043e\u0431\u0441\u043b\u0443\u0436\u0438\u0432\u0430\u043d\u0438\u044f';
const SLA_SUBLABEL = 'SLA (\u043e\u0442\u0432\u0435\u0442 \u0434\u043e 5 \u043c\u0438\u043d)';
const DELAYED_RESPONSES_LABEL = '\u041e\u0442\u0432\u0435\u0442\u043e\u0432 \u0441 \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u043e\u0439';
const RECURRING_REQUESTS_LABEL = '\u041f\u043e\u0432\u0442\u043e\u0440\u043d\u044b\u0435 \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u044f';
const RECURRING_SHARE_LABEL = '\u0414\u043e\u043b\u044f \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u044b\u0445';
const CSAT_TITLE = '\u0423\u0434\u043e\u0432\u043b\u0435\u0442\u0432\u043e\u0440\u0435\u043d\u043d\u043e\u0441\u0442\u044c (CSAT)';
const AI_RATING_TITLE = '\u041e\u0446\u0435\u043d\u043a\u0430 \u0440\u0430\u0431\u043e\u0442\u044b AI';
const NO_OPERATOR_RATINGS_LABEL = '\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043e\u0446\u0435\u043d\u043e\u043a \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u043e\u0432.';
const NO_AI_RATINGS_LABEL = '\u041f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043e\u0446\u0435\u043d\u043e\u043a AI.';
const BINS_LABEL = 'BIN';
const BIN_NOT_SPECIFIED_LABEL = 'BIN \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
const EMPLOYEE_LABEL = '\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a';
const EMPLOYEE_UNDEFINED_LABEL = '\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d';
const RATING_WORD_LABEL = '\u043e\u0446\u0435\u043d\u043a\u0430';
const NO_BINS_FOR_RATING_LABEL = '\u0414\u043b\u044f \u044d\u0442\u043e\u0439 \u043e\u0446\u0435\u043d\u043a\u0438 \u043d\u0435\u0442 BIN.';
const RESPONSE_TIME_LABEL = '\u0421\u0440. \u0432\u0440\u0435\u043c\u044f \u043e\u0442\u0432\u0435\u0442\u0430';
const REQUESTS_LABEL = '\u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0439';

const normalizeOperatorName = (value?: string | null) => value?.trim().toLowerCase() ?? '';

const speedLabelLocal = (key: 'fast' | 'medium' | 'slow') => {
  if (key === 'fast') return '\u0411\u044b\u0441\u0442\u0440\u044b\u0435';
  if (key === 'medium') return '\u0421\u0440\u0435\u0434\u043d\u0438\u0435';
  return '\u041c\u0435\u0434\u043b\u0435\u043d\u043d\u044b\u0435';
};

const formatMinutesLocal = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return DASH;
  const totalSeconds = Math.round(value * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}\u043c${seconds > 0 ? ` ${seconds}\u0441` : ''}`;
  }
  return `${seconds}\u0441`;
};

const getRatingColor = (rating: number, isDark: boolean) => {
  if (rating <= 2) return isDark ? '#e17c7c' : '#d96565';
  if (rating === 3) return isDark ? '#fbbf24' : '#f59e0b';
  if (rating === 4) return isDark ? '#34d399' : '#10b981';
  return isDark ? '#4ade80' : '#22c55e';
};

const DashboardOverviewTab: React.FC<DashboardOverviewTabProps> = ({
  dashboard: d,
  dashboardMapMaxCount,
  dashboardRayonCounts,
  dashboardRegionCounts,
  isDark,
  mapBins,
  mapChats,
  mapLoading,
}) => {
  const [ratingModal, setRatingModal] = useState<RatingModalState | null>(null);

  const responseTotal = useMemo(
    () => d.responseSegments.reduce((sum, seg) => sum + seg.count, 0),
    [d.responseSegments],
  );

  const activeOperatorLabel = useMemo(() => {
    if (d.activeOperatorId === null) return ALL_EMPLOYEES_LABEL;
    const found = d.operators.find((operator) => operator.id === d.activeOperatorId);
    return found?.name || found?.login || `ID ${d.activeOperatorId}`;
  }, [d.activeOperatorId, d.operators]);

  const periodLabel = useMemo(() => {
    if (d.timeRange.startDate && d.timeRange.endDate) {
      return `${d.timeRange.startDate} ${DASH} ${d.timeRange.endDate}`;
    }
    return DASH;
  }, [d.timeRange.endDate, d.timeRange.startDate]);

  const selectedOperatorAliases = useMemo(
    () => new Set((d.selectedOperatorAliases ?? []).map((value) => normalizeOperatorName(value)).filter(Boolean)),
    [d.selectedOperatorAliases],
  );

  const matchesSelectedOperator = useCallback(
    (operatorName: string | null) => {
      if (d.activeOperatorId === null || selectedOperatorAliases.size === 0) return true;
      const normalized = normalizeOperatorName(operatorName);
      return normalized ? selectedOperatorAliases.has(normalized) : false;
    },
    [d.activeOperatorId, selectedOperatorAliases],
  );

  const getRatingEntries = useCallback(
    (kind: RatingKind, rating: number) =>
      d.data.dialogMetrics.filter((metric) => {
        if (metric.isOpen) return false;
        if (kind === 'csat') {
          if (metric.csatRating !== rating) return false;
          return matchesSelectedOperator(metric.operatorName);
        }
        return metric.aiCsatRating === rating;
      }),
    [d.data.dialogMetrics, matchesSelectedOperator],
  );

  const openRatingModal = useCallback(
    (kind: RatingKind, params: any) => {
      const rawRating = params?.name ?? params?.value ?? (typeof params?.dataIndex === 'number' ? params.dataIndex + 1 : NaN);
      const rating = Number(rawRating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return;
      setRatingModal({ kind, rating, items: getRatingEntries(kind, rating) });
    },
    [getRatingEntries],
  );

  const closeRatingModal = useCallback(() => setRatingModal(null), []);

  const modalTitle = useMemo(() => {
    if (!ratingModal) return '';
    const prefix = ratingModal.kind === 'csat' ? 'CSAT' : 'AI';
    return `${prefix}: ${RATING_WORD_LABEL} ${ratingModal.rating}`;
  }, [ratingModal]);

  const modalSubtitle = useMemo(() => {
    if (!ratingModal) return '';
    return `${activeOperatorLabel} ? ${d.numberFormatter.format(ratingModal.items.length)} BIN`;
  }, [activeOperatorLabel, d.numberFormatter, ratingModal]);

  const renderRatingCard = (
    title: string,
    average: number | null,
    count: number,
    distribution: { rating: number; count: number }[],
    emptyText: string,
    kind: RatingKind,
  ) => {
    const ratingCounts = [1, 2, 3, 4, 5].map((rating) => {
      const found = distribution.find((entry) => entry.rating === rating);
      return found ? found.count : 0;
    });
    const yMax = Math.max(1, ...ratingCounts);
    const axisMax = yMax <= 1 ? 1.15 : yMax + Math.max(0.25, yMax * 0.1);

    return (
      <div className="dashboard-card dashboard-card--delay-3 dashboard-card--rating">
        <h3 className="dashboard-card__title">{title}</h3>
        {count === 0 ? (
          <div className="dashboard-empty dashboard-empty--card">
            <div className="dashboard-empty__icon">{STAR}</div>
            <p className="dashboard-empty__text">{emptyText}</p>
          </div>
        ) : (
          <div className="dashboard-rating">
            <div className="dashboard-rating__summary">
              <div className="dashboard-rating__score">{average !== null ? average.toFixed(1) : DASH}</div>
              <div className="dashboard-rating__caption">{AVERAGE_RATING_LABEL}</div>
              <div className="dashboard-rating__count">
                {d.numberFormatter.format(count)} {REVIEWS_LABEL}
              </div>
            </div>
            <div className="dashboard-rating__chart dashboard-rating__chart--interactive">
              <EChartsWrapper
                onEvents={{ click: (params: any) => openRatingModal(kind, params) }}
                option={{
                  tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'none' },
                    backgroundColor: isDark ? '#182538' : '#ffffff',
                    borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                    borderWidth: 1,
                    textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
                    formatter: '{b} ?: <b>{c}</b>',
                  },
                  grid: { top: 8, right: 8, bottom: 4, left: 8, containLabel: true },
                  xAxis: {
                    type: 'category',
                    data: ['1', '2', '3', '4', '5'],
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { fontSize: 13, color: isDark ? '#edf3fb' : '#1d2940', margin: 12 },
                  },
                  yAxis: {
                    type: 'value',
                    show: false,
                    min: 0,
                    max: axisMax,
                  },
                  series: [
                    {
                      type: 'bar',
                      barWidth: 30,
                      barMinHeight: 2,
                      data: ratingCounts,
                      itemStyle: {
                        borderRadius: [6, 6, 0, 0],
                        color: (params: any) => getRatingColor(Number(params.name), isDark),
                      },
                      label: {
                        show: true,
                        position: 'top',
                        color: isDark ? '#edf3fb' : '#1d2940',
                        fontSize: 12,
                        fontWeight: 700,
                        formatter: (params: any) => `${Number(params?.value ?? 0)}`,
                      },
                    },
                  ],
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };


  return (
    <>
      <div className="dashboard-card dashboard-card--map">
        <div className="dashboard-map-widget__header">
          <div>
            <div className="dashboard-map-widget__eyebrow">{MAP_EYEBROW_LABEL}</div>
            <h3 className="dashboard-card__title">{MAP_TITLE}</h3>
          </div>
          <div className="kz-map__legend">
            <span>0 BIN</span>
            <span className="kz-map__legend-gradient" aria-hidden="true" />
            <span>{dashboardMapMaxCount} BIN</span>
          </div>
        </div>
        <div className="dashboard-map-widget__body">
          {mapLoading ? (
            <div className="dashboard-empty dashboard-empty--map">
              <LoadingEstimate
                title={'\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c BIN-\u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0437 \u0433\u043e\u0441\u0437\u0430\u043a\u0443\u043f\u0430'}
                description={MAP_LOADING_LABEL}
              />
            </div>
          ) : (
            <RegionActivityMap
              counts={dashboardRegionCounts}
              rayonCounts={dashboardRayonCounts}
              binDetails={mapBins}
              chats={mapChats}
            />
          )}
        </div>
      </div>

      <div className="dashboard-overview-row">
        <div className="dashboard-card">
          <div className="dashboard-speed__header">
            <h3 className="dashboard-card__title">{SPEED_TITLE}</h3>
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              {d.activeOperatorId === null
                ? `${d.numberFormatter.format(d.totalOperators)} ${OPERATORS_LABEL}`
                : activeOperatorLabel}
            </span>
          </div>

          <div className="dashboard-donut-col">
            <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto' }}>
              <EChartsWrapper
                option={{
                  tooltip: {
                    trigger: 'item',
                    backgroundColor: isDark ? '#182538' : '#ffffff',
                    borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                    borderWidth: 1,
                    textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
                    formatter: (params: any) => {
                      if (params.name === 'empty') return '';
                      const segment = d.responseSegments.find((entry) => entry.key === params.name);
                      return `${speedLabelLocal(params.name)}: <b>${params.value}</b><br/>${RESPONSE_TIME_LABEL}: ${formatMinutesLocal(segment?.avgMinutes || 0)}`;
                    },
                  },
                  series: [
                    {
                      type: 'pie',
                      radius: ['75%', '88%'],
                      center: ['50%', '50%'],
                      avoidLabelOverlap: false,
                      itemStyle: {
                        borderRadius: 5,
                        borderColor: 'transparent',
                        borderWidth: 2,
                      },
                      label: { show: false },
                      data:
                        responseTotal === 0
                          ? [{ value: 1, name: 'empty', itemStyle: { color: '#e2e8f0' } }]
                          : d.responseSegments.filter((segment) => segment.count > 0).map((segment) => ({
                              value: segment.count,
                              name: segment.key,
                              itemStyle: {
                                color:
                                  segment.key === 'fast'
                                    ? isDark
                                      ? '#34d399'
                                      : '#10b981'
                                    : segment.key === 'medium'
                                      ? isDark
                                        ? '#fbbf24'
                                        : '#f59e0b'
                                      : isDark
                                        ? '#e17c7c'
                                        : '#d96565',
                              },
                            })),
                    },
                  ],
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: 'var(--text-color)' }}>
                  {d.numberFormatter.format(responseTotal)}
                </span>
                <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>
                  {d.activeOperatorId === null ? OPERATORS_LABEL : REQUESTS_LABEL}
                </span>
              </div>
            </div>

            <div className="dashboard-legend">
              {(['fast', 'medium', 'slow'] as const).map((key) => {
                const segment = d.responseSegments.find((entry) => entry.key === key) ?? {
                  key,
                  count: 0,
                  avgMinutes: null,
                  percentage: 0,
                };
                return (
                  <div key={key} className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className={`dashboard-legend-dot dashboard-legend-dot--${key}`} />
                      <span className="dashboard-legend-label">{speedLabelLocal(key)}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{segment.count}</span>
                    </div>
                  </div>
                );
              })}

              <div className="dashboard-legend-divider" />

              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">{RESPONSE_TIME_LABEL}</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-meta">{formatMinutesLocal(d.data.avgResponseTimeMinutes)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-card dashboard-card--delay-1">
          <h3 className="dashboard-card__title">{DIALOGS_TITLE}</h3>

          <div className="dashboard-kv">
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">{TOTAL_LABEL}</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.totalDialogs)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">{OPEN_LABEL}</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.openDialogs)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">{CLOSED_LABEL}</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.closedDialogs)}</span>
            </div>

            <div className="dashboard-kv__divider" />

            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">{MESSAGES_LABEL}</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.totalMessages)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">{AVERAGE_PER_DAY_LABEL}</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.messagesPerDay)}</span>
            </div>
          </div>

          <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 'auto' }}>
            {PERIOD_LABEL}: {periodLabel}
          </div>
        </div>
      </div>


      <div className="dashboard-overview-row">
        <div className="dashboard-card dashboard-card--delay-2">
          <h3 className="dashboard-card__title">{AI_TITLE}</h3>

          {(() => {
            const total = d.data.aiClosedDialogs + d.data.transferredToOperatorDialogs;
            const aiPct = total > 0 ? (d.data.aiClosedDialogs / total) * 100 : 0;
            return (
              <div className="dashboard-ai-bar">
                <div className="dashboard-ai-bar__hero">
                  <span className="dashboard-ai-bar__pct">{total > 0 ? `${aiPct.toFixed(0)}%` : DASH}</span>
                  <span className="dashboard-ai-bar__pct-label">{RESOLVED_BY_BOT_LABEL}</span>
                </div>

                <div style={{ height: 16, width: '100%', marginTop: 12, marginBottom: 12, borderRadius: 8, overflow: 'hidden' }}>
                  <EChartsWrapper
                    option={{
                      tooltip: {
                        trigger: 'axis',
                        axisPointer: { type: 'none' },
                        backgroundColor: isDark ? '#182538' : '#ffffff',
                        borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                        borderWidth: 1,
                        textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
                        formatter: (params: any) => {
                          if (total === 0) return NO_DATA_LABEL;
                          return params.map((point: any) => `${point.seriesName}: <b>${point.value}</b>`).join('<br/>');
                        },
                      },
                      grid: { top: 0, bottom: 0, left: 0, right: 0 },
                      xAxis: { type: 'value', show: false, max: total > 0 ? total : 1 },
                      yAxis: { type: 'category', data: ['AI'], show: false },
                      series:
                        total === 0
                          ? [
                              {
                                type: 'bar',
                                data: [1],
                                barWidth: 14,
                                itemStyle: { color: isDark ? '#2d3748' : '#e2e8f0' },
                                animation: false,
                              },
                            ]
                          : [
                              {
                                name: AI_RESOLVED_LABEL,
                                type: 'bar',
                                stack: 'total',
                                data: [d.data.aiClosedDialogs],
                                barWidth: 14,
                                itemStyle: { color: isDark ? '#60a5fa' : '#3b82f6', borderRadius: [8, 0, 0, 8] },
                              },
                              {
                                name: TRANSFERRED_TO_OPERATOR_LABEL,
                                type: 'bar',
                                stack: 'total',
                                data: [d.data.transferredToOperatorDialogs],
                                barWidth: 14,
                                itemStyle: {
                                  color: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                                  borderRadius: [0, 8, 8, 0],
                                },
                              },
                            ],
                    }}
                  />
                </div>

                <div className="dashboard-legend" style={{ marginTop: 12 }}>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-dot" style={{ background: 'var(--chart-color-2)' }} />
                      <span className="dashboard-legend-label">{AI_RESOLVED_LABEL}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.aiClosedDialogs)}</span>
                    </div>
                  </div>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-dot" style={{ background: 'var(--border-color)' }} />
                      <span className="dashboard-legend-label">{TRANSFERRED_TO_OPERATOR_LABEL}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.transferredToOperatorDialogs)}</span>
                    </div>
                  </div>

                  <div className="dashboard-legend-divider" />

                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-label">{BOT_MESSAGES_LABEL}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.aiMessagesCount)}</span>
                    </div>
                  </div>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-label">{BEFORE_TRANSFER_LABEL}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">
                        {d.data.avgMessagesBeforeTransfer !== null ? d.data.avgMessagesBeforeTransfer.toFixed(1) : DASH}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="dashboard-card dashboard-card--delay-3">
          <h3 className="dashboard-card__title">{SERVICE_QUALITY_TITLE}</h3>

          <div className="dashboard-donut-col">
            {(() => {
              const slaValue = d.data.slaCompliancePercentage ?? 0;
              const gaugeColor = slaValue >= 80 ? (isDark ? '#34d399' : '#10b981') : isDark ? '#e17c7c' : '#d96565';
              return (
                <div style={{ position: 'relative', width: 200, height: 110, margin: '0 auto', top: -10 }}>
                  <EChartsWrapper
                    option={{
                      series: [
                        {
                          type: 'gauge',
                          startAngle: 180,
                          endAngle: 0,
                          center: ['50%', '80%'],
                          radius: '100%',
                          min: 0,
                          max: 100,
                          splitNumber: 1,
                          itemStyle: { color: gaugeColor },
                          progress: { show: true, width: 10, roundCap: true },
                          axisLine: {
                            roundCap: true,
                            lineStyle: {
                              width: 10,
                              color: [[1, isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)']],
                            },
                          },
                          pointer: { show: false },
                          axisTick: { show: false },
                          splitLine: { show: false },
                          axisLabel: { show: false },
                          detail: { show: false },
                          data: [{ value: slaValue }],
                        },
                      ],
                    }}
                  />
                  <div className="dashboard-sla-gauge__label" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, marginTop: 0 }}>
                    <span className="dashboard-sla-gauge__value" style={{ color: gaugeColor }}>
                      {d.data.slaCompliancePercentage !== null ? `${d.data.slaCompliancePercentage.toFixed(1)}%` : DASH}
                    </span>
                    <span className="dashboard-sla-gauge__sub">{SLA_SUBLABEL}</span>
                  </div>
                </div>
              );
            })()}

            <div className="dashboard-legend">
              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-dot" style={{ background: 'var(--danger-bg)' }} />
                  <span className="dashboard-legend-label">{DELAYED_RESPONSES_LABEL}</span>
                </div>
                <div className="dashboard-legend-right">
                  <span
                    className="dashboard-legend-count"
                    style={{ color: d.data.slaViolationsCount > 0 ? 'var(--input-error-color)' : 'inherit' }}
                  >
                    {d.numberFormatter.format(d.data.slaViolationsCount)}
                  </span>
                </div>
              </div>

              <div className="dashboard-legend-divider" />

              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">{RECURRING_REQUESTS_LABEL}</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.recurringRequestsCount)}</span>
                </div>
              </div>
              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">{RECURRING_SHARE_LABEL}</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-count">
                    {d.data.recurringRequestsPercentage !== null ? `${d.data.recurringRequestsPercentage.toFixed(1)}%` : DASH}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      <div className="dashboard-overview-row">
        {renderRatingCard(
          CSAT_TITLE,
          d.data.csatAverage,
          d.data.csatCount,
          d.data.csatDistribution,
          NO_OPERATOR_RATINGS_LABEL,
          'csat',
        )}
        {renderRatingCard(
          AI_RATING_TITLE,
          d.data.aiCsatAverage,
          d.data.aiCsatCount,
          d.data.aiCsatDistribution,
          NO_AI_RATINGS_LABEL,
          'ai',
        )}
      </div>

      <Modal open={Boolean(ratingModal)} onClose={closeRatingModal} className="dashboard-rating-modal">
        <div className="dashboard-rating-modal__content">
          <div className="dashboard-rating-modal__header">
            <div>
              <h3 className="dashboard-rating-modal__title">{modalTitle}</h3>
              <p className="dashboard-rating-modal__subtitle">{modalSubtitle}</p>
            </div>
            <button type="button" className="dashboard-rating-modal__close" onClick={closeRatingModal} aria-label="Close">
              {CLOSE_ICON}
            </button>
          </div>

          {ratingModal?.items.length ? (
            <div className="dashboard-rating-modal__list">
              {ratingModal.items.map((item, index) => (
                <div
                  key={`${ratingModal.kind}-${ratingModal.rating}-${item.dialogId}-${item.bin ?? 'none'}-${index}`}
                  className="dashboard-rating-modal__item"
                >
                  <div className="dashboard-rating-modal__item-head">
                    <span className="dashboard-rating-modal__bin">{item.bin || BIN_NOT_SPECIFIED_LABEL}</span>
                  </div>
                  {ratingModal.kind === 'csat' ? (
                    <div className="dashboard-rating-modal__item-body">
                      <div>
                        <span className="dashboard-rating-modal__label">{EMPLOYEE_LABEL}</span>
                        <span className="dashboard-rating-modal__value">{item.operatorName || EMPLOYEE_UNDEFINED_LABEL}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty dashboard-empty--card dashboard-rating-modal__empty">
              <div className="dashboard-empty__icon">{STAR}</div>
              <p className="dashboard-empty__text">{NO_BINS_FOR_RATING_LABEL}</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
};

export default DashboardOverviewTab;
