import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiClient } from '../api/ApiClient';
import EChartsWrapper from '../components/EChartsWrapper';
import { SurveyBuilderSection } from '../components/surveys/SurveyBuilderSection';
import { createBlankSurveyQuestion, SURVEY_TOPICS, useSurveyData } from '../hooks/useSurveyData';
import type {
  AiRatingsAnalytics,
  ClientRatingsAnalytics,
  EmployeeClientAssessmentAnalytics,
  EmployeeRatingsAnalytics,
  MutualRatingMatrix,
  RatingLedgerEntry,
  RatingLedgerFilters,
  RatingLedgerResponse,
  RatingsSummary,
  SurveyAnalytics,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
  SurveyTemplate,
  SurveyTemplateAudience,
  SurveyTemplateStatus,
} from '../types';

interface SurveysPageProps {
  apiClient: ApiClient;
}

export type SurveysSection = 'builder' | 'clients' | 'employees' | 'ratings';
type RatingsTab = 'client_to_employee' | 'employee_to_client' | 'ai' | 'ledger';

const surveySectionPathBySection: Record<SurveysSection, string> = {
  builder: '',
  clients: 'clients',
  employees: 'employees',
  ratings: 'ratings',
};

export function getSurveysSectionFromPath(pathname: string): SurveysSection {
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const section = segments[0] === 'surveys' ? segments[1] : undefined;
  if (section === 'clients' || section === 'employees' || section === 'ratings') {
    return section;
  }
  return 'builder';
}

export function getSurveysPathForSection(section: SurveysSection): string {
  const sectionPath = surveySectionPathBySection[section];
  return sectionPath ? `/surveys/${sectionPath}` : '/surveys';
}

const numberFormatter = new Intl.NumberFormat('ru-RU');

const statusLabels: Record<SurveyTemplateStatus, string> = {
  draft: 'Черновик',
  active: 'Активный',
  archived: 'Архив',
};

const audienceLabels: Record<SurveyTemplateAudience, string> = {
  client: 'Опросы клиентов',
  employee: 'Опросы сотрудников',
};

const questionTypeLabels: Record<SurveyQuestionType, string> = {
  scale: 'Шкала',
  single_choice: 'Один выбор',
  multi_choice: 'Несколько вариантов',
  text_comment: 'Комментарий',
  employee_exclusion: 'Выбор сотрудника',
};

const ratingDirectionLabels: Record<string, string> = {
  client_to_employee: 'Клиент -> сотрудник',
  employee_to_client: 'Сотрудник -> клиент',
  client_to_ai: 'Клиент -> ИИ',
  client_to_appeal: 'Клиент -> обращение',
};

const formatScore = (value: number | null | undefined): string => (
  value === null || value === undefined ? '-' : value.toFixed(2).replace('.', ',')
);

const formatPercent = (value: number | null | undefined): string => (
  value === null || value === undefined ? '-' : `${Math.round(value * 100)}%`
);

const formatDate = (value: Date | null | undefined): string => (
  value ? value.toLocaleDateString('ru-RU') : '-'
);

const formatMonth = (value: string): string => {
  const [year, month] = value.split('-');
  return year && month ? `${month}.${year}` : value;
};

const createLineOption = (
  labels: string[],
  values: Array<number | null>,
  name: string,
  color = '#3a7ca5',
): EChartsOption => ({
  color: [color],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'none' },
    backgroundColor: '#ffffff',
    borderColor: 'rgba(137, 152, 176, 0.22)',
    borderWidth: 1,
    textStyle: { color: '#1d2940', fontSize: 12 },
  },
  grid: { top: 16, right: 18, bottom: 22, left: 18, containLabel: true },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: labels,
    axisLabel: { color: '#64748b', fontSize: 11 },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: 'rgba(137, 152, 176, 0.24)' } },
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 5,
    splitNumber: 5,
    axisLabel: { color: '#64748b', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(137, 152, 176, 0.2)' } },
  },
  series: [
    {
      name,
      type: 'line',
      smooth: true,
      symbolSize: 7,
      lineStyle: { width: 3 },
      areaStyle: { opacity: 0.1 },
      data: values,
    },
  ],
});

const createBarOption = (
  rows: Array<{ label: string; count: number }>,
  color = '#3a7ca5',
): EChartsOption => ({
  color: [color],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'none' },
    backgroundColor: '#ffffff',
    borderColor: 'rgba(137, 152, 176, 0.22)',
    borderWidth: 1,
    textStyle: { color: '#1d2940', fontSize: 12 },
  },
  grid: { top: 8, right: 28, bottom: 8, left: 8, containLabel: true },
  xAxis: {
    type: 'value',
    axisLabel: { color: '#64748b', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(137, 152, 176, 0.2)' } },
  },
  yAxis: {
    type: 'category',
    data: rows.map((item) => item.label),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#475569', fontSize: 11, overflow: 'truncate', width: 150 },
  },
  series: [{ type: 'bar', data: rows.map((item) => item.count), barWidth: 18, itemStyle: { borderRadius: [0, 6, 6, 0] } }],
});

const createToneDonutOption = (positive: number, neutral: number, negative: number): EChartsOption => {
  const total = positive + neutral + negative;
  return {
    color: ['#16a34a', '#f59e0b', '#b91c1c'],
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['62%', '82%'],
        center: ['50%', '50%'],
        label: {
          show: true,
          position: 'center',
          formatter: `${numberFormatter.format(total)}\nответов`,
          color: '#111827',
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 22,
        },
        labelLine: { show: false },
        data: [
          { name: 'Положительные', value: positive },
          { name: 'Нейтральные', value: neutral },
          { name: 'Негативные', value: negative },
        ],
      },
    ],
  };
};

const shortMonthLabels = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

const formatShortMonth = (value: string): string => {
  const month = Number(value.split('-')[1]);
  return month >= 1 && month <= 12 ? shortMonthLabels[month - 1] : formatMonth(value);
};

const formatTableScore = (value: number | null | undefined): string => (
  value === null || value === undefined ? '-' : value.toFixed(2)
);

const formatOneDecimalPercent = (value: number | null | undefined): string => (
  value === null || value === undefined ? '-' : `${value.toFixed(1).replace('.', ',')}%`
);

