import React, { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/ApiClient';
import type { AuthSession, HrRequest, HrTemplate } from '../types';
import { DEFAULT_EMPLOYEE_ORGANIZATION } from '../constants/hrOrganizations';
import { requestStatusLabels, requestTypeLabels } from './hr/hrMockData';

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
const skeletonStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);

const countDays = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) return '';
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '';
  return String(Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
};

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
    period,
    reason,
    purpose: reason,
    recipient: reason,
    access_reason: reason,
    manager_name: reason,
    payroll_month: reason,
    repayment_date: formatInputDate(endDate),
    amount: reason,
    destination: reason,
    city: reason,
    system_name: reason,
    monthly_income: reason,
  };
  template?.variables.forEach((variable) => {
    values[variable] = values[variable] || reason || period;
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
    || variable === 'recipient'
    || variable === 'manager_name'
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

const buildRequestStatement = (
  template: HrTemplate | null,
  employeeName: string,
  period: string,
  reason: string,
) => {
  const cleanReason = reason.trim();
  const prefix = `Я, ${employeeName},`;
  if (!cleanReason) {
    return `${prefix} прошу рассмотреть заявление${period ? ` на период ${period}` : ''}.`;
  }

  switch (template?.type) {
    case 'advance':
      return normalizeSentence(`${prefix} запрашиваю аванс ${cleanReason}`);
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

const EmployeeRequestsPage: React.FC<EmployeeRequestsPageProps> = ({ apiClient, session }) => {
  const [templates, setTemplates] = useState<HrTemplate[]>([]);
  const [requests, setRequests] = useState<HrRequest[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const period = useMemo(() => buildPeriodLabel(startDate, endDate), [startDate, endDate]);
  const isDateRangeInvalid = Boolean(startDate && endDate && endDate < startDate);
  const values = useMemo(
    () => buildAutoValues(selectedTemplate, session, startDate, endDate, reason, organization),
    [selectedTemplate, session, startDate, endDate, reason, organization],
  );
  const previewValues = useMemo(
    () => buildPreviewValues(selectedTemplate, values),
    [selectedTemplate, values],
  );
  const renderedTemplateText = selectedTemplate ? normalizeSentence(renderTemplate(selectedTemplate.body, previewValues)) : '';
  const previewText = renderedTemplateText || buildRequestStatement(selectedTemplate, session.user.name, period, reason);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTemplate || !period || !reason.trim() || isDateRangeInvalid) return;
    setIsSubmitting(true);
    setError('');
    try {
      const created = await apiClient.createHrRequest({
        templateId: selectedTemplate.id,
        values: { ...values, statement: previewText },
        summary: reason.trim(),
        period,
      });
      setRequests((current) => [created, ...current]);
      setReason('');
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
                        <span>{formatToday()}</span>
                        <span>________________ / {session.user.name} /</span>
                      </div>
                    </article>

                  </div>

                  <div className="hr-employee-request-fields">
                    <h3>Заявление</h3>
                    <label className="hr-field">
                      <span>Организация</span>
                      <input value={organization} readOnly />
                    </label>
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
                    {isDateRangeInvalid && (
                      <p className="form-error" role="alert">Дата окончания не может быть раньше даты начала.</p>
                    )}
                  </div>

                  <div className="hr-employee-request-bottom">
                    <label className="hr-field hr-employee-request-reason">
                      <span>Причина</span>
                      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required />
                    </label>

                    <div className="hr-template-preview__actions">
                      <button className="button" type="submit" disabled={isSubmitting || !period || !reason.trim() || isDateRangeInvalid}>
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
            <article className="hr-request-row hr-request-row--employee" key={request.id}>
              <span className="hr-request-row__body">
                <span className="hr-request-row__summary">
                  <strong>{requestTypeLabels[request.type]}</strong>
                  <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
                </span>
                <time className="hr-request-row__date" dateTime={request.submittedAt.toISOString()}>
                  {formatRequestDate(request.submittedAt)}
                </time>
              </span>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
};

export default EmployeeRequestsPage;
