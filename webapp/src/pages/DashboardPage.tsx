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
            {/* ── Overview tab ── */}
            {d.dashboardTab === 'overview' && (
              <>
                {/* Row 1: Скорость ответа + Диалоги */}
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
                          <text x="60" y="56" textAnchor="middle" className="dashboard-donut__center-value">
                            {d.numberFormatter.format(d.responseSegments.reduce((sum, seg) => sum + seg.count, 0))}
                          </text>
                          <text x="60" y="72" textAnchor="middle" className="dashboard-donut__center-sub">
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
                            <span className="dashboard-legend-label">Ср. время ответа</span>
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
                  <div className="dashboard-card dashboard-card--delay-2">
                    <h3 className="dashboard-card__title">Автоматизация (AI)</h3>

                    <div className="dashboard-speed__body">
                      <div>
                        <svg viewBox="0 0 120 120" className="dashboard-donut" role="img" aria-label="Автоматизация (AI)">
                          <circle className="dashboard-donut__track" cx="60" cy="60" r={d.aiDonut.radius} />
                          {d.aiDonut.arcs.map((seg) => (
                            <circle
                              key={seg.key}
                              className={`dashboard-donut__segment dashboard-donut__segment--${seg.key}`}
                              cx="60"
                              cy="60"
                              r={d.aiDonut.radius}
                              strokeDasharray={seg.dashArray}
                              strokeDashoffset={seg.dashOffset}
                              stroke={seg.key === 'ai' ? '#3b82f6' : '#e2e8f0'}
                            >
                              <title>
                                {seg.key === 'ai' ? 'Решено ботом' : 'Переведено оператору'}: {seg.count} ({seg.percentage.toFixed(1)}%)
                              </title>
                            </circle>
                          ))}
                          <text x="60" y="56" textAnchor="middle" className="dashboard-donut__center-value">
                            {d.data.aiClosedDialogs + d.data.transferredToOperatorDialogs > 0 ? ((d.data.aiClosedDialogs / (d.data.aiClosedDialogs + d.data.transferredToOperatorDialogs)) * 100).toFixed(0) + '%' : '—'}
                          </text>
                          <text x="60" y="72" textAnchor="middle" className="dashboard-donut__center-sub">
                            ботом
                          </text>
                        </svg>
                      </div>

                      <div className="dashboard-legend">
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
                            <span className="dashboard-legend-dot" style={{ background: '#e2e8f0' }} />
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
                  </div>

                  <div className="dashboard-card dashboard-card--delay-3">
                    <h3 className="dashboard-card__title">Качество обслуживания</h3>
                    <div className="dashboard-kv">
                      <div className="dashboard-kv__row">
                        <span className="dashboard-kv__key">SLA (ответ до 5 мин)</span>
                        <span className="dashboard-kv__val" style={{ color: (d.data.slaCompliancePercentage || 0) < 80 ? 'var(--input-error-color)' : 'var(--success-color)' }}>
                          {d.data.slaCompliancePercentage !== null ? d.data.slaCompliancePercentage.toFixed(1) + '%' : '—'}
                        </span>
                      </div>
                      <div className="dashboard-kv__row">
                        <span className="dashboard-kv__key">Ответов с задержкой</span>
                        <span className="dashboard-kv__val" style={{ color: d.data.slaViolationsCount > 0 ? 'var(--input-error-color)' : 'inherit' }}>
                          {d.numberFormatter.format(d.data.slaViolationsCount)}
                        </span>
                      </div>

                      <div className="dashboard-kv__divider" />

                      <div className="dashboard-kv__row">
                        <span className="dashboard-kv__key">Повторные обращения</span>
                        <span className="dashboard-kv__val">{d.numberFormatter.format(d.data.recurringRequestsCount)}</span>
                      </div>
                      <div className="dashboard-kv__row">
                        <span className="dashboard-kv__key">Доля повторных</span>
                        <span className="dashboard-kv__val">
                          {d.data.recurringRequestsPercentage !== null ? d.data.recurringRequestsPercentage.toFixed(1) + '%' : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
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

                          {sorted.map((r, i) => {
                            const showLabel = sorted.length <= 10 || i % Math.ceil(sorted.length / 10) === 0 || i === sorted.length - 1;
                            if (!showLabel) return null;
                            return (
                              <text key={`x${i}`} x={toX(i)} y={H - 6} textAnchor="middle" className="dashboard-chart__label">
                                {r.date.slice(8) + '.' + r.date.slice(5, 7)}
                              </text>
                            );
                          })}

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
            {/* ── Commercial tab ── */}
            {d.dashboardTab === 'commercial' && (
              <div className="dashboard-columns">
                <div className={`dashboard-card ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Контракты и Лиды</h3>
                  <div className="dashboard-speed__body mt-3" style={{ marginBottom: '1.5rem' }}>
                    <div>
                      <svg viewBox="0 0 120 120" className="dashboard-donut" role="img" aria-label="Контракты">
                        <circle className="dashboard-donut__track" cx="60" cy="60" r={d.contractDonut.radius} />
                        {d.contractDonut.arcs.map((seg) => (
                          <circle
                            key={seg.key}
                            className={`dashboard-donut__segment dashboard-donut__segment--${seg.key}`}
                            cx="60"
                            cy="60"
                            r={d.contractDonut.radius}
                            strokeDasharray={seg.dashArray}
                            strokeDashoffset={seg.dashOffset}
                            stroke={seg.key === 'with_contract' ? '#10b981' : '#f43f5e'}
                          >
                            <title>
                              {seg.key === 'with_contract' ? 'С договором' : 'Без договора'}: {seg.count} ({seg.percentage.toFixed(1)}%)
                            </title>
                          </circle>
                        ))}
                        <text x="60" y="56" textAnchor="middle" className="dashboard-donut__center-value">
                          {d.data.requestsWithContract + d.data.requestsWithoutContract > 0 ? ((d.data.requestsWithContract / (d.data.requestsWithContract + d.data.requestsWithoutContract)) * 100).toFixed(0) + '%' : '—'}
                        </text>
                        <text x="60" y="72" textAnchor="middle" className="dashboard-donut__center-sub">
                          с договором
                        </text>
                      </svg>
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

                  <h4 className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    ТОП-10 БИН БЕЗ ДОГОВОРА
                  </h4>
                  {d.data.topBinsWithoutContract.length === 0 ? (
                    <div className="dashboard-empty" style={{ paddingTop: '1rem', paddingBottom: '1rem' }}>
                      <p className="dashboard-empty__text" style={{ margin: 0 }}>Не найдено.</p>
                    </div>
                  ) : (
                    <ul className="section-progress-list mt-3">
                      {d.data.topBinsWithoutContract.map((item, index) => {
                        const total = d.data.requestsWithoutContract || 1;
                        const percentage = (item.requests / total) * 100;
                        return (
                          <li key={item.bin || index} className="section-progress-item">
                            <div className="section-progress-item__header">
                              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.bin || 'Анонимно'}</span>
                              <span className="text-muted">
                                {d.numberFormatter.format(item.requests)}
                              </span>
                            </div>
                            <div className="progress-bar" aria-hidden="true" style={{ height: '4px', marginTop: '4px' }}>
                              <span
                                className="progress-bar__fill"
                                style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%`, backgroundColor: 'var(--input-error-color)' }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className={`dashboard-card dashboard-card--delay-1 flex-1 ${d.isLoading ? 'dashboard-card--loading' : ''}`}>
                  <h3 className="dashboard-card__title">Пиковые нагрузки (Тепловая карта)</h3>
                  {d.data.peakLoadHeatmap.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">🔥</div>
                      <p className="dashboard-empty__text">Нет данных о потоке сообщений.</p>
                    </div>
                  ) : (
                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'auto repeat(12, 1fr)', gap: '4px', fontSize: '11px', flex: 1 }}>
                      {/* This is a simple heatmap grid using HTML and CSS grids */}
                      <div style={{ paddingRight: '12px', textAlign: 'right' }}></div>
                      {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
                        <div key={h} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{h}</div>
                      ))}

                      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((dayObj, dayIdx) => {
                        const maxCount = Math.max(...d.data.peakLoadHeatmap.map(s => s.count), 1);
                        return (
                          <React.Fragment key={dayIdx}>
                            <div style={{ paddingRight: '12px', textAlign: 'right', fontWeight: 600, alignSelf: 'center', color: 'var(--text-muted)' }}>{dayObj}</div>
                            {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((hour) => {
                              // Aggregate counts for 2-hour blocks
                              let cellCount = 0;
                              for (let h = hour; h < hour + 2; h++) {
                                const item = d.data.peakLoadHeatmap.find(c => c.dayOfWeek === dayIdx && c.hour === h);
                                if (item) cellCount += item.count;
                              }
                              // Calculate opacity based on max value in 2-hour blocks
                              const intensity = Math.min(cellCount / maxCount, 1);
                              const opacity = intensity > 0 ? 0.2 + (0.8 * intensity) : 0;

                              return (
                                <div
                                  key={hour}
                                  style={{
                                    backgroundColor: cellCount > 0 ? `rgba(40, 167, 69, ${opacity})` : 'rgba(0,0,0,0.03)',
                                    height: '100%',
                                    minHeight: '36px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: cellCount > 0 ? 'help' : 'default',
                                  }}
                                  title={cellCount > 0 ? `${cellCount} сообщ.` : ''}
                                >
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                  {d.data.peakLoadHeatmap.length > 0 && (
                    <div className="text-muted mt-3" style={{ fontSize: '0.82rem', textAlign: 'center' }}>
                      Указано местное время (UTC+5), группировка по 2 часа
                    </div>
                  )}
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
