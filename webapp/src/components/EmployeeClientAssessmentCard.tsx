import React, { useMemo, useRef, useState } from 'react';
import type { ChatSummary, EmployeeClientAssessmentSubmitPayload } from '../types';

interface EmployeeClientAssessmentCardProps {
  chat: ChatSummary;
  isSubmitting: boolean;
  onSubmit: (assessmentId: number, payload: EmployeeClientAssessmentSubmitPayload) => Promise<void>;
}

type ScoreFieldKey =
  | 'questionClarityScore'
  | 'dataCompletenessScore'
  | 'clientResponseSpeedScore'
  | 'businessCommunicationScore'
  | 'clientReadinessScore';

const SCORE_OPTIONS = [1, 2, 3, 4, 5];

const SCORE_FIELDS: Array<{ key: ScoreFieldKey; label: string }> = [
  { key: 'questionClarityScore', label: 'Постановка вопроса' },
  { key: 'dataCompletenessScore', label: 'Полнота данных' },
  { key: 'clientResponseSpeedScore', label: 'Скорость обратной связи' },
  { key: 'businessCommunicationScore', label: 'Деловая коммуникация' },
  { key: 'clientReadinessScore', label: 'Готовность клиента' },
];

const EmployeeClientAssessmentCard: React.FC<EmployeeClientAssessmentCardProps> = ({
  chat,
  isSubmitting,
  onSubmit,
}) => {
  const assessmentId = chat.employeeAssessmentId;
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const [form, setForm] = useState<EmployeeClientAssessmentSubmitPayload>({
    questionClarityScore: 5,
    dataCompletenessScore: 5,
    clientResponseSpeedScore: 5,
    businessCommunicationScore: 5,
    clientReadinessScore: 5,
    lowScoreReason: null,
    internalComment: '',
    interactionStatus: 'provided_all',
    interactionFlag: 'constructive',
    requestRepeatStatus: 'not_repeated',
    clientDataOverdue: false,
  });
  const [error, setError] = useState<string | null>(null);

  const disabled = !assessmentId || isSubmitting;

  const averageScoreValue = useMemo(() => {
    const total = SCORE_FIELDS.reduce((sum, field) => sum + form[field.key], 0);
    return total / SCORE_FIELDS.length;
  }, [form]);

  const averageScore = averageScoreValue.toFixed(2);
  const progress = Math.round((averageScoreValue / 5) * 100);
  const showLowScoreReason = averageScoreValue < 4;

  if (!assessmentId || !chat.employeeAssessmentPending) {
    return null;
  }

  const setScore = (key: ScoreFieldKey, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resizeComment = (element: HTMLTextAreaElement) => {
    const currentHeight = element.offsetHeight;
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, currentHeight)}px`;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assessmentId) {
      return;
    }
    setError(null);
    try {
      await onSubmit(assessmentId, {
        ...form,
        lowScoreReason: showLowScoreReason ? form.lowScoreReason : null,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось сохранить оценку.');
    }
  };

  return (
    <form className="employee-assessment" onSubmit={handleSubmit}>
      <header className="employee-assessment__header">
        <div className="employee-assessment__hero">
          <div className="employee-assessment__eyebrow">Внутренняя анкета</div>
          <h3 className="employee-assessment__title">Оценка клиента</h3>
          <div className="employee-assessment__identity">
            <strong>{chat.title}</strong>
            {chat.bin ? <span>БИН {chat.bin}</span> : null}
            {chat.sectionTitle ? <span>{chat.sectionTitle}</span> : null}
          </div>
        </div>

        <div className="employee-assessment__status-card" aria-label="Итоговая оценка">
          <div className="employee-assessment__status-row">
            {chat.dialogClosedAt ? <span className="employee-assessment__chip employee-assessment__chip--closed">Диалог закрыт</span> : null}
            <span className="employee-assessment__progress">{averageScore} / 5</span>
          </div>
          <div className="employee-assessment__progress-block">
            <div className="employee-assessment__progress-labels">
              <span>Средний балл</span>
              <strong>{averageScore}</strong>
            </div>
            <div className="employee-assessment__progress-track" aria-hidden="true">
              <div className="employee-assessment__progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </header>

      <section className="employee-assessment__section employee-assessment__section--criteria" aria-labelledby="employee-assessment-score-title">
        <div className="employee-assessment__section-label" id="employee-assessment-score-title">
          Критерии оценки
        </div>
        <div className="employee-assessment__questions">
          {SCORE_FIELDS.map((field) => {
            const value = form[field.key];

            return (
              <div className="employee-assessment__question" key={field.key} role="group" aria-label={field.label}>
                <div className="employee-assessment__question-copy">
                  <span>{field.label}</span>
                </div>
                <div className="employee-assessment__scale">
                  {SCORE_OPTIONS.map((score) => (
                    <button
                      className={[
                        'employee-assessment__score',
                        value === score ? 'is-active' : '',
                        score <= 2 ? 'is-low' : '',
                      ].filter(Boolean).join(' ')}
                      type="button"
                      key={score}
                      aria-pressed={value === score}
                      onClick={() => setScore(field.key, score)}
                      disabled={disabled}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="employee-assessment__section employee-assessment__section--details" aria-labelledby="employee-assessment-details-title">
        <div className="employee-assessment__section-label" id="employee-assessment-details-title">
          Детали взаимодействия
        </div>

        <div className="employee-assessment__summary">
          <div className="employee-assessment__detail-grid">
            <label className="employee-assessment__field">
              <span className="employee-assessment__field-title">Статус взаимодействия</span>
              <select
                value={form.interactionStatus}
                onChange={(event) => setForm((current) => ({ ...current, interactionStatus: event.target.value as EmployeeClientAssessmentSubmitPayload['interactionStatus'] }))}
                disabled={disabled}
              >
                <option value="provided_all">Клиент предоставил все данные</option>
                <option value="provided_partial">Клиент предоставил данные частично</option>
                <option value="provided_none">Клиент не предоставил данные</option>
              </select>
            </label>

            <label className="employee-assessment__field">
              <span className="employee-assessment__field-title">Флаг обращения</span>
              <select
                value={form.interactionFlag}
                onChange={(event) => setForm((current) => ({ ...current, interactionFlag: event.target.value as EmployeeClientAssessmentSubmitPayload['interactionFlag'] }))}
                disabled={disabled}
              >
                <option value="constructive">Конструктивное</option>
                <option value="repeated_clarifications">Потребовались уточнения</option>
                <option value="hindered_by_client">Затруднено действиями клиента</option>
              </select>
            </label>

            <label className="employee-assessment__field">
              <span className="employee-assessment__field-title">Характер обращения</span>
              <select
                value={form.requestRepeatStatus}
                onChange={(event) => setForm((current) => ({ ...current, requestRepeatStatus: event.target.value as EmployeeClientAssessmentSubmitPayload['requestRepeatStatus'] }))}
                disabled={disabled}
              >
                <option value="first_contact">Первое обращение</option>
                <option value="not_repeated">Не повторное</option>
                <option value="repeated_same_issue">Повторное однотипное</option>
              </select>
            </label>

            {showLowScoreReason ? (
              <label className="employee-assessment__field">
                <span className="employee-assessment__field-title">Причина низкой оценки</span>
                <select
                  value={form.lowScoreReason ?? ''}
                  onChange={(event) => setForm((current) => ({ ...current, lowScoreReason: event.target.value || null }))}
                  disabled={disabled}
                >
                  <option value="">Не выбрано</option>
                  <option value="unclear_request">Некорректная постановка вопроса</option>
                  <option value="missing_data">Недостаточно данных и документов</option>
                  <option value="slow_response">Медленная обратная связь</option>
                  <option value="communication_issues">Нарушение деловой коммуникации</option>
                  <option value="not_ready">Клиент не был готов к взаимодействию</option>
                  <option value="duplicate_requests">Повторные однотипные обращения</option>
                  <option value="other">Другая причина</option>
                </select>
              </label>
            ) : null}
          </div>

          <label className="employee-assessment__field employee-assessment__field--comment">
            <span className="employee-assessment__field-title">Комментарий</span>
            <textarea
              ref={commentRef}
              value={form.internalComment ?? ''}
              onChange={(event) => {
                resizeComment(event.currentTarget);
                setForm((current) => ({ ...current, internalComment: event.target.value }));
              }}
              rows={3}
              disabled={disabled}
            />
          </label>
        </div>
      </section>

      <label className="employee-assessment__toggle">
        <input
          type="checkbox"
          checked={form.clientDataOverdue}
          onChange={(event) => setForm((current) => ({ ...current, clientDataOverdue: event.target.checked }))}
          disabled={disabled}
        />
        <span>Была просрочка по предоставлению данных</span>
      </label>

      {error ? <div className="employee-assessment__error">{error}</div> : null}

      <div className="employee-assessment__actions">
        <button className="employee-assessment__submit" type="submit" disabled={disabled}>
          {isSubmitting ? 'Сохранение...' : 'Сохранить оценку'}
        </button>
      </div>
    </form>
  );
};

export default EmployeeClientAssessmentCard;
