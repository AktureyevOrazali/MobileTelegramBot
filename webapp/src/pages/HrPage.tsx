import React, { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/ApiClient';
import type { HrEmployee, HrRequest, HrTemplate } from '../types';
import HrArchiveTab from './hr/HrArchiveTab';
import HrCalendarTab from './hr/HrCalendarTab';
import HrEmployeesTab from './hr/HrEmployeesTab';
import { hrEmployees, hrRequests, hrTemplates } from './hr/hrMockData';
import HrRequestsTab from './hr/HrRequestsTab';
import HrTemplatesTab from './hr/HrTemplatesTab';

type HrTab = 'requests' | 'employees' | 'calendar' | 'templates' | 'archive';

interface HrPageProps {
  apiClient?: ApiClient;
}

const tabs: { id: HrTab; label: string }[] = [
  { id: 'requests', label: 'Заявления' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'templates', label: 'Шаблоны' },
  { id: 'archive', label: 'Архив' },
];

const mockRequests: HrRequest[] = hrRequests.map((request, index) => ({
  id: index + 1,
  templateId: null,
  templateTitle: '',
  type: request.type,
  employeeId: null,
  employeeName: request.employeeName,
  department: request.department,
  status: request.status,
  values: {},
  renderedText: request.summary,
  summary: request.summary,
  period: request.period,
  submittedAt: new Date(request.submittedAt),
  updatedAt: new Date(request.updatedAt),
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  decisionComment: '',
}));

const mockTemplates: HrTemplate[] = hrTemplates.map((template, index) => ({
  id: index + 1,
  title: template.title,
  type: template.type,
  description: '',
  body: template.preview,
  variables: template.variables,
  status: 'active',
  createdBy: null,
  createdAt: new Date(template.updatedAt),
  updatedAt: new Date(template.updatedAt),
}));

const mockEmployees: HrEmployee[] = hrEmployees.map((employee, index) => ({
  id: index + 1,
  email: employee.email,
  login: employee.email,
  name: employee.fullName,
  createdAt: new Date(employee.hireDate),
  jobTitle: employee.position,
  phone: employee.phone,
  bio: '',
  role: 'operator',
  isApproved: true,
  sections: [],
  bins: [],
  favoriteDialogIds: [],
  isAdmin: false,
  canReply: true,
  schedule: '09:00-18:00',
}));

const HrPage: React.FC<HrPageProps> = ({ apiClient }) => {
  const [activeTab, setActiveTab] = useState<HrTab>('requests');
  const [requests, setRequests] = useState<HrRequest[]>(mockRequests);
  const [templates, setTemplates] = useState<HrTemplate[]>(mockTemplates);
  const [employees, setEmployees] = useState<HrEmployee[]>(mockEmployees);
  const [isEmployeesLoading, setIsEmployeesLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!apiClient) return;
    const client = apiClient;
    let cancelled = false;
    async function loadHrData() {
      setIsEmployeesLoading(true);
      try {
        const [nextTemplates, nextRequests, nextEmployees] = await Promise.all([
          client.fetchHrTemplates(),
          client.fetchHrRequests(),
          client.fetchHrEmployees(),
        ]);
        if (cancelled) return;
        setTemplates(nextTemplates);
        setRequests(nextRequests);
        setEmployees(nextEmployees);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Не удалось загрузить HR-данные.');
      } finally {
        if (!cancelled) setIsEmployeesLoading(false);
      }
    }
    loadHrData();
    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const stats = useMemo(
    () => [
      { label: 'Новые заявления', value: requests.filter((request) => request.status === 'new').length },
      { label: 'Отпуска на неделе', value: requests.filter((request) => request.type === 'vacation').length },
      { label: 'Сотрудники', value: employees.length },
      { label: 'Документы на подпись', value: requests.filter((request) => request.status === 'new' || request.status === 'review').length },
    ],
    [requests, employees],
  );

  const handleDecision = async (requestId: number, status: 'approved' | 'rejected' | 'needsInfo') => {
    if (!apiClient) return;
    const updated = await apiClient.decideHrRequest(requestId, { status, comment: '' });
    setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
  };

  const handleCreateTemplate = async (template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => {
    if (!apiClient) return;
    const created = await apiClient.createHrTemplate(template);
    setTemplates((current) => [created, ...current]);
  };

  const handleUpdateTemplate = async (templateId: number, template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => {
    if (!apiClient) return;
    const updated = await apiClient.updateHrTemplate(templateId, template);
    setTemplates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleUpdateEmployee = (updatedEmployee: HrEmployee) => {
    setEmployees((current) => current.map((employee) => (
      employee.id === updatedEmployee.id ? updatedEmployee : employee
    )));
  };

  const handleDownload = async (requestId: number, format: 'doc' | 'pdf') => {
    if (!apiClient) return;
    try {
      await apiClient.downloadHrRequestDocument(requestId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скачать заявление.');
    }
  };

  return (
    <div className="hr-page" data-testid="hr-page-shell">
      <header className="hr-header">
        <div className="hr-header__top">
          <h2 className="hr-header__title">Кадры</h2>
          <div className="hr-header__actions" aria-label="Действия кадровика">
            <button className="button secondary" type="button">Добавить сотрудника</button>
            <button className="button" type="button" onClick={() => setActiveTab('templates')}>Создать шаблон</button>
          </div>
        </div>
        <div className="hr-stat-grid">
          {stats.map((stat) => (
            <div className="hr-stat-card" key={stat.label}>
              <span className="hr-stat-card__value">{stat.value}</span>
              <span className="hr-stat-card__label">{stat.label}</span>
            </div>
          ))}
        </div>
        <div className="hr-tabs" role="tablist" aria-label="Разделы кадровика">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`hr-tab ${activeTab === tab.id ? 'hr-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <section className={`hr-panel hr-panel--${activeTab}`}>
        {error && <div className="form-error">{error}</div>}
        {activeTab === 'requests' && <HrRequestsTab requests={requests} onDecide={handleDecision} onDownload={handleDownload} />}
        {activeTab === 'employees' && (
          <HrEmployeesTab
            employees={employees}
            isLoading={isEmployeesLoading}
            onUpdateEmployee={handleUpdateEmployee}
          />
        )}
        {activeTab === 'calendar' && <HrCalendarTab requests={requests} employees={employees} />}
        {activeTab === 'templates' && (
          <HrTemplatesTab
            templates={templates}
            onCreateTemplate={apiClient ? handleCreateTemplate : undefined}
            onUpdateTemplate={apiClient ? handleUpdateTemplate : undefined}
          />
        )}
        {activeTab === 'archive' && <HrArchiveTab />}
      </section>
    </div>
  );
};

export default HrPage;
