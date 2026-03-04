import React from 'react';
import * as echarts from 'echarts';
import EChartsWrapper from '../components/EChartsWrapper';
import { ApiClient } from '../api/ApiClient';
import { formatDate, formatDateTime } from '../utils/date';
import { formatMinutes, getInitials, parseQuestion, speedLabel, toInputDate } from '../utils/dashboard-helpers';
import SelectPill from '../components/SelectPill';
import { DashboardTab, OperatorMetricKey, TimePreset, useDashboardData } from '../hooks/useDashboardData';

interface DashboardPageProps {
  apiClient: ApiClient;
}

/* ── Color palettes ── */

const SECTION_COLORS = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const HEATMAP_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HEATMAP_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

const ExportButton: React.FC<{
  apiClient: ApiClient;
  filters: { operatorId?: number | null; startDate?: string | null; endDate?: string | null };
}> = ({ apiClient, filters }) => {
  const [exporting, setExporting] = React.useState<'xlsx' | 'pdf' | null>(null);

  const handleExport = async (fmt: 'xlsx' | 'pdf') => {
    setExporting(fmt);
    try {
      await apiClient.downloadDashboardExport({
        operatorId: filters.operatorId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        format: fmt,
      });
    } catch {
      alert('Не удалось скачать отчёт.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <button
        className="dashboard-hero__refresh"
        type="button"
        onClick={() => handleExport('xlsx')}
        disabled={exporting !== null}
      >
        {exporting === 'xlsx' ? '⏳…' : '📥 Excel'}
      </button>
      <button
        className="dashboard-hero__refresh"
        type="button"
        onClick={() => handleExport('pdf')}
        disabled={exporting !== null}
      >
        {exporting === 'pdf' ? '⏳…' : '📄 PDF'}
      </button>
    </>
  );
};

const DashboardPage: React.FC<DashboardPageProps> = ({ apiClient }) => {
  const d = useDashboardData(apiClient);
  const [topBinFilter, setTopBinFilter] = React.useState<'without_contract' | 'with_contract'>('without_contract');

  const lastUpdated = d.hasData ? formatDateTime(d.data.updatedAt) : '';

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
          <div className="dashboard-empty" style={{ minHeight: 160 }}>
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
                    backgroundColor: 'var(--surface-color, #ffffff)',
                    borderColor: 'var(--border-color, #e2e8f0)',
                    borderWidth: 1,
                    textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                    formatter: '{b} ★: <b>{c}</b>',
                  },
                  grid: { top: 8, right: 8, bottom: 4, left: 8, containLabel: true },
                  xAxis: {
                    type: 'category',
                    data: ['1', '2', '3', '4', '5'],
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { fontSize: 13, color: 'var(--text-color, #334155)', margin: 12 },
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
                          if (rating <= 2) return '#ef4444';
                          if (rating === 3) return '#f59e0b';
                          return '#22c55e';
                        },
                      },
                       label: {
                         show: true,
                         position: 'top',
                         color: 'var(--text-muted, #64748b)',
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
    <div className="dashboard-page">
      {/* ── Gradient hero header ── */}
      <div className={`dashboard-hero ${d.isLoading ? 'dashboard-hero--loading' : ''}`}>
        <div className="dashboard-hero__top">
          <div>
            <h2 className="dashboard-hero__title">Статистика</h2>
            <p className="dashboard-hero__sub">
              {d.selectedOperatorLabel} · {d.timeRange.label}{lastUpdated ? ` · ${lastUpdated}` : ''}
            </p>
          </div>

          <div className="dashboard-hero__controls">
            <SelectPill
              label=""
              options={d.periodOptions}
              value={d.effectiveTimePreset}
              onChange={(value) => {
                const next = (value as TimePreset) || 'last7';
                if (next === 'custom') {
                  d.setCustomRange((prev) => ({
                    start: prev.start || d.timeRange.startDate || '',
                    end: prev.end || d.timeRange.endDate || '',
                  }));
                  d.setTimePreset('custom');
                  return;
                }
                d.setTimePreset(next);
              }}
              showLabelInside={false}
            />

            <SelectPill
              label={d.operatorsLoading ? 'Загрузка…' : ''}
              options={d.operatorOptions}
              value={d.operatorSelectValue}
              onChange={(value) => {
                const nextValue = value === 'all' ? null : Number(value);
                d.setSelectedOperatorId((prev) => (prev === nextValue ? prev : nextValue));
              }}
              searchable
              showLabelInside={false}
              disabled={d.dashboardTab === 'operators'}
            />

            <button
              className="dashboard-hero__refresh"
              type="button"
              onClick={() => d.loadData('refresh', d.activeFilters)}
              disabled={d.refreshing}
            >
              {d.refreshing ? 'Обновляем…' : '↻ Пересчитать'}
            </button>
            <ExportButton apiClient={apiClient} filters={d.activeFilters} />
          </div>
        </div>

        {(d.operatorsError || d.error) && (
          <div className="dashboard-hero__errors">
            {d.operatorsError && <span className="dashboard-hero__error">{d.operatorsError}</span>}
            {d.error && <span className="dashboard-hero__error">{d.error}</span>}
          </div>
        )}

        <div
          className="dashboard-date-row"
          style={{
            minHeight: 32,
            visibility: d.timePreset === 'custom' ? 'visible' : 'hidden',
            pointerEvents: d.timePreset === 'custom' ? 'auto' : 'none',
          }}
        >
          <input
            type="date"
            value={d.customRange.start}
            disabled={d.timePreset !== 'custom'}
            onChange={(event) => {
              d.setCustomRange((prev) => ({ ...prev, start: event.target.value }));
              d.setTimePreset('custom');
            }}
          />
          <span className="text-muted">—</span>
          <input
            type="date"
            value={d.customRange.end}
            disabled={d.timePreset !== 'custom'}
            onChange={(event) => {
              d.setCustomRange((prev) => ({ ...prev, end: event.target.value }));
              d.setTimePreset('custom');
            }}
          />
        </div>

        <div className="dashboard-tabs">
          {[
            { key: 'overview', label: '📊 Обзор' },
            { key: 'operators', label: '👥 Сотрудники' },
            { key: 'sections', label: '📂 Разделы' },
            { key: 'activity', label: '📈 Активность' },
            { key: 'commercial', label: '💼 Аналитика' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`dashboard-tab ${d.dashboardTab === tab.key ? 'is-active' : ''}`}
              onClick={() => d.setDashboardTab(tab.key as DashboardTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="dashboard-content">
        {!d.hasData ? (
          d.loading ? (
            <div className="dashboard-loading-state">
              <div className="dashboard-loading-state__icon">⏳</div>
              <p>Загружаем данные…</p>
            </div>
          ) : d.error ? (
            <div className="dashboard-loading-state">
              <div className="dashboard-loading-state__icon">⚠️</div>
              <p>Ошибка: {d.error}</p>
              <button className="button" type="button" onClick={() => d.loadData('initial', d.activeFilters)}>
                Повторить попытку
              </button>
            </div>
          ) : (
            <div className="dashboard-loading-state">
              <div className="dashboard-loading-state__icon">📊</div>
              <p>Нет данных.</p>
              <button className="button" type="button" onClick={() => d.loadData('initial', d.activeFilters)}>
                Попробовать снова
              </button>
            </div>
          )
        ) : (
          <>
            {/* ══════════════════ Overview tab ══════════════════ */}
            {d.dashboardTab === 'overview' && (
              <>
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
                              backgroundColor: 'var(--surface-color, #ffffff)',
                              borderColor: 'var(--border-color, #e2e8f0)',
                              borderWidth: 1,
                              textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
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
                                    itemStyle: { color: seg.key === 'fast' ? '#22c55e' : seg.key === 'medium' ? '#f59e0b' : '#ef4444' }
                                  }))
                              }
                            ]
                          }}
                        />
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: 'var(--text-color, #1e293b)' }}>
                            {d.numberFormatter.format(d.responseSegments.reduce((sum, seg) => sum + seg.count, 0))}
                          </span>
                          <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>
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
                                  backgroundColor: 'var(--surface-color, #ffffff)',
                                  borderColor: 'var(--border-color, #e2e8f0)',
                                  borderWidth: 1,
                                  textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                                  formatter: (params: any) => {
                                    if (total === 0) return 'Нет данных';
                                    return params.map((p: any) => `${p.seriesName}: <b>${p.value}</b>`).join('<br/>');
                                  }
                                },
                                grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                xAxis: { type: 'value', show: false, max: total > 0 ? total : 1 },
                                yAxis: { type: 'category', data: ['AI'], show: false },
                                series: total === 0 ? [
                                  { type: 'bar', data: [1], barWidth: 14, itemStyle: { color: '#e2e8f0' }, animation: false }
                                ] : [
                                  {
                                    name: 'Решено ботом',
                                    type: 'bar',
                                    stack: 'total',
                                    data: [d.data.aiClosedDialogs],
                                    barWidth: 14,
                                    itemStyle: { color: '#3b82f6', borderRadius: [8, 0, 0, 8] }
                                  },
                                  {
                                    name: 'Переведено оператору',
                                    type: 'bar',
                                    stack: 'total',
                                    data: [d.data.transferredToOperatorDialogs],
                                    barWidth: 14,
                                    itemStyle: { color: '#cbd5e1', borderRadius: [0, 8, 8, 0] }
                                  }
                                ]
                              }}
                            />
                          </div>

                          <div className="dashboard-legend" style={{ marginTop: 12 }}>
                            <div className="dashboard-legend-row">
                              <div className="dashboard-legend-left">
                                <span className="dashboard-legend-dot" style={{ background: '#3b82f6' }} />
                                <span className="dashboard-legend-label">Решено ботом</span>
                              </div>
                              <div className="dashboard-legend-right">
                                <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.aiClosedDialogs)}</span>
                              </div>
                            </div>
                            <div className="dashboard-legend-row">
                              <div className="dashboard-legend-left">
                                <span className="dashboard-legend-dot" style={{ background: '#cbd5e1' }} />
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
                        const gaugeColor = slaValue >= 80 ? '#22c55e' : '#ef4444';
                        // SVG semicircle: radius 48, using full circumference for correct dasharray
                        const radius = 48;
                        const fullCirc = Math.PI * 2 * radius;
                        const halfCirc = fullCirc / 2;
                        const filled = (slaValue / 100) * halfCirc;
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
                                        color: [[1, '#e2e8f0']]
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
                            <span className="dashboard-legend-dot" style={{ background: '#ef4444' }} />
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
            )}

            {/* ══════════════════ Operators tab ══════════════════ */}
            {d.dashboardTab === 'operators' && (
              <div className="dashboard-columns">
                {/* ── TOP-10 horizontal bar chart ── */}
                <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <div className="dashboard-card__header">
                    <h3 className="dashboard-card__title">TOP-10</h3>
                    <SelectPill
                      label=""
                      options={d.metricOptions}
                      value={d.topMetric}
                      onChange={(value) => d.setTopMetric((value as OperatorMetricKey) || 'avgResponse')}
                      showLabelInside={false}
                      style={{ minWidth: 220 }}
                    />
                  </div>

                  {d.topOperators.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">👥</div>
                      <p className="dashboard-empty__text">Нет данных по сотрудникам.</p>
                    </div>
                  ) : (
                    <EChartsWrapper
                      option={{
                        tooltip: {
                          trigger: 'axis',
                          axisPointer: { type: 'none' },
                          backgroundColor: 'var(--surface-color, #ffffff)',
                          borderColor: 'var(--border-color, #e2e8f0)',
                          borderWidth: 1,
                          textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                          formatter: (params: any) => {
                            const data = params[0].data;
                            return `${params[0].name}<br/>${d.activeMetricConfig.label}: <b>${data.formattedLabel}</b>`;
                          }
                        },
                        grid: { top: 4, right: 60, bottom: 4, left: 8, containLabel: true },
                        xAxis: { type: 'value', show: false },
                        yAxis: {
                          type: 'category',
                          data: d.topOperators.map(a => a.name || 'Без имени'),
                          axisLine: { show: false },
                          axisTick: { show: false },
                          axisLabel: { fontSize: 12, color: 'var(--text-color, #334155)', margin: 12 },
                          inverse: true
                        },
                        series: [
                          {
                            type: 'bar',
                            barWidth: 22,
                            label: {
                              show: true,
                              position: 'right',
                              formatter: (params: any) => params.data.formattedLabel,
                              fontSize: 12,
                              fontWeight: 'bold',
                              color: 'var(--text-color, #334155)'
                            },
                            itemStyle: {
                              borderRadius: [0, 6, 6, 0],
                              color: (params: any) => {
                                if (params.dataIndex === 0) return '#6366f1';
                                if (params.dataIndex < 3) return '#818cf8';
                                return '#c7d2fe';
                              }
                            },
                            data: d.topOperators.map(agent => {
                              const raw = d.activeMetricConfig.getValue(agent);
                              return {
                                value: raw ?? 0,
                                formattedLabel: raw === null ? '—' : d.activeMetricConfig.format(raw),
                              };
                            })
                          }
                        ]
                      }}
                    />
                  )}
                </div>

                {/* ── Employee table (deduplicated: removed "Ответ" column) ── */}
                <div className={`dashboard-card dashboard-card--delay-1 ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Дэшборд сотрудников</h3>
                  {d.agentStats.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">📋</div>
                      <p className="dashboard-empty__text">Пока нет активности сотрудников.</p>
                    </div>
                  ) : (() => {
                    const maxDialogs = Math.max(1, ...d.agentStats.map((a) => a.dialogs));
                    return (
                      <div className="table-scroll">
                        <table className="dashboard-table">
                          <thead>
                            <tr>
                              <th>Сотрудник</th>
                              <th>Обращ.</th>
                              <th style={{ minWidth: 80 }}>Нагрузка</th>
                              <th>Сообщ.</th>
                              <th>Сообщ./обр.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.agentStats.map((agent) => (
                              <tr key={agent.name}>
                                <td>{agent.name}</td>
                                <td>{d.numberFormatter.format(agent.dialogs)}</td>
                                <td>
                                  <div style={{ height: 12, width: '100%' }}>
                                    <EChartsWrapper
                                      option={{
                                        grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                        xAxis: { type: 'value', show: false, max: maxDialogs },
                                        yAxis: { type: 'category', data: [''], show: false },
                                        series: [
                                          {
                                            type: 'bar',
                                            data: [agent.dialogs],
                                            barWidth: '100%',
                                            itemStyle: { color: '#6366f1', borderRadius: 4 },
                                            showBackground: true,
                                            backgroundStyle: { color: '#e2e8f0', borderRadius: 4 }
                                          }
                                        ],
                                        tooltip: { show: false }
                                      }}
                                    />
                                  </div>
                                </td>
                                <td>{d.numberFormatter.format(agent.messages)}</td>
                                <td>{agent.avgMessagesPerDialog.toFixed(1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ══════════════════ Sections tab ══════════════════ */}
            {d.dashboardTab === 'sections' && (
              <div className="dashboard-columns">
                {/* ── Section breakdown pie chart ── */}
                <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Обращения по разделам</h3>
                  {d.data.sectionBreakdown.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">📂</div>
                      <p className="dashboard-empty__text">Данных пока нет.</p>
                    </div>
                  ) : (
                    <>
                      <div style={{ width: '100%', height: 260 }}>
                        <EChartsWrapper
                          option={{
                            tooltip: {
                              trigger: 'item',
                              backgroundColor: 'var(--surface-color, #ffffff)',
                              borderColor: 'var(--border-color, #e2e8f0)',
                              borderWidth: 1,
                              textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                              formatter: '{b}: <b>{c}</b> ({d}%)'
                            },
                            series: [
                              {
                                type: 'pie',
                                radius: ['60%', '80%'],
                                center: ['50%', '50%'],
                                itemStyle: {
                                  borderRadius: 5,
                                  borderColor: 'transparent',
                                  borderWidth: 2
                                },
                                label: {
                                  show: true,
                                  formatter: '{d}%',
                                  fontWeight: 'bold',
                                  fontSize: 11,
                                  color: 'var(--text-color, #334155)'
                                },
                                labelLine: {
                                  show: true,
                                  length: 10,
                                  length2: 10,
                                  lineStyle: { color: 'var(--text-muted, #94a3b8)' }
                                },
                                data: d.data.sectionBreakdown.map((s, idx) => ({
                                  name: s.title.length > 20 ? s.title.slice(0, 18) + '…' : s.title,
                                  value: s.dialogs,
                                  itemStyle: { color: SECTION_COLORS[idx % SECTION_COLORS.length] }
                                }))
                              }
                            ]
                          }}
                        />
                      </div>
                      {/* Color legend */}
                      <div className="dashboard-section-legend">
                        {d.data.sectionBreakdown.map((section, idx) => (
                          <div key={section.section ?? section.title} className="dashboard-section-legend__item">
                            <span className="dashboard-legend-dot" style={{ background: SECTION_COLORS[idx % SECTION_COLORS.length] }} />
                            <span>{section.title}</span>
                            <span className="text-muted" style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{d.numberFormatter.format(section.dialogs)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* ── Frequent questions bar chart ── */}
                <div className={`dashboard-card dashboard-card--delay-1 ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <div className="dashboard-card__header">
                    <h3 className="dashboard-card__title">Частые вопросы</h3>
                    <SelectPill
                      label=""
                      options={d.questionSectionOptions}
                      value={d.selectedQuestionSection}
                      onChange={(value) => d.setSelectedQuestionSection(value || 'all')}
                      showLabelInside={false}
                      style={{ minWidth: 220 }}
                    />
                  </div>

                  {d.selectedQuestions.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">❓</div>
                      <p className="dashboard-empty__text">Нет популярных вопросов.</p>
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: Math.max(120, d.selectedQuestions.length * 36) }}>
                      <EChartsWrapper
                        option={{
                          tooltip: {
                            trigger: 'axis',
                            axisPointer: { type: 'none' },
                            backgroundColor: 'var(--surface-color, #ffffff)',
                            borderColor: 'var(--border-color, #e2e8f0)',
                            borderWidth: 1,
                            textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                            formatter: (params: any) => {
                              const data = params[0].data;
                              return `${data.fullName}<br/>Обращений: <b>${params[0].value}</b>`;
                            }
                          },
                          grid: { top: 4, right: 50, bottom: 4, left: 8, containLabel: true },
                          xAxis: { type: 'value', show: false },
                          yAxis: {
                            type: 'category',
                            data: d.selectedQuestions.map(item => {
                              const { text, badge } = parseQuestion(item.question);
                              return (badge ? `[${badge}] ` : '') + (text.length > 30 ? text.slice(0, 28) + '…' : text);
                            }),
                            axisLine: { show: false },
                            axisTick: { show: false },
                            axisLabel: { fontSize: 11, color: 'var(--text-color, #334155)', margin: 12 },
                            inverse: true
                          },
                          series: [
                            {
                              type: 'bar',
                              barWidth: 18,
                              label: {
                                show: true,
                                position: 'right',
                                formatter: '{c}',
                                fontSize: 11,
                                fontWeight: 'bold',
                                color: 'var(--text-color, #334155)'
                              },
                              itemStyle: {
                                borderRadius: [0, 6, 6, 0],
                                color: (params: any) => {
                                  if (params.dataIndex === 0) return '#6366f1';
                                  if (params.dataIndex < 3) return '#818cf8';
                                  return '#a5b4fc';
                                }
                              },
                              data: d.selectedQuestions.map(item => {
                                const { text, badge } = parseQuestion(item.question);
                                return {
                                  value: item.count,
                                  fullName: (badge ? `[${badge}] ` : '') + text
                                };
                              })
                            }
                          ]
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ══════════════════ Activity tab ══════════════════ */}
            {d.dashboardTab === 'activity' && (
              <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                <h3 className="dashboard-card__title">Активность · {d.timeRange.label}</h3>
                {d.recentWeek.length === 0 ? (
                  <div className="dashboard-empty">
                    <div className="dashboard-empty__icon">📈</div>
                    <p className="dashboard-empty__text">Нет данных о новых диалогах.</p>
                  </div>
                ) : (() => {
                  const sorted = [...d.recentWeek].sort((a, b) => a.date.localeCompare(b.date));
                  const chartData = sorted.map((r) => ({
                    date: r.date.slice(8) + '.' + r.date.slice(5, 7),
                    fullDate: formatDate(r.date),
                    dialogs: r.dialogs,
                    messages: r.incomingMessages,
                  }));

                  return (
                    <div style={{ width: '100%', height: 320 }}>
                      <EChartsWrapper
                        option={{
                          tooltip: {
                            trigger: 'axis',
                            formatter: (params: any) => {
                              const dateStr = params[0].data.fullDate;
                              let html = `${dateStr}<br/>`;
                              params.forEach((p: any) => {
                                const label = p.seriesName === 'dialogs' ? 'Новых обращений' : 'Входящих сообщений';
                                html += `<span style="color:${p.color}">${label}</span>: <b>${p.value[1]}</b><br/>`;
                              });
                              return html;
                            }
                          },
                          legend: {
                            data: ['dialogs', 'messages'],
                            formatter: (name: string) => name === 'dialogs' ? 'Новых обращений' : 'Входящих сообщений',
                            bottom: 0,
                            textStyle: { fontSize: 13, color: 'var(--text-color, #334155)' }
                          },
                          grid: { top: 10, right: 20, bottom: 40, left: 10, containLabel: true },
                          xAxis: {
                            type: 'category',
                            boundaryGap: false,
                            axisLine: { show: false },
                            axisTick: { show: false },
                            axisLabel: { color: 'var(--text-muted, #64748b)', fontSize: 12 }
                          },
                          yAxis: {
                            type: 'value',
                            axisLine: { show: false },
                            axisTick: { show: false },
                            splitLine: { show: false },
                            axisLabel: { color: 'var(--text-muted, #64748b)', fontSize: 12 },
                            minInterval: 1 // allowDecimals={false} equivalent
                          },
                          color: ['#5a7ab8', '#22c55e'],
                          series: [
                            {
                              type: 'line',
                              name: 'dialogs',
                              smooth: true,
                              symbol: 'circle',
                              symbolSize: 8,
                              showSymbol: false,
                              lineStyle: { width: 2.5 },
                              itemStyle: { color: '#5a7ab8', borderColor: '#fff', borderWidth: 2 },
                              areaStyle: {
                                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                  { offset: 0.05, color: 'rgba(90, 122, 184, 0.3)' },
                                  { offset: 0.95, color: 'rgba(90, 122, 184, 0)' }
                                ])
                              },
                              data: chartData.map(d => [d.date, d.dialogs, d.fullDate])
                            },
                            {
                              type: 'line',
                              name: 'messages',
                              smooth: true,
                              symbol: 'circle',
                              symbolSize: 8,
                              showSymbol: false,
                              lineStyle: { width: 2.5 },
                              itemStyle: { color: '#22c55e', borderColor: '#fff', borderWidth: 2 },
                              areaStyle: {
                                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                  { offset: 0.05, color: 'rgba(34, 197, 94, 0.3)' },
                                  { offset: 0.95, color: 'rgba(34, 197, 94, 0)' }
                                ])
                              },
                              data: chartData.map(d => [d.date, d.messages, d.fullDate])
                            }
                          ]
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ══════════════════ Commercial tab ══════════════════ */}
            {d.dashboardTab === 'commercial' && (
              <div className="dashboard-columns">
                <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Контракты и Лиды</h3>
                  <div className="dashboard-speed__body mt-3" style={{ marginBottom: '1.5rem' }}>
                    <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto' }}>
                      <EChartsWrapper
                        option={{
                          tooltip: {
                            trigger: 'item',
                            backgroundColor: 'var(--surface-color, #ffffff)',
                            borderColor: 'var(--border-color, #e2e8f0)',
                            borderWidth: 1,
                            textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                            formatter: '{b}: <b>{c}</b> ({d}%)'
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
                              data: d.data.requestsWithContract + d.data.requestsWithoutContract === 0 ?
                                [{ value: 1, name: 'empty', itemStyle: { color: '#e2e8f0' } }] :
                                [
                                  { value: d.data.requestsWithContract, name: 'С договором', itemStyle: { color: '#10b981' } },
                                  { value: d.data.requestsWithoutContract, name: 'Без договора', itemStyle: { color: '#f43f5e' } }
                                ].filter((s) => s.value > 0)
                            }
                          ]
                        }}
                      />
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: 'var(--text-color, #1e293b)' }}>
                          {d.data.requestsWithContract + d.data.requestsWithoutContract > 0 ? ((d.data.requestsWithContract / (d.data.requestsWithContract + d.data.requestsWithoutContract)) * 100).toFixed(0) + '%' : '—'}
                        </span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>
                          с договором
                        </span>
                      </div>
                    </div>

                    <div className="dashboard-legend">
                      <div className="dashboard-legend-row">
                        <div className="dashboard-legend-left">
                          <span className="dashboard-legend-dot" style={{ background: '#10b981' }} />
                          <span className="dashboard-legend-label">Обращений с договором</span>
                        </div>
                        <div className="dashboard-legend-right">
                          <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.requestsWithContract)}</span>
                        </div>
                      </div>
                      <div className="dashboard-legend-row">
                        <div className="dashboard-legend-left">
                          <span className="dashboard-legend-dot" style={{ background: '#f43f5e' }} />
                          <span className="dashboard-legend-label">Обращений <b>без</b> договора</span>
                        </div>
                        <div className="dashboard-legend-right">
                          <span className="dashboard-legend-count">{d.numberFormatter.format(d.data.requestsWithoutContract)}</span>
                        </div>
                      </div>

                      {d.data.averageFirstMessageLength !== null && (
                        <>
                          <div className="dashboard-legend-divider" />
                          <div className="dashboard-legend-row">
                            <div className="dashboard-legend-left">
                              <span className="dashboard-legend-label">Ср. длина 1-го сообщения</span>
                            </div>
                            <div className="dashboard-legend-right">
                              <span className="dashboard-legend-meta" style={{ color: 'var(--text-color)' }}>{Math.round(d.data.averageFirstMessageLength)} симв.</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── TOP-10 BIN horizontal bar chart ── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <h4 className="text-muted" style={{ fontSize: '0.85rem', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      ТОП-10 БИН
                    </h4>
                    <SelectPill
                      label=""
                      options={[
                        { value: 'without_contract', label: 'Без договора' },
                        { value: 'with_contract', label: 'С договором' },
                      ]}
                      value={topBinFilter}
                      onChange={(val) => setTopBinFilter(val as 'without_contract' | 'with_contract')}
                      showLabelInside={false}
                    />
                  </div>
                  {(() => {
                    const activeBins = topBinFilter === 'without_contract' ? d.data.topBinsWithoutContract : d.data.topBinsWithContract;
                    const chartColor = topBinFilter === 'without_contract' ? '#f43f5e' : '#10b981'; // red for without, green for with
                    const chartRgba = topBinFilter === 'without_contract' ? '225, 29, 72' : '16, 185, 129';

                    if (activeBins.length === 0) {
                      return (
                        <div className="dashboard-empty" style={{ paddingTop: '1rem', paddingBottom: '1rem' }}>
                          <p className="dashboard-empty__text" style={{ margin: 0 }}>Не найдено.</p>
                        </div>
                      );
                    }

                    return (
                      <div style={{ width: '100%', height: Math.max(140, activeBins.length * 32) }}>
                        <EChartsWrapper
                          option={{
                            tooltip: {
                              trigger: 'axis',
                              axisPointer: { type: 'none' },
                              backgroundColor: 'var(--surface-color, #ffffff)',
                              borderColor: 'var(--border-color, #e2e8f0)',
                              borderWidth: 1,
                              textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                              formatter: (params: any) => {
                                return `${params[0].name}<br/>Обращений: <b>${params[0].value}</b>`;
                              }
                            },
                            grid: { top: 0, right: 40, bottom: 0, left: 8, containLabel: true },
                            xAxis: { type: 'value', show: false },
                            yAxis: {
                              type: 'category',
                              data: activeBins.map(item => item.bin || 'Анонимно'),
                              axisLine: { show: false },
                              axisTick: { show: false },
                              axisLabel: { fontSize: 11, fontFamily: 'monospace', color: 'var(--text-color, #334155)', margin: 12 },
                              inverse: true
                            },
                            series: [
                              {
                                type: 'bar',
                                barWidth: 16,
                                label: {
                                  show: true,
                                  position: 'right',
                                  formatter: '{c}',
                                  fontSize: 11,
                                  fontWeight: 'bold',
                                  color: 'var(--text-color, #334155)'
                                },
                                itemStyle: {
                                  borderRadius: [0, 6, 6, 0],
                                  color: (params: any) => {
                                    const opacity = 1 - Math.min(params.dataIndex * 0.08, 0.7);
                                    return `rgba(${chartRgba}, ${opacity})`;
                                  }
                                },
                                data: activeBins.map(item => item.requests)
                              }
                            ]
                          }}
                        />
                      </div>
                    );
                  })()}
                </div>

                {/* ── Heatmap (improved with value labels & color legend) ── */}
                <div className={`dashboard-card dashboard-card--delay-1 flex-1 ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Пиковые нагрузки (Тепловая карта)</h3>
                  {d.data.peakLoadHeatmap.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">🔥</div>
                      <p className="dashboard-empty__text">Нет данных о потоке сообщений.</p>
                    </div>
                  ) : (() => {
                    const maxCount = Math.max(...d.data.peakLoadHeatmap.map(s => s.count), 1);
                    // Aggregate 2-hour blocks for finding the overall max
                    let maxCellCount = 1;
                    for (const dayIdx of [0, 1, 2, 3, 4, 5, 6]) {
                      for (const hour of HEATMAP_HOURS) {
                        let cellCount = 0;
                        for (let h = hour; h < hour + 2; h++) {
                          const item = d.data.peakLoadHeatmap.find(c => c.dayOfWeek === dayIdx && c.hour === h);
                          if (item) cellCount += item.count;
                        }
                        if (cellCount > maxCellCount) maxCellCount = cellCount;
                      }
                    }

                    return (
                      <>
                        <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'auto repeat(12, 1fr)', gap: '4px', fontSize: '11px', flex: 1 }}>
                          <div style={{ paddingRight: '12px', textAlign: 'right' }}></div>
                          {HEATMAP_HOURS.map((h) => (
                            <div key={h} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{h}</div>
                          ))}

                          {HEATMAP_DAYS.map((dayName, dayIdx) => (
                            <React.Fragment key={dayIdx}>
                              <div style={{ paddingRight: '12px', textAlign: 'right', fontWeight: 600, alignSelf: 'center', color: 'var(--text-muted)' }}>{dayName}</div>
                              {HEATMAP_HOURS.map((hour) => {
                                let cellCount = 0;
                                for (let h = hour; h < hour + 2; h++) {
                                  const item = d.data.peakLoadHeatmap.find(c => c.dayOfWeek === dayIdx && c.hour === h);
                                  if (item) cellCount += item.count;
                                }
                                const intensity = Math.min(cellCount / maxCellCount, 1);
                                const opacity = intensity > 0 ? 0.2 + (0.8 * intensity) : 0;

                                return (
                                  <div
                                    key={hour}
                                    className="heatmap-cell"
                                    style={{
                                      backgroundColor: cellCount > 0 ? `rgba(99, 102, 241, ${opacity})` : 'var(--surface-color)',
                                      color: intensity > 0.5 ? '#fff' : 'var(--text-muted)',
                                    }}
                                    title={cellCount > 0 ? `${cellCount} сообщ.` : ''}
                                  >
                                    {cellCount > 0 ? cellCount : ''}
                                  </div>
                                );
                              })}
                            </React.Fragment>
                          ))}
                        </div>

                        {/* Color legend */}
                        <div className="heatmap-legend">
                          <span className="text-muted" style={{ fontSize: '0.78rem' }}>Мало</span>
                          <div className="heatmap-legend__gradient" />
                          <span className="text-muted" style={{ fontSize: '0.78rem' }}>Много</span>
                        </div>

                        <div className="text-muted mt-3" style={{ fontSize: '0.82rem', textAlign: 'center' }}>
                          Указано местное время (UTC+5), группировка по 2 часа
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {d.operatorCount > 0 && (
        <div className="dashboard-footer">
          {d.numberFormatter.format(d.operatorCount)} сотрудников
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
