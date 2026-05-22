import React from 'react';
import type { HrRequest } from '../../types';
import { requestStatusLabels, requestTypeLabels } from './hrMockData';

interface HrArchiveTabProps {
  requests: HrRequest[];
  isLoading?: boolean;
}

const archiveStatuses = new Set<HrRequest['status']>(['approved', 'rejected', 'archived']);

const formatArchiveDate = (value: Date) => value.toISOString().slice(0, 10);

const HrArchiveTab: React.FC<HrArchiveTabProps> = ({ requests, isLoading = false }) => {
  const archiveRequests = requests.filter((request) => archiveStatuses.has(request.status));

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
              </tr>
            ))
          ) : archiveRequests.length === 0 ? (
            <tr>
              <td colSpan={5}>Архив пока пуст.</td>
            </tr>
          ) : archiveRequests.map((request) => {
            const decisionDate = formatArchiveDate(request.decidedAt ?? request.updatedAt);
            return (
              <tr key={request.id}>
                <td>{request.employeeName}</td>
                <td>{requestTypeLabels[request.type]}</td>
                <td><span className={`hr-status hr-status--${request.status}`}>{requestStatusLabels[request.status]}</span></td>
                <td><time dateTime={decisionDate}>{decisionDate}</time></td>
                <td>{request.decidedByName || 'HR'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default HrArchiveTab;