const createAssessmentLineOption = (
  labels: string[],
  scores: Array<number | null>,
  indexes: Array<number | null>,
): EChartsOption => ({
  color: ['#3e5aa8', '#10b981'],
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#ffffff',
    borderColor: 'rgba(30,41,80,0.09)',
    borderWidth: 1,
    textStyle: { color: '#1d2940', fontSize: 12 },
  },
  grid: { top: 12, right: 12, bottom: 22, left: 24, containLabel: true },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: labels,
    axisLabel: { color: '#64748b', fontSize: 11 },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: 'rgba(30,41,80,0.09)' } },
    splitLine: { show: true, lineStyle: { color: 'rgba(30,41,80,0.07)' } },
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 5,
    interval: 1,
    axisLabel: { color: '#64748b', fontSize: 11 },
    splitLine: { lineStyle: { color: 'rgba(30,41,80,0.07)' } },
  },
  series: [
    {
      name: 'Оценка',
      type: 'line',
      data: scores,
      smooth: true,
      connectNulls: true,
      symbolSize: 8,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
    },
    {
      name: 'Индекс',
      type: 'line',
      data: indexes,
      smooth: true,
      connectNulls: true,
      symbolSize: 8,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.06 },
    },
  ],
});

const createAssessmentDonutOption = (low: number, neutral: number, high: number): EChartsOption => ({
  color: ['#ef4444', '#f59e0b', '#10b981'],
  tooltip: { trigger: 'item' },
  series: [
    {
      type: 'pie',
      radius: ['75%', '88%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 5,
        borderColor: '#ffffff',
        borderWidth: 2,
      },
      label: { show: false },
      labelLine: { show: false },
      data: [
        { name: 'Низкие', value: low },
        { name: 'Нейтральные', value: neutral },
        { name: 'Высокие', value: high },
      ],
    },
  ],
});

const AssessmentBinFilter: React.FC<{ clientRatings?: Array<{ clientBin: string | null }> }> = ({ clientRatings = [] }) => {
  const bins = Array.from(new Set(clientRatings.map((client) => client.clientBin).filter((bin): bin is string => Boolean(bin))));
  return (
    <div className="surveys-assessment-filter">
      <span>БИН</span>
      <select aria-label="БИН">
        <option>Все БИНы</option>
        {bins.map((bin) => <option key={bin}>БИН {bin}</option>)}
      </select>
    </div>
  );
};

