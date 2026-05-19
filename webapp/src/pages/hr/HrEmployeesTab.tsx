import React, { useState } from 'react';
import { hrEmployees } from './hrMockData';
import type { HrEmployee } from './hrTypes';

const completenessLabel = (employee: HrEmployee) => (
  employee.documentCompleteness < 90 ? 'Документы неполные' : 'Документы готовы'
);

const HrEmployeesTab: React.FC = () => {
  const [selectedEmployee, setSelectedEmployee] = useState<HrEmployee | null>(null);

  return (
    <div className="hr-employees-layout">
      <div className="hr-employee-grid" aria-label="Карточки сотрудников">
        {hrEmployees.map((employee) => (
          <button
            className="hr-employee-card"
            data-testid="hr-employee-card"
            key={employee.id}
            type="button"
            aria-pressed={selectedEmployee?.id === employee.id}
            onClick={() => setSelectedEmployee(employee)}
          >
            <img className="hr-avatar" src={employee.photoUrl} alt="" />
            <span className="hr-employee-card__completion">{employee.documentCompleteness}%</span>
            <strong>{employee.fullName}</strong>
            <span>{employee.position}</span>
            <span>{employee.department}</span>
            <span className="hr-employee-card__badges">
              {employee.statuses.map((status) => (
                <span className="hr-badge" key={status}>{status}</span>
              ))}
              <span className="hr-status">{completenessLabel(employee)}</span>
            </span>
          </button>
        ))}
      </div>

      {selectedEmployee && (
        <aside className="hr-side-panel" aria-label="Профиль сотрудника">
          <button className="hr-side-panel__close" type="button" onClick={() => setSelectedEmployee(null)}>
            Закрыть
          </button>
          <img className="hr-avatar" src={selectedEmployee.photoUrl} alt="" />
          <h3>{selectedEmployee.fullName}</h3>
          <dl className="hr-form-grid">
            <div>
              <dt>Должность</dt>
              <dd>{selectedEmployee.position}</dd>
            </div>
            <div>
              <dt>Подразделение</dt>
              <dd>{selectedEmployee.department}</dd>
            </div>
            <div>
              <dt>Локация</dt>
              <dd>{selectedEmployee.location}</dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>{selectedEmployee.phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{selectedEmployee.email}</dd>
            </div>
            <div>
              <dt>График</dt>
              <dd>{selectedEmployee.schedule}</dd>
            </div>
          </dl>
        </aside>
      )}
    </div>
  );
};

export default HrEmployeesTab;
