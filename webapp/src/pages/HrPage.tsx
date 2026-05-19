import React, { useMemo, useState } from 'react';
import { hrEmployees, hrRequests } from './hr/hrMockData';

type HrTab = 'requests' | 'employees' | 'calendar' | 'templates' | 'archive';

const tabs: { id: HrTab; label: string }[] = [
  { id: 'requests', label: 'Заявления' },
  { id: 'employees', label: 'Сотрудники' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'templates', label: 'Шаблоны' },
  { id: 'archive', label: 'Архив' },
];

const HrPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HrTab>('requests');

  const stats = useMemo(
    () => [
      { label: 'Новые заявления', value: hrRequests.filter((request) => request.status === 'new').length },
      { label: 'Отпуска на неделе', value: 2 },
      { label: 'Карточки требуют данных', value: hrEmployees.filter((employee) => employee.documentCompleteness < 90).length },
      { label: 'Документы на подпись', value: 7 },
    ],
    [],
  );

  return (
    <div className="hr-page" data-testid="hr-page-shell">
      <header className="hr-header">
        <div className="hr-header__top">
          <h2 className="hr-header__title">Кадры</h2>
          <div className="hr-header__actions" aria-label="Действия кадровика">
            <button className="button secondary" type="button">Добавить сотрудника</button>
            <button className="button" type="button">Создать шаблон</button>
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

      <section className="hr-panel">
        {activeTab === 'requests' && <div>Заявления сотрудников</div>}
        {activeTab === 'employees' && <div>Карточки сотрудников</div>}
        {activeTab === 'calendar' && <div>Календарь сотрудников</div>}
        {activeTab === 'templates' && <div>Шаблоны документов</div>}
        {activeTab === 'archive' && <div>Архив заявлений</div>}
      </section>
    </div>
  );
};

export default HrPage;
