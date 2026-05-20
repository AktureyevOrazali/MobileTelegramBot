import React, { useEffect, useMemo, useState } from 'react';
import type { HrRequest } from '../../types';
import { requestStatusLabels } from './hrMockData';

interface HrRequestsTabProps {
  requests: HrRequest[];
  onDecide?: (requestId: number, status: 'approved' | 'rejected' | 'needsInfo') => Promise<void> | void;
  onDownload?: (requestId: number, format: 'doc' | 'pdf') => Promise<void> | void;
}

const formatDate = (value: Date | string) => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const formatDocumentDate = () => new Intl.DateTimeFormat('ru-RU').format(new Date());

const normalizeSentence = (value: string) => {
  const sentence = value.trim().replace(/\s+/g, ' ');
  if (!sentence) return '';
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const requestStatement = (request: HrRequest) => {
  if (typeof request.values.statement === 'string' && request.values.statement.trim()) {
    return normalizeSentence(request.values.statement);
  }
  const renderedText = request.renderedText.trim();
  if (/^я,\s/i.test(renderedText)) return renderedText;
  const prefix = `Я, ${request.employeeName},`;
  const reason = request.summary.trim();
  switch (request.type) {
    case 'advance':
      return normalizeSentence(`${prefix} запрашиваю аванс ${reason || request.period}`);
    case 'vacation':
      return normalizeSentence(`${prefix} прошу предоставить отпуск на период ${request.period} в связи с ${reason}`);
    case 'businessTrip':
      return normalizeSentence(`${prefix} прошу оформить командировку на период ${request.period} с целью ${reason}`);
    case 'certificate':
      return normalizeSentence(`${prefix} прошу подготовить справку с места работы для ${reason || 'предоставления по месту требования'}`);
    case 'sickLeave':
      return normalizeSentence(`${prefix} прошу оформить отсутствие по болезни на период ${request.period} по причине ${reason}`);
    default:
      return normalizeSentence(`${prefix} прошу рассмотреть заявление на период ${request.period} по причине ${reason}`);
  }
};

const requestOrganization = (request: HrRequest) => (
  typeof request.values.organization === 'string' && request.values.organization.trim()
    ? request.values.organization.trim()
    : 'организации'
);

const HrRequestsTab: React.FC<HrRequestsTabProps> = ({ requests, onDecide, onDownload }) => {
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(requests[0]?.id ?? null);

  useEffect(() => {
    if (selectedRequestId === null || !requests.some((request) => request.id === selectedRequestId)) {
      setSelectedRequestId(requests[0]?.id ?? null);
    }
  }, [requests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? requests[0],
    [requests, selectedRequestId],
  );

  if (!selectedRequest) {
    return <div className="hr-detail-card">Заявлений пока нет.</div>;
  }

  return (
    <div className="hr-requests-grid">
      <div className="hr-request-list" aria-label="Заявления сотрудников">
        {requests.map((request) => (
          <button
            key={request.id}
            type="button"
            aria-pressed={request.id === selectedRequest.id}
            className={`hr-request-row ${request.id === selectedRequest.id ? 'hr-request-row--active' : ''}`}
            onClick={() => setSelectedRequestId(request.id)}
          >
            <span className="hr-avatar hr-avatar--initials" aria-hidden="true">
              {request.employeeName.slice(0, 2).toUpperCase()}
            </span>
            <span className="hr-request-row__body">
              <strong>{request.employeeName}</strong>
              <span>{request.department}</span>
              <span className="hr-request-row__meta">
                <span className="hr-badge">Заявление</span>
                <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
              </span>
            </span>
            <time className="hr-request-row__date" dateTime={request.updatedAt.toISOString()}>{formatDate(request.updatedAt)}</time>
          </button>
        ))}
      </div>

      <article className="hr-detail-card">
        <div className="hr-detail-card__header">
          <span className="hr-badge">Заявление</span>
          <div className="hr-detail-card__header-actions">
            <span className={`hr-status hr-status--${selectedRequest.status}`}>{requestStatusLabels[selectedRequest.status]}</span>
            <button className="button secondary hr-export-button" type="button" onClick={() => onDownload?.(selectedRequest.id, 'doc')}>Word</button>
            <button className="button secondary hr-export-button" type="button" onClick={() => onDownload?.(selectedRequest.id, 'pdf')}>PDF</button>
          </div>
        </div>
        <h3>{selectedRequest.employeeName}</h3>
        <article className="hr-document-preview" aria-label="Форма заявления">
          <div className="hr-document-preview__to">
            <span>Директору</span>
            <span>{requestOrganization(selectedRequest)}</span>
          </div>
          <h3>Заявление</h3>
          <p>{requestStatement(selectedRequest)}</p>
          <div className="hr-document-preview__footer">
            <span>{formatDocumentDate()}</span>
            <span>________________ / {selectedRequest.employeeName} /</span>
          </div>
        </article>

        <dl className="hr-meta-list">
          <div>
            <dt>Период</dt>
            <dd>{selectedRequest.period || 'Не указан'}</dd>
          </div>
          <div>
            <dt>Подано</dt>
            <dd><time dateTime={selectedRequest.submittedAt.toISOString()}>{formatDate(selectedRequest.submittedAt)}</time></dd>
          </div>
        </dl>

        {selectedRequest.decisionComment && (
          <div className="hr-approval-chain" aria-label="Решение HR">
            <span className="hr-badge">{selectedRequest.decisionComment}</span>
          </div>
        )}

        <div className="hr-detail-card__actions">
          <button className="button" type="button" data-testid="hr-approve-request" onClick={() => onDecide?.(selectedRequest.id, 'approved')}>Одобрить</button>
          <button className="button secondary" type="button" onClick={() => onDecide?.(selectedRequest.id, 'rejected')}>Отклонить</button>
          <button className="button secondary" type="button" onClick={() => onDecide?.(selectedRequest.id, 'needsInfo')}>Запросить данные</button>
        </div>
      </article>
    </div>
  );
};

export default HrRequestsTab;
