import React from 'react';
import { ApiClient } from '../api/ApiClient';
import { formatDate, formatDateTime } from '../utils/date';
import { formatMinutes, getInitials, parseQuestion, speedLabel, toInputDate } from '../utils/dashboard-helpers';
import SelectPill from '../components/SelectPill';
import { DashboardTab, OperatorMetricKey, TimePreset, useDashboardData } from '../hooks/useDashboardData';

interface DashboardPageProps {
  apiClient: ApiClient;
}

const DashboardPage: React.FC<DashboardPageProps> = ({ apiClient }) => {
  const d = useDashboardData(apiClient);

  const lastUpdated = d.hasData ? formatDateTime(d.data.updatedAt) : '';

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
        {/* ── Overview tab ── */}
        {d.dashboardTab === 'overview' && (
          <div className="dashboard-overview-row">
            <div className="dashboard-card">
              <div className="dashboard-speed__header">
                <h3 className="dashboard-card__title">Скорость ответа</h3>
                <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                  {d.activeOperatorId === null
                    ? `${d.numberFormatter.format(d.totalOperators)} оператор${d.totalOperators === 1 ? '' : d.totalOperators < 5 ? 'а' : 'ов'}`
                    : d.selectedOperatorLabel}
                </span>
              </div>

              <div className="dashboard-speed__body">
                <div>
                  <svg viewBox="0 0 120 120" className="dashboard-donut" role="img" aria-label="Скорость ответа операторов">
                    <circle className="dashboard-donut__track" cx="60" cy="60" r={d.donutMulti.radius} />
                    {d.donutMulti.arcs.map((seg) => (
                      <circle
                        key={seg.key}
                        className={`dashboard-donut__segment dashboard-donut__segment--${seg.key}`}
                        cx="60"
                        cy="60"
                        r={d.donutMulti.radius}
                        strokeDasharray={seg.dashArray}
                        strokeDashoffset={seg.dashOffset}
                      >
                        <title>
                          {speedLabel(seg.key)}: {seg.count} ({seg.percentage.toFixed(1)}%), ср. {formatMinutes(seg.avgMinutes)}
                        </title>
                      </circle>
                    ))}
                    <text x="60" y="58" textAnchor="middle" className="dashboard-donut__center-value">
                      {d.numberFormatter.format(d.responseSegments.reduce((sum, seg) => sum + seg.count, 0))}
                    </text>
                    <text x="60" y="75" textAnchor="middle" className="dashboard-donut__center-sub">
                      {d.activeOperatorId === null ? 'операторов' : 'диалогов'}
                    </text>
                  </svg>
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
                      <span className="dashboard-legend-label">Среднее время ответа</span>
                    </div>
                    <div className="dashboard-legend-right">
                      <span className="dashboard-legend-meta">{d.avgResponseTimeLabel}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dashboard-card dashboard-card--delay-1">
              <h3 className="dashboard-card__title">Диалоги</h3>

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
                  <span className="dashboard-kv__key">Сообщений/день</span>
                  <span className="dashboard-kv__val">{d.numberFormatter.format(d.messagesPerDay)}</span>
                </div>
              </div>

              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                Период: {d.timeRange.label}
              </div>
            </div>
          </div>
        )}

        {/* ── Operators tab ── */}
        {d.dashboardTab === 'operators' && (
          <div className="dashboard-columns">
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
                <ul className="dashboard-top-list">
                  {d.topOperators.map((agent) => {
                    const normalizedName = agent.name.trim().toLowerCase();
                    const meta = d.operatorMetaByName.get(normalizedName);
                    const metricValue = d.activeMetricConfig.getValue(agent);
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
                            {metricValue === null ? '—' : d.activeMetricConfig.format(metricValue)}
                          </div>
                          <div className="dashboard-top-item__label">{d.activeMetricConfig.label}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={`dashboard-card dashboard-card--delay-1 ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
              <h3 className="dashboard-card__title">Дэшборд сотрудников</h3>
              {d.agentStats.length === 0 ? (
                <div className="dashboard-empty">
                  <div className="dashboard-empty__icon">📋</div>
                  <p className="dashboard-empty__text">Пока нет активности сотрудников.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="dashboard-table">
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
                      {d.agentStats.map((agent) => (
                        <tr key={agent.name}>
                          <td>{agent.name}</td>
                          <td>{d.numberFormatter.format(agent.dialogs)}</td>
                          <td>{d.numberFormatter.format(agent.messages)}</td>
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

        {/* ── Sections tab ── */}
        {d.dashboardTab === 'sections' && (
          <div className="dashboard-columns">
            <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
              <h3 className="dashboard-card__title">Обращения по разделам</h3>
              {d.data.sectionBreakdown.length === 0 ? (
                <div className="dashboard-empty">
                  <div className="dashboard-empty__icon">📂</div>
                  <p className="dashboard-empty__text">Данных пока нет.</p>
                </div>
              ) : (
                <ul className="section-progress-list">
                  {d.data.sectionBreakdown.map((section) => (
                    <li key={section.section ?? section.title} className="section-progress-item">
                      <div className="section-progress-item__header">
                        <span>{section.title}</span>
                        <span className="text-muted">
                          {d.numberFormatter.format(section.dialogs)} · {section.percentage.toFixed(1)}%
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
                <ol className="question-list">
                  {d.selectedQuestions.map((item, index) => {
                    const { text, badge } = parseQuestion(item.question);
                    return (
                      <li key={`${item.question}-${index}`} className="question-list__item">
                        <span>
                          {badge && <span className="question-badge">{badge}</span>}
                          {text}
                        </span>
                        <span className="question-list__count">{d.numberFormatter.format(item.count)}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* ── Activity tab ── */}
        {d.dashboardTab === 'activity' && (
          <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
            <h3 className="dashboard-card__title">Активность · {d.timeRange.label}</h3>
            {d.recentWeek.length === 0 ? (
              <div className="dashboard-empty">
                <div className="dashboard-empty__icon">📈</div>
                <p className="dashboard-empty__text">Нет данных о новых диалогах.</p>
              </div>
            ) : (
              (() => {
                const sorted = [...d.recentWeek].sort((a, b) => a.date.localeCompare(b.date));
                const maxVal = Math.max(1, ...sorted.map((r) => Math.max(r.dialogs, r.incomingMessages)));
                const W = 600;
                const H = 220;
                const padL = 40;
                const padR = 16;
                const padT = 16;
                const padB = 32;
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                const stepX = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW / 2;

                const toX = (i: number) => padL + (sorted.length > 1 ? i * stepX : plotW / 2);
                const toY = (v: number) => padT + plotH - (v / maxVal) * plotH;

                const dialogsPath = sorted.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(r.dialogs)}`).join(' ');
                const messagesPath = sorted.map((r, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(r.incomingMessages)}`).join(' ');

                const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxVal * (4 - i)) / 4));

                return (
                  <div className="dashboard-chart-wrap">
                    <div className="dashboard-chart-legend">
                      <span className="dashboard-chart-legend__item">
                        <span className="dashboard-chart-legend__dot" style={{ background: '#5a7ab8' }} />
                        Новых диалогов
                      </span>
                      <span className="dashboard-chart-legend__item">
                        <span className="dashboard-chart-legend__dot" style={{ background: '#22c55e' }} />
                        Входящих сообщений
                      </span>
                    </div>

                    <svg viewBox={`0 0 ${W} ${H}`} className="dashboard-line-chart" preserveAspectRatio="xMidYMid meet">
                      {yTicks.map((tick, i) => {
                        const y = toY(tick);
                        return (
                          <g key={`y${i}`}>
                            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4 3" />
                            <text x={padL - 6} y={y + 4} textAnchor="end" className="dashboard-chart__label">{tick}</text>
                          </g>
                        );
                      })}

                      {sorted.map((r, i) => (
                        <text key={`x${i}`} x={toX(i)} y={H - 6} textAnchor="middle" className="dashboard-chart__label">
                          {r.date.slice(5).replace('-', '.')}
                        </text>
                      ))}

                      <path d={dialogsPath} fill="none" stroke="#5a7ab8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d={messagesPath} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                      {sorted.map((r, i) => (
                        <g key={`d${i}`}>
                          <circle cx={toX(i)} cy={toY(r.dialogs)} r="4" fill="#5a7ab8" stroke="#fff" strokeWidth="2" className="dashboard-chart__dot">
                            <title>{formatDate(r.date)}: {r.dialogs} диалогов</title>
                          </circle>
                          <circle cx={toX(i)} cy={toY(r.incomingMessages)} r="4" fill="#22c55e" stroke="#fff" strokeWidth="2" className="dashboard-chart__dot">
                            <title>{formatDate(r.date)}: {r.incomingMessages} входящих</title>
                          </circle>
                        </g>
                      ))}
                    </svg>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {!d.hasData && (
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
