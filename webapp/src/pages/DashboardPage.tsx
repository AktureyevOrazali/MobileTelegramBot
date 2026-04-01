import React from 'react';
import * as echarts from 'echarts';
import EChartsWrapper from '../components/EChartsWrapper';
import { ApiClient } from '../api/ApiClient';
import { useIsDarkTheme } from '../components/RegionActivityMap';
import {
  GEOJSON_FEATURES,
  SVG_ID_TO_REGION_KEY,
  detectRayonFromAddress,
  detectRegionFromAddress,
} from '../utils/kazakhstanGeo';
import { OBLAST_RAYONS } from '../data/kzMapData';
import { BinDetailed, ChatSummary } from '../types';
import { formatDate, formatDateTime } from '../utils/date';
import { formatMinutes, parseQuestion, speedLabel } from '../utils/dashboard-helpers';
import SelectPill from '../components/SelectPill';
import DashboardContentState from '../components/dashboard/DashboardContentState';
import DashboardHero from '../components/dashboard/DashboardHero';
import DashboardOverviewTab from '../components/dashboard/DashboardOverviewTab';
import { OperatorMetricKey, useDashboardData } from '../hooks/useDashboardData';

interface DashboardPageProps {
  apiClient: ApiClient;
}

/* ── Color palettes ── */

