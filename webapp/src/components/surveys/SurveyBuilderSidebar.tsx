import React from 'react';
import type { SurveyTemplate, SurveyTemplateAudience } from '../../types';
import { buildBuilderTemplateGroups, buildLaunchSummary } from './surveyBuilderModel';

interface SurveyBuilderSidebarProps {
  audience: SurveyTemplateAudience;
  templates: SurveyTemplate[];
  selectedTemplateId: number | null;
  onAudienceChange: (audience: SurveyTemplateAudience) => void;
  onSelectTemplate: (id: number | null) => void;
  onNew: () => void;
}

export const SurveyBuilderSidebar: React.FC<SurveyBuilderSidebarProps> = ({
  audience,
  templates,
  selectedTemplateId,
  onAudienceChange,
  onSelectTemplate,
  onNew,
}) => {
  const { activeTemplate, savedTemplates } = buildBuilderTemplateGroups(templates);

  return (
    <aside className="surveys-panel surveys-template-list surveys-builder-sidebar">
      <div className="surveys-segmented surveys-segmented--builder">
        {(['client', 'employee'] as SurveyTemplateAudience[]).map((item) => (
          <button
            key={item}
            type="button"
            className={audience === item ? 'is-active' : ''}
            onClick={() => onAudienceChange(item)}
          >
            {item === 'client' ? 'Клиенты' : 'Сотрудники'}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="surveys-button surveys-button--full surveys-button--ghost"
        onClick={onNew}
      >
        Новый опрос
      </button>

      <section className="surveys-builder-sidebar__section">
        <div className="surveys-builder-sidebar__title">Активный опрос</div>
        {activeTemplate ? (
          <button
            type="button"
            className={`surveys-template-card ${selectedTemplateId === activeTemplate.id ? 'is-active' : ''}`}
            onClick={() => onSelectTemplate(activeTemplate.id)}
          >
            <strong>{activeTemplate.title}</strong>
            <span>{buildLaunchSummary(activeTemplate)}</span>
          </button>
        ) : (
          <div className="surveys-empty">Активного опроса нет.</div>
        )}
      </section>

      <section className="surveys-builder-sidebar__section">
        <div className="surveys-builder-sidebar__title">Сохраненные опросы</div>
        <div className="surveys-template-list__items">
          {savedTemplates.length === 0 ? (
            <div className="surveys-empty">Сохраненных опросов нет.</div>
          ) : (
            savedTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`surveys-template-card ${selectedTemplateId === template.id ? 'is-active' : ''}`}
                onClick={() => onSelectTemplate(template.id)}
              >
                <strong>{template.title}</strong>
                <span>{buildLaunchSummary(template)}</span>
              </button>
            ))
          )}
        </div>
      </section>
    </aside>
  );
};
