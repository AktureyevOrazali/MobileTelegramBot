import React, { useMemo, useState } from 'react';
import { hrRequests, requestStatusLabels, requestTypeLabels } from './hrMockData';

const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const HrRequestsTab: React.FC = () => {
  const [selectedRequestId, setSelectedRequestId] = useState(hrRequests[0]?.id ?? '');

  const selectedRequest = useMemo(
    () => hrRequests.find((request) => request.id === selectedRequestId) ?? hrRequests[0],
    [selectedRequestId],
  );

  if (!selectedRequest) {
    return null;
  }

  const selectedSummary = selectedRequest.id === 'req-2026-001'
    ? 'Ежегодный оплачиваемый отпуск на 6 рабочих дней.'
    : selectedRequest.summary;

  return (
    <div className="hr-requests-grid">
      <div className="hr-request-list" aria-label="Заявления сотрудников">
        {hrRequests.map((request) => (
          <button
            key={request.id}
            type="button"
            className={`hr-request-row ${request.id === selectedRequest.id ? 'hr-request-row--active' : ''}`}
            onClick={() => setSelectedRequestId(request.id)}
          >
            <img className="hr-avatar" src={request.employeePhotoUrl} alt="" />
            <span className="hr-request-row__body">
              <strong>{request.employeeName}</strong>
              <span>{request.department}</span>
              <span className="hr-request-row__meta">
                <span className="hr-badge">{requestTypeLabels[request.type]}</span>
                <span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span>
              </span>
            </span>
            <time className="hr-request-row__date" dateTime={request.updatedAt}>{formatDate(request.updatedAt)}</time>
          </button>
        ))}
      </div>

      <article className="hr-detail-card">
        <div className="hr-detail-card__header">
          <span className="hr-badge">{requestTypeLabels[selectedRequest.type]}</span>
          <span className={`hr-status hr-status--${selectedRequest.status}`}>{requestStatusLabels[selectedRequest.status]}</span>
        </div>
        <h3>{selectedRequest.employeeName}</h3>
        <p>{selectedSummary}</p>

        <dl className="hr-meta-list">
          <div>
            <dt>Период</dt>
            <dd>{selectedRequest.period}</dd>
          </div>
          <div>
            <dt>Подано</dt>
            <dd><time dateTime={selectedRequest.submittedAt}>{formatDate(selectedRequest.submittedAt)}</time></dd>
          </div>
        </dl>

        <div className="hr-approval-chain" aria-label="Маршрут согласования">
          {selectedRequest.approvalChain.map((step) => (
            <span className="hr-badge" key={step}>{step}</span>
          ))}
        </div>

        <div className="hr-detail-card__actions">
          <button className="button" type="button">Одобрить</button>
          <button className="button secondary" type="button">Отклонить</button>
          <button className="button secondary" type="button">Запросить данные</button>
        </div>
      </article>
    </div>
  );
};

export default HrRequestsTab;
