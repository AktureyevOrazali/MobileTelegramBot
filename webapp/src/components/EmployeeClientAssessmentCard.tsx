import React, { useMemo, useState } from 'react';
import type { ChatSummary, EmployeeClientAssessmentSubmitPayload } from '../types';

interface EmployeeClientAssessmentCardProps {
  chat: ChatSummary;
  isSubmitting: boolean;
  onSubmit: (assessmentId: number, payload: EmployeeClientAssessmentSubmitPayload) => Promise<void>;
}

const SCORE_OPTIONS = [1, 2, 3, 4, 5];

const EmployeeClientAssessmentCard: React.FC<EmployeeClientAssessmentCardProps> = ({
  chat,
  isSubmitting,
  onSubmit,
}) => {
  const assessmentId = chat.employeeAssessmentId;
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

  const averageScore = useMemo(() => {
    const total =
      form.questionClarityScore +
      form.dataCompletenessScore +
      form.clientResponseSpeedScore +
      form.businessCommunicationScore +
      form.clientReadinessScore;
    return (total / 5).toFixed(2);
  }, [form]);

  if (!assessmentId || !chat.employeeAssessmentPending) {
    return null;
  }

  const setScore = (key: keyof EmployeeClientAssessmentSubmitPayload, value: number) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assessmentId) {
      return;
    }
    setError(null);
    try {
      await onSubmit(assessmentId, form);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось сохранить оценку.');
    }
  };

  return (
    <form className="dialogs-side-card" onSubmit={handleSubmit}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18 }}>Оценка клиента</h3>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Внутренняя анкета по завершенному обращению
          </p>
        </div>
        <strong style={{ fontSize: 18 }}>{averageScore}</strong>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {[
          ['questionClarityScore', 'Постановка вопроса'],
          ['dataCompletenessScore', 'Полнота данных'],
          ['clientResponseSpeedScore', 'Скорость обратной связи'],
          ['businessCommunicationScore', 'Деловая коммуникация'],
          ['clientReadinessScore', 'Готовность клиента'],
        ].map(([key, label]) => (
          <label key={key} style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
            <select
              value={String(form[key as keyof EmployeeClientAssessmentSubmitPayload] ?? 5)}
              onChange={(event) => setScore(key as keyof EmployeeClientAssessmentSubmitPayload, Number(event.target.value))}
              disabled={disabled}
            >
              {SCORE_OPTIONS.map((score) => (
                <option key={score} value={score}>
                  {score}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Статус взаимодействия</span>
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

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Флаг обращения</span>
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

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Характер обращения</span>
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

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Причина низкой оценки</span>
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

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Комментарий</span>
          <textarea
            value={form.internalComment ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, internalComment: event.target.value }))}
            rows={3}
            disabled={disabled}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={form.clientDataOverdue}
            onChange={(event) => setForm((current) => ({ ...current, clientDataOverdue: event.target.checked }))}
            disabled={disabled}
          />
          <span>Была просрочка по предоставлению данных</span>
        </label>

        {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="button" type="submit" disabled={disabled}>
            {isSubmitting ? 'Сохранение...' : 'Сохранить оценку'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default EmployeeClientAssessmentCard;
