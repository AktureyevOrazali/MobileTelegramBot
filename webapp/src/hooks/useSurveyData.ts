import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/ApiClient';
import type {
  SurveyAnalytics,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyTemplate,
  SurveyTemplateAudience,
} from '../types';

export const SURVEY_TOPICS = [
  { id: 'consultation_quality', label: 'Качество консультаций' },
  { id: 'response_speed', label: 'Скорость ответа' },
  { id: 'answer_clarity', label: 'Понятность ответа' },
  { id: 'resolution_quality', label: 'Полнота решения' },
  { id: 'communication_quality', label: 'Качество общения' },
  { id: 'system_usability', label: 'Удобство работы с системой' },
  { id: 'seminars', label: 'Потребность в семинарах' },
  { id: 'webinars', label: 'Потребность в вебинарах' },
  { id: 'instructions', label: 'Инструкции, памятки, видеоуроки' },
  { id: 'employee_remarks', label: 'Замечания по сотрудникам' },
  { id: 'employee_exclusion', label: 'Выбор сотрудника' },
  { id: 'support_improvements', label: 'Предложения по улучшению' },
];

export const SURVEY_QUESTION_TYPES: Array<{ id: SurveyQuestionType; label: string }> = [
  { id: 'scale', label: 'Шкала' },
  { id: 'single_choice', label: 'Один выбор' },
  { id: 'multi_choice', label: 'Несколько вариантов' },
  { id: 'text_comment', label: 'Комментарий' },
  { id: 'employee_exclusion', label: 'Выбор сотрудника' },
];

export function createBlankSurveyQuestion(sortOrder: number): SurveyQuestion {
  return {
    sortOrder,
    questionType: 'scale',
    text: '',
    topic: 'consultation_quality',
    required: true,
    anonymityMode: 'inherit',
    config: { min: 1, max: 5, presentation: 'scale' },
  };
}

function createEmployeeAssessmentQuestions(): SurveyQuestion[] {
  return [
    {
      sortOrder: 1,
      questionType: 'scale',
      text: 'Постановка вопроса',
      topic: 'consultation_quality',
      required: true,
      anonymityMode: 'inherit',
      config: { min: 1, max: 5, presentation: 'scale' },
    },
    {
      sortOrder: 2,
      questionType: 'scale',
      text: 'Полнота данных',
      topic: 'consultation_quality',
      required: true,
      anonymityMode: 'inherit',
      config: { min: 1, max: 5, presentation: 'scale' },
    },
    {
      sortOrder: 3,
      questionType: 'scale',
      text: 'Скорость обратной связи',
      topic: 'response_speed',
      required: true,
      anonymityMode: 'inherit',
      config: { min: 1, max: 5, presentation: 'scale' },
    },
    {
      sortOrder: 4,
      questionType: 'scale',
      text: 'Деловая коммуникация',
      topic: 'consultation_quality',
      required: true,
      anonymityMode: 'inherit',
      config: { min: 1, max: 5, presentation: 'scale' },
    },
    {
      sortOrder: 5,
      questionType: 'scale',
      text: 'Готовность клиента',
      topic: 'consultation_quality',
      required: true,
      anonymityMode: 'inherit',
      config: { min: 1, max: 5, presentation: 'scale' },
    },
    {
      sortOrder: 6,
      questionType: 'single_choice',
      text: 'Характер обращения',
      topic: 'support_improvements',
      required: true,
      anonymityMode: 'inherit',
      config: {
        options: [
          { id: 'first_contact', label: 'Первое обращение' },
          { id: 'not_repeated', label: 'Не повторное' },
          { id: 'repeated_same_issue', label: 'Повторное однотипное' },
        ],
      },
    },
    {
      sortOrder: 7,
      questionType: 'single_choice',
      text: 'Статус взаимодействия',
      topic: 'support_improvements',
      required: true,
      anonymityMode: 'inherit',
      config: {
        options: [
          { id: 'provided_all', label: 'Все данные предоставлены' },
          { id: 'provided_partial', label: 'Данные предоставлены частично' },
          { id: 'provided_none', label: 'Данные не предоставлены' },
        ],
      },
    },
    {
      sortOrder: 8,
      questionType: 'single_choice',
      text: 'Отметка по обращению',
      topic: 'support_improvements',
      required: true,
      anonymityMode: 'inherit',
      config: {
        options: [
          { id: 'constructive', label: 'Обращение было конструктивным' },
          { id: 'repeated_clarifications', label: 'Потребовались повторные уточнения' },
          { id: 'hindered_by_client', label: 'Процесс был затруднен клиентом' },
        ],
      },
    },
    {
      sortOrder: 9,
      questionType: 'single_choice',
      text: 'Была просрочка по предоставлению данных',
      topic: 'support_improvements',
      required: true,
      anonymityMode: 'inherit',
      config: {
        options: [
          { id: 'yes', label: 'Да' },
          { id: 'no', label: 'Нет' },
        ],
      },
    },
    {
      sortOrder: 10,
      questionType: 'single_choice',
      text: 'Причина низкой оценки',
      topic: 'employee_remarks',
      required: false,
      anonymityMode: 'inherit',
      config: {
        options: [
          { id: 'unclear_request', label: 'Некорректная постановка вопроса' },
          { id: 'missing_data', label: 'Недостаточно данных и документов' },
          { id: 'slow_response', label: 'Медленная обратная связь' },
          { id: 'communication_issues', label: 'Нарушение деловой коммуникации' },
          { id: 'not_ready', label: 'Клиент не был готов к взаимодействию' },
          { id: 'duplicate_requests', label: 'Повторные однотипные обращения' },
          { id: 'other', label: 'Другая причина' },
        ],
      },
    },
    {
      sortOrder: 11,
      questionType: 'text_comment',
      text: 'Внутренний комментарий',
      topic: 'employee_remarks',
      required: false,
      anonymityMode: 'identified',
      config: {},
    },
  ];
}

