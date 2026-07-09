import React from 'react';
import type { HrRequest, HrSignature } from '../../types';
import { requestStatusLabels, requestTypeLabels } from './hrMockData';
import { signWithNcalayer } from '../../services/ncalayer';

interface HrArchiveTabProps {
  requests: HrRequest[];
  isLoading?: boolean;
  onDecide?: (
    requestId: number,
    status: 'approved' | 'rejected',
    comment?: string,
    hrSignature?: HrSignature | null,
  ) => Promise<void> | void;
}

const archiveStatuses = new Set<HrRequest['status']>(['approved', 'rejected', 'archived']);

const formatArchiveDate = (value: Date) => value.toISOString().slice(0, 10);
const formatSignatureDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU').format(date);
};

const normalizeSentence = (value: string) => {
  const sentence = value.trim().replace(/\s+/g, ' ');
  if (!sentence) return '';
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

const requestStatement = (request: HrRequest) => {
  if (typeof request.values.statement === 'string' && request.values.statement.trim()) {
    const statement = normalizeSentence(request.values.statement);
    if (!statement.includes('????')) return statement;
  }
  if (request.renderedText.trim() && !request.renderedText.includes('????')) {
    return normalizeSentence(request.renderedText);
  }
  const prefix = `Я, ${request.employeeName},`;
  if (request.type === 'advance') {
    const amount = typeof request.values.amount === 'string' && request.values.amount.trim() ? request.values.amount.trim() : '____';
    const reason = typeof request.values.reason === 'string' && request.values.reason.trim()
      ? request.values.reason.trim()
      : request.summary || request.period || '_____________________';
    return normalizeSentence(`Прошу выдать мне аванс в размере ${amount} в счет заработной платы, в связи с ${reason}`);
  }
  if (request.type === 'vacation') {
    return normalizeSentence(`${prefix} прошу предоставить отпуск на период ${request.period} в связи с ${request.summary}`);
  }
  if (request.type === 'businessTrip') {
    return normalizeSentence(`${prefix} прошу оформить командировку на период ${request.period} с целью ${request.summary}`);
  }
  return normalizeSentence(`${prefix} прошу рассмотреть заявление по причине ${request.summary || request.period}`);
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

const HrArchiveTab: React.FC<HrArchiveTabProps> = ({ requests, isLoading = false, onDecide }) => {
  const [decidingRequestId, setDecidingRequestId] = React.useState<number | null>(null);
  const archiveRequests = React.useMemo(
    () => requests.filter((request) => archiveStatuses.has(request.status)),
    [requests],
  );
  const [selectedRequestId, setSelectedRequestId] = React.useState<number | null>(archiveRequests[0]?.id ?? null);
  const selectedRequest = archiveRequests.find((request) => request.id === selectedRequestId) ?? archiveRequests[0] ?? null;

  React.useEffect(() => {
    if (archiveRequests.length === 0) {
      setSelectedRequestId(null);
      return;
    }
    if (!archiveRequests.some((request) => request.id === selectedRequestId)) {
      setSelectedRequestId(archiveRequests[0].id);
    }
  }, [archiveRequests, selectedRequestId]);

  const handleDecision = async (requestId: number, status: 'approved' | 'rejected') => {
    if (!onDecide || decidingRequestId !== null) return;
    const request = requests.find((item) => item.id === requestId);
    if (!request) return;
    setDecidingRequestId(requestId);
    try {
      const signature = await signWithNcalayer({
        action: status,
        requestId: request.id,
        employeeId: request.employeeId,
        employeeName: request.employeeName,
        requestStatus: request.status,
        statement: request.renderedText || request.values.statement || request.summary,
        comment: '',
      });
      await onDecide(requestId, status, '', signature);
    } finally {
      setDecidingRequestId(null);
    }
  };

  return (
    <div className="hr-archive-layout">
      <div className="hr-archive-table-wrap">
        <table className="hr-archive-table">
          <thead>
            <tr>
              <th scope="col">Сотрудник</th>
              <th scope="col">Тип</th>
              <th scope="col">Статус</th>
              <th scope="col">Дата</th>
              <th scope="col">Ответственный</th>
              <th scope="col">Решение</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }, (_, index) => (
                <tr className="hr-archive-row--skeleton" data-testid="hr-archive-row-skeleton" key={index}>
                  <td><span className="skeleton-unit hr-archive-cell-skeleton" /></td>
                  <td><span className="skeleton-unit hr-archive-cell-skeleton hr-archive-cell-skeleton--short" /></td>
                  <td><span className="skeleton-unit hr-detail-card__pill-skeleton" /></td>
                  <td><span className="skeleton-unit hr-archive-cell-skeleton hr-archive-cell-skeleton--short" /></td>
                  <td><span className="skeleton-unit hr-archive-cell-skeleton" /></td>
                  <td><span className="skeleton-unit hr-archive-cell-skeleton hr-archive-cell-skeleton--short" /></td>
                </tr>
              ))
            ) : archiveRequests.length === 0 ? (
              <tr>
                <td colSpan={6}>Архив пока пуст.</td>
              </tr>
            ) : archiveRequests.map((request) => {
              const decisionDate = formatArchiveDate(request.decidedAt ?? request.updatedAt);
              const isDeciding = decidingRequestId === request.id;
              return (
                <tr
                  className={request.id === selectedRequest?.id ? 'hr-archive-row--active' : ''}
                  key={request.id}
                  onClick={() => setSelectedRequestId(request.id)}
                >
                  <td>{request.employeeName}</td>
                  <td>{requestTypeLabels[request.type]}</td>
                  <td><span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span></td>
                  <td><time dateTime={decisionDate}>{decisionDate}</time></td>
                  <td>{request.decidedByName || 'HR'}</td>
                  <td>
                    <div className="hr-archive-actions">
                      <button
                        className="button secondary hr-archive-action"
                        data-testid={`hr-archive-approve-${request.id}`}
                        disabled={!onDecide || isDeciding || request.status === 'approved'}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDecision(request.id, 'approved');
                        }}
                      >
                        Одобрить
                      </button>
                      <button
                        className="button secondary hr-archive-action"
                        data-testid={`hr-archive-reject-${request.id}`}
                        disabled={!onDecide || isDeciding || request.status === 'rejected'}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDecision(request.id, 'rejected');
                        }}
                      >
                        Отклонить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <article className="hr-archive-preview" aria-label="Шаблон архивного заявления">
        {isLoading ? (
          <article className="hr-document-preview hr-document-preview--skeleton skeleton-unit" data-testid="hr-archive-document-skeleton" />
        ) : selectedRequest ? (
          <>
            <div className="hr-archive-preview__header">
              <strong>{selectedRequest.templateTitle || requestTypeLabels[selectedRequest.type]}</strong>
              <span className={`hr-status hr-status--${selectedRequest.status}`}>{requestStatusLabels[selectedRequest.status]}</span>
            </div>
            <article className="hr-document-preview hr-document-preview--hr-detail" aria-label="Форма архивного заявления">
              <div className="hr-document-preview__to">
                <span>Директору организации "{requestOrganization(selectedRequest)}"</span>
                <span>от {requestEmployeePosition(selectedRequest)} {selectedRequest.employeeName}</span>
              </div>
              <div className="hr-document-preview__body">
                <h3>Заявление</h3>
                <p>{requestStatement(selectedRequest)}</p>
              </div>
              <div className="hr-document-preview__footer">
                <span>{formatSignatureDate(selectedRequest.employeeSignature?.signedAt) || formatArchiveDate(selectedRequest.submittedAt)}</span>
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
          </>
        ) : (
          <p>Выберите архивное заявление.</p>
        )}
      </article>
    </div>
  );
};

export default HrArchiveTab;
