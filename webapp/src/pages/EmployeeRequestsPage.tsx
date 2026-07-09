import React, { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/ApiClient';
import type { AuthSession, HrRequest, HrSignature, HrTemplate } from '../types';
import { DEFAULT_EMPLOYEE_ORGANIZATION } from '../constants/hrOrganizations';
import { requestStatusLabels, requestTypeLabels } from './hr/hrMockData';
import { signWithNcalayer } from '../services/ncalayer';

interface EmployeeRequestsPageProps {
  apiClient: ApiClient;
  session: AuthSession;
}

const formatInputDate = (value: string) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`));
};

const formatToday = () => new Intl.DateTimeFormat('ru-RU').format(new Date());
const formatRequestDate = (value: Date) => new Intl.DateTimeFormat('ru-RU').format(value);
const formatSignatureDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU').format(date);
};
const skeletonStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);

const countDays = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) return '';
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '';
  return String(Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
};

const numberWordsRu = [
  'ноль',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];

const tensWordsRu: Record<number, string> = {
  20: 'двадцать',
  30: 'тридцать',
  40: 'сорок',
  50: 'пятьдесят',
  60: 'шестьдесят',
  70: 'семьдесят',
  80: 'восемьдесят',
  90: 'девяносто',
};

const countDaysWords = (startDate: string, endDate: string) => {
  const days = Number(countDays(startDate, endDate));
  if (!Number.isFinite(days) || days <= 0) return '';
  if (days < 20) return numberWordsRu[days];
  if (days < 100) {
    const tens = Math.floor(days / 10) * 10;
    const rest = days % 10;
    return rest ? `${tensWordsRu[tens]} ${numberWordsRu[rest]}` : tensWordsRu[tens];
  }
  return String(days);
};

const requestTypeRequiresDates = (template: HrTemplate | null) => (
  template?.type === 'vacation'
  || template?.type === 'businessTrip'
  || template?.type === 'sickLeave'
);

const buildPeriodLabel = (startDate: string, endDate: string) => {
  const start = formatInputDate(startDate);
  const end = formatInputDate(endDate);
  if (start && end) return `с ${start} по ${end}`;
  return start || end;
};

const buildAutoValues = (
  template: HrTemplate | null,
  session: AuthSession,
  startDate: string,
  endDate: string,
  reason: string,
  extraValues: Record<string, string>,
  organization: string,
): Record<string, string> => {
  const period = buildPeriodLabel(startDate, endDate);
  const values: Record<string, string> = {
    employee_name: session.user.name,
    organization,
    document_date: formatToday(),
    position: session.user.jobTitle || session.user.role,
    department: session.user.jobTitle || '',
    start_date: formatInputDate(startDate),
    end_date: formatInputDate(endDate),
    days_count: countDays(startDate, endDate),
    days_count_words: countDaysWords(startDate, endDate),
    period,
    reason,
    purpose: reason,
    access_reason: reason,
    repayment_date: formatInputDate(endDate),
  };
  Object.entries(extraValues).forEach(([key, value]) => {
    values[key] = value;
  });
  template?.variables.forEach((variable) => {
    values[variable] = values[variable] || '';
  });
  return values;
};

const previewDatePlaceholder = 'дд.мм.гггг';
const previewReasonPlaceholder = 'укажите причину';
const previewValuePlaceholder = 'укажите значение';

const getPreviewPlaceholder = (variable: string) => {
  if (variable.includes('date') || variable.endsWith('_at')) return previewDatePlaceholder;
  if (variable === 'days_count') return '0';
  if (variable === 'period') return `с ${previewDatePlaceholder} по ${previewDatePlaceholder}`;
  if (
    variable.includes('reason')
    || variable === 'purpose'
    || variable === 'manager_name'
  ) {
    return previewReasonPlaceholder;
  }
  if (
    variable === 'recipient'
    || variable === 'payroll_month'
    || variable === 'amount'
    || variable === 'destination'
    || variable === 'city'
    || variable === 'system_name'
    || variable === 'monthly_income'
  ) {
    return previewReasonPlaceholder;
  }
  return previewValuePlaceholder;
};

const reasonVariables = new Set(['reason', 'purpose', 'access_reason']);
const autoVariables = new Set([
  'employee_name',
  'organization',
  'document_date',
  'position',
  'department',
  'start_date',
  'end_date',
  'days_count',
  'days_count_words',
  'period',
  'repayment_date',
]);

const variableLabels: Record<string, string> = {
  amount: 'Сумма аванса',
  payroll_month: 'Месяц начисления',
  destination: 'Место командировки',
  city: 'Город',
  recipient: 'Куда предоставить',
  topic: 'Тема обращения',
  system_name: 'Название системы',
  monthly_income: 'Ежемесячный доход',
  manager_name: 'Руководитель',
};

const getVariableLabel = (variable: string) => variableLabels[variable] ?? variable;

const getExtraTemplateVariables = (template: HrTemplate | null) => (
  (template?.variables ?? []).filter((variable) => (
    !autoVariables.has(variable)
    && !reasonVariables.has(variable)
  ))
);

const templateNeedsReason = (template: HrTemplate | null) => (
  (template?.variables ?? []).some((variable) => reasonVariables.has(variable))
);

const buildPreviewValues = (
  template: HrTemplate | null,
  values: Record<string, string>,
) => {
  const previewValues = { ...values };
  Object.keys(previewValues).forEach((key) => {
    if (!previewValues[key]) previewValues[key] = getPreviewPlaceholder(key);
  });
  template?.variables.forEach((variable) => {
    if (!previewValues[variable]) previewValues[variable] = getPreviewPlaceholder(variable);
  });
  return previewValues;
};

const normalizeSentence = (value: string) => {
  const sentence = value.trim().replace(/\s+/g, ' ');
  if (!sentence) return '';
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const normalizeEmployeeTemplateBody = (template: HrTemplate) => {
  if (
    template.type === 'advance'
    && template.body.trim() === 'Прошу выдать аванс сотруднику {employee_name} в размере {amount}. Причина: {reason}.'
  ) {
    return 'Прошу выдать мне аванс в размере {amount} в счет заработной платы, в связи с {reason}.';
  }
  return template.body;
};

const buildRequestStatement = (
  template: HrTemplate | null,
  employeeName: string,
  period: string,
  reason: string,
  amount = '',
) => {
  const cleanReason = reason.trim();
  const cleanAmount = amount.trim() || '____';
  const prefix = `Я, ${employeeName},`;
  if (!cleanReason) {
    return `${prefix} прошу рассмотреть заявление${period ? ` на период ${period}` : ''}.`;
  }

  switch (template?.type) {
    case 'advance':
      return normalizeSentence(`Прошу выдать мне аванс в размере ${cleanAmount} в счет заработной платы, в связи с ${cleanReason}`);
    case 'vacation':
      return normalizeSentence(`${prefix} прошу предоставить отпуск на период ${period} в связи с ${cleanReason}`);
    case 'businessTrip':
      return normalizeSentence(`${prefix} прошу оформить командировку на период ${period} с целью ${cleanReason}`);
    case 'certificate':
      return normalizeSentence(`${prefix} прошу подготовить справку с места работы для ${cleanReason}`);
    case 'sickLeave':
      return normalizeSentence(`${prefix} прошу оформить отсутствие по болезни на период ${period} по причине ${cleanReason}`);
    default:
      return normalizeSentence(`${prefix} прошу рассмотреть заявление на период ${period} по причине ${cleanReason}`);
  }
};

const renderTemplate = (body: string, values: Record<string, string>) => (
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value || ''),
    body,
  )
);

const requestStatement = (request: HrRequest) => {
  if (typeof request.values.statement === 'string' && request.values.statement.trim()) {
    return normalizeSentence(request.values.statement);
  }
  if (request.renderedText.trim()) return normalizeSentence(request.renderedText);
  return buildRequestStatement(
    { type: request.type } as HrTemplate,
    request.employeeName,
    request.period,
    request.summary,
    typeof request.values.amount === 'string' ? request.values.amount : '',
  );
};

const requestOrganization = (request: HrRequest, fallback: string) => (
  typeof request.values.organization === 'string' && request.values.organization.trim()
    ? request.values.organization.trim()
    : fallback
);

const EmployeeRequestsPage: React.FC<EmployeeRequestsPageProps> = ({ apiClient, session }) => {
  const [templates, setTemplates] = useState<HrTemplate[]>([]);
  const [requests, setRequests] = useState<HrRequest[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [showSignedExample, setShowSignedExample] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [employeeSignature, setEmployeeSignature] = useState<HrSignature | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextTemplates, nextRequests] = await Promise.all([
          apiClient.fetchHrTemplates(),
          apiClient.fetchHrRequests(),
        ]);
        if (cancelled) return;
        setTemplates(nextTemplates);
        setRequests(nextRequests);
        setSelectedTemplateId((current) => current ?? nextTemplates[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить заявления.');
      }
    }
    setIsLoading(true);
    load().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates],
  );
  const organization = session.user.organization || DEFAULT_EMPLOYEE_ORGANIZATION;
  const requiresDates = requestTypeRequiresDates(selectedTemplate);
  const period = useMemo(() => buildPeriodLabel(startDate, endDate), [startDate, endDate]);
  const effectivePeriod = requiresDates ? period : '';
  const isDateRangeInvalid = Boolean(requiresDates && startDate && endDate && endDate < startDate);
  const extraTemplateVariables = useMemo(() => getExtraTemplateVariables(selectedTemplate), [selectedTemplate]);
  const needsReason = templateNeedsReason(selectedTemplate);
  const hasRequiredExtraValues = extraTemplateVariables.every((variable) => (extraValues[variable] ?? '').trim());
  const values = useMemo(
    () => buildAutoValues(
      selectedTemplate,
      session,
      requiresDates ? startDate : '',
      requiresDates ? endDate : '',
      reason,
      extraValues,
      organization,
    ),
    [selectedTemplate, session, requiresDates, startDate, endDate, reason, extraValues, organization],
  );
  const previewValues = useMemo(
    () => buildPreviewValues(selectedTemplate, values),
    [selectedTemplate, values],
  );
  const renderedTemplateText = selectedTemplate
    ? normalizeSentence(renderTemplate(normalizeEmployeeTemplateBody(selectedTemplate), previewValues))
    : '';
  const previewText = renderedTemplateText || buildRequestStatement(selectedTemplate, session.user.name, effectivePeriod, reason, values.amount);
  const canSignRequest = Boolean(
    selectedTemplate
    && (!requiresDates || effectivePeriod)
    && (!needsReason || reason.trim())
    && hasRequiredExtraValues
    && !isDateRangeInvalid,
  );
  const employeeSignedDate = formatSignatureDate(employeeSignature?.signedAt);
  const previewSignatureDate = employeeSignedDate || (showSignedExample ? formatToday() : '');
  const showPreviewSignature = Boolean(employeeSignature || showSignedExample);
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? null,
    [requests, selectedRequestId],
  );

  useEffect(() => {
    setEmployeeSignature(null);
    setShowSignedExample(false);
  }, [selectedTemplate?.id, startDate, endDate, reason, extraValues, previewText]);

  useEffect(() => {
    setExtraValues({});
  }, [selectedTemplate?.id]);

  const handleSign = async () => {
    if (!selectedTemplate || !canSignRequest) return;
    setIsSigning(true);
    setError('');
    try {
      const signature = await signWithNcalayer({
        action: 'submit',
        templateId: selectedTemplate.id,
        employeeId: session.user.id,
        employeeName: session.user.name,
        values,
        period: effectivePeriod,
        summary: reason.trim(),
        statement: previewText,
      });
      setEmployeeSignature(signature);
    } catch (err) {
      setEmployeeSignature(null);
      setError(err instanceof Error ? err.message : 'Не удалось подписать заявление через NCALayer.');
    } finally {
      setIsSigning(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTemplate || (requiresDates && !effectivePeriod) || (needsReason && !reason.trim()) || !hasRequiredExtraValues || isDateRangeInvalid || !employeeSignature) return;
    setIsSubmitting(true);
    setError('');
    try {
      const created = await apiClient.createHrRequest({
        templateId: selectedTemplate.id,
        values: { ...values, statement: previewText },
        summary: reason.trim(),
        period: effectivePeriod,
        employeeSignature,
      });
      setRequests((current) => [created, ...current]);
      setSelectedRequestId(created.id);
      setReason('');
      setExtraValues({});
      setStartDate('');
      setEndDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить заявление.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="hr-page hr-page--employee" data-testid="employee-requests-page">
      <header className="hr-header">
        <div className="hr-header__top">
          <div>
            <h2 className="hr-header__title">Мои заявления</h2>
            <p className="hr-subtitle">{session.user.name}</p>
          </div>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <main className="hr-employee-requests-layout">
        <section className="hr-request-wizard">
          <div className="hr-template-list" aria-label="Шаблоны заявлений">
            {isLoading && Array.from({ length: 4 }, (_, index) => (
              <div
                className="hr-template-item hr-template-item--skeleton skeleton-unit"
                data-testid="employee-template-item-skeleton"
                key={index}
                style={skeletonStyle(index)}
              />
            ))}
            {!isLoading && templates.map((template) => (
              <button
                className={`hr-template-item ${template.id === selectedTemplate?.id ? 'hr-template-item--active' : ''}`}
                key={template.id}
                type="button"
                aria-pressed={template.id === selectedTemplate?.id}
                onClick={() => setSelectedTemplateId(template.id)}
              >
                <strong>{template.title}</strong>
                <span className="hr-badge">{requestTypeLabels[template.type]}</span>
              </button>
            ))}
          </div>

          <form className="hr-template-preview" onSubmit={handleSubmit}>
            {isLoading ? (
              <div className="hr-employee-request-preview-skeleton" aria-hidden="true">
                <div className="hr-detail-card__header">
                  <span className="skeleton-unit hr-detail-card__pill-skeleton" />
                  <span className="skeleton-unit hr-detail-card__pill-skeleton" />
                </div>
                <span className="skeleton-unit hr-detail-card__title-skeleton" />
                <span className="skeleton-unit hr-template-field-skeleton" />
                <div className="hr-form-grid hr-form-grid--two">
                  <span className="skeleton-unit hr-template-field-skeleton" />
                  <span className="skeleton-unit hr-template-field-skeleton" />
                </div>
                <span className="skeleton-unit hr-template-field-skeleton hr-template-field-skeleton--textarea" />
                <article
                  className="hr-document-preview hr-document-preview--skeleton skeleton-unit"
                  data-testid="employee-statement-preview-skeleton"
                />
                <div className="hr-template-preview__actions">
                  <span className="skeleton-unit hr-detail-card__button-skeleton hr-detail-card__button-skeleton--wide" />
                </div>
              </div>
            ) : selectedTemplate ? (
              <>
                <div className="hr-detail-card__header">
                  <span className="hr-badge">Заявление</span>
                  <span className="hr-status">Автозаполнение</span>
                </div>
                <div className="hr-employee-request-editor">
                  <div className="hr-employee-request-document-column">
                    <article className="hr-document-preview" aria-label="Предпросмотр заявления">
                      <div className="hr-document-preview__to">
                        <span>Директору</span>
                        <span>{organization}</span>
                      </div>
                      <div className="hr-document-preview__body">
                        <h3>Заявление</h3>
                        <p>{previewText}</p>
                      </div>
                      <div className="hr-document-preview__footer">
                        <span>{previewSignatureDate || formatToday()}</span>
                        <span className="hr-document-preview__signature">
                          <span>________________ / {session.user.name} /</span>
                          {showPreviewSignature && (
                            <small>
                              {previewSignatureDate && <time dateTime={employeeSignature?.signedAt ?? new Date().toISOString()}>{previewSignatureDate}</time>}
                              <span>Подписано ЭЦП</span>
                              {showSignedExample && !employeeSignature && <span>пример</span>}
                            </small>
                          )}
                        </span>
                      </div>
                    </article>

                  </div>

                  <div className="hr-employee-request-fields">
                    <h3>Заявление</h3>
                    <label className="hr-field">
                      <span>Организация</span>
                      <input value={organization} readOnly />
                    </label>
                    {requiresDates && (
                      <div className="hr-employee-request-date-stack">
                        <label className="hr-field">
                          <span>Дата начала</span>
                          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
                        </label>
                        <label className="hr-field">
                          <span>Дата окончания</span>
                          <input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(event) => setEndDate(event.target.value)}
                            aria-invalid={isDateRangeInvalid}
                            required
                          />
                        </label>
                      </div>
                    )}
                    {isDateRangeInvalid && (
                      <p className="form-error" role="alert">Дата окончания не может быть раньше даты начала.</p>
                    )}
                    {extraTemplateVariables.map((variable) => (
                      <label className="hr-field" key={variable}>
                        <span>{getVariableLabel(variable)}</span>
                        <input
                          value={extraValues[variable] ?? ''}
                          onChange={(event) => setExtraValues((current) => ({
                            ...current,
                            [variable]: event.target.value,
                          }))}
                          required
                        />
                      </label>
                    ))}
                  </div>

                  <div className="hr-employee-request-bottom">
                    <label className="hr-field hr-employee-request-reason">
                      <span>{selectedTemplate.type === 'businessTrip' ? 'Цель / причина' : 'Причина'}</span>
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required={needsReason} />
                    </label>

                    <div className="hr-template-preview__actions">
                      <button className="button secondary" type="button" disabled={isSigning || !canSignRequest} onClick={handleSign}>
                        {isSigning ? 'Подписание...' : 'Подписать ЭЦП'}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={Boolean(employeeSignature)}
                        onClick={() => setShowSignedExample((current) => !current)}
                      >
                        {showSignedExample ? 'Скрыть пример ЭЦП' : 'Показать пример ЭЦП'}
                      </button>
                      {employeeSignature && <span className="hr-badge">ЭЦП подписано</span>}
                      <button className="button" type="submit" disabled={isSubmitting || !canSignRequest || !employeeSignature}>
                        Отправить заявление
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p>Кадровик еще не создал активные шаблоны заявлений.</p>
            )}
          </form>
        </section>

        <section className="hr-request-list hr-request-list--employee" aria-label="Мои отправленные заявления">
          <div className="hr-template-list__header">
            <strong>Отправленные</strong>
            <span>{requests.length}</span>
          </div>
          {isLoading && Array.from({ length: 3 }, (_, index) => (
            <article
              className="hr-request-row hr-request-row--employee hr-request-row--skeleton skeleton-unit"
              data-testid="employee-request-row-skeleton"
              key={index}
              style={skeletonStyle(index)}
            />
          ))}
          {!isLoading && requests.length === 0 && (
            <article className="hr-detail-card">
              <p>Вы еще не отправляли заявления.</p>
            </article>
          )}
          {!isLoading && requests.map((request) => (
            <button
              className={`hr-request-row hr-request-row--employee ${request.id === selectedRequest?.id ? 'hr-request-row--active' : ''}`}
              key={request.id}
              type="button"
              aria-pressed={request.id === selectedRequest?.id}
              onClick={() => setSelectedRequestId(request.id)}
            >
              <span className="hr-request-row__body">
                <span className="hr-request-row__summary">
                  <strong>{requestTypeLabels[request.type]}</strong>
                  <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
                </span>
                <time className="hr-request-row__date" dateTime={request.submittedAt.toISOString()}>
                  {formatRequestDate(request.submittedAt)}
                </time>
              </span>
            </button>
          ))}
          {!isLoading && selectedRequest && (
            <article className="hr-sent-request-preview" aria-label="Форма отправленного заявления">
              <div className="hr-sent-request-preview__header">
                <strong>{selectedRequest.templateTitle || requestTypeLabels[selectedRequest.type]}</strong>
                <span className={`hr-status hr-status--${selectedRequest.status}`}>{requestStatusLabels[selectedRequest.status]}</span>
              </div>
              <article className="hr-document-preview hr-document-preview--sent">
                <div className="hr-document-preview__to">
                  <span>Директору</span>
                  <span>{requestOrganization(selectedRequest, organization)}</span>
                </div>
                <div className="hr-document-preview__body">
                  <h3>Заявление</h3>
                  <p>{requestStatement(selectedRequest)}</p>
                </div>
                <div className="hr-document-preview__footer">
                  <span>{formatSignatureDate(selectedRequest.employeeSignature?.signedAt) || formatRequestDate(selectedRequest.submittedAt)}</span>
                  <span className="hr-document-preview__signature">
                    <span>________________ / {selectedRequest.employeeName} /</span>
                    {selectedRequest.employeeSignature && (
                      <small>
                        <time dateTime={selectedRequest.employeeSignature.signedAt}>{formatSignatureDate(selectedRequest.employeeSignature.signedAt)}</time>
                        <span>Подписано ЭЦП</span>
                      </small>
                    )}
                  </span>
                </div>
                {(selectedRequest.status === 'approved' || selectedRequest.status === 'rejected') && selectedRequest.hrSignature && (
                  <div className="hr-document-preview__decision">
                    <strong>Решение: {requestStatusLabels[selectedRequest.status]}</strong>
                    <span>{selectedRequest.decidedByName || 'HR'}</span>
                    <small>
                      <time dateTime={selectedRequest.hrSignature.signedAt}>{formatSignatureDate(selectedRequest.hrSignature.signedAt)}</time>
                      <span>Подписано ЭЦП</span>
                    </small>
                  </div>
                )}
              </article>
              {selectedRequest.decisionComment && (
                <div className="hr-request-row__decision">
                  <span>Комментарий HR</span>
                  <p>{selectedRequest.decisionComment}</p>
                </div>
              )}
            </article>
          )}
        </section>
      </main>
    </div>
  );
};

export default EmployeeRequestsPage;