const SurveysPage: React.FC<SurveysPageProps> = ({ apiClient }) => {
  const data = useSurveyData(apiClient);
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = useMemo(() => getSurveysSectionFromPath(location.pathname), [location.pathname]);
  const [builderAudience, setBuilderAudience] = useState<SurveyTemplateAudience>('client');

  const [employeeAnalytics, setEmployeeAnalytics] = useState<EmployeeClientAssessmentAnalytics | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState<string | null>(null);

  const [ratingsSummary, setRatingsSummary] = useState<RatingsSummary | null>(null);
  const [employeeRatings, setEmployeeRatings] = useState<EmployeeRatingsAnalytics | null>(null);
  const [clientRatings, setClientRatings] = useState<ClientRatingsAnalytics | null>(null);
  const [aiRatings, setAiRatings] = useState<AiRatingsAnalytics | null>(null);
  const [matrix, setMatrix] = useState<MutualRatingMatrix | null>(null);
  const [ledger, setLedger] = useState<RatingLedgerResponse | null>(null);
  const [ratingsTab, setRatingsTab] = useState<RatingsTab>('client_to_employee');
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [ratingsError, setRatingsError] = useState<string | null>(null);
  const [ledgerFilters, setLedgerFilters] = useState<RatingLedgerFilters>({ limit: 50, offset: 0 });

  const templates = useMemo(
    () => data.templates.filter((template) => template.audience === builderAudience),
    [builderAudience, data.templates],
  );

  const selectedLedgerEntry = useMemo<RatingLedgerEntry | null>(
    () => ledger?.items[0] ?? null,
    [ledger],
  );

  const setActiveSection = useCallback(
    (section: SurveysSection) => {
      const nextPath = getSurveysPathForSection(section);
      if (location.pathname !== nextPath) {
        navigate(nextPath);
      }
    },
    [location.pathname, navigate],
  );

  const loadEmployeeAnalytics = useCallback(async () => {
    setEmployeeLoading(true);
    setEmployeeError(null);
    try {
      setEmployeeAnalytics(await apiClient.fetchEmployeeClientAssessmentAnalytics());
    } catch (error) {
      setEmployeeError(error instanceof Error ? error.message : 'Не удалось загрузить аналитику опросов сотрудников.');
    } finally {
      setEmployeeLoading(false);
    }
  }, [apiClient]);

  const loadRatings = useCallback(async (filters: RatingLedgerFilters = ledgerFilters) => {
    setRatingsLoading(true);
    setRatingsError(null);
    try {
      const [summary, employees, clients, ai, nextMatrix, nextLedger] = await Promise.all([
        apiClient.fetchRatingsSummary(),
        apiClient.fetchEmployeeRatingsAnalytics(),
        apiClient.fetchClientRatingsAnalytics(),
        apiClient.fetchAiRatingsAnalytics(),
        apiClient.fetchMutualRatingMatrix(),
        apiClient.fetchRatingLedger(filters),
      ]);
      setRatingsSummary(summary);
      setEmployeeRatings(employees);
      setClientRatings(clients);
      setAiRatings(ai);
      setMatrix(nextMatrix);
      setLedger(nextLedger);
    } catch (error) {
      setRatingsError(error instanceof Error ? error.message : 'Не удалось загрузить сводную аналитику.');
    } finally {
      setRatingsLoading(false);
    }
  }, [apiClient, ledgerFilters]);

  useEffect(() => {
    if (activeSection === 'employees') {
      void loadEmployeeAnalytics();
    }
  }, [activeSection, loadEmployeeAnalytics]);

  useEffect(() => {
    if (activeSection === 'ratings') {
      void loadRatings();
    }
  }, [activeSection, loadRatings]);

  useEffect(() => {
    const firstTemplate = templates[0];
    if (activeSection !== 'builder') return;
    if (firstTemplate && data.selectedTemplate?.audience !== builderAudience) {
      data.setSelectedTemplateId(firstTemplate.id);
      return;
    }
    if (!firstTemplate && data.draft.audience !== builderAudience) {
      data.startNewTemplate(builderAudience);
    }
  }, [activeSection, builderAudience, data, templates]);

  const updateQuestion = (index: number, patch: Partial<SurveyQuestion>) => {
    data.setDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, currentIndex) => (
        currentIndex === index ? { ...question, ...patch } : question
      )),
    }));
  };

  const addQuestion = () => {
    data.setDraft((draft) => ({
      ...draft,
      questions: [...draft.questions, createBlankSurveyQuestion(draft.questions.length + 1)],
    }));
  };

  const removeQuestion = (index: number) => {
    data.setDraft((draft) => ({
      ...draft,
      questions: draft.questions
        .filter((_, currentIndex) => currentIndex !== index)
        .map((question, currentIndex) => ({ ...question, sortOrder: currentIndex + 1 })),
    }));
  };

  const updateOption = (questionIndex: number, optionIndex: number, patch: Partial<SurveyQuestionOption>) => {
    data.setDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, currentIndex) => {
        if (currentIndex !== questionIndex) return question;
        const options = [...(question.config.options ?? [])];
        options[optionIndex] = { ...options[optionIndex], ...patch };
        return { ...question, config: { ...question.config, options } };
      }),
    }));
  };

  const addOption = (questionIndex: number) => {
    data.setDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, currentIndex) => {
        if (currentIndex !== questionIndex) return question;
        const options = question.config.options ?? [];
        return {
          ...question,
          config: {
            ...question.config,
            options: [...options, { id: `option_${options.length + 1}`, label: 'Новый вариант', score: null }],
          },
        };
      }),
    }));
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    data.setDraft((draft) => ({
      ...draft,
      questions: draft.questions.map((question, currentIndex) => {
        if (currentIndex !== questionIndex) return question;
        return {
          ...question,
          config: {
            ...question.config,
            options: (question.config.options ?? []).filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex),
          },
        };
      }),
    }));
  };

  return (
    <div className="page surveys-page surveys-page--app-sidebar">
      <header className="surveys-hero">
        <div>
          <span className="surveys-eyebrow">Опросы и оценки</span>
          <h1>Опросы клиентов и сотрудников</h1>
          <p>Конструктор анкет, отдельная аналитика по клиентам и сотрудникам, общий реестр движений.</p>
        </div>
        <div className="surveys-hero-actions">
          {activeSection === 'employees' ? <AssessmentBinFilter clientRatings={employeeAnalytics?.clientRatings} /> : null}
          <button
            type="button"
            className="surveys-button surveys-button--primary"
            onClick={() => void (activeSection === 'employees' ? loadEmployeeAnalytics() : data.load())}
            disabled={activeSection === 'employees' ? employeeLoading : data.isLoading}
          >
            Обновить
          </button>
        </div>
      </header>

      <nav className="surveys-tabs" aria-label="Разделы опросов">
        {[
          ['builder', 'Конструктор'],
          ['clients', 'Опросы клиентов'],
          ['employees', 'Оценка клиентов сотрудниками'],
          ['ratings', 'Сводная аналитика'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`surveys-tabs__button ${activeSection === key ? 'is-active' : ''}`}
            onClick={() => setActiveSection(key as SurveysSection)}
          >
            {label}
          </button>
        ))}
      </nav>

      {data.error ? <div className="surveys-alert">{data.error}</div> : null}

      {activeSection === 'builder' ? (
        <SurveyBuilderSection
          audience={builderAudience}
          onAudienceChange={(audience) => {
            setBuilderAudience(audience);
            data.startNewTemplate(audience);
          }}
          templates={templates}
          selectedTemplateId={data.selectedTemplateId}
          onSelectTemplate={data.setSelectedTemplateId}
          draft={data.draft}
          setDraft={data.setDraft}
          isLoading={data.isLoading}
          onSave={() => void data.saveDraft()}
          onDuplicate={() => void data.duplicateSelected()}
          onDelete={() => void data.deleteSelected()}
          onNew={() => data.startNewTemplate(builderAudience)}
          updateQuestion={updateQuestion}
          addQuestion={addQuestion}
          removeQuestion={removeQuestion}
          updateOption={updateOption}
          addOption={addOption}
          removeOption={removeOption}
        />
      ) : null}

      {activeSection === 'clients' ? (
        <ClientSurveyAnalytics analytics={data.analytics} isLoading={data.isAnalyticsLoading} onRefresh={data.reloadAnalytics} />
      ) : null}

      {activeSection === 'employees' ? (
        <EmployeeSurveyAnalytics analytics={employeeAnalytics} error={employeeError} />
      ) : null}

      {activeSection === 'ratings' ? (
        <RatingsAnalytics
          summary={ratingsSummary}
          employeeRatings={employeeRatings}
          clientRatings={clientRatings}
          aiRatings={aiRatings}
          matrix={matrix}
          ledger={ledger}
          selectedLedgerEntry={selectedLedgerEntry}
          activeTab={ratingsTab}
          onTabChange={setRatingsTab}
          filters={ledgerFilters}
          onFiltersChange={setLedgerFilters}
          isLoading={ratingsLoading}
          error={ratingsError}
          onRefresh={() => void loadRatings()}
          onApplyFilters={() => void loadRatings({ ...ledgerFilters, offset: 0 })}
        />
      ) : null}
    </div>
  );
};

interface BuilderSectionProps {
  audience: SurveyTemplateAudience;
  onAudienceChange: (audience: SurveyTemplateAudience) => void;
  templates: SurveyTemplate[];
  selectedTemplateId: number | null;
  onSelectTemplate: (id: number | null) => void;
  draft: Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;
  setDraft: React.Dispatch<React.SetStateAction<Omit<SurveyTemplate, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>>>;
  isLoading: boolean;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onNew: () => void;
  updateQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
  addQuestion: () => void;
  removeQuestion: (index: number) => void;
  updateOption: (questionIndex: number, optionIndex: number, patch: Partial<SurveyQuestionOption>) => void;
  addOption: (questionIndex: number) => void;
  removeOption: (questionIndex: number, optionIndex: number) => void;
}

