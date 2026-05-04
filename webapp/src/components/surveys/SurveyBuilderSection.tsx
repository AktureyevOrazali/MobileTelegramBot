import React, { useState } from 'react';
import type {
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyTemplate,
  SurveyTemplateAudience,
  SurveyTemplateStatus,
} from '../../types';
import SelectPill from '../SelectPill';
import { SurveyBuilderSidebar } from './SurveyBuilderSidebar';
import { SurveyQuestionCard } from './SurveyQuestionCard';
import { buildLaunchSummary } from './surveyBuilderModel';

const statusLabels: Record<SurveyTemplateStatus, string> = {
  draft: 'Черновик',
  active: 'Активный',
  archived: 'Архив',
};

type LaunchOptionId = 'schedule' | 'month_start' | 'after_appeal_closed' | 'custom_date';

const launchOptions: Array<{ id: LaunchOptionId; label: string; icon: string }> = [
  { id: 'schedule', label: 'По расписанию', icon: 'calendar' },
  { id: 'month_start', label: 'Начало месяца', icon: 'trend' },
  { id: 'after_appeal_closed', label: 'После обращения', icon: 'message' },
  { id: 'custom_date', label: 'Своя дата', icon: 'clock' },
];

interface SurveyBuilderSectionProps {
  audience: SurveyTemplateAudience;
  onAudienceChange: (audience: SurveyTemplateAudience) => void;
  templates: SurveyTemplate[];
  selectedTemplateId: number | null;
  onSelectTemplate: (id: number | null) => void;
  draft: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;
  setDraft: React.Dispatch<
    React.SetStateAction<Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>
  >;
  isLoading: boolean;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNew: () => void;
  updateQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
  addQuestion: () => void;
  removeQuestion: (index: number) => void;
  updateOption: (
    questionIndex: number,
    optionIndex: number,
    patch: Partial<SurveyQuestionOption>,
  ) => void;
  addOption: (questionIndex: number) => void;
  removeOption: (questionIndex: number, optionIndex: number) => void;
}

