import React, { useEffect, useMemo, useState } from 'react';
import type { HrEmployee } from '../../types';

interface HrEmployeesTabProps {
  employees: HrEmployee[];
  isLoading?: boolean;
  onUpdateEmployee?: (employee: HrEmployee) => Promise<void> | void;
}

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'HR';

const createDraft = (employee: HrEmployee) => ({
  jobTitle: employee.jobTitle || 'Сотрудник',
  role: employee.role,
  phone: employee.phone,
  email: employee.email,
  schedule: employee.schedule,
});

const HrEmployeesTab: React.FC<HrEmployeesTabProps> = ({ employees, isLoading = false, onUpdateEmployee }) => {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(employees[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const filteredEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return employees;
    return employees.filter((employee) => (
      employee.name.toLowerCase().includes(normalized)
      || employee.email.toLowerCase().includes(normalized)
      || employee.login.toLowerCase().includes(normalized)
      || employee.jobTitle.toLowerCase().includes(normalized)
    ));
  }, [employees, query]);

  const selectedEmployee = useMemo(
    () => (selectedEmployeeId === null
      ? null
      : filteredEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null),
    [filteredEmployees, selectedEmployeeId],
  );

  const [draft, setDraft] = useState(() => (selectedEmployee ? createDraft(selectedEmployee) : null));

  useEffect(() => {
    if (selectedEmployeeId !== null && !employees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(employees[0]?.id ?? null);
    }
  }, [employees, selectedEmployeeId]);

  useEffect(() => {
    setDraft(selectedEmployee ? createDraft(selectedEmployee) : null);
    setIsEditing(false);
  }, [selectedEmployee]);

  const updateDraft = (field: keyof NonNullable<typeof draft>, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSave = async () => {
    if (!selectedEmployee || !draft) return;
    await onUpdateEmployee?.({
      ...selectedEmployee,
      jobTitle: draft.jobTitle.trim(),
      role: draft.role.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      schedule: draft.schedule.trim() || '09:00-18:00',
    });
    setIsEditing(false);
  };

  return (
    <div className="hr-employees-layout">
      <div className="hr-employees-main">
        <label className="hr-search-field">
          <span>Поиск сотрудника</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, email, логин или должность"
          />
        </label>

        <div className="hr-employee-grid" aria-label="Карточки сотрудников">
          {isLoading && <div className="hr-detail-card">Загружаем сотрудников...</div>}
          {!isLoading && filteredEmployees.length === 0 && <div className="hr-detail-card">Сотрудники не найдены.</div>}
          {filteredEmployees.map((employee) => (
            <button
              className="hr-employee-card"
              data-testid="hr-employee-card"
              key={employee.id}
              type="button"
              aria-pressed={selectedEmployee?.id === employee.id}
              onClick={() => {
                setSelectedEmployeeId(employee.id);
                setIsEditing(false);
              }}
            >
              <span className="hr-avatar hr-avatar--initials" aria-hidden="true">{initials(employee.name)}</span>
              <strong>{employee.name}</strong>
              <span>{employee.jobTitle || 'Сотрудник'}</span>
              <small>{employee.schedule}</small>
            </button>
          ))}
        </div>
      </div>

      {selectedEmployee && (
        <aside className="hr-side-panel" aria-label="Профиль сотрудника">
          <div className="hr-side-panel__actions">
            <button className="hr-side-panel__close" type="button" onClick={() => setSelectedEmployeeId(null)}>
              Закрыть
            </button>
          </div>
          <div className="hr-side-panel__identity">
            <span className="hr-avatar hr-avatar--initials" aria-hidden="true">{initials(selectedEmployee.name)}</span>
            <div>
              <h3>{selectedEmployee.name}</h3>
              <span>{selectedEmployee.email}</span>
            </div>
          </div>

          {isEditing && draft ? (
            <form
              className="hr-employee-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSave();
              }}
            >
              <label className="hr-field">
                <span>Должность</span>
                <input value={draft.jobTitle} onChange={(event) => updateDraft('jobTitle', event.target.value)} />
              </label>
              <label className="hr-field">
                <span>Роль</span>
                <input value={draft.role} onChange={(event) => updateDraft('role', event.target.value)} />
              </label>
              <label className="hr-field">
                <span>Телефон</span>
                <input value={draft.phone} onChange={(event) => updateDraft('phone', event.target.value)} />
              </label>
              <label className="hr-field">
                <span>Email</span>
                <input type="email" value={draft.email} onChange={(event) => updateDraft('email', event.target.value)} />
              </label>
              <label className="hr-field">
                <span>График</span>
                <input value={draft.schedule} onChange={(event) => updateDraft('schedule', event.target.value)} />
              </label>
              <div className="hr-side-panel__footer">
                <button className="button secondary" type="button" onClick={() => setIsEditing(false)}>Отмена</button>
                <button className="button" type="submit">Сохранить</button>
              </div>
            </form>
          ) : (
            <>
              <dl className="hr-form-grid">
                <div>
                  <dt>Должность</dt>
                  <dd>{selectedEmployee.jobTitle || 'Сотрудник'}</dd>
                </div>
                <div>
                  <dt>Роль</dt>
                  <dd>{selectedEmployee.role}</dd>
                </div>
                <div>
                  <dt>Телефон</dt>
                  <dd>{selectedEmployee.phone || 'Не указан'}</dd>
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
              <div className="hr-side-panel__footer">
                <button className="button" type="button" onClick={() => setIsEditing(true)}>Редактировать данные</button>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
};

export default HrEmployeesTab;
