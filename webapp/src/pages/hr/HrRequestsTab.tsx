import React, { useEffect, useMemo, useState } from 'react';
import type { HrRequest, HrRequestStatus, HrSignature } from '../../types';
import { requestStatusLabels, requestTypeLabels } from './hrMockData';
import { signWithNcalayer } from '../../services/ncalayer';

interface HrRequestsTabProps {
  requests: HrRequest[];
  isLoading?: boolean;
  onDecide?: (
    requestId: number,
    status: Extract<HrRequestStatus, 'approved' | 'rejected' | 'needsInfo'>,
    comment?: string,
    hrSignature?: HrSignature | null,
  ) => Promise<void> | void;
  onDownload?: (requestId: number, format: 'doc' | 'pdf') => Promise<void> | void;
}

const skeletonItems = Array.from({ length: 7 }, (_, index) => index);
const skeletonStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);

const HrRequestsLoadingSkeleton: React.FC = () => (
  <div className="hr-requests-grid" role="status" aria-live="polite" aria-busy="true">
    <span className="sr-only">Loading HR requests</span>
    <div className="hr-request-list" aria-hidden="true">
      {skeletonItems.map((item) => (
        <div
          className="hr-request-row hr-request-row--skeleton skeleton-unit"
          data-testid="hr-request-row-skeleton"
          key={item}
          style={skeletonStyle(item)}
        />
      ))}
    </div>

    <article className="hr-detail-card hr-detail-card--loading" aria-hidden="true">
      <div className="hr-detail-card__header">
        <span className="skeleton-unit hr-detail-card__title-skeleton" />
        <div className="hr-detail-card__header-actions">
          <span className="skeleton-unit hr-detail-card__pill-skeleton" />
          <span className="skeleton-unit hr-detail-card__button-skeleton" />
          <span className="skeleton-unit hr-detail-card__button-skeleton" />
        </div>
      </div>
      <div className="hr-document-preview-shell">
        <article
          className="hr-document-preview hr-document-preview--skeleton skeleton-unit"
          data-testid="hr-document-preview-skeleton"
        />
      </div>
      <span className="skeleton-unit hr-decision-comment-skeleton" />
      <div className="hr-detail-card__actions">
        <span className="skeleton-unit hr-detail-card__button-skeleton hr-detail-card__button-skeleton--primary" />
        <span className="skeleton-unit hr-detail-card__button-skeleton" />
        <span className="skeleton-unit hr-detail-card__button-skeleton hr-detail-card__button-skeleton--wide" />
      </div>
    </article>
  </div>
);

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

const requestEmployeePosition = (request: HrRequest) => {
  const position = request.values.position ?? request.values.jobTitle ?? request.values.job_title;
  return typeof position === 'string' && position.trim() ? position.trim() : 'сотрудника';
};

const eventActionLabel = (action: HrRequest['events'][number]['action']) => {
  if (action === 'created') return 'Создано';
  return requestStatusLabels[action];
};

