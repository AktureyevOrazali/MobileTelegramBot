import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type { EmployeeClientAssessmentAnalytics, SurveyAnalytics } from '../types';
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
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

const employeeAnalytics: EmployeeClientAssessmentAnalytics = {
  totalAssessments: 3,
  averageOverallScore: 2.3333333333,
  averageInteractionQualityIndex: 46,
  averageFeedbackDelayHours: 0,
  highScoreShare: 0,
  lowScoreShare: 2 / 3,
  repeatedRequestShare: 1 / 3,
  firstContactShare: 1 / 3,
  hinderedCount: 1,
  withoutClarificationsCount: 2,
  firstTimeFullDataShare: 2 / 3,
  lowScoreReasons: [
    { label: 'Другая причина', count: 1 },
    { label: 'Некорректная постановка вопроса', count: 1 },
  ],
  interactionStatuses: [
    { label: 'Клиент предоставил все необходимые данные', count: 2 },
    { label: 'Клиент предоставил данные частично', count: 1 },
  ],
  interactionFlags: [
    { label: 'Обращение было конструктивным', count: 2 },
    { label: 'Обращение затруднено из-за действий клиента', count: 1 },
  ],
  requestRepeatStatuses: [
    { label: 'Первое обращение', count: 1 },
    { label: 'Не повторное', count: 1 },
    { label: 'Повторное однотипное', count: 1 },
  ],
  monthlyScores: [
    { month: '2026-02', averageOverallScore: 0, averageInteractionQualityIndex: 0, count: 0 },
    { month: '2026-03', averageOverallScore: 0, averageInteractionQualityIndex: 0, count: 0 },
    { month: '2026-04', averageOverallScore: 2.33, averageInteractionQualityIndex: 1.6, count: 3 },
  ],
  clientRatings: [
    {
      clientName: 'saycheese228',
      clientBin: '131313131313',
      taskCount: 1,
      averageOverallScore: 3.8,
      averageInteractionQualityIndex: 58,
      highScoreShare: 0,
      lowScoreShare: 0,
      repeatedRequestShare: 0,
      firstContactShare: 1,
      averageFeedbackDelayHours: 0,
      hinderedCount: 0,
      withoutClarificationsCount: 1,
      firstTimeFullDataShare: 1,
      internalRating: 57.5,
    },
    {
      clientName: 'saycheese228',
      clientBin: '151515151515',
      taskCount: 2,
      averageOverallScore: 1.6,
      averageInteractionQualityIndex: 40,
      highScoreShare: 0,
      lowScoreShare: 1,
      repeatedRequestShare: 0.5,
      firstContactShare: 0.5,
      averageFeedbackDelayHours: 0,
      hinderedCount: 1,
      withoutClarificationsCount: 1,
      firstTimeFullDataShare: 0.5,
      internalRating: 40,
    },
  ],
  recentAssessments: [
    {
      id: 1,
      clientName: 'saycheese228',
      clientBin: '131313131313',
      assignedUserName: 'test1',
      overallScore: 3.8,
      interactionQualityIndex: 58,
      lowScoreReason: null,
      submittedAt: new Date('2026-04-15T00:00:00Z'),
      repeatedRequest: false,
      requestRepeatStatus: 'first_contact',
      clientDataOverdue: false,
      aiAssisted: false,
    },
    {
      id: 2,
      clientName: 'saycheese228',
      clientBin: '151515151515',
      assignedUserName: 'Администратор',
      overallScore: 1.2,
      interactionQualityIndex: 36,
      lowScoreReason: 'Другая причина',
      submittedAt: new Date('2026-04-15T00:00:00Z'),
      repeatedRequest: true,
      requestRepeatStatus: 'repeated_same_issue',
      clientDataOverdue: true,
      aiAssisted: false,
    },
    {
      id: 3,
      clientName: 'saycheese228',
      clientBin: '151515151515',
      assignedUserName: 'test1',
      overallScore: 2,
      interactionQualityIndex: 44,
      lowScoreReason: 'Некорректная постановка вопроса',
      submittedAt: new Date('2026-04-15T00:00:00Z'),
      repeatedRequest: false,
      requestRepeatStatus: 'not_repeated',
      clientDataOverdue: false,
      aiAssisted: false,
    },
  ],
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

function renderEmployeeAnalyticsPage() {
  const apiClient = {
    fetchSurveyTemplates: vi.fn().mockResolvedValue([]),
    fetchSurveyAnalytics: vi.fn().mockResolvedValue(emptySurveyAnalytics),
    fetchEmployeeClientAssessmentAnalytics: vi.fn().mockResolvedValue(employeeAnalytics),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/employees']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage employee analytics', () => {
  it('renders the employee-to-client dashboard with score structure, dynamics, ratings, and recent scores', async () => {
    const { container } = renderEmployeeAnalyticsPage();

    expect(await screen.findByText('Внутренняя оценка взаимодействия с клиентами')).toBeInTheDocument();
    expect(screen.getByText('Карточек')).toBeInTheDocument();
    expect(screen.queryByText('Средний балл')).not.toBeInTheDocument();
    expect(screen.queryByText('Качество данных, скорость ответа и деловая коммуникация.')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment > .surveys-assessment-hero .surveys-assessment-eyebrow')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment-card--quality > .surveys-assessment-eyebrow')).not.toBeInTheDocument();
    expect(screen.queryByText('Сигналы, которые помогают понять поведение клиента в процессе.')).not.toBeInTheDocument();
    expect(screen.queryByText('Как распределяются первые, повторные и неповторные кейсы.')).not.toBeInTheDocument();
    expect(screen.queryByText('Качество взаимодействия по БИН и доля проблемных кейсов.')).not.toBeInTheDocument();
    expect(screen.queryByText('Свежие анкеты сотрудников без перехода в сырой журнал.')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-assessment-tags')).not.toBeInTheDocument();
    expect(container.querySelector('.surveys-hero .surveys-assessment-filter')).toBeInTheDocument();
    expect(screen.getAllByText('2,33')[0]).toBeInTheDocument();
    expect(screen.getByText('Динамика и структура оценок')).toBeInTheDocument();
    expect(screen.getByText('Низкие (67%)')).toBeInTheDocument();
    expect(screen.getByText('Нейтральные (33%)')).toBeInTheDocument();
    expect(screen.getByText('Высокие (0%)')).toBeInTheDocument();
    expect(screen.getByText('Причины низких оценок')).toBeInTheDocument();
    expect(screen.getAllByText('Клиент предоставил все необходимые данные').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Операционные показатели')).toBeInTheDocument();
    expect(screen.getByText('Рейтинг клиентов')).toBeInTheDocument();
    expect(screen.getByText('Последние оценки')).toBeInTheDocument();
    expect(screen.getAllByText('saycheese228').length).toBeGreaterThanOrEqual(2);

    await waitFor(() => {
      expect(screen.getByTestId('surveys-assessment-line-chart')).toHaveTextContent('Фев');
      expect(screen.getByTestId('surveys-assessment-line-chart')).toHaveTextContent('Оценка');
      expect(screen.getByTestId('surveys-assessment-donut-chart')).toHaveTextContent('Низкие');
    });

    const donutOption = JSON.parse(screen.getByTestId('surveys-assessment-donut-chart').textContent ?? '{}');
    expect(donutOption.series[0]).toMatchObject({
      radius: ['75%', '88%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 5,
        borderWidth: 2,
      },
    });
    expect(container.querySelector('.surveys-assessment-card--character')).toBeInTheDocument();
    expect(container.querySelectorAll('.surveys-assessment-table-wrap--limited')).toHaveLength(2);
  });
});
