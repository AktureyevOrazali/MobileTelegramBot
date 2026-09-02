import React, { useEffect, useMemo, useState } from 'react';
import type { HrRequestType, HrTemplate } from '../../types';
import { requestTypeLabels } from './hrMockData';

interface HrTemplatesTabProps {
  templates: HrTemplate[];
  isLoading?: boolean;
  onCreateTemplate?: (template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
  onUpdateTemplate?: (id: number, template: Omit<HrTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>) => Promise<void> | void;
}

const requestTypes: HrRequestType[] = ['vacation', 'advance', 'sickLeave', 'businessTrip', 'certificate', 'serviceLetter'];

const templatePresets: Record<HrRequestType, { variables: string; body: string }> = {
  vacation: {
    variables: 'start_date,end_date,days_count,days_count_words,reason',
    body: 'Прошу предоставить мне ежегодный оплачиваемый трудовой отпуск продолжительностью {days_count} ({days_count_words}) календарных дней в период с {start_date} по {end_date}.',
  },
  advance: {
    variables: 'amount,reason',
    body: 'Прошу выдать мне аванс в размере {amount} в счет заработной платы, в связи с {reason}.',
  },
  sickLeave: {
    variables: 'start_date,end_date,days_count,days_count_words,reason',
    body: 'Прошу оформить мое отсутствие по болезни продолжительностью {days_count} ({days_count_words}) календарных дней в период с {start_date} по {end_date}. Основание: {reason}.',
  },
  businessTrip: {
    variables: 'destination,start_date,end_date,days_count,days_count_words,purpose',
    body: 'Прошу направить меня в служебную командировку в {destination} продолжительностью {days_count} ({days_count_words}) календарных дней в период с {start_date} по {end_date}. Цель командировки: {purpose}.',
  },
  certificate: {
    variables: 'recipient',
    body: 'Прошу выдать мне справку с места работы для предоставления в {recipient}.',
  },
  serviceLetter: {
    variables: 'topic,reason',
    body: 'Прошу рассмотреть служебное письмо по теме "{topic}" для {employee_name}. Основание: {reason}.',
  },
};

const skeletonStyle = (index: number) => ({ '--skeleton-index': index } as React.CSSProperties);
type TemplateMode = 'view' | 'edit' | 'create';

const HrTemplatesTab: React.FC<HrTemplatesTabProps> = ({ templates, isLoading = false, onCreateTemplate, onUpdateTemplate }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(templates[0]?.id ?? null);
  const [mode, setMode] = useState<TemplateMode>('view');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<HrRequestType>('vacation');
  const [variables, setVariables] = useState('employee_name,start_date,end_date');
  const [body, setBody] = useState('Прошу рассмотреть заявление для {employee_name}.');

  const selectedTemplate = useMemo(
    () => {
      if (selectedTemplateId === null) return mode === 'create' ? null : templates[0] ?? null;
      return templates.find((template) => template.id === selectedTemplateId) ?? null;
    },
    [mode, selectedTemplateId, templates],
  );

  useEffect(() => {
    if (selectedTemplateId === null && templates[0] && mode !== 'create') {
      setSelectedTemplateId(templates[0].id);
      return;
    }
    if (selectedTemplateId !== null && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? null);
      setMode('view');
    }
  }, [mode, templates, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate || mode === 'create') return;
    setTitle(selectedTemplate.title);
    setType(selectedTemplate.type);
    setVariables(selectedTemplate.variables.join(','));
    setBody(selectedTemplate.body);
  }, [mode, selectedTemplate]);

  const applyPreset = (requestType: HrRequestType) => {
    setType(requestType);
    setVariables(templatePresets[requestType].variables);
    setBody(templatePresets[requestType].body);
  };

  const startNewTemplate = () => {
    setMode('create');
    setSelectedTemplateId(null);
    setTitle('');
    setType('vacation');
    setVariables(templatePresets.vacation.variables);
    setBody(templatePresets.vacation.body);
  };

  const startEditingTemplate = () => {
    if (!selectedTemplate) return;
    setTitle(selectedTemplate.title);
    setType(selectedTemplate.type);
    setVariables(selectedTemplate.variables.join(','));
    setBody(selectedTemplate.body);
    setMode('edit');
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
    if (mode === 'edit' && selectedTemplate && onUpdateTemplate) {
      await onUpdateTemplate(selectedTemplate.id, payload);
      setMode('view');
      return;
    }
    if (mode === 'create' && onCreateTemplate) {
      await onCreateTemplate(payload);
      setMode('view');
    }
  };

  const isFormOpen = mode === 'edit' || mode === 'create';
  const formTitle = mode === 'create' ? 'Новый шаблон' : 'Редактирование шаблона';

  return (
    <div className="hr-template-layout hr-template-layout--manager">
      <div className="hr-template-list" aria-label="Шаблоны документов">
        <div className="hr-template-list__header">
          <strong>Шаблоны</strong>
          <div className="hr-template-list__tools">
            <span>{templates.length}</span>
            {onCreateTemplate && !isLoading && (
              <button
                className="hr-icon-button"
                type="button"
                aria-label="Добавить шаблон"
                title="Добавить шаблон"
                onClick={startNewTemplate}
              >
                +
              </button>
            )}
          </div>
        </div>
        {isLoading && Array.from({ length: 5 }, (_, index) => (
          <div
            className="hr-template-item hr-template-item--skeleton skeleton-unit"
            data-testid="hr-template-item-skeleton"
            key={index}
            style={skeletonStyle(index)}
          />
        ))}
        {!isLoading && templates.map((template) => (
          <button
            className={`hr-template-item ${template.id === selectedTemplate?.id ? 'hr-template-item--active' : ''}`}
            key={template.id}
            type="button"
            aria-pressed={template.id === selectedTemplate?.id}
            onClick={() => {
              setMode('view');
              setSelectedTemplateId(template.id);
            }}
          >
            <strong>{template.title}</strong>
            <span className="hr-badge">{requestTypeLabels[template.type]}</span>
            <time dateTime={template.updatedAt.toISOString()}>{template.updatedAt.toLocaleDateString('ru-RU')}</time>
          </button>
        ))}
      </div>

      <article className="hr-template-preview">
        {isLoading ? (
          <div className="hr-template-preview-skeleton" data-testid="hr-template-preview-skeleton" aria-hidden="true">
            <span className="skeleton-unit hr-detail-card__pill-skeleton" />
            <span className="skeleton-unit hr-detail-card__title-skeleton" />
            <span className="skeleton-unit hr-template-line-skeleton hr-template-line-skeleton--wide" />
            <span className="skeleton-unit hr-template-line-skeleton" />
            <div className="hr-template-preview__variables">
              <span className="skeleton-unit hr-detail-card__pill-skeleton" />
              <span className="skeleton-unit hr-detail-card__pill-skeleton" />
              <span className="skeleton-unit hr-detail-card__pill-skeleton" />
            </div>
          </div>
        ) : selectedTemplate && !isFormOpen ? (
          <>
            <div className="hr-template-preview__header">
              <span className="hr-badge">{requestTypeLabels[selectedTemplate.type]}</span>
              {onUpdateTemplate && (
                <button className="button secondary" type="button" onClick={startEditingTemplate}>Редактировать</button>
              )}
            </div>
            <div className="hr-document-preview-shell hr-document-preview-shell--template">
              <article className="hr-document-preview" aria-label="Предпросмотр шаблона">
                <div className="hr-document-preview__to">
                  <span>Получателю документа</span>
                  <span>от {'{employee_name}'}</span>
                </div>
                <div className="hr-document-preview__body">
                  <h3>{selectedTemplate.title}</h3>
                  <p>{selectedTemplate.body}</p>
                </div>
                <div className="hr-document-preview__footer">
                  <span>{new Intl.DateTimeFormat('ru-RU').format(new Date())}</span>
                  <span>{'{employee_name}'}</span>
                </div>
              </article>
            </div>
            <div className="hr-template-preview__variables" aria-label="Переменные шаблона">
              {selectedTemplate.variables.map((variable) => (
                <span className="hr-badge" key={variable}>{variable}</span>
              ))}
            </div>
          </>
        ) : !isFormOpen ? (
          <p>Шаблонов пока нет.</p>
        ) : null}

        {!isLoading && isFormOpen && (onCreateTemplate || onUpdateTemplate) && (
          <form className="hr-template-form" onSubmit={handleSubmit}>
            <div className="hr-template-form__header">
              <h3>{formTitle}</h3>
              <button className="button secondary" type="button" onClick={() => setMode('view')}>Отмена</button>
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
                {mode === 'edit' ? 'Сохранить изменения' : 'Создать шаблон'}
              </button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
};

export default HrTemplatesTab;