const BuilderSection: React.FC<BuilderSectionProps> = ({
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
}) => (
  <section className="surveys-layout surveys-layout--builder">
    <aside className="surveys-panel surveys-template-list">
      <div className="surveys-segmented">
        {(['client', 'employee'] as SurveyTemplateAudience[]).map((item) => (
          <button
            key={item}
            type="button"
            className={audience === item ? 'is-active' : ''}
            onClick={() => onAudienceChange(item)}
          >
            {audienceLabels[item]}
          </button>
        ))}
      </div>
      <button type="button" className="surveys-button surveys-button--full" onClick={onNew}>
        Новый опрос
      </button>
      <div className="surveys-template-list__items">
        {templates.length === 0 ? <p className="surveys-muted">Шаблонов пока нет.</p> : null}
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className={`surveys-template-card ${selectedTemplateId === template.id ? 'is-active' : ''}`}
            onClick={() => onSelectTemplate(template.id)}
          >
            <strong>{template.title}</strong>
            <span>{statusLabels[template.status]} · {template.questions.length} вопросов</span>
          </button>
        ))}
      </div>
    </aside>

    <div className="surveys-panel surveys-editor">
      <div className="surveys-editor__head">
        <div>
          <span className="surveys-eyebrow">{audienceLabels[draft.audience]}</span>
          <h2>Конструктор</h2>
        </div>
        <div className="surveys-actions">
          <button type="button" className="surveys-button" onClick={onDuplicate} disabled={!selectedTemplateId || isLoading}>Дублировать</button>
          <button type="button" className="surveys-button" onClick={onDelete} disabled={!selectedTemplateId || isLoading}>Удалить</button>
          <button type="button" className="surveys-button surveys-button--primary" onClick={onSave} disabled={isLoading}>Сохранить</button>
        </div>
      </div>

      <div className="surveys-form-grid">
        <label className="surveys-field">
          <span>Название</span>
          <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className="surveys-field">
          <span>Статус</span>
          <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as SurveyTemplateStatus }))}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="surveys-field surveys-field--wide">
          <span>Описание</span>
          <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
        </label>
      </div>

      <div className="surveys-question-head">
        <div>
          <h3>Вопросы</h3>
          <p>{draft.questions.length} в шаблоне</p>
        </div>
        <button type="button" className="surveys-button" onClick={addQuestion}>Добавить вопрос</button>
      </div>

      <div className="surveys-question-list">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={`${question.id ?? 'new'}-${index}`}
            question={question}
            index={index}
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

interface QuestionEditorProps {
  question: SurveyQuestion;
  index: number;
  updateQuestion: (index: number, patch: Partial<SurveyQuestion>) => void;
  removeQuestion: (index: number) => void;
  updateOption: (questionIndex: number, optionIndex: number, patch: Partial<SurveyQuestionOption>) => void;
  addOption: (questionIndex: number) => void;
  removeOption: (questionIndex: number, optionIndex: number) => void;
}