export const SurveyBuilderSection: React.FC<SurveyBuilderSectionProps> = ({
  audience,
  onAudienceChange,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  draft,
  setDraft,
  isLoading,
  onSave,
  onDuplicate,
  onDelete,
  onNew,
  updateQuestion,
  addQuestion,
  removeQuestion,
  updateOption,
  addOption,
  removeOption,
}) => {
  const [expandedQuestionIndex, setExpandedQuestionIndex] = useState<number | null>(0);
  const [isLaunchOptionsOpen, setIsLaunchOptionsOpen] = useState(false);
  const activeLaunchOption: LaunchOptionId = (() => {
    if (draft.triggerType === 'after_appeal_closed') return 'after_appeal_closed';
    const calendarRule = draft.launchRules.find((rule) => rule.type === 'calendar');
    if (calendarRule?.schedule === 'month_start') return 'month_start';
    if (calendarRule?.schedule === 'custom_dates' || draft.scheduledAt) return 'custom_date';
    return 'schedule';
  })();

  const setLaunchPreset = (option: LaunchOptionId) => {
    setDraft((current) => {
      if (option === 'month_start') {
        return {
          ...current,
          triggerType: 'periodic',
          scheduledAt: null,
          launchRules: [{ type: 'calendar', schedule: 'month_start', dates: [] }],
        };
      }

      if (option === 'after_appeal_closed') {
        return {
          ...current,
          triggerType: 'after_appeal_closed',
          scheduledAt: null,
          launchRules: [{ type: 'after_appeal_closed', dates: [] }],
        };
      }

      if (option === 'custom_date') {
        return {
          ...current,
          triggerType: 'periodic',
          launchRules: [{
            type: 'calendar',
            schedule: 'custom_dates',
            dates: current.scheduledAt ? [current.scheduledAt] : [],
          }],
        };
      }

      return {
        ...current,
        triggerType: 'periodic',
        scheduledAt: null,
        launchRules: [{ type: 'calendar', dates: [] }],
      };
    });
  };

  return (
    <section className="surveys-layout surveys-layout--builder surveys-builder-shell">
      <SurveyBuilderSidebar
        audience={audience}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onAudienceChange={onAudienceChange}
        onSelectTemplate={onSelectTemplate}
        onNew={onNew}
      />

      <div className="surveys-panel surveys-editor surveys-editor--builder">
        <div className="surveys-editor__head surveys-editor__head--builder">
          <h2>Конструктор</h2>
          <div className="surveys-actions">
            <button
              type="button"
              className="surveys-button"
              onClick={onDuplicate}
              disabled={!selectedTemplateId || isLoading}
            >
              Дублировать
            </button>
            <button
              type="button"
              className="surveys-button surveys-button--danger-text"
              onClick={onDelete}
              disabled={!selectedTemplateId || isLoading}
            >
              Удалить
            </button>
            <button
              type="button"
              className="surveys-button surveys-button--primary"
              onClick={onSave}
              disabled={isLoading}
            >
              Сохранить
            </button>
          </div>
        </div>

        <section className="surveys-card surveys-builder-card">
          <div className="surveys-builder-card__row">
            <label className="surveys-field surveys-builder-field surveys-builder-field--grow">
              <span>Название</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <div className="surveys-field surveys-builder-field surveys-builder-field--status">
              <span>Статус</span>
              <SelectPill
                label="Статус"
                value={draft.status}
                showLabelInside={false}
                options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
                onChange={(value) => setDraft((current) => ({ ...current, status: value as SurveyTemplateStatus }))}
              />
            </div>
          </div>
        </section>

        <section className="surveys-card surveys-builder-card surveys-builder-card--launch">
          <div className="surveys-launch-card__head">
            <div>
              <h3>Запуск</h3>
              <p className="surveys-builder-card__meta">{buildLaunchSummary(draft)}</p>
            </div>
            <button
              type="button"
              className="surveys-button"
              aria-expanded={isLaunchOptionsOpen}
              aria-label="Настроить запуск"
              onClick={() => setIsLaunchOptionsOpen((current) => !current)}
            >
              Настроить
            </button>
          </div>

          {isLaunchOptionsOpen ? (
            <>
              <div className="surveys-launch-options" aria-label="Варианты запуска">
                {launchOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`surveys-launch-option ${activeLaunchOption === option.id ? 'is-active' : ''}`}
                    onClick={() => setLaunchPreset(option.id)}
                  >
                    <span className={`surveys-launch-option__icon surveys-launch-option__icon--${option.icon}`} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>

              {activeLaunchOption === 'custom_date' ? (
                <label className="surveys-field surveys-launch-date-field">
                  <span>Дата запуска</span>
                  <input
                    aria-label="Дата запуска"
                    type="date"
                    value={draft.scheduledAt ?? ''}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      triggerType: 'periodic',
                      scheduledAt: event.target.value || null,
                      launchRules: [{
                        type: 'calendar',
                        schedule: 'custom_dates',
                        dates: event.target.value ? [event.target.value] : [],
                      }],
                    }))}
                  />
                </label>
              ) : null}
            </>
          ) : null}
        </section>

        <div className="surveys-question-head surveys-question-head--builder">
          <h3>Вопросы</h3>
          <button
            type="button"
            className="surveys-button surveys-button--primary"
            aria-label="Добавить вопрос"
            onClick={() => {
              addQuestion();
              setExpandedQuestionIndex(draft.questions.length);
            }}
          >
            + Добавить
          </button>
        </div>

        <div className="surveys-question-list surveys-question-list--builder">
          {draft.questions.map((question, index) => (
            <SurveyQuestionCard
              key={`${question.id ?? 'new'}-${index}`}
              question={question}
              index={index}
              expanded={expandedQuestionIndex === index}
              onToggle={() => setExpandedQuestionIndex((current) => (current === index ? null : index))}
              updateQuestion={updateQuestion}
              removeQuestion={removeQuestion}
              updateOption={updateOption}
              addOption={addOption}
              removeOption={removeOption}
            />
          ))}
        </div>

      </div>
    </section>
  );
};
