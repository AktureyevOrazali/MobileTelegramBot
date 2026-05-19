import React from 'react';
import { hrArchiveItems, requestStatusLabels, requestTypeLabels } from './hrMockData';

const HrArchiveTab: React.FC = () => (
  <div className="hr-archive-table-wrap">
    <table className="hr-archive-table">
      <thead>
        <tr>
          <th scope="col">Сотрудник</th>
          <th scope="col">Тип</th>
          <th scope="col">Статус</th>
          <th scope="col">Дата <span className="sr-only">decision-date</span></th>
          <th scope="col">Ответственный</th>
        </tr>
      </thead>
      <tbody>
        {hrArchiveItems.map((item) => (
          <tr key={item.id}>
            <td>{item.employeeName}</td>
            <td>{requestTypeLabels[item.type]}</td>
            <td><span className={`hr-status hr-status--${item.finalStatus}`}>{requestStatusLabels[item.finalStatus]}</span></td>
            <td><time dateTime={item.decisionDate}>{item.decisionDate}</time></td>
            <td>{item.responsible}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default HrArchiveTab;
