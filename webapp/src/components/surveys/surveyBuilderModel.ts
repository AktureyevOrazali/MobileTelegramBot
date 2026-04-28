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
  const savedTemplates = templates.filter((template) => template.id !== activeTemplate?.id);
  return { activeTemplate, savedTemplates };
}

export function buildLaunchSummary(template: Pick<SurveyTemplate, 'triggerType' | 'launchRules' | 'scheduledAt'>): string {
  const customDate = template.launchRules.find((rule) => rule.type === 'calendar' && rule.schedule === 'custom_dates')?.dates[0]
    ?? template.scheduledAt;

  if (customDate) {
    return `Своя дата: ${new Date(customDate).toLocaleDateString('ru-RU')}`;
  }

  return launchLabels[template.triggerType] ?? 'Не настроено';
}

export function buildQuestionPreview(question: SurveyQuestion): string {
  if (question.questionType === 'scale') {
    const min = question.config.min ?? 1;
    const max = Math.min(question.config.max ?? 5, 5);
    return `Шкала ${min}-${max}`;
  }

  if (question.questionType === 'text_comment') {
    return 'Текстовый ответ';
  }

  const optionLabels = (question.config.options ?? []).map((item) => item.label).filter(Boolean);
  if (optionLabels.length <= 2) {
    return optionLabels.join(', ');
  }
  return `${optionLabels.slice(0, 2).join(', ')} +${optionLabels.length - 2}`;
}

export function buildScaleMarks(question: SurveyQuestion): number[] {
  const min = question.config.min ?? 1;
  const max = Math.min(question.config.max ?? 5, 5);
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}
