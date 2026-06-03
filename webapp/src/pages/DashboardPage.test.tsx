import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from './DashboardPage';

vi.mock('../components/EChartsWrapper', () => ({
  default: () => <div data-testid="chart" />,
}));

vi.mock('../components/RegionActivityMap', () => ({
  default: () => <div data-testid="region-map" />,
  useIsDarkTheme: () => false,
}));

vi.mock('../components/dashboard/DashboardHero', () => ({
  default: () => <div data-testid="dashboard-hero" />,
}));

vi.mock('../hooks/useDashboardData', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useDashboardData')>('../hooks/useDashboardData');
  return {
    ...actual,
    useDashboardData: vi.fn(),
  };
});

import { useDashboardData, type DashboardTab } from '../hooks/useDashboardData';

const mockedUseDashboardData = vi.mocked(useDashboardData);

const makeDashboardState = (dashboardTab: DashboardTab) => ({
  data: {
    updatedAt: new Date('2026-05-22T08:00:00Z'),
    totalDialogs: 0,
    openDialogs: 0,
    closedDialogs: 0,
    totalMessages: 0,
    totalOutgoingMessages: 0,
    aiClosedDialogs: 0,
    transferredToOperatorDialogs: 0,
    aiMessagesCount: 0,
    avgMessagesBeforeTransfer: null,
    avgResponseTimeMinutes: null,
    slaCompliancePercentage: null,
    slaViolationsCount: 0,
    recurringRequestsCount: 0,
    recurringRequestsPercentage: null,
    csatAverage: null,
    csatCount: 0,
    csatDistribution: [],
    aiCsatAverage: null,
    aiCsatCount: 0,
    aiCsatDistribution: [],
    dialogMetrics: [],
    responseTimeDialogs: [],
    sectionBreakdown: [],
    questionsBySection: [],
    topQuestions: [],
    recentActivity: [],
    agentBreakdown: [],
    requestsWithContract: 0,
    requestsWithoutContract: 0,
    topBinsWithContract: [],
    topBinsWithoutContract: [],
    peakLoadHeatmap: [],
    averageFirstMessageLength: null,
  },
  hasData: false,
  loading: true,
  refreshing: false,
  isLoading: true,
  error: null,
  dashboardTab,
  setDashboardTab: vi.fn(),
  topMetric: 'avgResponse',
  setTopMetric: vi.fn(),
  metricOptions: [],
  activeMetricConfig: { label: 'Metric', getValue: () => null, format: () => '-', sortDirection: 'asc' },
  topOperators: [],
  agentStats: [],
  numberFormatter: new Intl.NumberFormat('ru-RU'),
  activeFilters: {},
  loadData: vi.fn(),
  operatorCount: 0,
  operators: [],
  totalOperators: 0,
  activeOperatorId: null,
  selectedOperatorAliases: null,
  responseSegments: [],
  messagesPerDay: 0,
  timeRange: { startDate: null, endDate: null, label: '7 дней' },
  selectedQuestionSection: 'all',
  setSelectedQuestionSection: vi.fn(),
  questionSectionOptions: [],
  selectedQuestions: [],
});

describe('DashboardPage loading skeletons', () => {
  it.each([
    ['overview', 'dashboard-overview-row'],
    ['operators', 'dashboard-columns'],
    ['sections', 'dashboard-columns'],
    ['activity', 'dashboard-card'],
    ['commercial', 'dashboard-columns'],
  ] as const)('keeps real %s tab card containers during initial loading', (tab, expectedClass) => {
    mockedUseDashboardData.mockReturnValue(makeDashboardState(tab) as any);

    const apiClient = {
      syncBinsWithContracts: vi.fn(() => new Promise(() => {})),
      getBinsDetailed: vi.fn(() => new Promise(() => {})),
      fetchChats: vi.fn(() => new Promise(() => {})),
    };

    const { container } = render(<DashboardPage apiClient={apiClient as any} />);

    expect(container.querySelector(`.${expectedClass}`)).toBeInTheDocument();
    expect(container.querySelector('.dashboard-card')).toBeInTheDocument();
    expect(container.querySelector('.dashboard-loading-state')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('dashboard-card-skeleton').length).toBeGreaterThan(0);
  });

  it('uses a full map-shaped skeleton while BIN map data is loading', () => {
    mockedUseDashboardData.mockReturnValue({
      ...makeDashboardState('overview'),
      hasData: true,
      loading: false,
      isLoading: false,
    } as any);
    const apiClient = {
      syncBinsWithContracts: vi.fn(() => new Promise(() => {})),
      getBinsDetailed: vi.fn(() => new Promise(() => {})),
      fetchChats: vi.fn(() => new Promise(() => {})),
    };

    const { container } = render(<DashboardPage apiClient={apiClient as any} />);

    expect(screen.getByTestId('dashboard-map-skeleton')).toBeInTheDocument();
    expect(container.querySelector('.dashboard-card--map .data-loading-state')).not.toBeInTheDocument();
  });

  it('loads current map BIN details without waiting for a slow contract sync', async () => {
    mockedUseDashboardData.mockReturnValue({
      ...makeDashboardState('overview'),
      hasData: true,
      loading: false,
      isLoading: false,
    } as any);
    const slowSync = new Promise(() => {});
    const apiClient = {
      syncBinsWithContracts: vi.fn(() => slowSync),
      getBinsDetailed: vi.fn().mockResolvedValue([]),
      fetchChats: vi.fn().mockResolvedValue([]),
    };

    render(<DashboardPage apiClient={apiClient as any} />);

    await waitFor(() => expect(apiClient.getBinsDetailed).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('dashboard-map-skeleton')).not.toBeInTheDocument());
    expect(apiClient.syncBinsWithContracts).toHaveBeenCalled();
  });
});
