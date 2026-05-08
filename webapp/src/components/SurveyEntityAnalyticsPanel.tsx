import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import type { SurveyAnalytics, SurveyAnalyticsAnswer, SurveyAnalyticsTopItemRaw, SurveyQuestionAnalytics } from '../types';
import { formatDateTime } from '../utils/date';
import { extractErrorMessage } from '../utils/errors';

type SurveyAnalyticsTarget =
  | { kind: 'employee'; label: string; operatorName: string }
  | { kind: 'bin'; label: string; bin: string };

interface SurveyEntityAnalyticsPanelProps {
  apiClient: ApiClient;
  open: boolean;
  target: SurveyAnalyticsTarget | null;
}

const numberFormatter = new Intl.NumberFormat('ru-RU');

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return value.toFixed(1).replace('.', ',');
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0%';
  }
  return `${Math.round(value * 100)}%`;
}

function answerValue(answer: SurveyAnalyticsAnswer): string {
  if (answer.numericScore !== null) {
    return formatScore(answer.numericScore);
  }
  if (answer.selectedEmployeeName) {
    return answer.selectedEmployeeName;
  }
  if (answer.rawText.trim()) {
    return answer.rawText.trim();
  }
  if (answer.selectedOptions.length > 0) {
    return answer.selectedOptions.join(', ');
  }
  return '-';
}

const MiniProgressList: React.FC<{ items: SurveyAnalyticsTopItemRaw[] }> = ({ items }) => {
  const max = Math.max(...items.map((item) => item.count), 1);
  if (items.length === 0) {
    return <div className="survey-entity-analytics__empty">Нет ответов по этому вопросу.</div>;
  }
  return (
    <div className="survey-entity-analytics__progress-list">
      {items.map((item) => (
        <div className="survey-entity-analytics__progress-row" key={item.label}>
          <div className="survey-entity-analytics__progress-copy">
            <span>{item.label}</span>
            <strong>{numberFormatter.format(item.count)}</strong>
          </div>
          <div className="survey-entity-analytics__progress-track" aria-hidden="true">
            <span style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const QuestionCard: React.FC<{ question: SurveyQuestionAnalytics }> = ({ question }) => {
  const rows = question.questionType === 'scale' ? question.scoreDistribution : question.topAnswers;
  return (
    <article className="survey-entity-analytics__question">
      <div className="survey-entity-analytics__question-head">
        <h5>{question.questionText}</h5>
        <span>{numberFormatter.format(question.answerCount)} ответов</span>
      </div>
      {question.averageScore !== null ? (
        <div className="survey-entity-analytics__score">Средняя оценка: <strong>{formatScore(question.averageScore)}</strong></div>
      ) : null}
      <MiniProgressList items={rows} />
    </article>
  );
};

const SurveyEntityAnalyticsPanel: React.FC<SurveyEntityAnalyticsPanelProps> = ({ apiClient, open, target }) => {
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestKey = target ? `${target.kind}:${target.label}` : '';

  useEffect(() => {
    if (!open || !target) {
      setAnalytics(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = target.kind === 'employee'
      ? { audience: 'client' as const, operatorName: target.operatorName }
      : { audience: 'client' as const, bin: target.bin };

    apiClient.fetchSurveyAnalytics(query)
      .then((nextAnalytics) => {
        if (!cancelled) {
          setAnalytics(nextAnalytics);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(extractErrorMessage(err, 'Не удалось загрузить аналитику опросов.'));
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient, open, requestKey]);

  const answers = useMemo(() => analytics?.answers.slice(0, 12) ?? [], [analytics]);
  const hasData = Boolean(analytics && (analytics.answerCount > 0 || analytics.completedSurveyCount > 0));

  return (
    <section className="survey-entity-analytics" aria-label="Аналитика опросов">
      <div className="survey-entity-analytics__head">
        <div>
          <span className="survey-entity-analytics__eyebrow">Опросы клиентов</span>
          <h4>Аналитика по ответам</h4>
        </div>
        {target ? <span className="badge">{target.label}</span> : null}
      </div>

      {loading ? <div className="survey-entity-analytics__empty">Загрузка аналитики...</div> : null}
      {error ? <div className="alert error">{error}</div> : null}
      {!loading && !error && !hasData ? (
        <div className="survey-entity-analytics__empty">По этому сотруднику или БИНу пока нет ответов на опросы.</div>
      ) : null}

      {!loading && !error && analytics ? (
        <>
          <div className="survey-entity-analytics__stats">
            <article>
              <span>Средняя оценка</span>
              <strong>{formatScore(analytics.averageScore)}</strong>
            </article>
            <article>
              <span>Завершено</span>
              <strong>{numberFormatter.format(analytics.completedSurveyCount)}</strong>
            </article>
            <article>
              <span>Ответов</span>
              <strong>{numberFormatter.format(analytics.answerCount)}</strong>
            </article>
            <article>
              <span>Положительные</span>
              <strong>{formatPercent(analytics.positiveShare)}</strong>
            </article>
          </div>

          <div className="survey-entity-analytics__questions">
            {analytics.questionAnalytics.length === 0 ? (
              <div className="survey-entity-analytics__empty">Нет детализации по вопросам.</div>
            ) : (
              analytics.questionAnalytics.map((question) => <QuestionCard key={question.questionId} question={question} />)
            )}
          </div>

          <div className="survey-entity-analytics__answers">
            <div className="survey-entity-analytics__subhead">
              <h5>Последние ответы</h5>
              {analytics.answersPreviewLimited ? <span>Показана часть ответов</span> : null}
            </div>
            {answers.length === 0 ? (
              <div className="survey-entity-analytics__empty">Ответов для просмотра пока нет.</div>
            ) : (
              <div className="survey-entity-analytics__answer-list">
                {answers.map((answer) => (
                  <article className="survey-entity-analytics__answer" key={answer.id}>
                    <div>
                      <strong>{answer.questionText}</strong>
                      <span>{formatDateTime(answer.createdAt)}</span>
                    </div>
                    <div>
                      <strong>{answerValue(answer)}</strong>
                      <span>{answer.isAnonymous ? 'Анонимно' : answer.organization ?? answer.bin ?? answer.chatTitle ?? '-'}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
};

export default SurveyEntityAnalyticsPanel;
