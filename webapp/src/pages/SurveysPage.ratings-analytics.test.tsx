import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type {
  AiRatingsAnalytics,
  ClientRatingsAnalytics,
  EmployeeRatingsAnalytics,
  MutualRatingMatrix,
  RatingLedgerResponse,
  RatingsSummary,
  SurveyAnalytics,
} from '../types';
import SurveysPage from './SurveysPage';

vi.mock('../components/EChartsWrapper', () => ({
  default: ({ option, className }: { option: unknown; className?: string }) => (
    <div data-testid={className ?? 'chart'}>{JSON.stringify(option)}</div>
  ),
}));

const emptySurveyAnalytics: SurveyAnalytics = {
  averageScore: null,
  completedSurveyCount: 0,
  answerCount: 0,
  scoreCount: 0,
  positiveCount: 0,
  neutralCount: 0,
  negativeCount: 0,
  neutralShare: 0,
  positiveShare: 0,
  negativeShare: 0,
  monthlySatisfaction: [],
  topClientRequests: [],
  topTrainingWishes: [],
  employeeRemarks: [],
  answers: [],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-04-20T00:00:00Z'),
};

const summaryEntity = {
  averageScore: 4.2,
  ratingCount: 24,
  highScoreShare: 0.72,
  lowScoreShare: 0.08,
  averageResolutionMinutes: 37,
  withoutRepeatShare: 0.81,
  withoutEscalationShare: 0.9,
  aiAssistedShare: 0.58,
  closureCorrectness: 0.94,
  fullDataFirstTimeShare: 0.78,
  assessmentCount: 18,
  averageFeedbackDelayHours: 1.3,
  repeatedRequestShare: 0.19,
  hinderedCount: 2,
  interactionQualityIndex: 76,
  aiUsageShare: 0.63,
  inaccurateShare: 0.06,
  manualCorrectionShare: 0.17,
  clientFeedbackCount: 11,
  employeeFeedbackCount: 9,
  notAvailable: [],
};

const ratingsSummary: RatingsSummary = {
  employees: summaryEntity,
  clients: { ...summaryEntity, averageScore: 3.9, ratingCount: 18, assessmentCount: 18 },
  ai: { ...summaryEntity, averageScore: 4.1, ratingCount: 14, manualCorrectionShare: 0.17 },
  missingFlows: [],
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};

const employeeRatings: EmployeeRatingsAnalytics = {
  summary: ratingsSummary.employees,
  rows: [
    {
      employeeId: 7,
      employeeName: 'Operator One',
      averageScore: 4.8,
      ratedAppealsCount: 12,
      highScoreShare: 0.92,
      lowScoreShare: 0,
      averageResolutionMinutes: 24,
      withoutRepeatShare: 0.9,
      withoutEscalationShare: 1,
      aiAssistedShare: 0.75,
      closureCorrectness: 0.98,
      totalLowRatings: 0,
    },
    {
      employeeId: 8,
      employeeName: 'Operator Two',
      averageScore: 2.6,
      ratedAppealsCount: 6,
      highScoreShare: 0.2,
      lowScoreShare: 0.5,
      averageResolutionMinutes: 62,
      withoutRepeatShare: 0.5,
      withoutEscalationShare: 0.6,
      aiAssistedShare: 0.25,
      closureCorrectness: 0.7,
      totalLowRatings: 3,
    },
  ],
  monthlyDynamics: [
    { month: '2026-02', averageScore: 3.7, ratingCount: 5 },
    { month: '2026-03', averageScore: 4.1, ratingCount: 7 },
    { month: '2026-04', averageScore: 4.4, ratingCount: 12 },
  ],
  lowScoreReasons: [{ label: 'Долгое ожидание', count: 2 }],
  aiImpact: [
    { label: 'С подсказками ИИ', averageScore: 4.6, ratingCount: 10 },
    { label: 'Без ИИ', averageScore: 3.5, ratingCount: 8 },
  ],
  topEmployees: [],
  problemEmployees: [],
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};
employeeRatings.topEmployees = [employeeRatings.rows[0]];
employeeRatings.problemEmployees = [employeeRatings.rows[1]];

const clientRatings: ClientRatingsAnalytics = {
  summary: ratingsSummary.clients,
  rows: [
    {
      clientBin: '131313131313',
      clientName: 'ACME',
      completedAppealsCount: 9,
      averageScore: 4.4,
      interactionQualityIndex: 82,
      fullDataFirstTimeShare: 0.88,
      averageFeedbackDelayHours: 0.8,
      repeatedRequestShare: 0.11,
      hinderedCount: 0,
      recommendation: 'Методическая поддержка',
    },
    {
      clientBin: '151515151515',
      clientName: 'Beta',
      completedAppealsCount: 5,
      averageScore: 2.7,
      interactionQualityIndex: 48,
      fullDataFirstTimeShare: 0.35,
      averageFeedbackDelayHours: 3.2,
      repeatedRequestShare: 0.4,
      hinderedCount: 2,
      recommendation: 'Вебинар по подготовке данных',
    },
  ],
  monthlyDynamics: [
    { month: '2026-03', averageScore: 3.8, interactionQualityIndex: 70, count: 8 },
    { month: '2026-04', averageScore: 4.0, interactionQualityIndex: 76, count: 10 },
  ],
  lowScoreReasons: [{ label: 'Неполные данные', count: 3 }],
  interactionStatuses: [{ label: 'Данные предоставлены полностью', count: 10 }],
  interactionFlags: [{ label: 'Требовались уточнения', count: 4 }],
  requestRepeatStatuses: [{ label: 'Повторные обращения', count: 3 }],
  supportCandidates: [],
  recentAssessments: [],
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};
clientRatings.supportCandidates = [clientRatings.rows[1]];

