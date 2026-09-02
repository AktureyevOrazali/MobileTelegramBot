import type { SurveyQuestion, SurveyTemplate } from '../../types';

export interface BuilderTemplateGroups {
  activeTemplate: SurveyTemplate | null;
  savedTemplates: SurveyTemplate[];
}

const launchLabels: Record<string, string> = {
  after_appeal_closed: 'После обращения',
  after_employee_csat: 'После оценки сотрудника',
  periodic: 'По расписанию',
  admin_manual: 'Ручной запуск',
};

export function buildBuilderTemplateGroups(templates: SurveyTemplate[]): BuilderTemplateGroups {
  const activeTemplate = templates.find((template) => template.status === 'active') ?? null;
  const savedTemplates = templates.filter((template) => (
    template.status !== 'archived' && template.id !== activeTemplate?.id
  ));
  return { activeTemplate, savedTemplates };
}

export function buildLaunchSummary(template: Pick<SurveyTemplate, 'triggerType' | 'launchRules' | 'scheduledAt'>): string {
  if (template.triggerType !== 'periodic') {
    return launchLabels[template.triggerType] ?? 'Не настроено';
  }

  const calendarRule = template.launchRules.find((rule) => rule.type === 'calendar');
  const customDate = calendarRule?.schedule === 'custom_dates'
    ? calendarRule.dates[0] ?? template.scheduledAt
    : template.scheduledAt;

  if (customDate) {
    return `Своя дата: ${new Date(customDate).toLocaleDateString('ru-RU')}`;
  }

  if (calendarRule?.schedule === 'month_start') {
    return 'Начало месяца';
  }

  if (calendarRule?.schedule === 'quarter_end') {
    return 'Конец квартала';
  }

  return launchLabels[template.triggerType] ?? 'Не настроено';
}

export function buildQuestionPreview(question: SurveyQuestion): string {
  if (question.questionType === 'scale') {
    return 'Шкала 1-5';
  }

  if (question.questionType === 'text_comment') {
    return 'Текстовый ответ';
  }

  if (question.questionType === 'employee_exclusion') {
    return 'Список сотрудников';
  }

  const optionLabels = (question.config.options ?? []).map((item) => item.label).filter(Boolean);
  if (optionLabels.length <= 2) {
    return optionLabels.join(', ');
  }
  return `${optionLabels.slice(0, 2).join(', ')} +${optionLabels.length - 2}`;
}

export function buildScaleMarks(question: SurveyQuestion): number[] {
  return question.questionType === 'scale' ? [1, 2, 3, 4, 5] : [];
}
