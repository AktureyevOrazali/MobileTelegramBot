import React from 'react';

import EChartsWrapper from '../EChartsWrapper';
import RegionActivityMap from '../RegionActivityMap';
import { useDashboardData } from '../../hooks/useDashboardData';
import type { BinDetailed, ChatSummary } from '../../types';
import { formatMinutes, speedLabel } from '../../utils/dashboard-helpers';

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
  const renderRatingCard = (
    title: string,
    average: number | null,
    count: number,
    distribution: { rating: number; count: number }[],
    emptyText: string,
  ) => {
    const ratingCounts = [1, 2, 3, 4, 5].map((rating) => {
      const found = distribution.find((x) => x.rating === rating);
      return found ? found.count : 0;
    });
    const yMax = Math.max(1, ...ratingCounts);
    const axisMax = yMax <= 1 ? 1.15 : yMax + Math.max(0.25, yMax * 0.1);

    return (
      <div className="dashboard-card dashboard-card--delay-3 dashboard-card--rating">
        <h3 className="dashboard-card__title">{title}</h3>
        {count === 0 ? (
          <div className="dashboard-empty dashboard-empty--card">
            <div className="dashboard-empty__icon">⭐</div>
            <p className="dashboard-empty__text">{emptyText}</p>
          </div>
        ) : (
          <div className="dashboard-rating">
            <div className="dashboard-rating__summary">
              <div className="dashboard-rating__score">
                {average !== null ? average.toFixed(1) : '—'}
              </div>
              <div className="dashboard-rating__caption">Средняя оценка</div>
              <div className="dashboard-rating__count">
                {d.numberFormatter.format(count)} отзывов
              </div>
            </div>
            <div className="dashboard-rating__chart">
              <EChartsWrapper
                option={{
                  tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'none' },
                    backgroundColor: isDark ? '#182538' : '#ffffff',
                    borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                    borderWidth: 1,
                    textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
                    formatter: '{b} ★: <b>{c}</b>',
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
                        color: (params: any) => {
                          const rating = Number(params.name);
                          if (rating <= 2) return isDark ? '#e17c7c' : '#d96565';
                          if (rating === 3) return isDark ? '#fbbf24' : '#f59e0b';
                          if (rating === 4) return isDark ? '#34d399' : '#10b981';
                          if (rating === 5) return isDark ? '#4ade80' : '#22c55e';
                          return isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)';
                        },
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
            <div className="dashboard-map-widget__eyebrow">Карта BIN</div>
            <h3 className="dashboard-card__title">Активность по регионам Казахстана</h3>
          </div>
          <div className="kz-map__legend">
            <span>0 BIN</span>
            <span className="kz-map__legend-gradient" aria-hidden="true" />
            <span>{dashboardMapMaxCount} BIN</span>
          </div>
        </div>
        <div className="dashboard-map-widget__body">
          {mapLoading ? (
            <div className="dashboard-empty dashboard-empty--map">Загрузка карты...</div>
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

      {/* Row 1: Скорость ответа + Обращения */}
      <div className="dashboard-overview-row">
        {/* ── Response speed donut ── */}
        <div className="dashboard-card">
          <div className="dashboard-speed__header">
            <h3 className="dashboard-card__title">Скорость ответа</h3>
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              {d.activeOperatorId === null
                ? `${d.numberFormatter.format(d.totalOperators)} оператор${d.totalOperators === 1 ? '' : d.totalOperators < 5 ? 'а' : 'ов'}`
                : d.selectedOperatorLabel}
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
                      const seg = d.responseSegments.find((s) => s.key === params.name);
                      return `${speedLabel(params.name)}: <b>${params.value}</b><br/>Ср. время: ${formatMinutes(seg?.avgMinutes || 0)}`;
                    }
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
                        borderWidth: 2
                      },
                      label: { show: false },
                      data: d.responseSegments.reduce((sum, seg) => sum + seg.count, 0) === 0 ?
                        [{ value: 1, name: 'empty', itemStyle: { color: '#e2e8f0' } }] :
                        d.responseSegments.filter(s => s.count > 0).map(seg => ({
                          value: seg.count,
                          name: seg.key,
                          itemStyle: { color: seg.key === 'fast' ? (isDark ? '#34d399' : '#10b981') : seg.key === 'medium' ? (isDark ? '#fbbf24' : '#f59e0b') : (isDark ? '#e17c7c' : '#d96565') }
                        }))
                    }
                  ]
                }}
              />
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: 'var(--text-color)' }}>
                  {d.numberFormatter.format(d.responseSegments.reduce((sum, seg) => sum + seg.count, 0))}
                </span>
                <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>
                  {d.activeOperatorId === null ? 'операторов' : 'обращений'}
                </span>
              </div>
            </div>

            <div className="dashboard-legend">
              {(['fast', 'medium', 'slow'] as const).map((k) => {
                const seg = d.responseSegments.find((s) => s.key === k) ?? { key: k, count: 0, avgMinutes: null, percentage: 0 };
                return (
                  <div key={k} className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className={`dashboard-legend-dot dashboard-legend-dot--${k}`} />
                      <span className="dashboard-legend-label">{speedLabel(k)}</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{seg.count}</span>
                    </div>
                  </div>
                );
              })}

              <div className="dashboard-legend-divider" />

              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">Ср. время ответа</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-meta">{d.avgResponseTimeLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Dialogs card (clean key-value) ── */}
        <div className="dashboard-card dashboard-card--delay-1">
          <h3 className="dashboard-card__title">Обращения</h3>

          <div className="dashboard-kv">
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">Всего</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.totalDialogs)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">Активные</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.openDialogs)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">Закрытые</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.closedDialogs)}</span>
            </div>

            <div className="dashboard-kv__divider" />

            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">Сообщений</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.totalMessages)}</span>
            </div>
            <div className="dashboard-kv__row">
              <span className="dashboard-kv__key">Ср. за день</span>
              <span className="dashboard-kv__val">{d.numberFormatter.format(d.messagesPerDay)}</span>
            </div>
          </div>

          <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: 'auto' }}>
            Период: {d.timeRange.label}
          </div>
        </div>
      </div>

      {/* Row 2: AI + SLA */}
      <div className="dashboard-overview-row">
        {/* ── AI progress bar ── */}
        <div className="dashboard-card dashboard-card--delay-2">
          <h3 className="dashboard-card__title">Автоматизация (AI)</h3>

          {(() => {
            const total = d.data.aiClosedDialogs + d.data.transferredToOperatorDialogs;
            const aiPct = total > 0 ? (d.data.aiClosedDialogs / total) * 100 : 0;
            return (
              <div className="dashboard-ai-bar">
                <div className="dashboard-ai-bar__hero">
                  <span className="dashboard-ai-bar__pct">{total > 0 ? aiPct.toFixed(0) + '%' : '—'}</span>
                  <span className="dashboard-ai-bar__pct-label">решено ботом</span>
                </div>

                {/* Stacked bar */}
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
                          if (total === 0) return 'Нет данных';
                          return params.map((p: any) => `${p.seriesName}: <b>${p.value}</b>`).join('<br/>');
                        }
                      },
                      grid: { top: 0, bottom: 0, left: 0, right: 0 },
                      xAxis: { type: 'value', show: false, max: total > 0 ? total : 1 },
                      yAxis: { type: 'category', data: ['AI'], show: false },
                      series: total === 0 ? [
                        { type: 'bar', data: [1], barWidth: 14, itemStyle: { color: isDark ? '#2d3748' : '#e2e8f0' }, animation: false }
                      ] : [
                        {
                          name: 'Решено ботом',
                          type: 'bar',
                          stack: 'total',
                          data: [d.data.aiClosedDialogs],
                          barWidth: 14,
                          itemStyle: { color: isDark ? '#60a5fa' : '#3b82f6', borderRadius: [8, 0, 0, 8] }
                        },
                        {
                          name: 'Переведено оператору',
                          type: 'bar',
                          stack: 'total',
                          data: [d.data.transferredToOperatorDialogs],
                          barWidth: 14,
                          itemStyle: { color: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)', borderRadius: [0, 8, 8, 0] }
                        }
                      ]
                    }}
                  />
                </div>

                <div className="dashboard-legend" style={{ marginTop: 12 }}>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-dot" style={{ background: 'var(--chart-color-2)' }} />
                      <span className="dashboard-legend-label">Решено ботом</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.aiClosedDialogs)}</span>
                    </div>
                  </div>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-dot" style={{ background: 'var(--border-color)' }} />
                      <span className="dashboard-legend-label">Переведено оператору</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.transferredToOperatorDialogs)}</span>
                    </div>
                  </div>

                  <div className="dashboard-legend-divider" />

                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-label">Сообщений от бота</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.aiMessagesCount)}</span>
                    </div>
                  </div>
                  <div className="dashboard-legend-row">
                    <div className="dashboard-legend-left">
                      <span className="dashboard-legend-label">Ср. до перевода</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-count">
                        {d.data.avgMessagesBeforeTransfer !== null ? d.data.avgMessagesBeforeTransfer.toFixed(1) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── SLA semicircle gauge ── */}
        <div className="dashboard-card dashboard-card--delay-3">
          <h3 className="dashboard-card__title">Качество обслуживания</h3>

          <div className="dashboard-donut-col">
            {(() => {
              const slaValue = d.data.slaCompliancePercentage ?? 0;
              const gaugeColor = slaValue >= 80 ? (isDark ? '#34d399' : '#10b981') : (isDark ? '#e17c7c' : '#d96565');
              // SVG semicircle: radius 48, using full circumference for correct dasharray
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
                          itemStyle: {
                            color: gaugeColor
                          },
                          progress: {
                            show: true,
                            width: 10,
                            roundCap: true
                          },
                          axisLine: {
                            roundCap: true,
                            lineStyle: {
                              width: 10,
                              color: [[1, isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)']]
                            }
                          },
                          pointer: { show: false },
                          axisTick: { show: false },
                          splitLine: { show: false },
                          axisLabel: { show: false },
                          detail: { show: false },
                          data: [{ value: slaValue }]
                        }
                      ]
                    }}
                  />
                  <div className="dashboard-sla-gauge__label" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, marginTop: 0 }}>
                    <span className="dashboard-sla-gauge__value" style={{ color: gaugeColor }}>
                      {d.data.slaCompliancePercentage !== null ? d.data.slaCompliancePercentage.toFixed(1) + '%' : '—'}
                    </span>
                    <span className="dashboard-sla-gauge__sub">SLA (ответ до 5 мин)</span>
                  </div>
                </div>
              );
            })()}

            <div className="dashboard-legend">
              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-dot" style={{ background: 'var(--danger-bg)' }} />
                  <span className="dashboard-legend-label">Ответов с задержкой</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-count" style={{ color: d.data.slaViolationsCount > 0 ? 'var(--input-error-color)' : 'inherit' }}>
                    {d.numberFormatter.format(d.data.slaViolationsCount)}
                  </span>
                </div>
              </div>

              <div className="dashboard-legend-divider" />

              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">Повторные обращения</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.recurringRequestsCount)}</span>
                </div>
              </div>
              <div className="dashboard-legend-row">
                <div className="dashboard-legend-left">
                  <span className="dashboard-legend-label">Доля повторных</span>
                </div>
                <div className="dashboard-legend-right">
                  <span className="dashboard-legend-count">
                    {d.data.recurringRequestsPercentage !== null ? d.data.recurringRequestsPercentage.toFixed(1) + '%' : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: ratings */}
      <div className="dashboard-overview-row">
        {renderRatingCard(
          'Удовлетворенность (CSAT)',
          d.data.csatAverage,
          d.data.csatCount,
          d.data.csatDistribution,
          'Пока нет оценок операторов.',
        )}
        {renderRatingCard(
          'Оценка работы AI',
          d.data.aiCsatAverage,
          d.data.aiCsatCount,
          d.data.aiCsatDistribution,
          'Пока нет оценок AI.',
        )}
      </div>
    </>
  );
};

export default DashboardOverviewTab;