const QuestionEditor: React.FC<QuestionEditorProps> = ({
  question,
  index,
  updateQuestion,
  removeQuestion,
  updateOption,
  addOption,
  removeOption,
}) => {
  const isChoice = question.questionType === 'single_choice' || question.questionType === 'multi_choice';

  const setQuestionType = (questionType: SurveyQuestionType) => {
    if (questionType === 'single_choice' || questionType === 'multi_choice') {
      updateQuestion(index, {
        questionType,
        config: question.config.options?.length
          ? question.config
          : { options: [{ id: 'option_1', label: 'Да' }, { id: 'option_2', label: 'Нет' }] },
      });
      return;
    }
    updateQuestion(index, {
      questionType,
      config: questionType === 'scale' ? { min: 1, max: 5, presentation: 'scale' } : {},
    });
  };

  return (
    <article className="surveys-question">
      <div className="surveys-question__top">
        <strong>Вопрос {index + 1}</strong>
        <button type="button" className="surveys-link-button" onClick={() => removeQuestion(index)}>Удалить</button>
      </div>
      <label className="surveys-field surveys-field--wide">
        <span>Текст вопроса</span>
        <input value={question.text} onChange={(event) => updateQuestion(index, { text: event.target.value })} />
      </label>
      <div className="surveys-form-grid">
        <label className="surveys-field">
          <span>Тип ответа</span>
          <select value={question.questionType} onChange={(event) => setQuestionType(event.target.value as SurveyQuestionType)}>
            {Object.entries(questionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="surveys-field">
          <span>Тематика</span>
          <select value={question.topic ?? ''} onChange={(event) => updateQuestion(index, { topic: event.target.value || null })}>
            {SURVEY_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
          </select>
        </label>
        <label className="surveys-check">
          <input type="checkbox" checked={question.required} onChange={() => updateQuestion(index, { required: !question.required })} />
          <span>Обязательный</span>
        </label>
      </div>
      {question.questionType === 'scale' ? (
        <div className="surveys-scale-row">
          <label className="surveys-field">
            <span>Минимум</span>
            <input type="number" min={1} max={9} value={question.config.min ?? 1} onChange={(event) => updateQuestion(index, { config: { ...question.config, min: Number(event.target.value) } })} />
          </label>
          <label className="surveys-field">
            <span>Максимум</span>
            <input type="number" min={2} max={10} value={question.config.max ?? 5} onChange={(event) => updateQuestion(index, { config: { ...question.config, max: Number(event.target.value) } })} />
          </label>
        </div>
      ) : null}
      {isChoice ? (
        <div className="surveys-options">
          <div className="surveys-options__head">
            <span>Варианты ответа</span>
            <button type="button" className="surveys-button surveys-button--compact" onClick={() => addOption(index)}>Добавить</button>
          </div>
          {(question.config.options ?? []).map((option, optionIndex) => (
            <div key={`${option.id}-${optionIndex}`} className="surveys-option-row">
              <input value={option.label} onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })} />
              <button type="button" className="surveys-link-button" onClick={() => removeOption(index, optionIndex)}>Удалить</button>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
};

const ClientSurveyAnalytics: React.FC<{
  analytics: SurveyAnalytics | null;
  isLoading: boolean;
  onRefresh: () => void;
}> = ({ analytics, isLoading, onRefresh }) => {
  const lineOption = useMemo(
    () => createLineOption(
      analytics?.monthlySatisfaction.map((item) => formatMonth(item.month)) ?? [],
      analytics?.monthlySatisfaction.map((item) => item.averageScore) ?? [],
      'Средняя оценка',
    ),
    [analytics],
  );
  const toneDonutOption = useMemo(
    () => createToneDonutOption(
      analytics?.positiveCount ?? 0,
      analytics?.neutralCount ?? 0,
      analytics?.negativeCount ?? 0,
    ),
    [analytics],
  );

  return (
    <AnalyticsPanel
      eyebrow="Опросы клиентов"
      title="Аналитика опросов клиентов"
      description="Главный счетчик показывает завершенные анкеты, а не количество вопросов внутри них."
      actionLabel="Обновить"
      onAction={onRefresh}
      isLoading={isLoading}
    >
      <div className="surveys-client-overview">
        <section className="surveys-score-card">
          <span className="surveys-eyebrow">Клиентский CSAT</span>
          <h3>Общая оценка сервиса</h3>
          <div className="surveys-score-card__value">
            <strong>{formatScore(analytics?.averageScore)}</strong>
            <span>из 5</span>
          </div>
          <p>
            {numberFormatter.format(analytics?.completedSurveyCount ?? 0)} завершенных опросов · {numberFormatter.format(analytics?.answerCount ?? 0)} ответов на вопросы
          </p>
          <div className="surveys-score-card__rows">
            <ToneRow label="Положительные" value={analytics?.positiveShare ?? 0} count={analytics?.positiveCount ?? 0} tone="ok" />
            <ToneRow label="Нейтральные" value={analytics?.neutralShare ?? 0} count={analytics?.neutralCount ?? 0} tone="neutral" />
            <ToneRow label="Негативные" value={analytics?.negativeShare ?? 0} count={analytics?.negativeCount ?? 0} tone="warn" />
          </div>
        </section>
        <section className="surveys-card surveys-trend-card">
          <h3>Тональность и динамика</h3>
          <p className="surveys-muted">Как меняется удовлетворенность и какой тип ответов преобладает.</p>
          <div className="surveys-trend-card__donut">
            <EChartsWrapper option={toneDonutOption} style={{ height: 150 }} />
          </div>
          <div className="surveys-tone-list surveys-trend-card__tone">
            <ToneRow label="Положительные" value={analytics?.positiveShare ?? 0} count={analytics?.positiveCount ?? 0} tone="ok" />
            <ToneRow label="Нейтральные" value={analytics?.neutralShare ?? 0} count={analytics?.neutralCount ?? 0} tone="neutral" />
            <ToneRow label="Негативные" value={analytics?.negativeShare ?? 0} count={analytics?.negativeCount ?? 0} tone="warn" />
          </div>
          {!analytics || analytics.monthlySatisfaction.length === 0 ? (
            <EmptyState text="Недостаточно данных по месяцам." />
          ) : (
            <EChartsWrapper option={lineOption} style={{ height: 170 }} />
          )}
        </section>
      </div>
      <KpiGrid
        items={[
          { label: 'Завершенные опросы', value: numberFormatter.format(analytics?.completedSurveyCount ?? 0), hint: '1 анкета = 1 опрос' },
          { label: 'Ответы на вопросы', value: numberFormatter.format(analytics?.answerCount ?? 0), hint: 'для детализации' },
          { label: 'Средняя оценка', value: formatScore(analytics?.averageScore), hint: 'из 5' },
          { label: 'Положительные', value: formatPercent(analytics?.positiveShare), hint: `${numberFormatter.format(analytics?.positiveCount ?? 0)} ответов` },
        ]}
      />
      {!analytics || ((analytics.completedSurveyCount ?? 0) === 0 && analytics.answerCount === 0) ? (
        <EmptyState text="Пока нет завершенных клиентских опросов." />
      ) : (
        <>
          <div className="surveys-dashboard-grid">
            <Card title="Тональность">
              <div className="surveys-tone-list">
                <ToneRow label="Положительные" value={analytics.positiveShare} count={analytics.positiveCount} tone="ok" />
                <ToneRow label="Нейтральные" value={analytics.neutralShare} count={analytics.neutralCount} tone="neutral" />
                <ToneRow label="Негативные" value={analytics.negativeShare} count={analytics.negativeCount} tone="warn" />
              </div>
            </Card>
            <Card title="Динамика оценок">
              {analytics.monthlySatisfaction.length === 0 ? <EmptyState text="Недостаточно данных по месяцам." /> : <EChartsWrapper option={lineOption} style={{ height: 220 }} />}
            </Card>
          </div>
          <div className="surveys-dashboard-grid surveys-dashboard-grid--three">
            <TopList title="Запросы клиентов" items={analytics.topClientRequests} />
            <TopList title="Пожелания по обучению" items={analytics.topTrainingWishes} />
            <TopList title="Замечания по сотрудникам" items={analytics.employeeRemarks} />
          </div>
        </>
      )}
    </AnalyticsPanel>
  );
};

const EmployeeSurveyAnalytics: React.FC<{
  analytics: EmployeeClientAssessmentAnalytics | null;
  error: string | null;
}> = ({ analytics, error }) => {
  const monthlyScores = analytics?.monthlyScores ?? [];
  const lineOption = useMemo(() => createAssessmentLineOption(
    monthlyScores.map((item) => formatShortMonth(item.month)),
    monthlyScores.map((item) => (item.count > 0 ? item.averageOverallScore : null)),
    monthlyScores.map((item) => (item.count > 0 ? item.averageInteractionQualityIndex : null)),
  ), [monthlyScores]);

  const bucketCounts = useMemo(() => {
    const total = analytics?.totalAssessments ?? 0;
    const low = Math.round(total * (analytics?.lowScoreShare ?? 0));
    const high = Math.round(total * (analytics?.highScoreShare ?? 0));
    const neutral = Math.max(0, total - low - high);
    return { total, low, neutral, high };
  }, [analytics]);

  const donutOption = useMemo(
    () => createAssessmentDonutOption(bucketCounts.low, bucketCounts.neutral, bucketCounts.high),
    [bucketCounts.high, bucketCounts.low, bucketCounts.neutral],
  );

  const percentOfTotal = useCallback((count: number) => (
    bucketCounts.total > 0 ? `${Math.round((count / bucketCounts.total) * 100)}%` : '0%'
  ), [bucketCounts.total]);

  const criteria = [
    { label: 'Индекс коммуникации', value: analytics?.averageInteractionQualityIndex ?? 0 },
    { label: 'Полные данные', value: (analytics?.firstTimeFullDataShare ?? 0) * 100 },
    { label: 'Повторы', value: (analytics?.repeatedRequestShare ?? 0) * 100 },
    { label: 'Первые обращения', value: (analytics?.firstContactShare ?? 0) * 100 },
  ];

  return (
    <section className="surveys-assessment">
      <div className="surveys-assessment-hero">
        <div>
          <h2>Внутренняя оценка взаимодействия с клиентами</h2>
        </div>
        <div className="surveys-assessment-hero__stats">
          <div>
            <span>Карточек</span>
            <strong>{numberFormatter.format(analytics?.totalAssessments ?? 0)}</strong>
          </div>
        </div>
      </div>

      {error ? <div className="surveys-alert">{error}</div> : null}
      {!analytics || analytics.totalAssessments === 0 ? (
        <div className="surveys-assessment-card">
          <EmptyState text="Пока нет заполненных опросов сотрудников." />
        </div>
      ) : (
        <>
          <div className="surveys-assessment-grid surveys-assessment-grid--hero">
            <section className="surveys-assessment-card surveys-assessment-card--quality">
              <h3>Качество взаимодействия</h3>
              <div className="surveys-assessment-score">
                <strong>{formatScore(analytics.averageOverallScore)}</strong>
                <span>из 5</span>
              </div>
              <p>Средняя внутренняя оценка клиента по пяти критериям.</p>
              <div className="surveys-assessment-criteria">
                {criteria.map((item) => {
                  const value = Math.max(0, Math.min(100, Math.round(item.value)));
                  return (
                    <div className="surveys-assessment-criteria__row" key={item.label}>
                      <span>{item.label}</span>
                      <div><i style={{ width: `${value}%` }} /></div>
                      <strong>{value}%</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="surveys-assessment-card">
              <h3>Динамика и структура оценок</h3>
              <p>Тренд общей оценки и индекс коммуникации по месяцам.</p>
              <div className="surveys-assessment-chart-combo">
                <div className="surveys-assessment-donut">
                  <div className="surveys-assessment-donut__stage">
                    <EChartsWrapper
                      option={donutOption}
                      className="surveys-assessment-donut-chart"
                      style={{ height: 130 }}
                    />
                    <div className="surveys-assessment-donut__center">
                      <strong>{numberFormatter.format(bucketCounts.total)}</strong>
                      <span>анкет</span>
                    </div>
                  </div>
                  <div className="surveys-assessment-legend">
                    <span><i className="is-low" />Низкие ({percentOfTotal(bucketCounts.low)})</span>
                    <span><i className="is-mid" />Нейтральные ({percentOfTotal(bucketCounts.neutral)})</span>
                    <span><i className="is-high" />Высокие ({percentOfTotal(bucketCounts.high)})</span>
                  </div>
                </div>
                <div>
                  <EChartsWrapper
                    option={lineOption}
                    className="surveys-assessment-line-chart"
                    style={{ height: 160 }}
                  />
                  <div className="surveys-assessment-series">
                    <span><i className="is-score" />Оценка</span>
                    <span><i className="is-index" />Индекс</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="surveys-assessment-grid surveys-assessment-grid--three">
            <ProgressCard title="Причины низких оценок" items={analytics.lowScoreReasons} tone="accent" />
            <ProgressCard title="Статусы коммуникации" items={analytics.interactionStatuses} tone="accent" />
            <ProgressCard title="Флаги обращений" items={analytics.interactionFlags} tone="accent" />
          </div>

          <div className="surveys-assessment-grid surveys-assessment-grid--two">
            <section className="surveys-assessment-card">
              <h3>Операционные показатели</h3>
              <div className="surveys-assessment-ops">
                <span>Средняя задержка ответа<strong>{(analytics.averageFeedbackDelayHours ?? 0).toFixed(1).replace('.', ',')} ч</strong></span>
                <span>Без уточнений<strong>{numberFormatter.format(analytics.withoutClarificationsCount)}</strong></span>
                <span>С затруднениями<strong>{numberFormatter.format(analytics.hinderedCount)}</strong></span>
                <span>Высокие оценки<strong className="is-good">{formatPercent(analytics.highScoreShare)}</strong></span>
                <span>Низкие оценки<strong className="is-bad">{formatPercent(analytics.lowScoreShare)}</strong></span>
              </div>
            </section>

            <section className="surveys-assessment-card surveys-assessment-card--character">
              <h3>Характер обращений</h3>
              <div className="surveys-assessment-character">
                {analytics.requestRepeatStatuses.map((item) => (
                  <ProgressRow key={item.label} item={item} max={Math.max(...analytics.requestRepeatStatuses.map((status) => status.count), 1)} tone="accent" />
                ))}
              </div>
            </section>
          </div>

          <div className="surveys-assessment-grid surveys-assessment-grid--two">
            <section className="surveys-assessment-card">
              <h3>Рейтинг клиентов</h3>
              <div className="surveys-assessment-table-wrap surveys-assessment-table-wrap--limited">
                <table className="surveys-assessment-table">
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Рейтинг</th>
                      <th>Ср. балл</th>
                      <th>Обращения</th>
                      <th>Повторы</th>
                      <th>С первого раза</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.clientRatings.map((item) => (
                      <tr key={`${item.clientName}-${item.clientBin ?? 'no-bin'}`}>
                        <td>
                          <strong>{item.clientName}</strong>
                          {item.clientBin ? <small>{item.clientBin}</small> : null}
                        </td>
                        <td><ScoreBadge value={item.internalRating} suffix="%" /></td>
                        <td><b>{formatTableScore(item.averageOverallScore)}</b></td>
                        <td>{numberFormatter.format(item.taskCount)}</td>
                        <td><span className="surveys-assessment-percent">{formatPercent(item.repeatedRequestShare)}</span></td>
                        <td><span className="surveys-assessment-percent is-good">{formatPercent(item.firstContactShare)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="surveys-assessment-card">
              <h3>Последние оценки</h3>
              <div className="surveys-assessment-table-wrap surveys-assessment-table-wrap--limited">
                <table className="surveys-assessment-table">
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Сотрудник</th>
                      <th>Балл</th>
                      <th>Индекс</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.recentAssessments.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.clientName}</strong>
                          {item.clientBin ? <small>{item.clientBin}</small> : null}
                        </td>
                        <td>{item.assignedUserName ?? '-'}</td>
                        <td><ScoreBadge value={item.overallScore} /></td>
                        <td><span className="surveys-assessment-percent">{item.interactionQualityIndex === null || item.interactionQualityIndex === undefined ? '-' : `${Math.round(item.interactionQualityIndex)}%`}</span></td>
                        <td><span className="surveys-assessment-date">{formatDate(item.submittedAt)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
};

const ProgressRow: React.FC<{
  item: { label: string; count: number };
  max: number;
  tone: 'accent' | 'teal' | 'green';
}> = ({ item, max, tone }) => {
  const width = max > 0 ? Math.max(6, Math.round((item.count / max) * 100)) : 0;
  return (
    <div className="surveys-assessment-progress">
      <div>
        <span>{item.label}</span>
        <strong>{numberFormatter.format(item.count)}</strong>
      </div>
      <em><i className={`is-${tone}`} style={{ width: `${width}%` }} /></em>
    </div>
  );
};

const ProgressCard: React.FC<{
  title: string;
  items: Array<{ label: string; count: number }>;
  tone: 'accent' | 'teal' | 'green';
}> = ({ title, items, tone }) => {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <section className="surveys-assessment-card">
      <h3>{title}</h3>
      <div className="surveys-assessment-progress-list">
        {items.length === 0 ? <EmptyState text="Нет данных." /> : items.map((item) => (
          <ProgressRow key={item.label} item={item} max={max} tone={tone} />
        ))}
      </div>
    </section>
  );
};

const ScoreBadge: React.FC<{ value: number | null | undefined; suffix?: string }> = ({ value, suffix }) => {
  const numericValue = value ?? null;
  const tone = numericValue === null
    ? 'mid'
    : suffix === '%'
      ? numericValue >= 50 ? 'high' : numericValue >= 40 ? 'mid' : 'low'
      : numericValue >= 3.5 ? 'high' : numericValue >= 2 ? 'mid' : 'low';
  const text = numericValue === null
    ? '-'
    : suffix === '%'
      ? formatOneDecimalPercent(numericValue)
      : formatTableScore(numericValue);
  return <span className={`surveys-assessment-badge is-${tone}`}>{text}</span>;
};

const RatingsAnalytics: React.FC<{
  summary: RatingsSummary | null;
  employeeRatings: EmployeeRatingsAnalytics | null;
  clientRatings: ClientRatingsAnalytics | null;
  aiRatings: AiRatingsAnalytics | null;
  matrix: MutualRatingMatrix | null;
  ledger: RatingLedgerResponse | null;
  selectedLedgerEntry: RatingLedgerEntry | null;
  activeTab: RatingsTab;
  onTabChange: (tab: RatingsTab) => void;
  filters: RatingLedgerFilters;
  onFiltersChange: React.Dispatch<React.SetStateAction<RatingLedgerFilters>>;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onApplyFilters: () => void;
}> = ({
  summary,
  employeeRatings,
  clientRatings,
  aiRatings,
  matrix,
  ledger,
  selectedLedgerEntry,
  activeTab,
  onTabChange,
  filters,
  onFiltersChange,
  isLoading,
  error,
  onRefresh,
  onApplyFilters,
}) => (
  <AnalyticsPanel
    eyebrow="Сводная аналитика"
    title="Все движения оценок"
    description="Отдельные срезы по направлениям и общий реестр: кто, кому и какую оценку поставил."
    actionLabel="Обновить"
    onAction={onRefresh}
    isLoading={isLoading}
  >
    {error ? <div className="surveys-alert">{error}</div> : null}
    <KpiGrid
      items={[
        { label: 'Клиент -> сотрудник', value: numberFormatter.format(summary?.employees.ratingCount ?? 0), hint: 'оценок клиентов' },
        { label: 'Сотрудник -> клиент', value: numberFormatter.format(summary?.clients.assessmentCount ?? 0), hint: 'внутренних анкет' },
        { label: 'Клиент -> ИИ', value: numberFormatter.format(summary?.ai.ratingCount ?? 0), hint: 'оценок ИИ' },
        { label: 'В реестре', value: numberFormatter.format(ledger?.total ?? 0), hint: 'движений' },
      ]}
    />
    <div className="surveys-subtabs">
      {[
        ['client_to_employee', 'Клиент -> сотрудник'],
        ['employee_to_client', 'Сотрудник -> клиент'],
        ['ai', 'Клиент -> ИИ'],
        ['ledger', 'Реестр'],
      ].map(([key, label]) => (
        <button key={key} type="button" className={activeTab === key ? 'is-active' : ''} onClick={() => onTabChange(key as RatingsTab)}>
          {label}
        </button>
      ))}
    </div>
    {activeTab === 'client_to_employee' ? <EmployeeRatingsSlice analytics={employeeRatings} /> : null}
    {activeTab === 'employee_to_client' ? <ClientRatingsSlice analytics={clientRatings} /> : null}
    {activeTab === 'ai' ? <AiRatingsSlice analytics={aiRatings} matrix={matrix} /> : null}
    {activeTab === 'ledger' ? (
      <LedgerSlice
        ledger={ledger}
        selectedEntry={selectedLedgerEntry}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onApplyFilters={onApplyFilters}
      />
    ) : null}
  </AnalyticsPanel>
);

const EmployeeRatingsSlice: React.FC<{ analytics: EmployeeRatingsAnalytics | null }> = ({ analytics }) => {
  if (!analytics || analytics.rows.length === 0) return <EmptyState text="Пока нет оценок сотрудников клиентами." />;
  return (
    <>
      <div className="surveys-dashboard-grid surveys-dashboard-grid--three">
        <TopList title="Причины низких оценок" items={analytics.lowScoreReasons} />
        <TopList title="Лучшие сотрудники" items={analytics.topEmployees.map((item) => ({ label: item.employeeName, count: item.ratedAppealsCount }))} />
        <TopList title="Низкие оценки" items={analytics.problemEmployees.map((item) => ({ label: item.employeeName, count: item.totalLowRatings }))} />
      </div>
      <Card title="Рейтинг сотрудников">
        <DataTable
          headers={['Сотрудник', 'Средний балл', 'Оценки', 'Высокие', 'Низкие']}
          rows={analytics.rows.map((item) => [
            item.employeeName,
            formatScore(item.averageScore),
            numberFormatter.format(item.ratedAppealsCount),
            formatPercent(item.highScoreShare),
            formatPercent(item.lowScoreShare),
          ])}
        />
      </Card>
    </>
  );
};

const ClientRatingsSlice: React.FC<{ analytics: ClientRatingsAnalytics | null }> = ({ analytics }) => {
  if (!analytics || analytics.rows.length === 0) return <EmptyState text="Пока нет внутренних оценок клиентов." />;
  return (
    <>
      <div className="surveys-dashboard-grid surveys-dashboard-grid--three">
        <TopList title="Причины низких оценок" items={analytics.lowScoreReasons} />
        <TopList title="Статусы взаимодействия" items={analytics.interactionStatuses} />
        <TopList title="Флаги коммуникации" items={analytics.interactionFlags} />
      </div>
      <Card title="Рейтинг клиентов">
        <DataTable
          headers={['Клиент', 'Средний балл', 'Индекс', 'Обращения', 'Рекомендация']}
          rows={analytics.rows.map((item) => [
            `${item.clientName}${item.clientBin ? ` · ${item.clientBin}` : ''}`,
            formatScore(item.averageScore),
            item.interactionQualityIndex === null ? '-' : `${Math.round(item.interactionQualityIndex)}%`,
            numberFormatter.format(item.completedAppealsCount),
            item.recommendation ?? '-',
          ])}
        />
      </Card>
    </>
  );
};

const AiRatingsSlice: React.FC<{ analytics: AiRatingsAnalytics | null; matrix: MutualRatingMatrix | null }> = ({ analytics, matrix }) => {
  if (!analytics) return <EmptyState text="Пока нет оценок ИИ." />;
  return (
    <>
      <div className="surveys-dashboard-grid surveys-dashboard-grid--three">
        <TopList title="Причины низких оценок ИИ" items={analytics.lowScoreReasons} />
        <TopList title="Полезные категории" items={analytics.topUsefulSections.map((item) => ({ label: item.section ?? 'Без категории', count: item.ratingCount }))} />
        <TopList title="На проверку" items={analytics.reviewRequiredSections.map((item) => ({ label: item.section ?? 'Без категории', count: item.ratingCount }))} />
      </div>
      <Card title="Матрица направлений">
        <div className="surveys-matrix-grid">
          {(matrix?.cells ?? []).map((item) => (
            <div key={item.code} className="surveys-matrix-cell">
              <span>{item.label}</span>
              <strong>{numberFormatter.format(item.count)}</strong>
              <small>{item.averageScore === null ? 'Нет данных' : `Средний балл ${formatScore(item.averageScore)}`}</small>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
};

const LedgerSlice: React.FC<{
  ledger: RatingLedgerResponse | null;
  selectedEntry: RatingLedgerEntry | null;
  filters: RatingLedgerFilters;
  onFiltersChange: React.Dispatch<React.SetStateAction<RatingLedgerFilters>>;
  onApplyFilters: () => void;
}> = ({ ledger, selectedEntry, filters, onFiltersChange, onApplyFilters }) => (
  <div className="surveys-ledger">
    <Card title="Фильтры реестра">
      <div className="surveys-filter-grid">
        <label className="surveys-field">
          <span>С даты</span>
          <input type="date" value={filters.startDate ?? ''} onChange={(event) => onFiltersChange((current) => ({ ...current, startDate: event.target.value || null }))} />
        </label>
        <label className="surveys-field">
          <span>По дату</span>
          <input type="date" value={filters.endDate ?? ''} onChange={(event) => onFiltersChange((current) => ({ ...current, endDate: event.target.value || null }))} />
        </label>
        <label className="surveys-field">
          <span>Сотрудник</span>
          <input value={filters.employeeName ?? ''} onChange={(event) => onFiltersChange((current) => ({ ...current, employeeName: event.target.value || null }))} />
        </label>
        <label className="surveys-field">
          <span>БИН клиента</span>
          <input value={filters.clientBin ?? ''} onChange={(event) => onFiltersChange((current) => ({ ...current, clientBin: event.target.value || null }))} />
        </label>
        <button type="button" className="surveys-button surveys-button--primary" onClick={onApplyFilters}>Применить</button>
      </div>
    </Card>
    <Card title="Реестр оценок">
      <DataTable
        headers={['Дата', 'Направление', 'Кто поставил', 'Кому', 'Балл', 'Канал']}
        rows={(ledger?.items ?? []).map((item) => [
          formatDate(item.createdAt),
          ratingDirectionLabels[item.sourceKind] ?? item.sourceKind,
          item.raterName ?? item.raterType,
          item.ratedObjectName ?? item.ratedObjectType,
          formatScore(item.finalScore),
          item.ratingChannel ?? '-',
        ])}
      />
    </Card>
    <Card title="Карточка оценки">
      {selectedEntry ? (
        <div className="surveys-detail-list">
          <span>Направление</span><strong>{ratingDirectionLabels[selectedEntry.sourceKind] ?? selectedEntry.sourceKind}</strong>
          <span>Клиент</span><strong>{selectedEntry.clientName ?? selectedEntry.clientBin ?? '-'}</strong>
          <span>Комментарий</span><strong>{selectedEntry.comment ?? '-'}</strong>
          <span>Причина низкой оценки</span><strong>{selectedEntry.lowScoreReason ?? '-'}</strong>
        </div>
      ) : <EmptyState text="В реестре нет записей." />}
    </Card>
  </div>
);

const AnalyticsPanel: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  isLoading: boolean;
  onAction: () => void;
  children: React.ReactNode;
}> = ({ eyebrow, title, description, actionLabel, isLoading, onAction, children }) => (
  <section className="surveys-panel surveys-analytics-panel">
    <div className="surveys-panel__head">
      <div>
        <span className="surveys-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <button type="button" className="surveys-button" onClick={onAction} disabled={isLoading}>
        {isLoading ? 'Загрузка...' : actionLabel}
      </button>
    </div>
    <div className="surveys-panel__body">{children}</div>
  </section>
);

const KpiGrid: React.FC<{ items: Array<{ label: string; value: string; hint: string }> }> = ({ items }) => (
  <div className="surveys-kpi-grid">
    {items.map((item) => (
      <div key={item.label} className="surveys-kpi">
        <span>{item.label}</span>
        <strong>{item.value}</strong>
        <small>{item.hint}</small>
      </div>
    ))}
  </div>
);

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="surveys-card">
    <h3>{title}</h3>
    {children}
  </section>
);

const TopList: React.FC<{ title: string; items: Array<{ label: string; count: number }> }> = ({ title, items }) => (
  <Card title={title}>
    {items.length === 0 ? <EmptyState text="Нет данных." /> : (
      <ul className="surveys-top-list">
        {items.slice(0, 8).map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <strong>{numberFormatter.format(item.count)}</strong>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const ToneRow: React.FC<{ label: string; value: number; count: number; tone: 'ok' | 'neutral' | 'warn' }> = ({ label, value, count, tone }) => (
  <div className={`surveys-tone-row surveys-tone-row--${tone}`}>
    <span>{label}</span>
    <strong>{formatPercent(value)}</strong>
    <small>{numberFormatter.format(count)}</small>
  </div>
);

const DataTable: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => (
  <div className="surveys-table-wrap">
    <table className="surveys-table">
      <thead>
        <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={headers.length}>Нет данных.</td></tr>
        ) : rows.map((row, index) => (
          <tr key={`${row[0]}-${index}`}>
            {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="surveys-empty">{text}</div>
);

export default SurveysPage;
