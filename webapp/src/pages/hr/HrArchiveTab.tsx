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

const HrArchiveTab: React.FC<HrArchiveTabProps> = ({ requests, isLoading = false, onDecide }) => {
  const [decidingRequestId, setDecidingRequestId] = React.useState<number | null>(null);
  const archiveRequests = requests.filter((request) => archiveStatuses.has(request.status));

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
              <tr key={request.id}>
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
                      onClick={() => handleDecision(request.id, 'approved')}
                    >
                      Одобрить
                    </button>
                    <button
                      className="button secondary hr-archive-action"
                      data-testid={`hr-archive-reject-${request.id}`}
                      disabled={!onDecide || isDeciding || request.status === 'rejected'}
                      type="button"
                      onClick={() => handleDecision(request.id, 'rejected')}
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
  );
};

export default HrArchiveTab;
