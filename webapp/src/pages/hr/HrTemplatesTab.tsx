import React, { useEffect, useMemo, useState } from 'react';
import type { HrRequestType, HrTemplate } from '../../types';
import { requestTypeLabels } from './hrMockData';

interface HrTemplatesTabProps {
  templates: HrTemplate[];
  onCreateTemplate?: (template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
  onUpdateTemplate?: (id: number, template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
}

const requestTypes: HrRequestType[] = ['vacation', 'advance', 'sickLeave', 'businessTrip', 'certificate', 'serviceLetter'];

const templatePresets: Record<HrRequestType, { variables: string; body: string }> = {
  vacation: {
    variables: 'employee_name,start_date,end_date,days_count,reason',
    body: 'Прошу предоставить {employee_name} ежегодный оплачиваемый отпуск с {start_date} по {end_date} на {days_count} календарных дней. Причина: {reason}.',
  },
  advance: {
    variables: 'employee_name,amount,payroll_month,reason',
    body: 'Прошу выдать {employee_name} аванс в размере {amount} за {payroll_month}. Основание: {reason}.',
  },
  sickLeave: {
    variables: 'employee_name,start_date,end_date,reason',
    body: 'Прошу оформить отсутствие {employee_name} по болезни с {start_date} по {end_date}. Основание: {reason}.',
  },
  businessTrip: {
    variables: 'employee_name,destination,start_date,end_date,reason',
    body: 'Прошу направить {employee_name} в командировку в {destination} с {start_date} по {end_date}. Цель: {reason}.',
  },
  certificate: {
    variables: 'employee_name,position,department,recipient',
    body: 'Прошу подготовить справку с места работы для {employee_name}. Организация-получатель: {recipient}.',
  },
  serviceLetter: {
    variables: 'employee_name,topic,reason',
    body: 'Прошу рассмотреть служебное письмо по теме "{topic}" для {employee_name}. Основание: {reason}.',
  },
};

const HrTemplatesTab: React.FC<HrTemplatesTabProps> = ({ templates, onCreateTemplate, onUpdateTemplate }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(templates[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<HrRequestType>('vacation');
  const [variables, setVariables] = useState('employee_name,start_date,end_date');
  const [body, setBody] = useState('Прошу рассмотреть заявление для {employee_name}.');

  const selectedTemplate = useMemo(
    () => (selectedTemplateId === null ? null : templates.find((template) => template.id === selectedTemplateId) ?? null),
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (selectedTemplateId !== null && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? null);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setTitle(selectedTemplate.title);
    setType(selectedTemplate.type);
    setVariables(selectedTemplate.variables.join(','));
    setBody(selectedTemplate.body);
  }, [selectedTemplate]);

  const applyPreset = (requestType: HrRequestType) => {
    setType(requestType);
    setVariables(templatePresets[requestType].variables);
    setBody(templatePresets[requestType].body);
  };

  const startNewTemplate = () => {
    setSelectedTemplateId(null);
    setTitle('');
    setType('vacation');
    setVariables(templatePresets.vacation.variables);
    setBody(templatePresets.vacation.body);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const payload: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'> = {
      title: title.trim(),
      type,
      description: '',
      body: body.trim(),
      variables: variables.split(',').map((variable) => variable.trim()).filter(Boolean),
      status: 'active',
    };
    if (selectedTemplate && onUpdateTemplate) {
      await onUpdateTemplate(selectedTemplate.id, payload);
      return;
    }
    if (!selectedTemplate && onCreateTemplate) {
      await onCreateTemplate(payload);
      setTitle('');
    }
  };

  return (
    <div className="hr-template-layout hr-template-layout--manager">
      <div className="hr-template-list" aria-label="Шаблоны документов">
        <div className="hr-template-list__header">
          <strong>Шаблоны</strong>
          <span>{templates.length}</span>
        </div>
        {templates.map((template) => (
          <button
            className={`hr-template-item ${template.id === selectedTemplate?.id ? 'hr-template-item--active' : ''}`}
            key={template.id}
            type="button"
            aria-pressed={template.id === selectedTemplate?.id}
            onClick={() => setSelectedTemplateId(template.id)}
          >
            <strong>{template.title}</strong>
            <span className="hr-badge">{requestTypeLabels[template.type]}</span>
            <time dateTime={template.updatedAt.toISOString()}>{template.updatedAt.toLocaleDateString('ru-RU')}</time>
          </button>
        ))}
      </div>

      <article className="hr-template-preview">
        {selectedTemplate ? (
          <>
            <span className="hr-badge">{requestTypeLabels[selectedTemplate.type]}</span>
            <h3>{selectedTemplate.title}</h3>
            <p>{selectedTemplate.body}</p>
            <div className="hr-template-preview__variables" aria-label="Переменные шаблона">
              {selectedTemplate.variables.map((variable) => (
                <span className="hr-badge" key={variable}>{variable}</span>
              ))}
            </div>
          </>
        ) : (
          <p>Шаблонов пока нет.</p>
        )}

        {(onCreateTemplate || onUpdateTemplate) && (
          <form className="hr-template-form" onSubmit={handleSubmit}>
            <div className="hr-template-form__header">
              <h3>{selectedTemplate ? 'Редактирование шаблона' : 'Новый шаблон'}</h3>
              {selectedTemplate && (
                <button className="button secondary" type="button" onClick={startNewTemplate}>Новый шаблон</button>
              )}
            </div>
            <div className="hr-template-preset-grid" aria-label="Быстрые формы">
              {requestTypes.map((requestType) => (
                <button
                  className={`hr-chip-button ${type === requestType ? 'hr-chip-button--active' : ''}`}
                  key={requestType}
                  type="button"
                  onClick={() => applyPreset(requestType)}
                >
                  {requestTypeLabels[requestType]}
                </button>
              ))}
            </div>
            <label className="hr-field">
              <span>Название</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="hr-field">
              <span>Тип</span>
              <select value={type} onChange={(event) => setType(event.target.value as HrRequestType)}>
                {requestTypes.map((requestType) => (
                  <option key={requestType} value={requestType}>{requestTypeLabels[requestType]}</option>
                ))}
              </select>
            </label>
            <label className="hr-field">
              <span>Поля автозаполнения</span>
              <input value={variables} onChange={(event) => setVariables(event.target.value)} />
            </label>
            <label className="hr-field">
              <span>Текст шаблона</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} />
            </label>
            <div className="hr-template-preview__actions">
              <button className="button" type="submit">
                {selectedTemplate ? 'Сохранить изменения' : 'Создать шаблон'}
              </button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
};

export default HrTemplatesTab;
