import React from 'react';
import type { SurveyTemplate } from '../../types';
import { buildLaunchSummary, buildQuestionPreview } from './surveyBuilderModel';

type SurveyDraft = Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;

interface SurveyBuilderSidebarProps {
  templates: SurveyTemplate[];
  selectedTemplateId: number | null;
  draft: SurveyDraft;
  expandedQuestionIndex: number | null;
  onSelectTemplate: (id: number) => void;
  onSelectQuestion: (index: number) => void;
}

const statusLabels: Record<SurveyDraft['status'], string> = {
  active: 'Активный опрос',
  draft: 'Черновик',
  archived: 'Архив',
};

export const SurveyBuilderSidebar: React.FC<SurveyBuilderSidebarProps> = ({
  templates,
  selectedTemplateId,
  draft,
  expandedQuestionIndex,
  onSelectTemplate,
  onSelectQuestion,
}) => (
  <aside className="surveys-panel surveys-builder-sidebar">
    <div className="surveys-builder-sidebar__head">
      <span className={`surveys-status-dot surveys-status-dot--${draft.status}`}>
        {statusLabels[draft.status]}
      </span>
      <label className="surveys-field">
        <select
          aria-label="Опрос"
          value={selectedTemplateId ?? ''}
          disabled={templates.length === 0}
          onChange={(event) => onSelectTemplate(Number(event.target.value))}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.title}</option>
          ))}
        </select>
      </label>
      <small>{buildLaunchSummary(draft)}</small>
    </div>

    <nav className="surveys-question-nav" aria-label="Вопросы активного опроса">
      <div className="surveys-question-nav__title">
        <span>Вопросы</span>
        <strong>{draft.questions.length}</strong>
      </div>
      {draft.questions.map((question, index) => (
        <button
          key={`${question.id ?? 'new'}-${index}`}
          type="button"
          className={expandedQuestionIndex === index ? 'is-active' : ''}
          onClick={() => onSelectQuestion(index)}
        >
          <span>{index + 1}</span>
          <div>
            <strong>{question.text || `Вопрос ${index + 1}`}</strong>
            <small>{buildQuestionPreview(question)}</small>
          </div>
        </button>
      ))}
    </nav>
  </aside>
);
