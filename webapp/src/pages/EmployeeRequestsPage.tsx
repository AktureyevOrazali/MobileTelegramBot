import React, { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/ApiClient';
import type { AuthSession, HrRequest, HrTemplate } from '../types';
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

const organizations = [
  'ТОО "Smart Hub"',
  'ТОО "Операционный центр"',
  'АО "Информационные системы"',
];

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
  const [organization, setOrganization] = useState(organizations[0]);
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
  const period = useMemo(() => buildPeriodLabel(startDate, endDate), [startDate, endDate]);
  const values = useMemo(
    () => buildAutoValues(selectedTemplate, session, startDate, endDate, reason, organization),
    [selectedTemplate, session, startDate, endDate, reason, organization],
  );
  const previewText = buildRequestStatement(selectedTemplate, session.user.name, period, reason)
    || (selectedTemplate ? renderTemplate(selectedTemplate.body, values) : '');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTemplate || !period || !reason.trim()) return;
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

  const handleDownload = async (requestId: number, format: 'doc' | 'pdf') => {
    try {
      await apiClient.downloadHrRequestDocument(requestId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скачать заявление.');
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

      <section className="hr-request-wizard">
        <div className="hr-template-list" aria-label="Шаблоны заявлений">
          {templates.map((template) => (
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
            <p>Загружаем шаблоны заявлений...</p>
          ) : selectedTemplate ? (
            <>
              <div className="hr-detail-card__header">
                <span className="hr-badge">Заявление</span>
                <span className="hr-status">Автозаполнение</span>
              </div>
              <h3>Заявление</h3>
              <label className="hr-field">
                <span>Организация</span>
                <select value={organization} onChange={(event) => setOrganization(event.target.value)}>
                  {organizations.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div className="hr-form-grid hr-form-grid--two">
                <label className="hr-field">
                  <span>Дата начала</span>
                  <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
                </label>
                <label className="hr-field">
                  <span>Дата окончания</span>
                  <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
                </label>
              </div>
              <label className="hr-field">
                <span>Причина</span>
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required />
              </label>

              <article className="hr-document-preview" aria-label="Предпросмотр заявления">
                <div className="hr-document-preview__to">
                  <span>Директору</span>
                  <span>{organization}</span>
                </div>
                <h3>Заявление</h3>
                <p>{previewText}</p>
                <div className="hr-document-preview__footer">
                  <span>{formatToday()}</span>
                  <span>________________ / {session.user.name} /</span>
                </div>
              </article>

              <div className="hr-template-preview__actions">
                <button className="button" type="submit" disabled={isSubmitting || !period || !reason.trim()}>
                  Отправить заявление
                </button>
              </div>
            </>
          ) : (
            <p>Кадровик еще не создал активные шаблоны заявлений.</p>
          )}
        </form>
      </section>

      <section className="hr-request-list" aria-label="Мои отправленные заявления">
        {!isLoading && requests.length === 0 && (
          <article className="hr-detail-card">
            <p>Вы еще не отправляли заявления.</p>
          </article>
        )}
        {requests.map((request) => (
          <article className="hr-request-row hr-request-row--document" key={request.id}>
            <span className="hr-request-row__body">
              <strong>Заявление</strong>
              <span>{request.period || request.summary}</span>
              <span className="hr-request-row__meta">
                <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
              </span>
            </span>
            <span className="hr-request-row__actions">
              <button className="button secondary" type="button" onClick={() => handleDownload(request.id, 'doc')}>Word</button>
              <button className="button secondary" type="button" onClick={() => handleDownload(request.id, 'pdf')}>PDF</button>
            </span>
          </article>
        ))}
      </section>
    </div>
  );
};

export default EmployeeRequestsPage;
