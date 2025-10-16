import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { DashboardSummary } from '../types';
import { formatDate, formatDateTime } from '../utils/date';

interface DashboardPageProps {
  apiClient: ApiClient;
}

type LoadMode = 'initial' | 'refresh';

const DashboardPage: React.FC<DashboardPageProps> = ({ apiClient }) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(
    async (mode: LoadMode = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const data = await apiClient.fetchDashboardSummary();
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
        if (mode === 'initial') {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [apiClient],
  );

  useEffect(() => {
    loadData('initial');
  }, [loadData]);

  const numberFormatter = useMemo(() => new Intl.NumberFormat('ru-RU'), []);

  if (loading && !summary) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="heading" style={{ marginBottom: 8 }}>Дэшборд обращений</h2>
        <p className="text-muted">Загружаем отчёт...</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="heading" style={{ marginBottom: 12 }}>Дэшборд обращений</h2>
        <p className="text-muted" style={{ marginBottom: 16 }}>{error ?? 'Нет данных для отображения.'}</p>
        <button className="button" type="button" onClick={() => loadData('initial')}>
          Попробовать снова
        </button>
      </div>
    );
  }

  const statCards = [
    { label: 'Всего обращений', value: summary.totalDialogs },
    { label: 'Открытые диалоги', value: summary.openDialogs },
    { label: 'Закрытые диалоги', value: summary.closedDialogs },
    { label: 'Активных чатов', value: summary.totalChats },
    { label: 'Входящих сообщений', value: summary.totalIncomingMessages },
    { label: 'Исходящих сообщений', value: summary.totalOutgoingMessages },
  ];

  const sectionTitleSet = useMemo(
    () =>
      new Set(
        summary.sectionBreakdown
          .map((item) => item.title.trim().toLowerCase())
          .filter((title) => title.length > 0),
      ),
    [summary.sectionBreakdown],
  );

  const topQuestions = useMemo(() => {
    const seen = new Set<string>();
    const filtered = summary.topQuestions.filter((item) => {
      const trimmed = item.question.trim();
      if (!trimmed) {
        return false;
      }
      const normalized = trimmed.toLowerCase();
      if (sectionTitleSet.has(normalized)) {
        return false;
      }
      if (/^\[[^\]]*команда[^\]]*\]/i.test(trimmed)) {
        return false;
      }
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
    return filtered.slice(0, 5);
  }, [sectionTitleSet, summary.topQuestions]);

  const questionsBySection = useMemo(
    () =>
      summary.questionsBySection
        .map((section) => ({
          ...section,
          totalCount: section.questions.reduce((acc, question) => acc + question.count, 0),
        }))
        .filter((section) => section.questions.length > 0)
        .sort((a, b) => b.totalCount - a.totalCount),
    [summary.questionsBySection],
  );

  const agentStats = useMemo(
    () =>
      summary.agentBreakdown
        .map((agent) => ({
          ...agent,
          avgMessagesPerDialog: Number.isFinite(agent.avgMessagesPerDialog)
            ? agent.avgMessagesPerDialog
            : 0,
        }))
        .sort((a, b) => b.messages - a.messages),
    [summary.agentBreakdown],
  );

  const avgMessagesValue = summary.averageMessagesPerDialog
    ? summary.averageMessagesPerDialog.toFixed(1)
    : '0.0';
  const avgDurationValue = summary.avgDialogDurationMinutes
    ? summary.avgDialogDurationMinutes.toFixed(1)
    : '—';

  const lastUpdated = formatDateTime(summary.updatedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginBottom: 48 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="dashboard-header">
          <div>
            <h2 className="heading" style={{ marginBottom: 6 }}>Дэшборд обращений</h2>
            <p className="text-muted" style={{ margin: 0 }}>
              Обновлено: {lastUpdated || '—'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {error && (
              <span className="badge" style={{ background: 'rgba(220, 53, 69, 0.12)', color: '#b42318' }}>
                {error}
              </span>
            )}
            <button
              className="button secondary"
              type="button"
              onClick={() => loadData('refresh')}
              disabled={refreshing}
            >
              {refreshing ? 'Обновляем…' : 'Обновить'}
            </button>
          </div>
        </div>

        <div className="dashboard-stat-grid">
          {statCards.map((stat) => (
            <div key={stat.label} className="stat-card">
              <span className="stat-card__label">{stat.label}</span>
              <span className="stat-card__value">{numberFormatter.format(stat.value)}</span>
            </div>
          ))}
        </div>

        <div className="dashboard-secondary-metrics">
          <div>
            <span className="stat-card__label">Среднее сообщений на диалог</span>
            <span className="stat-card__value">{avgMessagesValue}</span>
          </div>
          <div>
            <span className="stat-card__label">Средняя длительность, мин</span>
            <span className="stat-card__value">{avgDurationValue}</span>
          </div>
        </div>
      </div>

      <div className="dashboard-columns">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Обращения по разделам</h3>
          {summary.sectionBreakdown.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>Данных пока нет.</p>
          ) : (
            <ul className="section-progress-list">
              {summary.sectionBreakdown.map((section) => (
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Частые вопросы</h3>
          {topQuestions.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>Входящих вопросов пока недостаточно.</p>
          ) : (
            <ol className="question-list">
              {topQuestions.map((item, index) => {
                const raw = item.question.trim();
                const match = raw.match(/^\[(faq)\]\s*/i);
                const questionText = match ? raw.slice(match[0].length) : raw;
                const badge = match ? match[1].toUpperCase() : null;
                return (
                  <li key={`${item.question}-${index}`} className="question-list__item">
                    <span>
                      {badge && <span className="question-badge">{badge}</span>}
                      {questionText}
                    </span>
                    <span className="question-list__count">{numberFormatter.format(item.count)}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="questions-by-section">
            <div className="questions-by-section__header">
              <h4>По разделам</h4>
              <span className="text-muted">ТОП-5 для каждого</span>
            </div>
            {questionsBySection.length === 0 ? (
              <p className="text-muted" style={{ margin: 0 }}>Пока недостаточно данных по разделам.</p>
            ) : (
              <div className="questions-by-section__grid">
                {questionsBySection.map((section) => (
                  <div key={section.section ?? 'no-section'} className="questions-by-section__item">
                    <div className="questions-by-section__title">{section.title}</div>
                    <ul>
                      {section.questions.slice(0, 5).map((question) => (
                        <li key={`${section.title}-${question.question}`}>{question.question}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-columns">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Дэшборд сотрудников</h3>
          {agentStats.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>Пока нет активности сотрудников.</p>
          ) : (
            <table className="table table--compact">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Диалогов</th>
                  <th>Сообщений</th>
                  <th>Среднее сообщений</th>
                  <th>Последняя активность</th>
                </tr>
              </thead>
              <tbody>
                {agentStats.map((agent) => (
                  <tr key={agent.name}>
                    <td>{agent.name}</td>
                    <td>{numberFormatter.format(agent.dialogs)}</td>
                    <td>{numberFormatter.format(agent.messages)}</td>
                    <td>{agent.avgMessagesPerDialog.toFixed(1)}</td>
                    <td>{agent.lastActivity ? formatDateTime(agent.lastActivity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Активность за последние {summary.recentActivity.length} дн.</h3>
        {summary.recentActivity.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>Нет данных о новых диалогах.</p>
        ) : (
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Новых диалогов</th>
                <th>Входящих сообщений</th>
              </tr>
            </thead>
            <tbody>
              {summary.recentActivity.map((item) => (
                <tr key={item.date}>
                  <td>{formatDate(item.date)}</td>
                  <td>{numberFormatter.format(item.dialogs)}</td>
                  <td>{numberFormatter.format(item.incomingMessages)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;