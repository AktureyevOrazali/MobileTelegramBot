import { describe, expect, it } from 'vitest';
import type { SurveyQuestion, SurveyTemplate } from '../../../types';
import {
  buildBuilderTemplateGroups,
  buildLaunchSummary,
  buildQuestionPreview,
  buildScaleMarks,
} from '../surveyBuilderModel';

const template = (patch: Partial<SurveyTemplate> = {}): SurveyTemplate => ({
  id: 1,
  title: 'Client pulse',
  description: '',
  audience: 'client',
  status: 'active',
  triggerType: 'after_appeal_closed',
  periodicInterval: null,
  scheduledAt: null,
  launchRules: [{ type: 'after_appeal_closed', dates: [] }],
  isAnonymous: false,
  createdBy: 1,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  questions: [],
  ...patch,
});

const question = (patch: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  sortOrder: 1,
  questionType: 'scale',
  text: 'How was the consultation?',
  topic: 'consultation_quality',
  required: true,
  anonymityMode: 'inherit',
  config: { min: 1, max: 10, presentation: 'scale' },
  ...patch,
});

describe('surveyBuilderModel', () => {
  it('separates active template from visible saved templates', () => {
    const groups = buildBuilderTemplateGroups([
      template({ id: 1, status: 'active', title: 'Active survey' }),
      template({ id: 2, status: 'draft', title: 'Draft survey' }),
      template({ id: 3, status: 'archived', title: 'Archive survey' }),
    ]);

    expect(groups.activeTemplate?.title).toBe('Active survey');
    expect(groups.savedTemplates.map((item) => item.title)).toEqual(['Draft survey']);
  });

  it('builds compact previews for every approved question type', () => {
    expect(buildQuestionPreview(question())).toBe('Шкала 1-10');
    expect(buildQuestionPreview(question({
      questionType: 'single_choice',
      config: { options: [{ id: '1', label: 'Да' }, { id: '2', label: 'Нет' }, { id: '3', label: 'Не знаю' }] },
    }))).toBe('Да, Нет +1');
    expect(buildQuestionPreview(question({ questionType: 'text_comment', config: {} }))).toBe('Текстовый ответ');
  });

  it('builds a short launch summary for calendar and appeal triggers', () => {
    expect(buildLaunchSummary(template({ triggerType: 'after_appeal_closed' }))).toBe('После обращения');
    expect(buildLaunchSummary(template({
      triggerType: 'periodic',
      launchRules: [{ type: 'calendar', schedule: 'month_start', dates: [] }],
    }))).toBe('Начало месяца');
    expect(buildLaunchSummary(template({
      triggerType: 'periodic',
      launchRules: [{ type: 'calendar', schedule: 'custom_dates', dates: ['2026-05-15'] }],
      scheduledAt: '2026-05-15',
    }))).toBe('Своя дата: 15.05.2026');
  });

  it('returns a visible 1..10 mark row for new scale questions', () => {
    expect(buildScaleMarks(question())).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
