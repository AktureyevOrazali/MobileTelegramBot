import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/ApiClient';
import type { EmployeeClientAssessmentAnalytics, SurveyAnalytics, SurveyTemplate } from '../types';
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
  questionAnalytics: [],
  answers: [],
  answersPreviewLimited: false,
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

const employeeSurveyAnalytics: SurveyAnalytics = {
  ...emptySurveyAnalytics,
  averageScore: 4.4,
  completedSurveyCount: 2,
  answerCount: 5,
  scoreCount: 4,
  positiveCount: 3,
  neutralCount: 1,
  negativeCount: 0,
  positiveShare: 0.75,
  neutralShare: 0.25,
  negativeShare: 0,
  monthlySatisfaction: [{ month: '2026-04', averageScore: 4.4, count: 2 }],
};

const employeeAssessmentAnalytics: EmployeeClientAssessmentAnalytics = {
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
    { label: 'Needs clarification', count: 2 },
  ],
  interactionStatuses: [
    { label: 'Full data provided', count: 2 },
  ],
  interactionFlags: [
    { label: 'Constructive interaction', count: 2 },
  ],
  requestRepeatStatuses: [
    { label: 'First contact', count: 1 },
    { label: 'Repeated request', count: 2 },
  ],
  monthlyScores: [
    { month: '2026-04', averageOverallScore: 2.33, averageInteractionQualityIndex: 46, count: 3 },
  ],
  clientRatings: [
    {
      clientName: 'Client Alpha',
      clientBin: '131313131313',
      taskCount: 3,
      averageOverallScore: 2.33,
      averageInteractionQualityIndex: 46,
      highScoreShare: 0,
      lowScoreShare: 2 / 3,
      repeatedRequestShare: 1 / 3,
      firstContactShare: 1 / 3,
      averageFeedbackDelayHours: 0,
      hinderedCount: 1,
      withoutClarificationsCount: 2,
      firstTimeFullDataShare: 2 / 3,
      internalRating: 46,
    },
  ],
  recentAssessments: [
    {
      id: 1,
      clientName: 'Client Alpha',
      clientBin: '131313131313',
      assignedUserName: 'Operator One',
      overallScore: 2.33,
      interactionQualityIndex: 46,
      lowScoreReason: 'Needs clarification',
      submittedAt: new Date('2026-04-15T00:00:00Z'),
      repeatedRequest: true,
      requestRepeatStatus: 'repeated_same_issue',
      clientDataOverdue: false,
      aiAssisted: false,
    },
  ],
  updatedAt: new Date('2026-04-15T00:00:00Z'),
};

const currentEmployeeTemplate: SurveyTemplate = {
  id: 88,
  title: 'Current employee survey',
  description: '',
  audience: 'employee',
  status: 'active',
  triggerType: 'after_appeal_closed',
  periodicInterval: null,
  scheduledAt: null,
  launchRules: [{ type: 'after_appeal_closed', dates: [] }],
  isAnonymous: false,
  createdBy: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-18T00:00:00Z'),
  questions: [],
};

function renderEmployeeAnalyticsPage() {
  const apiClient = {
    fetchSurveyTemplates: vi.fn().mockResolvedValue([currentEmployeeTemplate]),
    fetchSurveyAnalytics: vi.fn().mockResolvedValue(employeeSurveyAnalytics),
    fetchEmployeeClientAssessmentAnalytics: vi.fn().mockResolvedValue(employeeAssessmentAnalytics),
  } as unknown as ApiClient;

  const result = render(
    <MemoryRouter initialEntries={['/surveys/employees']}>
      <SurveysPage apiClient={apiClient} />
    </MemoryRouter>,
  );

  return { apiClient, ...result };
}

describe('SurveysPage employee analytics', () => {
  it('renders employee survey analytics from submitted employee assessment forms', async () => {
    const user = userEvent.setup();
    const { container, apiClient } = renderEmployeeAnalyticsPage();

    expect(await screen.findByText('Аналитика опроса сотрудников')).toBeInTheDocument();
    expect((await screen.findAllByText('Client Alpha')).length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.surveys-assessment-card--quality')).toBeInTheDocument();
    expect(container.querySelector('.surveys-hero .surveys-assessment-filter')).toBeInTheDocument();

    await waitFor(() => {
      expect(apiClient.fetchEmployeeClientAssessmentAnalytics).toHaveBeenCalledWith({ clientBin: null });
    });

    await user.selectOptions(screen.getByLabelText('БИН'), '131313131313');
    await waitFor(() => {
      expect(apiClient.fetchEmployeeClientAssessmentAnalytics).toHaveBeenLastCalledWith({ clientBin: '131313131313' });
    });
  });
});