function createBlankSurveyTemplate(
  audience: SurveyTemplateAudience = 'client',
): Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  const isEmployee = audience === 'employee';
  return {
    title: isEmployee ? 'Анкета сотрудника после завершения обращения' : 'Опрос после оценки оператора',
    description: isEmployee ? 'Внутренний опрос сотрудника после завершения обращения.' : '',
    audience,
    status: 'active',
    triggerType: 'after_appeal_closed',
    periodicInterval: null,
    scheduledAt: null,
    launchRules: [{ type: 'after_appeal_closed', dates: [] }],
    isAnonymous: false,
    questions: isEmployee ? createEmployeeAssessmentQuestions() : [createBlankSurveyQuestion(1)],
  };
}

export function useSurveyData(apiClient: ApiClient) {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>(createBlankSurveyTemplate);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const refreshTemplates = useCallback(async (preferredTemplateId?: number | null) => {
    const nextTemplates = await apiClient.fetchSurveyTemplates();
    setTemplates(nextTemplates);
    setSelectedTemplateId((currentTemplateId) => {
      const targetTemplateId = preferredTemplateId === undefined ? currentTemplateId : preferredTemplateId;
      if (targetTemplateId && nextTemplates.some((template) => template.id === targetTemplateId)) {
        return targetTemplateId;
      }
      return nextTemplates[0]?.id ?? null;
    });
    return nextTemplates;
  }, [apiClient]);

  const refreshAnalytics = useCallback(async () => {
    const nextAnalytics = await apiClient.fetchSurveyAnalytics({
      audience: 'client',
    });
    setAnalytics(nextAnalytics);
    return nextAnalytics;
  }, [apiClient]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setIsAnalyticsLoading(true);
    setError(null);
    try {
      await refreshTemplates();
      await refreshAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные опросов.');
    } finally {
      setIsLoading(false);
      setIsAnalyticsLoading(false);
    }
  }, [refreshAnalytics, refreshTemplates]);

  const reloadAnalytics = useCallback(async () => {
    setIsAnalyticsLoading(true);
    setError(null);
    try {
      await refreshAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аналитику опросов.');
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, [refreshAnalytics, templates]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setDraft({
      title: selectedTemplate.title,
      description: selectedTemplate.description,
      audience: selectedTemplate.audience,
      status: selectedTemplate.status,
      triggerType: selectedTemplate.triggerType,
      periodicInterval: selectedTemplate.periodicInterval,
      scheduledAt: selectedTemplate.scheduledAt,
      launchRules: selectedTemplate.launchRules,
      isAnonymous: selectedTemplate.isAnonymous,
      questions: selectedTemplate.questions.map((question) => (
        question.questionType === 'scale'
          ? { ...question, config: { ...question.config, min: 1, max: 5, presentation: 'scale' } }
          : question
      )),
    });
  }, [selectedTemplate]);

  const saveDraft = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const saved = selectedTemplateId
        ? await apiClient.updateSurveyTemplate(selectedTemplateId, draft)
        : await apiClient.createSurveyTemplate(draft);
      await refreshTemplates(saved.id);
      await refreshAnalytics();
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить опрос.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, draft, refreshAnalytics, refreshTemplates, selectedTemplateId]);

  const duplicateSelected = useCallback(async () => {
    if (!selectedTemplateId) return;
    setIsLoading(true);
    setError(null);
    try {
      const created = await apiClient.duplicateSurveyTemplate(selectedTemplateId);
      await refreshTemplates(created.id);
      await refreshAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось дублировать опрос.');
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, refreshAnalytics, refreshTemplates, selectedTemplateId]);

  const deleteSelected = useCallback(async () => {
    if (!selectedTemplateId) return;
    setIsLoading(true);
    setError(null);
    try {
      await apiClient.deleteSurveyTemplate(selectedTemplateId);
      setDraft(createBlankSurveyTemplate(draft.audience));
      await refreshTemplates(null);
      await refreshAnalytics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить опрос.');
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, draft.audience, refreshAnalytics, refreshTemplates, selectedTemplateId]);

  const startNewTemplate = useCallback((audience: SurveyTemplateAudience = draft.audience) => {
    setSelectedTemplateId(null);
    setDraft(createBlankSurveyTemplate(audience));
  }, [draft.audience]);

  return {
    analytics,
    deleteSelected,
    draft,
    duplicateSelected,
    error,
    isAnalyticsLoading,
    isLoading,
    load,
    reloadAnalytics,
    saveDraft,
    selectedTemplate,
    selectedTemplateId,
    setDraft,
    setSelectedTemplateId,
    startNewTemplate,
    templates,
  };
}
