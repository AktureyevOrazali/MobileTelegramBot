import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../api/ApiClient';
import { DashboardSummary } from '../types';
import { formatDate, formatDateTime } from '../utils/date';
import SelectPill from '../components/SelectPill';

interface DashboardPageProps {
  apiClient: ApiClient;
}

type LoadMode = 'initial' | 'refresh';

type QuestionSection = DashboardSummary['questionsBySection'][number] & { totalCount: number };
type QuestionSectionEntry = { key: string; title: string; section: QuestionSection };

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
  const [selectedQuestionSection, setSelectedQuestionSection] = useState<string>('all');

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

  const hasData = Boolean(summary);
  const data = summary ?? EMPTY_SUMMARY;

  const statCards = [
    { label: 'Всего обращений', value: data.totalDialogs },
    { label: 'Открытые диалоги', value: data.openDialogs },
    { label: 'Закрытые диалоги', value: data.closedDialogs },
    { label: 'Активных чатов', value: data.totalChats },
    { label: 'Входящих сообщений', value: data.totalIncomingMessages },
    { label: 'Исходящих сообщений', value: data.totalOutgoingMessages },
  ];

  const sectionTitleSet = useMemo(
    () =>
      new Set(
        data.sectionBreakdown
          .map((item) => item.title.trim().toLowerCase())
          .filter((title) => title.length > 0),
      ),
    [data.sectionBreakdown],
  );

  const topQuestions = useMemo(() => {
    const seen = new Set<string>();
    const filtered = data.topQuestions.filter((item) => {
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
  }, [sectionTitleSet, data.topQuestions]);

  const questionsBySection = useMemo(
    () =>
      data.questionsBySection
        .map((section) => ({
          ...section,
          totalCount: section.questions.reduce((acc, question) => acc + question.count, 0),
        }))
        .filter((section) => section.questions.length > 0)
        .sort((a, b) => b.totalCount - a.totalCount),
    [data.questionsBySection],
  ) as QuestionSection[];

  const questionSectionEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries: QuestionSectionEntry[] = [];
    questionsBySection.forEach((section) => {
      const key = section.section ?? (section.title || 'no-section');
      if (seen.has(key)) {
        return;
      }
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
    if (selectedQuestionSection === 'all') {
      return;
    }
    const exists = questionSectionEntries.some((entry) => entry.key === selectedQuestionSection);
    if (!exists) {
      setSelectedQuestionSection('all');
    }
  }, [questionSectionEntries, selectedQuestionSection]);

  const selectedQuestions = useMemo(() => {
    if (selectedQuestionSection === 'all') {
      return topQuestions;
    }
    const entry = questionSectionEntries.find((item) => item.key === selectedQuestionSection);
    if (!entry) {
      return [];
    }
    return entry.section.questions.slice(0, 5);
  }, [questionSectionEntries, selectedQuestionSection, topQuestions]);

  const selectedSectionTitle = useMemo(() => {
    if (selectedQuestionSection === 'all') {
      return 'Все разделы';
    }
    const entry = questionSectionEntries.find((item) => item.key === selectedQuestionSection);
    return entry?.title ?? 'Без раздела';
  }, [questionSectionEntries, selectedQuestionSection]);

  const agentStats = useMemo(() => {
    const systemKeywords = ['admin', 'administrator', 'администратор', 'ai assistant'];
    return data.agentBreakdown
      .filter((agent) => {
        const normalized = agent.name.trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        if (systemKeywords.some((keyword) => normalized.includes(keyword))) {
          return false;
        }
        if (/\b(bot|бот)\b/.test(normalized)) {
          return false;
        }
        return true;
      })
      .map((agent) => ({
        ...agent,
        avgMessagesPerDialog: Number.isFinite(agent.avgMessagesPerDialog)
          ? agent.avgMessagesPerDialog
          : 0,
      }))
      .sort((a, b) => b.messages - a.messages);
  }, [data.agentBreakdown]);

  const parseQuestion = useCallback((raw: string) => {
    const trimmed = raw.trim();
    const match = trimmed.match(/^\[(faq)\]\s*/i);
    return {
      text: match ? trimmed.slice(match[0].length) : trimmed,
      badge: match ? match[1].toUpperCase() : null,
    };
  }, []);

  const avgMessagesValue = data.averageMessagesPerDialog
    ? data.averageMessagesPerDialog.toFixed(1)
    : '0.0';
  const avgDurationValue = data.avgDialogDurationMinutes
    ? data.avgDialogDurationMinutes.toFixed(1)
    : '—';

  const lastUpdated = hasData ? formatDateTime(data.updatedAt) : '';

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

         {!hasData && (
          <div style={{ borderTop: '1px solid rgba(37, 50, 99, 0.1)', paddingTop: 16 }}>
            <p className="text-muted" style={{ margin: '0 0 12px 0' }}>
              {loading
                ? 'Загружаем отчёт...'
                : error ?? 'Нет данных для отображения. Попробуйте обновить страницу.'}
            </p>
            {!loading && (
              <button className="button" type="button" onClick={() => loadData('initial')}>
                Попробовать снова
              </button>
            )}
          </div>
        )}
      </div>

      <div className="dashboard-columns">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Обращения по разделам</h3>
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

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Частые вопросы</h3>
            <SelectPill
              label=""
              options={questionSectionOptions}
              value={selectedQuestionSection}
              onChange={(value) => setSelectedQuestionSection(value || 'all')}
              showLabelInside={false}
            />
          </div>
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            ТОП-5 · {selectedSectionTitle}
          </span>
          {selectedQuestions.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>Пока нет популярных вопросов для выбранного раздела.</p>
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
        <h3 className="heading" style={{ fontSize: '1.1rem', margin: 0 }}>Активность за последние {data.recentActivity.length} дн.</h3>
        {data.recentActivity.length === 0 ? (
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
              {data.recentActivity.map((item) => (
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