const aiRatings: AiRatingsAnalytics = {
  summary: ratingsSummary.ai,
  rows: [
    { section: 'Интеграции', averageScore: 4.5, ratingCount: 9, lowScoreShare: 0 },
    { section: 'Документы', averageScore: 3.4, ratingCount: 5, lowScoreShare: 0.2 },
  ],
  monthlyDynamics: [
    { month: '2026-03', averageScore: 3.9, ratingCount: 6 },
    { month: '2026-04', averageScore: 4.2, ratingCount: 8 },
  ],
  lowScoreReasons: [{ label: 'Неточная подсказка', count: 1 }],
  scenarioComparison: [
    { scenario: 'human_without_ai', label: 'Человек без ИИ', casesCount: 8, averageScore: 3.7 },
    { scenario: 'ai_without_human', label: 'ИИ без участия сотрудника', casesCount: 4, averageScore: 4.0 },
    { scenario: 'employee_with_ai', label: 'Сотрудник с подсказками ИИ', casesCount: 10, averageScore: 4.6 },
  ],
  topUsefulSections: [],
  reviewRequiredSections: [],
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};
aiRatings.topUsefulSections = [aiRatings.rows[0]];
aiRatings.reviewRequiredSections = [aiRatings.rows[1]];

const matrix: MutualRatingMatrix = {
  cells: [
    {
      code: 'client_to_employee',
      raterType: 'client',
      ratedObjectType: 'employee',
      label: 'Клиент оценил сотрудника',
      count: 24,
      averageScore: 4.2,
      status: 'active',
    },
    {
      code: 'manager_to_case',
      raterType: 'manager',
      ratedObjectType: 'case',
      label: 'Руководитель оценил закрытие кейса',
      count: 5,
      averageScore: 4.7,
      status: 'active',
    },
  ],
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};

const ledger: RatingLedgerResponse = {
  items: [
    {
      ratingId: 101,
      sourceTable: 'ratings',
      sourceKind: 'client_to_employee',
      appealId: 5001,
      dialogId: 3001,
      chatId: 2001,
      clientId: 1,
      clientBin: '131313131313',
      clientName: 'ACME',
      organization: 'ACME Group',
      section: 'Интеграции',
      region: 'Алматы',
      raterType: 'client',
      raterId: '1',
      raterName: 'ACME',
      ratedObjectType: 'employee',
      ratedObjectId: '7',
      ratedObjectName: 'Operator One',
      employeeId: 7,
      employeeName: 'Operator One',
      ratingChannel: 'survey',
      aiInvolved: true,
      finalScore: 4.8,
      comment: 'Быстро закрыли вопрос',
      lowScoreReason: null,
      parameterDetails: { speed: 5, quality: 4 },
      createdAt: new Date('2026-04-20T00:00:00Z'),
      status: 'closed',
      scenario: 'employee_with_ai',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
  updatedAt: new Date('2026-04-21T00:00:00Z'),
};

function renderRatingsPage() {
  const apiClient = {
    fetchSurveyTemplates: vi.fn().mockResolvedValue([]),
    fetchSurveyAnalytics: vi.fn().mockResolvedValue(emptySurveyAnalytics),
    fetchRatingsSummary: vi.fn().mockResolvedValue(ratingsSummary),
    fetchEmployeeRatingsAnalytics: vi.fn().mockResolvedValue(employeeRatings),
    fetchClientRatingsAnalytics: vi.fn().mockResolvedValue(clientRatings),
    fetchAiRatingsAnalytics: vi.fn().mockResolvedValue(aiRatings),
    fetchMutualRatingMatrix: vi.fn().mockResolvedValue(matrix),
    fetchRatingLedger: vi.fn().mockResolvedValue(ledger),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/ratings']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage ratings analytics', () => {
  it('renders the executive summary analytics in the same assessment design with mutual-rating controls', async () => {
    const user = userEvent.setup();
    const { container } = renderRatingsPage();

    expect((await screen.findAllByText('Сводная аналитика оценок')).length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.surveys-assessment')).toBeInTheDocument();
    expect(screen.getAllByText('Клиенты').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Сотрудники').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ИИ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Рейтинг сотрудников по качеству обслуживания')).toBeInTheDocument();
    expect(screen.getByText('Динамика оценок по периодам')).toBeInTheDocument();
    expect(screen.getByText('Зависимость оценки от использования ИИ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Кто кому поставил оценку' }));

    await waitFor(() => {
      expect(screen.getByText('Таблица взаимных оценок')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Тип оценщика')).toBeInTheDocument();
    expect(screen.getByLabelText('Тип оцениваемого объекта')).toBeInTheDocument();
    expect(screen.getByLabelText('Категория обращения')).toBeInTheDocument();
    expect(screen.getByLabelText('Регион')).toBeInTheDocument();
    expect(screen.getByLabelText('Организация')).toBeInTheDocument();
    expect(screen.getByText('Клиент оценил сотрудника')).toBeInTheDocument();
    expect(screen.getByText('Руководитель оценил закрытие кейса')).toBeInTheDocument();
    expect(screen.getAllByText('Номер обращения').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('5001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Детализация параметров')).toBeInTheDocument();
    expect(screen.getByText(/speed: 5/)).toBeInTheDocument();
    expect(screen.getByText('Участвовал ли ИИ')).toBeInTheDocument();
    expect(screen.getByText('Да')).toBeInTheDocument();
    expect(screen.getByText('Итоговый статус обращения')).toBeInTheDocument();
  });
});