const HrRequestsTab: React.FC<HrRequestsTabProps> = ({
  requests,
  isLoading = false,
  onDecide,
  onDownload,
}) => {
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(requests[0]?.id ?? null);
  const [decisionComment, setDecisionComment] = useState('');
  const [isDeciding, setIsDeciding] = useState(false);
  const [isSigningDecision, setIsSigningDecision] = useState<'approved' | 'rejected' | null>(null);
  const [decisionSignature, setDecisionSignature] = useState<{ status: 'approved' | 'rejected'; signature: HrSignature } | null>(null);

  useEffect(() => {
    if (selectedRequestId === null || !requests.some((request) => request.id === selectedRequestId)) {
      setSelectedRequestId(requests[0]?.id ?? null);
    }
  }, [requests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) ?? requests[0],
    [requests, selectedRequestId],
  );

  useEffect(() => {
    setDecisionComment('');
  }, [selectedRequest?.id]);

  useEffect(() => {
    setDecisionSignature(null);
  }, [selectedRequest?.id, decisionComment]);

  const handleSignDecision = async (status: 'approved' | 'rejected') => {
    if (!selectedRequest || isSigningDecision) return;
    setIsSigningDecision(status);
    try {
      const signature = await signWithNcalayer({
        action: status,
        requestId: selectedRequest.id,
        employeeId: selectedRequest.employeeId,
        employeeName: selectedRequest.employeeName,
        requestStatus: selectedRequest.status,
        statement: requestStatement(selectedRequest),
        comment: decisionComment.trim(),
      });
      setDecisionSignature({ status, signature });
    } finally {
      setIsSigningDecision(null);
    }
  };

  const handleDecision = async (status: 'approved' | 'rejected' | 'needsInfo') => {
    if (!onDecide || !selectedRequest || isDeciding) return;
    const finalDecision = status === 'approved' || status === 'rejected';
    const matchingSignature = finalDecision && decisionSignature?.status === status ? decisionSignature.signature : null;
    if (finalDecision && !matchingSignature) return;
    setIsDeciding(true);
    try {
      await onDecide(selectedRequest.id, status, decisionComment.trim(), matchingSignature);
      setDecisionComment('');
      setDecisionSignature(null);
    } finally {
      setIsDeciding(false);
    }
  };

  if (isLoading) {
    return <HrRequestsLoadingSkeleton />;
  }

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
                <span className="hr-badge">{requestTypeLabels[request.type]}</span>
                <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
              </span>
            </span>
            <time className="hr-request-row__date" dateTime={request.updatedAt.toISOString()}>{formatDate(request.updatedAt)}</time>
          </button>
        ))}
      </div>

      <article className="hr-detail-card">
        <div className="hr-detail-card__header">
          <span className="hr-detail-card__employee">{selectedRequest.employeeName}</span>
          <div className="hr-detail-card__header-actions">
            <span className={`hr-status hr-status--${selectedRequest.status}`}>{requestStatusLabels[selectedRequest.status]}</span>
            <button className="button secondary hr-export-button" type="button" onClick={() => onDownload?.(selectedRequest.id, 'doc')}>Word</button>
            <button className="button secondary hr-export-button" type="button" onClick={() => onDownload?.(selectedRequest.id, 'pdf')}>PDF</button>
          </div>
        </div>
        <div className="hr-document-preview-shell">
          <article className="hr-document-preview" aria-label="Форма заявления">
            <div className="hr-document-preview__to">
              <span>Директору организации "{requestOrganization(selectedRequest)}"</span>
              <span>от {requestEmployeePosition(selectedRequest)} {selectedRequest.employeeName}</span>
            </div>
            <div className="hr-document-preview__body">
              <h3>Заявление</h3>
              <p>{requestStatement(selectedRequest)}</p>
            </div>
            <div className="hr-document-preview__footer">
              <span>{formatDocumentDate()}</span>
              <span>________________ / {selectedRequest.employeeName} /</span>
            </div>
          </article>
        </div>

        {selectedRequest.decisionComment && (
          <div className="hr-approval-chain" aria-label="Решение HR">
            <span className="hr-badge">{selectedRequest.decisionComment}</span>
          </div>
        )}

        {selectedRequest.events.length > 0 && (
          <section className="hr-request-history" aria-label="HR request history">
            <h4>История</h4>
            <ol>
              {selectedRequest.events.map((event) => (
                <li key={event.id}>
                  <span className="hr-request-history__marker" aria-hidden="true" />
                  <div>
                    <div className="hr-request-history__header">
                      <strong>{event.actorName || 'HR'}</strong>
                      <span>{eventActionLabel(event.action)}</span>
                    </div>
                    {event.comment && <p>{event.comment}</p>}
                    <time dateTime={event.createdAt.toISOString()}>{formatDate(event.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        <label className="hr-field hr-decision-comment">
          <span>Комментарий HR</span>
          <textarea
            aria-label="HR comment"
            rows={3}
            value={decisionComment}
            onChange={(event) => setDecisionComment(event.target.value)}
            placeholder="Например: приложите справку или уточните период"
          />
        </label>

        <div className="hr-detail-card__actions">
          <button className="button secondary" type="button" disabled={isDeciding || Boolean(isSigningDecision)} onClick={() => handleSignDecision('approved')}>
            {isSigningDecision === 'approved' ? 'Подписание...' : 'Подписать одобрение ЭЦП'}
          </button>
          <button className="button secondary" type="button" disabled={isDeciding || Boolean(isSigningDecision)} onClick={() => handleSignDecision('rejected')}>
            {isSigningDecision === 'rejected' ? 'Подписание...' : 'Подписать отклонение ЭЦП'}
          </button>
          {decisionSignature && <span className="hr-badge">Решение подписано ЭЦП</span>}
          <button className="button" type="button" data-testid="hr-approve-request" disabled={isDeciding || decisionSignature?.status !== 'approved'} onClick={() => handleDecision('approved')}>Одобрить</button>
          <button className="button secondary" type="button" disabled={isDeciding || decisionSignature?.status !== 'rejected'} onClick={() => handleDecision('rejected')}>Отклонить</button>
          <button className="button secondary" type="button" disabled={isDeciding} onClick={() => handleDecision('needsInfo')}>Запросить данные</button>
        </div>
      </article>
    </div>
  );
};

export default HrRequestsTab;