const SECTION_COLORS_LIGHT = ['#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#3b82f6'];
const SECTION_COLORS_DARK = ['#818cf8', '#60a5fa', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#818cf8', '#60a5fa'];
const HEATMAP_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HEATMAP_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
const DashboardPage: React.FC<DashboardPageProps> = ({ apiClient }) => {
  const d = useDashboardData(apiClient);
  const isDark = useIsDarkTheme();
  const sectionColors = isDark ? SECTION_COLORS_DARK : SECTION_COLORS_LIGHT;
  const [topBinFilter, setTopBinFilter] = React.useState<'without_contract' | 'with_contract'>('without_contract');
  const [mapBins, setMapBins] = React.useState<BinDetailed[]>([]);
  const [mapChats, setMapChats] = React.useState<ChatSummary[]>([]);
  const [mapLoading, setMapLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setMapLoading(true);
    Promise.all([
      apiClient.getBinsDetailed().catch(() => [] as BinDetailed[]),
      apiClient.fetchChats().catch(() => [] as ChatSummary[]),
    ])
      .then(([bins, chats]) => {
        if (cancelled) return;
        setMapBins(bins);
        setMapChats(chats);
      })
      .finally(() => {
        if (!cancelled) setMapLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const dashboardRegionCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    GEOJSON_FEATURES.features.forEach((feature) => {
      if (feature.properties?.name) counts[feature.properties.name] = 0;
    });
    mapBins.forEach((detail) => {
      const regionKey = detectRegionFromAddress(detail.customerLegalAddress);
      if (regionKey && regionKey in counts) counts[regionKey] += 1;
    });
    return counts;
  }, [mapBins]);

  const dashboardMapMaxCount = React.useMemo(
    () => Math.max(1, ...Object.values(dashboardRegionCounts)),
    [dashboardRegionCounts],
  );

  const dashboardRayonCounts = React.useMemo(() => {
    const result: Record<string, Record<number, number>> = {};
    const regionKeyToSvgId: Record<string, string> = {};

    for (const svgId of Object.keys(SVG_ID_TO_REGION_KEY)) {
      regionKeyToSvgId[SVG_ID_TO_REGION_KEY[svgId]] = svgId;
    }

    mapBins.forEach((detail) => {
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
  }, [mapBins]);

  const lastUpdated = d.hasData ? formatDateTime(d.data.updatedAt) : '';

  return (
    <div className="dashboard-page dashboard-page--app-sidebar">
      <DashboardHero apiClient={apiClient} dashboard={d} lastUpdated={lastUpdated} />

      <div className="dashboard-content-shell">
        {/* Tab content */}
        <div className="dashboard-content">
          {!d.hasData ? (
            <DashboardContentState
              loading={d.loading}
              error={d.error}
              onRetry={() => d.loadData('initial', d.activeFilters)}
            />
          ) : (
            <>
              {d.dashboardTab === 'overview' && (
                <DashboardOverviewTab
                  dashboard={d}
                  dashboardMapMaxCount={dashboardMapMaxCount}
                  dashboardRayonCounts={dashboardRayonCounts}
                  dashboardRegionCounts={dashboardRegionCounts}
                  isDark={isDark}
                  mapBins={mapBins}
                  mapChats={mapChats}
                  mapLoading={mapLoading}
                />
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
                          backgroundColor: isDark ? '#182538' : '#ffffff',
                          borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                          borderWidth: 1,
                          textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
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
                          axisLabel: { fontSize: 12, color: isDark ? '#edf3fb' : '#1d2940', margin: 12 },
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
                              color: 'var(--text-color)'
                            },
                            itemStyle: {
                              borderRadius: [0, 6, 6, 0],
                              color: (params: any) => {
                                if (params.dataIndex === 0) return isDark ? '#818cf8' : '#6366f1';
                                if (params.dataIndex < 3) return isDark ? '#60a5fa' : '#3b82f6';
                                return isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)';
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
                                            itemStyle: { color: isDark ? '#818cf8' : '#6366f1', borderRadius: 4 },
                                            showBackground: true,
                                            backgroundStyle: { color: isDark ? '#1e2d44' : '#f6faff', borderRadius: 4 }
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
                              backgroundColor: isDark ? '#182538' : '#ffffff',
                              borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                              borderWidth: 1,
                              textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
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
                                  color: isDark ? '#edf3fb' : '#1d2940'
                                },
                                labelLine: {
                                  show: true,
                                  length: 10,
                                  length2: 10,
                                  lineStyle: { color: isDark ? '#91a1b8' : '#72829a' }
                                },
                                data: d.data.sectionBreakdown.map((s, idx) => ({
                                  name: s.title.length > 20 ? s.title.slice(0, 18) + '…' : s.title,
                                  value: s.dialogs,
                                  itemStyle: { color: sectionColors[idx % sectionColors.length] }
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
                            <span className="dashboard-legend-dot" style={{ background: sectionColors[idx % sectionColors.length] }} />
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
                            backgroundColor: isDark ? '#182538' : '#ffffff',
                            borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                            borderWidth: 1,
                            textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
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
                            axisLabel: { fontSize: 11, color: isDark ? '#edf3fb' : '#1d2940', margin: 12 },
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
                                color: isDark ? '#edf3fb' : '#1d2940'
                              },
                              itemStyle: {
                                borderRadius: [0, 6, 6, 0],
                                color: (params: any) => {
                                  if (params.dataIndex === 0) return isDark ? '#818cf8' : '#6366f1';
                                  if (params.dataIndex < 3) return isDark ? '#60a5fa' : '#3b82f6';
                                  return isDark ? '#22d3ee' : '#06b6d4';
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
                            textStyle: { fontSize: 13, color: isDark ? '#edf3fb' : '#1d2940' }
                          },
                          grid: { top: 10, right: 20, bottom: 40, left: 10, containLabel: true },
                          xAxis: {
                            type: 'category',
                            boundaryGap: false,
                            axisLine: { show: false },
                            axisTick: { show: false },
                            axisLabel: { color: isDark ? '#91a1b8' : '#72829a', fontSize: 12 }
                          },
                          yAxis: {
                            type: 'value',
                            axisLine: { show: false },
                            axisTick: { show: false },
                            splitLine: { show: false },
                            axisLabel: { color: isDark ? '#91a1b8' : '#72829a', fontSize: 12 },
                            minInterval: 1 // allowDecimals={false} equivalent
                          },
                          color: [isDark ? '#60a5fa' : '#3b82f6', isDark ? '#34d399' : '#10b981'],
                          series: [
                            {
                              type: 'line',
                              name: 'dialogs',
                              smooth: true,
                              symbol: 'circle',
                              symbolSize: 8,
                              showSymbol: false,
                              lineStyle: { width: 2.5 },
                              itemStyle: { color: isDark ? '#60a5fa' : '#3b82f6', borderColor: isDark ? '#182538' : '#ffffff', borderWidth: 2 },
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
                              itemStyle: { color: isDark ? '#34d399' : '#10b981', borderColor: isDark ? '#182538' : '#ffffff', borderWidth: 2 },
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
                            backgroundColor: isDark ? '#182538' : '#ffffff',
                            borderColor: isDark ? 'rgba(137, 152, 176, 0.18)' : 'rgba(137, 152, 176, 0.22)',
                            borderWidth: 1,
                            textStyle: { color: isDark ? '#edf3fb' : '#1d2940', fontSize: 12 },
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
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1, color: isDark ? '#edf3fb' : '#1d2940' }}>
                          {d.data.requestsWithContract + d.data.requestsWithoutContract > 0 ? ((d.data.requestsWithContract / (d.data.requestsWithContract + d.data.requestsWithoutContract)) * 100).toFixed(0) + '%' : '—'}
                        </span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginTop: 2 }}>
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
                              backgroundColor: 'var(--surface-color)',
                              borderColor: 'var(--border-color)',
                              borderWidth: 1,
                              textStyle: { color: 'var(--text-color)', fontSize: 12 },
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
                              axisLabel: { fontSize: 11, fontFamily: 'monospace', color: 'var(--text-color)', margin: 12 },
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
                                  color: 'var(--text-color)'
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


